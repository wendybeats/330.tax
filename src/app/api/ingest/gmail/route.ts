import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { calculateFullDays } from "@/lib/trips";

// Extend function timeout for email processing
export const maxDuration = 60;

// ── Stage 0: Gmail search terms ──────────────────────────────────────
const GMAIL_SEARCH_QUERY = [
  '"booking confirmation"',
  '"e-ticket"',
  '"itinerary"',
  '"reservation confirmed"',
  '"your trip"',
  '"flight receipt"',
  '"train ticket"',
  '"bus ticket"',
  '"boarding pass"',
  '"check-in confirmation"',
  '"ticket confirmation"',
  '"travel document"',
  '"your flight"',
  '"your booking"',
  '"confirmation code"',
  '"booking reference"',
  '"PNR"',
  '"record locator"',
].join(" OR ");

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

// ── Stage 3: Sonnet extraction prompt ────────────────────────────────
const EXTRACTION_PROMPT = `Extract individual transport LEGS from these booking confirmation emails.

A LEG is a single one-way segment of transport. A round-trip flight has 2 legs. A multi-city itinerary A→B→C has 2 legs.

Return ONLY valid JSON:
{
  "legs": [
    {
      "email_index": 1,
      "type": "flight | train | bus | ferry",
      "operator": "airline/operator name",
      "service_number": "flight/train number or empty string",
      "origin_city": "city name",
      "origin_country": "full country name",
      "destination_city": "city name",
      "destination_country": "full country name",
      "departure_date": "YYYY-MM-DD",
      "arrival_date": "YYYY-MM-DD",
      "booking_reference": "PNR/confirmation code or empty string"
    }
  ]
}

Rules:
- Extract EVERY leg, including return flights and connections
- A round trip has TWO legs (outbound + return) — list both
- Use full country names (e.g., "United States", "Turkey", "United Kingdom")
- If no actual booking data is found in an email, do not create legs for it
- Departure and arrival dates may differ for overnight flights/trains`;

// ── Stage 4: Sonnet assembly prompt (template) ───────────────────────
function buildAssemblyPrompt(taxHomeCountry: string) {
  return `You are an IRS Physical Presence Test travel timeline builder.

Given a list of transport LEGS and the user's tax home country, assemble them into COUNTRY STAYS.

Tax home country: ${taxHomeCountry}

Rules:
1. MERGE CONNECTIONS: If leg A arrives in Frankfurt at 14:00 and leg B departs Frankfurt the same day, Frankfurt is a transit point, NOT a separate stay. Only create a stay for the final destination.
2. LINK OUTBOUND AND RETURN: If the user flies US→Turkey on Dec 13 and Turkey→US on Dec 27, that is ONE stay in Turkey from Dec 13 to Dec 27.
3. TAX HOME ASSUMPTION: Between trips abroad, assume the user is in ${taxHomeCountry}. Do NOT create stays for ${taxHomeCountry} — only create stays for other countries.
4. MULTI-COUNTRY TRIPS: If the user flies A→B, stays, then B→C, stays, then C→A, create separate stays for B and C. Use the next leg's departure date as the departure from the previous country.
5. ONE-WAY LEGS with no return: If you only see an outbound leg with no matching return, set confidence to LOW and note it.
6. WITHIN-COUNTRY TRAVEL: If consecutive legs stay within the same country (e.g., Istanbul→Izmir), do NOT create a separate stay. The user never left that country.
7. Dates must be YYYY-MM-DD format.
8. Do NOT calculate full_days — just provide accurate arrival and departure dates.

Return ONLY valid JSON:
{
  "stays": [
    {
      "country": "full country name",
      "date_arrived": "YYYY-MM-DD",
      "date_departed": "YYYY-MM-DD",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "notes": "how this stay was determined"
    }
  ]
}`;
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

  const { tax_year } = await request.json();

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
    const query = `(${GMAIL_SEARCH_QUERY}) after:${afterDate} before:${beforeDate} -category:promotions -category:social`;
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`;

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

    // Fetch email bodies in parallel
    const emailSummaries: EmailSummary[] = [];

    const fetchPromises = newMessages.slice(0, 50).map(async (msg) => {
      try {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
        const msgResponse = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!msgResponse.ok) return null;

        const msgData: GmailMessageDetail = await msgResponse.json();
        const rawBody = extractEmailBody(msgData);
        const body = stripHtml(rawBody).slice(0, 2000);
        const subject =
          msgData.payload.headers.find(
            (h) => h.name.toLowerCase() === "subject"
          )?.value || "";

        return { id: msg.id, subject, snippet: msgData.snippet, body };
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

    // ═══════════════════════════════════════════════════════════════════
    // STAGE 1: Pre-filter (zero cost)
    // Drop obvious promos by subject line before any AI call
    // ═══════════════════════════════════════════════════════════════════
    const filtered = emailSummaries.filter((email) => {
      const subjectLower = email.subject.toLowerCase();
      return !SUBJECT_BLOCKLIST.some((term) => subjectLower.includes(term));
    });

    if (filtered.length === 0) {
      // Store raw_sources so we don't re-fetch these
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
        message: "All emails were filtered as non-booking content",
        total_found: messages.length,
        new_processed: emailSummaries.length,
        successfully_parsed: 0,
        trips_created: 0,
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // STAGE 2: Haiku Triage (~$0.01)
    // Cheap classification: is this a real booking or junk?
    // Batched 12 emails per call, run in parallel
    // ═══════════════════════════════════════════════════════════════════
    const TRIAGE_BATCH_SIZE = 12;
    const triageBatches = chunkArray(filtered, TRIAGE_BATCH_SIZE);
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
        // On triage failure, pass all emails through (false positives > false negatives)
        return batch;
      }
    });

    const triageResults = await Promise.all(triagePromises);
    for (const confirmed of triageResults) {
      bookingEmails.push(...confirmed);
    }

    if (bookingEmails.length === 0) {
      // Store raw_sources for all fetched emails
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
        message: "No booking confirmations found in emails",
        total_found: messages.length,
        new_processed: emailSummaries.length,
        successfully_parsed: 0,
        trips_created: 0,
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // STAGE 3: Sonnet Extraction (~$0.10)
    // Extract individual transport LEGS from confirmed bookings
    // Batched 4 emails per call, run in parallel
    // ═══════════════════════════════════════════════════════════════════
    const EXTRACT_BATCH_SIZE = 4;
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

        const parsed = parseJsonFromAI(response) as { legs: ExtractedLeg[] };
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
          `[Leg ${i}] ${leg.departure_date} ${leg.origin_city} (${leg.origin_country}) → ${leg.destination_city} (${leg.destination_country}) | ${leg.type} ${leg.operator} ${leg.service_number} | ref: ${leg.booking_reference}`
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
            content: `${buildAssemblyPrompt(taxHomeCountry)}\n\nHere are ${allLegs.length} legs to assemble:\n\n${legsBlock}`,
          },
        ],
      });

      const assemblyData = parseJsonFromAI(assemblyResponse) as {
        stays: AssembledStay[];
      };
      stays = assemblyData.stays || [];
    } catch {
      // Fallback: convert each leg into a simple stay
      stays = allLegs
        .filter((leg) => leg.destination_country.toUpperCase() !== taxHomeCountry.toUpperCase())
        .map((leg) => ({
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

    // Store raw_sources in a single batch insert
    await supabase.from("raw_sources").insert(
      emailSummaries.map((email) => ({
        user_id: user.id,
        source_type: "gmail",
        gmail_message_id: email.id,
        raw_content: `Subject: ${email.subject}\n\n${email.body}`.slice(0, 50000),
        parsed_at: new Date().toISOString(),
      }))
    );

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
    const filteredOutSubjects = emailSummaries
      .filter((e) => !filtered.includes(e))
      .map((e) => e.subject);
    const triagedOutSubjects = filtered
      .filter((e) => !bookingEmails.includes(e))
      .map((e) => e.subject);

    return NextResponse.json({
      message: `Scanned ${emailSummaries.length} emails → ${filtered.length} passed filter → ${bookingEmails.length} confirmed bookings → ${allLegs.length} legs extracted → ${stays.length} stays assembled → ${tripsCreated} trips created`,
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
