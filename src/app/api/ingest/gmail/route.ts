import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { calculateFullDays } from "@/lib/trips";

// Extend function timeout for email processing
export const maxDuration = 60;

// ── Stage 0: Gmail search terms ──────────────────────────────────────
// Two strategies combined:
// 1. Keyword phrases that appear in any booking confirmation
// 2. Sender domains for known airlines/OTAs (high precision)
const KEYWORD_QUERIES = [
  '"booking confirmation"',
  '"e-ticket"',
  '"itinerary"',
  '"reservation confirmed"',
  '"flight receipt"',
  '"train ticket"',
  '"bus ticket"',
  '"boarding pass"',
  '"check-in confirmation"',
  '"ticket confirmation"',
  '"your flight"',
  '"your booking"',
  '"booking reference"',
  '"PNR"',
  '"record locator"',
  '"reservation number"',
  '"booking number"',
  '"your reservation"',
  '"travel confirmation"',
  '"order confirmation" flight',
  '"trip confirmation"',
];

// Emails from these senders are almost certainly real bookings
const SENDER_QUERIES = [
  // Airlines
  'from:airfrance', 'from:klm.com',
  'from:turkishairlines', 'from:thy.com',
  'from:flypgs.com', 'from:pegasusairlines',
  'from:delta.com', 'from:united.com', 'from:aa.com',
  'from:southwest.com', 'from:jetblue.com',
  'from:british-airways', 'from:virginatlantic', 'from:"virgin atlantic"',
  'from:easyjet.com', 'from:ryanair.com', 'from:vueling.com',
  'from:wizzair.com', 'from:lot.com',
  'from:lufthansa.com', 'from:swiss.com',
  'from:emirates.com', 'from:qatarairways.com',
  // OTAs
  'from:kiwi.com',
  'from:booking.com', 'from:airbnb.com',
  'from:expedia.com', 'from:hotels.com',
  'from:kayak.com', 'from:skyscanner.com',
  'from:omio.com', 'from:trainline.com',
  'from:flixbus.com',
  'from:justfly.com subject:confirmation',
  'from:flighthub subject:confirmation',
  // Hotel chains
  'from:marriott.com', 'from:hilton.com', 'from:ihg.com',
  'from:hyatt.com', 'from:accor.com',
];

const GMAIL_SEARCH_QUERY = [...KEYWORD_QUERIES, ...SENDER_QUERIES].join(" OR ");

// ── Stage 1: Subject blocklist (zero cost) ───────────────────────────
const SUBJECT_BLOCKLIST = [
  "sale", "% off", "deal", "earn miles", "credit card", "statement",
  "promotion", "newsletter", "survey", "feedback",
  "price alert", "fare alert", "explore", "discover", "dream",
  "flash sale", "price drop", "exclusive offer", "limited time",
  "membership rewards", "gold card", "platinum card", "delta card",
  "year-end summary", "unlock $", "annual value", "perks await",
  "special offer", "rewards is here", "don't miss out",
  "your trip with uber", "uber receipt",
  "car upgrade", "travel insurance",
  "electronic messages information",
];

// ── Stage 2: Haiku triage prompt ─────────────────────────────────────
const TRIAGE_PROMPT = `You are an email classifier. For each email below, respond with its number and either BOOKING or OTHER.

BOOKING = any of these:
- Flight, train, bus, or ferry booking confirmation with dates/routes
- Hotel, Airbnb, or accommodation reservation with check-in/check-out dates
- E-ticket or boarding pass
- Restaurant reservation at a specific location and date (helps prove presence in a country)
- Any confirmation email that contains a specific date AND a specific location/destination

When in doubt, classify as BOOKING. False positives are acceptable — false negatives lose important tax data.

OTHER = promotional email, deal/sale alert, newsletter, loyalty program update, credit card offer, survey, travel inspiration, price tracking, or emails with NO specific booking date.

Return ONLY a JSON array like: [{"email": 1, "label": "BOOKING"}, {"email": 2, "label": "OTHER"}]`;

// ── Stage 3: Sonnet extraction prompt (with few-shot examples) ───────
const EXTRACTION_PROMPT = `You are extracting transport bookings from emails.

For each email, follow these steps:
STEP 1: Scan the entire email and count how many separate transport segments are mentioned (including outbound flights, return flights, connections, trains, buses). State the count.
STEP 2: Extract each one as a LEG. A leg is a single one-way segment.

IMPORTANT:
- A round-trip booking has AT LEAST 2 legs (outbound + return). Look for both.
- A connecting itinerary A->B->C has 2 legs. Extract each segment.
- Check-in confirmations and boarding passes contain booking data — extract it.
- Look for return dates even if they appear far down in the email body.
- Extract passenger_names as an array of strings. If the email mentions specific passenger names (e.g., "Passenger: John Smith", "Traveler: SMITH/JOHN MR"), list them. If no names are mentioned, return an empty array [].

EXAMPLES:

--- EXAMPLE: Multi-leg connection (same-day, same booking ref) ---
Email: "Your booking 2GUNQF is confirmed. Air France AF1053, Tbilisi (TBS) to Paris CDG, Apr 7 2025, depart 02:30, arrive 06:30. Connecting: Air France AF1492, Paris CDG to Valencia (VLC), Apr 7 2025, depart 10:20, arrive 12:25."
Output: {"leg_count": 2, "legs": [
  {"email_index": 1, "type": "flight", "operator": "Air France", "service_number": "AF1053", "origin_city": "Tbilisi", "origin_country": "Georgia", "destination_city": "Paris", "destination_country": "France", "departure_date": "2025-04-07", "arrival_date": "2025-04-07", "booking_reference": "2GUNQF", "passenger_names": []},
  {"email_index": 1, "type": "flight", "operator": "Air France", "service_number": "AF1492", "origin_city": "Paris", "origin_country": "France", "destination_city": "Valencia", "destination_country": "Spain", "departure_date": "2025-04-07", "arrival_date": "2025-04-07", "booking_reference": "2GUNQF", "passenger_names": []}
]}

--- EXAMPLE: Round-trip (Kiwi.com style) ---
Email: "Booking 593629113 confirmed. Outbound: Air Montenegro 4O401, Istanbul (IST) to Tivat (TIV), Jan 13 2025. Return: Air Montenegro 4O400, Tivat to Istanbul, Jan 19 2025."
Output: {"leg_count": 2, "legs": [
  {"email_index": 1, "type": "flight", "operator": "Air Montenegro", "service_number": "4O401", "origin_city": "Istanbul", "origin_country": "Turkey", "destination_city": "Tivat", "destination_country": "Montenegro", "departure_date": "2025-01-13", "arrival_date": "2025-01-13", "booking_reference": "593629113", "passenger_names": []},
  {"email_index": 1, "type": "flight", "operator": "Air Montenegro", "service_number": "4O400", "origin_city": "Tivat", "origin_country": "Montenegro", "destination_city": "Istanbul", "destination_country": "Turkey", "departure_date": "2025-01-19", "arrival_date": "2025-01-19", "booking_reference": "593629113", "passenger_names": []}
]}

--- EXAMPLE: Overnight flight ---
Email: "Avianca AV 16, Medellin (MDE) to Madrid (MAD), Jan 1 2025, depart 18:05. Arrives Jan 2 at 10:30. Connecting: AV 6612, Madrid to Istanbul, Jan 2 2025, depart 14:25, arrive 19:55."
Output: {"leg_count": 2, "legs": [
  {"email_index": 1, "type": "flight", "operator": "Avianca", "service_number": "AV 16", "origin_city": "Medellin", "origin_country": "Colombia", "destination_city": "Madrid", "destination_country": "Spain", "departure_date": "2025-01-01", "arrival_date": "2025-01-02", "booking_reference": "", "passenger_names": []},
  {"email_index": 1, "type": "flight", "operator": "Avianca", "service_number": "AV 6612", "origin_city": "Madrid", "origin_country": "Spain", "destination_city": "Istanbul", "destination_country": "Turkey", "departure_date": "2025-01-02", "arrival_date": "2025-01-02", "booking_reference": "", "passenger_names": []}
]}

--- EXAMPLE: Bus booking ---
Email: "Reservation 10207767 confirmed. Yerevan to Tbilisi, Feb 18 2025, Departure: 13:00, Arrival: 19:00."
Output: {"leg_count": 1, "legs": [
  {"email_index": 1, "type": "bus", "operator": "", "service_number": "", "origin_city": "Yerevan", "origin_country": "Armenia", "destination_city": "Tbilisi", "destination_country": "Georgia", "departure_date": "2025-02-18", "arrival_date": "2025-02-18", "booking_reference": "10207767", "passenger_names": []}
]}

NOW EXTRACT FROM THESE EMAILS. Return ONLY valid JSON with "leg_count" and "legs" array. If no transport booking is found in an email, do not create legs for it.`;

// ── Stage 4: Sonnet assembly prompt (template) ───────────────────────
function buildAssemblyPrompt(taxHomeCountry: string, taxYear: number, legCount: number, userName: string) {
  return `You are building a country-by-country travel timeline for the IRS Physical Presence Test (Form 2555).

The user's tax home is: ${taxHomeCountry}
Tax year: ${taxYear}

TOTAL LEGS PROVIDED: ${legCount}

Assemble these legs into a list of COUNTRY STAYS. Every day of the tax year must be accounted for — the user was always somewhere.

RULES:

1. EVERY LEG MUST BE USED. After assembly, verify that every leg is reflected in the timeline. If a leg doesn't fit, flag it in warnings — do not silently discard it.

2. TAX HOME FILLS GAPS. If there is a gap between two trips (e.g., user arrives back from Armenia on Feb 18 and next departure is Apr 7), the user was at their tax home (${taxHomeCountry}) during that gap. Create a stay for it.

3. INCLUDE TAX HOME STAYS. The form requires entries for EVERY country including the tax home. Create ${taxHomeCountry} entries for all periods the user was home.

4. MERGE SAME-DAY CONNECTIONS. If leg A arrives in Paris at 06:30 and leg B departs Paris at 10:20 the same day, Paris is transit — NOT a separate stay. Attribute that day to the final destination.

5. WITHIN-COUNTRY TRAVEL. Legs within the same country (e.g., Istanbul->Izmir, Paris->Marseille) do NOT create separate stays. The user never left that country.

6. LINK BY BOOKING REFERENCE. Legs sharing the same booking_reference are parts of the same trip even if they were in different emails.

7. CHRONOLOGICAL ORDER. Stays must be in date order with no overlaps.

8. CONFIDENCE:
   - HIGH = both arrival and departure supported by a transport leg
   - MEDIUM = one end is supported, the other is inferred (e.g., tax home fill)
   - LOW = entirely inferred (no direct transport evidence)

9. START AND END OF YEAR. If the first leg of the year departs from a non-tax-home city, create a stay for that country from Jan 1 (or tax year start) with confidence MEDIUM. Similarly, if the last leg arrives somewhere, create a stay through Dec 31 with confidence MEDIUM.

10. PASSENGER FILTERING. The user's name is: ${userName}. If a leg has passenger_names listed AND the user's name does not appear in that list (compare first name OR last name, case-insensitive), EXCLUDE that leg from the timeline and note it in warnings as "Excluded leg X: booked for [names], not ${userName}". If passenger_names is empty or unknown, assume the user is the passenger.

Return ONLY valid JSON with:
- "stays": array of country stays, each with country, date_arrived, date_departed, confidence, notes
- "legs_used": array of leg indices accounted for
- "legs_unused": array of leg indices that didn't fit (should be empty ideally)
- "warnings": array of strings describing any anomalies`;
}

// ── Types ────────────────────────────────────────────────────────────

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

interface EmailSummary {
  id: string;
  subject: string;
  snippet: string;
  body: string;
}

interface ExtractedLeg {
  email_index: number;
  type: string;
  operator: string;
  service_number: string;
  origin_city: string;
  origin_country: string;
  destination_city: string;
  destination_country: string;
  departure_date: string;
  arrival_date: string;
  booking_reference: string;
  passenger_names: string[];
}

interface AssembledStay {
  country: string;
  date_arrived: string;
  date_departed: string;
  confidence: string;
  notes: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function stripHtml(html: string): string {
  let text = html;
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&zwnj;/g, "");
  text = text.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(parseInt(code))
  );
  text = text.replace(/\s{2,}/g, "\n");
  return text.trim();
}

function parseJsonFromAI(response: Anthropic.Message): unknown {
  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonString = jsonMatch ? jsonMatch[1].trim() : responseText.trim();
  return JSON.parse(jsonString);
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

// ── Main handler ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tax_year, force } = await request.json();

  if (!tax_year) {
    return NextResponse.json(
      { error: "tax_year is required" },
      { status: 400 }
    );
  }

  // Get user's tax home for Stage 4 assembly
  const { data: taxProfile } = await supabase
    .from("tax_profiles")
    .select("tax_home_country")
    .eq("user_id", user.id)
    .eq("tax_year", tax_year)
    .maybeSingle();

  const taxHomeCountry = taxProfile?.tax_home_country || "Georgia";

  // Get user's name for passenger filtering (Google OAuth provides full_name)
  const userName =
    (user.user_metadata?.full_name as string) ||
    (user.user_metadata?.name as string) ||
    user.email?.split("@")[0] ||
    "";

  // If force=true, clear previous scan data so we reprocess all emails
  if (force) {
    await supabase
      .from("trips")
      .delete()
      .eq("user_id", user.id)
      .eq("tax_year", tax_year)
      .like("notes", "Gmail%");
    await supabase
      .from("raw_sources")
      .delete()
      .eq("user_id", user.id)
      .eq("source_type", "gmail");
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
    // ═══════════════════════════════════════════════════════════════════
    // STAGE 0: Gmail Query
    // 4-month pre-buffer, 1-month post-buffer to catch bookings made
    // before/after the tax year boundaries
    // ═══════════════════════════════════════════════════════════════════
    const afterDate = `${tax_year - 1}/09/01`;
    const beforeDate = `${tax_year + 1}/01/31`;
    const query = `(${GMAIL_SEARCH_QUERY}) after:${afterDate} before:${beforeDate}`;
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=250`;

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

    // ═══════════════════════════════════════════════════════════════════
    // STAGE 1: Fetch metadata + pre-filter (zero AI cost)
    // Fetch lightweight metadata first, apply blocklist, then fetch
    // full bodies only for emails that pass the filter
    // ═══════════════════════════════════════════════════════════════════

    // Fetch metadata (subject + snippet) for all emails — lightweight
    const metadataPromises = newMessages.slice(0, 250).map(async (msg) => {
      try {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`;
        const msgResponse = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!msgResponse.ok) return null;

        const msgData = await msgResponse.json();
        const subject =
          msgData.payload?.headers?.find(
            (h: { name: string; value: string }) => h.name.toLowerCase() === "subject"
          )?.value || "";
        const from =
          msgData.payload?.headers?.find(
            (h: { name: string; value: string }) => h.name.toLowerCase() === "from"
          )?.value || "";

        return { id: msg.id, subject, from, snippet: msgData.snippet || "" };
      } catch {
        return null;
      }
    });

    const metadataResults = await Promise.all(metadataPromises);
    const allMetadata = metadataResults.filter((r): r is NonNullable<typeof r> => r !== null);

    // Apply subject blocklist
    const filtered = allMetadata.filter((email) => {
      const subjectLower = email.subject.toLowerCase();
      return !SUBJECT_BLOCKLIST.some((term) => subjectLower.includes(term));
    });

    if (filtered.length === 0) {
      // Store raw_sources so we don't re-fetch
      await supabase.from("raw_sources").insert(
        allMetadata.map((email) => ({
          user_id: user.id,
          source_type: "gmail",
          gmail_message_id: email.id,
          raw_content: `Subject: ${email.subject}`,
          parsed_at: new Date().toISOString(),
        }))
      );
      return NextResponse.json({
        message: "All emails were filtered as non-booking content",
        total_found: messages.length,
        new_processed: allMetadata.length,
        successfully_parsed: 0,
        trips_created: 0,
      });
    }

    // Now fetch full bodies only for filtered emails (saves time + bandwidth)
    const emailSummaries: EmailSummary[] = [];

    const fetchPromises = filtered.slice(0, 100).map(async (meta) => {
      try {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${meta.id}?format=full`;
        const msgResponse = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!msgResponse.ok) return null;

        const msgData: GmailMessageDetail = await msgResponse.json();
        const rawBody = extractEmailBody(msgData);
        const body = stripHtml(rawBody).slice(0, 2000);

        return { id: meta.id, subject: meta.subject, snippet: meta.snippet, body };
      } catch {
        return null;
      }
    });

    const bodyResults = await Promise.all(fetchPromises);
    for (const r of bodyResults) {
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


    // ═══════════════════════════════════════════════════════════════════
    // STAGE 2: Haiku Triage (~$0.01)
    // Cheap classification using subject + snippet (no full body needed)
    // Batched 15 per call, run in parallel
    // ═══════════════════════════════════════════════════════════════════
    const TRIAGE_BATCH_SIZE = 15;
    const triageBatches = chunkArray(emailSummaries, TRIAGE_BATCH_SIZE);
    const bookingEmails: EmailSummary[] = [];

    const triagePromises = triageBatches.map(async (batch) => {
      const emailBlock = batch
        .map(
          (e, i) =>
            `[Email ${i + 1}] Subject: ${e.subject}\n${e.body.slice(0, 500)}`
        )
        .join("\n\n");

      try {
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: `${TRIAGE_PROMPT}\n\n${emailBlock}`,
            },
          ],
        });

        const labels = parseJsonFromAI(response) as Array<{
          email: number;
          label: string;
        }>;
        const confirmed: EmailSummary[] = [];
        for (const label of labels) {
          if (
            label.label === "BOOKING" &&
            label.email >= 1 &&
            label.email <= batch.length
          ) {
            confirmed.push(batch[label.email - 1]);
          }
        }
        return confirmed;
      } catch {
        // On triage failure, pass all emails through
        return batch;
      }
    });

    const triageResults = await Promise.all(triagePromises);
    for (const confirmed of triageResults) {
      bookingEmails.push(...confirmed);
    }

    if (bookingEmails.length === 0) {
      // Store all raw_sources
      const allEmailIds = new Set(emailSummaries.map((e) => e.id));
      const blockedOnly = allMetadata.filter((e) => !allEmailIds.has(e.id));
      const rawRows = [
        ...emailSummaries.map((e) => ({
          user_id: user.id,
          source_type: "gmail" as const,
          gmail_message_id: e.id,
          raw_content: `Subject: ${e.subject}\n\n${e.body}`.slice(0, 50000),
          parsed_at: new Date().toISOString(),
        })),
        ...blockedOnly.map((e) => ({
          user_id: user.id,
          source_type: "gmail" as const,
          gmail_message_id: e.id,
          raw_content: `Subject: ${e.subject} [BLOCKED]`,
          parsed_at: new Date().toISOString(),
        })),
      ];
      if (rawRows.length > 0) await supabase.from("raw_sources").insert(rawRows);

      return NextResponse.json({
        message: "No booking confirmations found in emails",
        total_found: messages.length,
        new_processed: allMetadata.length,
        successfully_parsed: 0,
        trips_created: 0,
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // STAGE 3: Sonnet Extraction (~$0.10)
    // Extract individual transport LEGS from confirmed bookings
    // Batched 2 emails per call, run in parallel
    // ═══════════════════════════════════════════════════════════════════
    const EXTRACT_BATCH_SIZE = 2;
    const extractBatches = chunkArray(bookingEmails, EXTRACT_BATCH_SIZE);
    const allLegs: ExtractedLeg[] = [];

    const extractionPromises = extractBatches.map(async (batch) => {
      const emailBlock = batch
        .map(
          (e, i) =>
            `--- EMAIL ${i + 1} ---\nSubject: ${e.subject}\n\n${e.body}\n--- END EMAIL ${i + 1} ---`
        )
        .join("\n\n");

      try {
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `${EXTRACTION_PROMPT}\n\n${emailBlock}`,
            },
          ],
        });

        const parsed = parseJsonFromAI(response) as { leg_count?: number; legs: ExtractedLeg[] };
        return parsed.legs || [];
      } catch {
        return [];
      }
    });

    const extractionResults = await Promise.all(extractionPromises);
    for (const legs of extractionResults) {
      allLegs.push(...legs);
    }

    if (allLegs.length === 0) {
      // Store raw_sources
      await supabase.from("raw_sources").insert(
        emailSummaries.map((email) => ({
          user_id: user.id,
          source_type: "gmail",
          gmail_message_id: email.id,
          raw_content: `Subject: ${email.subject}\n\n${email.body}`.slice(0, 50000),
          parsed_at: new Date().toISOString(),
        }))
      );
      return NextResponse.json({
        message: `Found ${bookingEmails.length} booking emails but could not extract any transport legs`,
        total_found: messages.length,
        new_processed: emailSummaries.length,
        successfully_parsed: 0,
        trips_created: 0,
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // STAGE 4: Sonnet Assembly (~$0.02)
    // One call: stitch all legs into country stays using tax home context
    // ═══════════════════════════════════════════════════════════════════
    const legsBlock = allLegs
      .map(
        (leg, i) =>
          `[Leg ${i}] ${leg.departure_date} ${leg.origin_city} (${leg.origin_country}) → ${leg.destination_city} (${leg.destination_country}) | ${leg.type} ${leg.operator} ${leg.service_number} | ref: ${leg.booking_reference} | passengers: ${(leg.passenger_names || []).join(", ") || "unknown"}`
      )
      .join("\n");

    let stays: AssembledStay[] = [];

    try {
      const assemblyResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `${buildAssemblyPrompt(taxHomeCountry, tax_year, allLegs.length, userName)}\n\nHere are ${allLegs.length} legs to assemble:\n\n${legsBlock}`,
          },
        ],
      });

      const assemblyData = parseJsonFromAI(assemblyResponse) as {
        stays: AssembledStay[];
        legs_used?: number[];
        legs_unused?: number[];
        warnings?: string[];
      };
      stays = assemblyData.stays || [];

      if (assemblyData.legs_unused && assemblyData.legs_unused.length > 0) {
        console.warn("Assembly: unused legs:", assemblyData.legs_unused);
      }
      if (assemblyData.warnings && assemblyData.warnings.length > 0) {
        console.warn("Assembly warnings:", assemblyData.warnings);
      }
    } catch {
      // Fallback: convert each leg into a simple stay
      stays = allLegs.map((leg) => ({
          country: leg.destination_country,
          date_arrived: leg.arrival_date || leg.departure_date,
          date_departed: leg.arrival_date || leg.departure_date,
          confidence: "LOW",
          notes: "Fallback: assembly failed, created from individual leg",
        }));
    }

    // ═══════════════════════════════════════════════════════════════════
    // Database writes
    // ═══════════════════════════════════════════════════════════════════

    // Store raw_sources for ALL fetched emails (including blocked ones)
    // so they don't get re-fetched on subsequent scans
    const allEmailIds = new Set(emailSummaries.map((e) => e.id));
    const blockedEmails = allMetadata.filter((e) => !allEmailIds.has(e.id));

    const rawSourceRows = [
      ...emailSummaries.map((email) => ({
        user_id: user.id,
        source_type: "gmail" as const,
        gmail_message_id: email.id,
        raw_content: `Subject: ${email.subject}\n\n${email.body}`.slice(0, 50000),
        parsed_at: new Date().toISOString(),
      })),
      ...blockedEmails.map((email) => ({
        user_id: user.id,
        source_type: "gmail" as const,
        gmail_message_id: email.id,
        raw_content: `Subject: ${email.subject} [BLOCKED BY FILTER]`,
        parsed_at: new Date().toISOString(),
      })),
    ];

    if (rawSourceRows.length > 0) {
      await supabase.from("raw_sources").insert(rawSourceRows);
    }

    // Create trip records from assembled stays in a single batch
    const tripRows = stays
      .filter((stay) => {
        if (!stay.country || !stay.date_arrived) return false;
        if (!stay.date_arrived.match(/^\d{4}-\d{2}-\d{2}$/)) return false;
        return true;
      })
      .map((stay) => {
        const dateDeparted = stay.date_departed?.match(/^\d{4}-\d{2}-\d{2}$/)
          ? stay.date_departed
          : stay.date_arrived;
        const earlier =
          stay.date_arrived <= dateDeparted ? stay.date_arrived : dateDeparted;
        const later =
          stay.date_arrived > dateDeparted ? stay.date_arrived : dateDeparted;
        return {
          user_id: user.id,
          tax_year,
          country: stay.country,
          date_arrived: earlier,
          date_departed: later,
          full_days_present: calculateFullDays(earlier, later),
          confidence: stay.confidence || "MEDIUM",
          notes: stay.notes || "Gmail multi-stage pipeline",
          sort_order: 0,
        };
      });

    let tripsCreated = 0;
    if (tripRows.length > 0) {
      const { data: inserted } = await supabase
        .from("trips")
        .insert(tripRows)
        .select("id");
      tripsCreated = inserted?.length || 0;
    }

    // Collect subjects that were filtered out at each stage for debugging
    const filteredIds = new Set(filtered.map((e) => e.id));
    const filteredOutSubjects = allMetadata
      .filter((e) => !filteredIds.has(e.id))
      .map((e) => e.subject);
    const bookingIds = new Set(bookingEmails.map((e) => e.id));
    const triagedOutSubjects = emailSummaries
      .filter((e) => !bookingIds.has(e.id))
      .map((e) => e.subject);

    return NextResponse.json({
      message: `Found ${allMetadata.length} emails → ${filtered.length} passed filter → ${emailSummaries.length} fetched → ${bookingEmails.length} confirmed bookings → ${allLegs.length} legs → ${stays.length} stays → ${tripsCreated} trips`,
      total_found: messages.length,
      new_processed: emailSummaries.length,
      successfully_parsed: stays.length,
      trips_created: tripsCreated,
      debug: {
        stage1_blocked: filteredOutSubjects,
        stage2_rejected: triagedOutSubjects,
        stage3_legs: allLegs,
        stage4_stays: stays,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to process Gmail: ${message}` },
      { status: 500 }
    );
  }
}
