import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { calculateFullDays } from "@/lib/trips";

const GMAIL_SEARCH_QUERY = [
  '"booking confirmation"',
  '"e-ticket"',
  '"itinerary"',
  '"reservation confirmed"',
  '"flight confirmation"',
  '"travel confirmation"',
].join(" OR ");

const BATCH_PROMPT = `You are a travel document parser for US expats tracking the IRS Physical Presence Test.

I will give you multiple email snippets. For EACH email that contains a real travel booking (flight, train, bus, hotel check-in/out), extract the trip data.

Return ONLY valid JSON in this format:
{
  "trips": [
    {
      "country": "full country name of destination",
      "date_arrived": "YYYY-MM-DD",
      "date_departed": "YYYY-MM-DD",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "source_subject": "the email subject this came from",
      "notes": "brief note about the booking"
    }
  ]
}

Rules:
- Use full country names (e.g., "United States", "Turkey", "Georgia", "Colombia")
- For flights: the destination country is where you arrive. Create one trip per destination.
- For multi-leg trips (A->B->C), create separate entries for B and C
- If an email is promotional, a newsletter, or not an actual booking, SKIP it
- If dates are unclear, set confidence to LOW
- Combine round-trip bookings into one trip entry with arrival and departure dates
- If only one date is available, use it for both arrived and departed`;

interface GmailMessage {
  id: string;
  threadId: string;
}

interface GmailMessageDetail {
  id: string;
  snippet: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string };
      parts?: Array<{
        mimeType: string;
        body?: { data?: string };
      }>;
    }>;
  };
}

const anthropic = new Anthropic();

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tax_year } = await request.json();

  if (!tax_year) {
    return NextResponse.json(
      { error: "tax_year is required" },
      { status: 400 }
    );
  }

  // Get Google access token
  const {
    data: { session },
  } = await supabase.auth.getSession();

  let accessToken = session?.provider_token;

  if (!accessToken) {
    const { data: userData } = await supabase
      .from("users")
      .select("google_refresh_token")
      .eq("id", user.id)
      .single();

    if (userData?.google_refresh_token) {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: userData.google_refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        accessToken = tokenData.access_token;
      }
    }
  }

  if (!accessToken) {
    return NextResponse.json(
      {
        error:
          "Google access token not available. Please log out and sign in again.",
      },
      { status: 401 }
    );
  }

  try {
    // Search Gmail for travel emails
    const afterDate = `${tax_year}/01/01`;
    const beforeDate = `${tax_year + 1}/01/01`;
    const query = `(${GMAIL_SEARCH_QUERY}) after:${afterDate} before:${beforeDate}`;
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=30`;

    const searchResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      let errorMessage = "Gmail API error";
      if (searchResponse.status === 403) {
        errorMessage =
          "Gmail access denied. Make sure you granted Gmail read access when signing in.";
      } else if (searchResponse.status === 401) {
        errorMessage =
          "Gmail token expired. Please log out and sign in again.";
      }
      return NextResponse.json(
        { error: errorMessage, details: errorText },
        { status: searchResponse.status }
      );
    }

    const searchData = await searchResponse.json();
    const messages: GmailMessage[] = searchData.messages || [];

    if (messages.length === 0) {
      return NextResponse.json({
        message: "No travel-related emails found",
        total_found: 0,
        new_processed: 0,
        successfully_parsed: 0,
        trips_created: 0,
      });
    }

    // Check which messages we've already processed
    const { data: existingSources } = await supabase
      .from("raw_sources")
      .select("gmail_message_id")
      .eq("user_id", user.id)
      .eq("source_type", "gmail")
      .in(
        "gmail_message_id",
        messages.map((m) => m.id)
      );

    const processedIds = new Set(
      existingSources?.map((s) => s.gmail_message_id) || []
    );
    const newMessages = messages.filter((m) => !processedIds.has(m.id));

    if (newMessages.length === 0) {
      return NextResponse.json({
        message: "All emails already processed",
        total_found: messages.length,
        new_processed: 0,
        successfully_parsed: 0,
        trips_created: 0,
      });
    }

    // Fetch all email snippets in parallel (fast — just Gmail API)
    const emailSummaries: Array<{
      id: string;
      subject: string;
      snippet: string;
      body: string;
    }> = [];

    const fetchPromises = newMessages.slice(0, 20).map(async (msg) => {
      try {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
        const msgResponse = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!msgResponse.ok) return null;

        const msgData: GmailMessageDetail = await msgResponse.json();
        const body = extractEmailBody(msgData);
        const subject =
          msgData.payload.headers.find(
            (h) => h.name.toLowerCase() === "subject"
          )?.value || "";

        return {
          id: msg.id,
          subject,
          snippet: msgData.snippet,
          body: body.slice(0, 3000),
        };
      } catch {
        return null;
      }
    });

    const results = await Promise.all(fetchPromises);
    for (const r of results) {
      if (r) emailSummaries.push(r);
    }

    if (emailSummaries.length === 0) {
      return NextResponse.json({
        message: "Could not fetch any email content",
        total_found: messages.length,
        new_processed: 0,
        successfully_parsed: 0,
        trips_created: 0,
      });
    }

    // Build a single prompt with all emails for one Claude call
    const emailBlock = emailSummaries
      .map(
        (e, i) =>
          `--- EMAIL ${i + 1} ---\nSubject: ${e.subject}\n\n${e.body}\n--- END EMAIL ${i + 1} ---`
      )
      .join("\n\n");

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `${BATCH_PROMPT}\n\nHere are ${emailSummaries.length} emails to parse:\n\n${emailBlock}`,
        },
      ],
    });

    const responseText = aiResponse.content
      .filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      )
      .map((block) => block.text)
      .join("");

    let parsedData: { trips: Array<{
      country: string;
      date_arrived: string;
      date_departed: string;
      confidence: string;
      source_subject: string;
      notes: string;
    }> };

    try {
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonString = jsonMatch
        ? jsonMatch[1].trim()
        : responseText.trim();
      parsedData = JSON.parse(jsonString);
    } catch {
      return NextResponse.json({
        error: "Failed to parse AI response",
        total_found: messages.length,
        new_processed: emailSummaries.length,
        successfully_parsed: 0,
        trips_created: 0,
      });
    }

    // Store raw_sources for processed emails
    for (const email of emailSummaries) {
      await supabase.from("raw_sources").insert({
        user_id: user.id,
        source_type: "gmail",
        gmail_message_id: email.id,
        raw_content: `Subject: ${email.subject}\n\n${email.body}`.slice(0, 50000),
        parsed_at: new Date().toISOString(),
      });
    }

    // Create trip records
    let tripsCreated = 0;
    const trips = parsedData.trips || [];

    for (const trip of trips) {
      if (!trip.country || !trip.date_arrived) continue;
      if (!trip.date_arrived.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

      const dateDeparted = trip.date_departed?.match(/^\d{4}-\d{2}-\d{2}$/)
        ? trip.date_departed
        : trip.date_arrived;

      const earlier =
        trip.date_arrived <= dateDeparted ? trip.date_arrived : dateDeparted;
      const later =
        trip.date_arrived > dateDeparted ? trip.date_arrived : dateDeparted;

      const fullDays = calculateFullDays(earlier, later);

      const { error: tripError } = await supabase.from("trips").insert({
        user_id: user.id,
        tax_year,
        country: trip.country,
        date_arrived: earlier,
        date_departed: later,
        full_days_present: fullDays,
        confidence: trip.confidence || "MEDIUM",
        notes: trip.notes || `From: ${trip.source_subject || "Gmail"}`,
        sort_order: 0,
      });

      if (!tripError) tripsCreated++;
    }

    return NextResponse.json({
      message: `Scanned ${emailSummaries.length} emails, found ${trips.length} bookings, created ${tripsCreated} trips`,
      total_found: messages.length,
      new_processed: emailSummaries.length,
      successfully_parsed: trips.length,
      trips_created: tripsCreated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to process Gmail: ${message}` },
      { status: 500 }
    );
  }
}

function extractEmailBody(message: GmailMessageDetail): string {
  if (message.payload.parts) {
    for (const part of message.payload.parts) {
      if (part.parts) {
        const textPart = part.parts.find((p) => p.mimeType === "text/plain");
        const htmlPart = part.parts.find((p) => p.mimeType === "text/html");
        const nested = textPart || htmlPart;
        if (nested?.body?.data) {
          return Buffer.from(nested.body.data, "base64").toString("utf-8");
        }
      }
      if (
        (part.mimeType === "text/plain" || part.mimeType === "text/html") &&
        part.body?.data
      ) {
        return Buffer.from(part.body.data, "base64").toString("utf-8");
      }
    }
  }

  if (message.payload.body?.data) {
    return Buffer.from(message.payload.body.data, "base64").toString("utf-8");
  }

  return message.snippet || "";
}
