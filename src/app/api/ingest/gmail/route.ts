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

const EXTRACTION_PROMPT = `You are a travel document parser. Extract travel booking data from this email.

Return ONLY valid JSON:
{
  "bookings": [
    {
      "type": "flight",
      "origin_country": "full country name",
      "destination_country": "full country name",
      "departure_date": "YYYY-MM-DD",
      "arrival_date": "YYYY-MM-DD",
      "booking_reference": ""
    }
  ],
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "notes": ""
}

Rules:
- Use full country names (e.g., "United States", "Turkey", "Georgia")
- If no travel booking data is found, return {"bookings": [], "confidence": "LOW", "notes": "No travel data found"}
- Only extract actual bookings, not promotional emails or ads`;

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
      { error: "Google access token not available. Please log out and sign in again." },
      { status: 401 }
    );
  }

  try {
    // Search Gmail for travel emails
    const afterDate = `${tax_year}/01/01`;
    const beforeDate = `${tax_year + 1}/01/01`;
    const query = `(${GMAIL_SEARCH_QUERY}) after:${afterDate} before:${beforeDate}`;
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`;

    const searchResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      let errorMessage = "Gmail API error";
      if (searchResponse.status === 403) {
        errorMessage = "Gmail access denied. Make sure you granted Gmail read access when signing in.";
      } else if (searchResponse.status === 401) {
        errorMessage = "Gmail token expired. Please log out and sign in again.";
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

    let tripsCreated = 0;
    let emailsParsed = 0;

    // Process each new email: fetch, parse with Claude, create trips
    for (const msg of newMessages) {
      try {
        // Fetch full email
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
        const msgResponse = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!msgResponse.ok) continue;

        const msgData: GmailMessageDetail = await msgResponse.json();
        const body = extractEmailBody(msgData);
        const subject =
          msgData.payload.headers.find(
            (h) => h.name.toLowerCase() === "subject"
          )?.value || "";

        const emailContent = `Subject: ${subject}\n\n${body}`.slice(0, 15000);

        // Parse with Claude directly
        const aiResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          messages: [
            {
              role: "user",
              content: `${EXTRACTION_PROMPT}\n\n--- EMAIL ---\n${emailContent}\n--- END ---`,
            },
          ],
        });

        const responseText = aiResponse.content
          .filter(
            (block): block is Anthropic.TextBlock => block.type === "text"
          )
          .map((block) => block.text)
          .join("");

        let parsedData;
        try {
          const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
          const jsonString = jsonMatch
            ? jsonMatch[1].trim()
            : responseText.trim();
          parsedData = JSON.parse(jsonString);
        } catch {
          // Store raw source even if parsing fails
          await supabase.from("raw_sources").insert({
            user_id: user.id,
            source_type: "gmail",
            gmail_message_id: msg.id,
            raw_content: emailContent,
            confidence: "LOW",
          });
          continue;
        }

        // Store raw source with parsed data
        const { data: source } = await supabase
          .from("raw_sources")
          .insert({
            user_id: user.id,
            source_type: "gmail",
            gmail_message_id: msg.id,
            raw_content: emailContent,
            parsed_json: parsedData,
            parsed_at: new Date().toISOString(),
            confidence: parsedData.confidence || "MEDIUM",
          })
          .select()
          .single();

        emailsParsed++;

        // Create trip records from parsed bookings
        if (parsedData.bookings && parsedData.bookings.length > 0) {
          for (const booking of parsedData.bookings) {
            if (!booking.departure_date || !booking.destination_country) continue;

            const dateArrived = booking.arrival_date || booking.departure_date;
            const dateDeparted = booking.departure_date;
            const country = booking.destination_country;

            // Skip if dates are invalid
            if (!dateArrived.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

            const fullDays = calculateFullDays(
              dateArrived < dateDeparted ? dateArrived : dateDeparted,
              dateArrived > dateDeparted ? dateArrived : dateDeparted
            );

            const { error: tripError } = await supabase.from("trips").insert({
              user_id: user.id,
              tax_year,
              country,
              date_arrived: dateArrived < dateDeparted ? dateArrived : dateDeparted,
              date_departed: dateArrived > dateDeparted ? dateArrived : dateDeparted,
              full_days_present: fullDays,
              confidence: parsedData.confidence || "MEDIUM",
              notes: `Parsed from email: ${subject}`,
              sort_order: 0,
            });

            if (!tripError) {
              tripsCreated++;

              // Link source to trip
              if (source) {
                const { data: trip } = await supabase
                  .from("trips")
                  .select("id")
                  .eq("user_id", user.id)
                  .eq("country", country)
                  .eq("date_arrived", dateArrived < dateDeparted ? dateArrived : dateDeparted)
                  .order("created_at", { ascending: false })
                  .limit(1)
                  .single();

                if (trip) {
                  await supabase
                    .from("raw_sources")
                    .update({ trip_id: trip.id })
                    .eq("id", source.id);
                }
              }
            }
          }
        }
      } catch {
        // Continue processing other emails
        continue;
      }
    }

    return NextResponse.json({
      message: `Found ${messages.length} emails, processed ${newMessages.length} new, created ${tripsCreated} trips`,
      total_found: messages.length,
      new_processed: newMessages.length,
      successfully_parsed: emailsParsed,
      trips_created: tripsCreated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to process Gmail messages: ${message}` },
      { status: 500 }
    );
  }
}

function extractEmailBody(message: GmailMessageDetail): string {
  if (message.payload.parts) {
    for (const part of message.payload.parts) {
      // Check nested parts (multipart/alternative inside multipart/mixed)
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
