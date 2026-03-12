import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const GMAIL_SEARCH_QUERY = [
  '"booking confirmation"',
  '"e-ticket"',
  '"itinerary"',
  '"reservation confirmed"',
  '"flight confirmation"',
  '"travel confirmation"',
].join(" OR ");

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
    }>;
  };
}

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

  // Try to get the Google access token from the current session first
  const {
    data: { session },
  } = await supabase.auth.getSession();

  let accessToken = session?.provider_token;

  // If no provider_token in session, try refreshing via Google refresh token
  if (!accessToken) {
    const { data: userData } = await supabase
      .from("users")
      .select("google_refresh_token")
      .eq("id", user.id)
      .single();

    if (userData?.google_refresh_token) {
      // Exchange refresh token for a new access token
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
      { error: "Google access token not available. Please log out and sign in again to reconnect Gmail." },
      { status: 401 }
    );
  }

  try {
    // Search Gmail for travel-related emails within the tax year
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
        count: 0,
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

    // Fetch full message content for new messages
    const results = [];

    for (const msg of newMessages) {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
      const msgResponse = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!msgResponse.ok) continue;

      const msgData: GmailMessageDetail = await msgResponse.json();

      // Extract email body
      const body = extractEmailBody(msgData);
      const subject =
        msgData.payload.headers.find((h) => h.name.toLowerCase() === "subject")
          ?.value || "";

      // Store raw source
      const { data: source } = await supabase
        .from("raw_sources")
        .insert({
          user_id: user.id,
          source_type: "gmail",
          gmail_message_id: msg.id,
          raw_content: `Subject: ${subject}\n\n${body}`,
        })
        .select()
        .single();

      if (source) {
        results.push({
          id: source.id,
          gmail_message_id: msg.id,
          subject,
          snippet: msgData.snippet,
        });
      }
    }

    // Now parse each new source with Claude API
    const parseResults = [];
    for (const source of results) {
      try {
        const parseResponse = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/ai/parse`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source_id: source.id,
              content: source.snippet,
              source_type: "email",
              tax_year,
            }),
          }
        );

        if (parseResponse.ok) {
          const parsed = await parseResponse.json();
          parseResults.push(parsed);
        }
      } catch {
        // Continue processing other emails even if one fails
      }
    }

    return NextResponse.json({
      message: `Found ${messages.length} emails, ${newMessages.length} new, ${parseResults.length} parsed`,
      total_found: messages.length,
      new_processed: newMessages.length,
      successfully_parsed: parseResults.length,
      sources: results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to process Gmail messages" },
      { status: 500 }
    );
  }
}

function extractEmailBody(message: GmailMessageDetail): string {
  // Try to get text/plain body first, then text/html
  if (message.payload.parts) {
    const textPart = message.payload.parts.find(
      (p) => p.mimeType === "text/plain"
    );
    const htmlPart = message.payload.parts.find(
      (p) => p.mimeType === "text/html"
    );

    const part = textPart || htmlPart;
    if (part?.body?.data) {
      return Buffer.from(part.body.data, "base64").toString("utf-8");
    }
  }

  // Fallback to direct body
  if (message.payload.body?.data) {
    return Buffer.from(message.payload.body.data, "base64").toString("utf-8");
  }

  return "";
}
