import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { calculateFullDays } from "@/lib/trips";

// Extend function timeout for email processing (300s on Vercel Pro)
export const maxDuration = 300;

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
// Split into two groups to keep each Gmail query under ~25 OR clauses
const AIRLINE_SENDERS = [
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
  'from:airmontenegro', 'from:"air montenegro"',
  'from:georgianairways', 'from:"georgian airways"',
  'from:flyone.aero', 'from:flyone',
];

const OTA_SENDERS = [
  'from:kiwi.com',
  'from:booking.com', 'from:airbnb.com',
  'from:expedia.com', 'from:hotels.com',
  'from:kayak.com', 'from:skyscanner.com',
  'from:omio.com', 'from:trainline.com',
  'from:flixbus.com',
  'from:justfly.com subject:confirmation',
  'from:flighthub subject:confirmation',
  'from:marriott.com', 'from:hilton.com', 'from:ihg.com',
  'from:hyatt.com', 'from:accor.com',
];

// ── Server-side Gmail exclusions (applied to keyword query only) ──────
const GMAIL_EXCLUSIONS = [
  '-subject:newsletter',
  '-subject:unsubscribe',
  '-subject:promotion',
  '-subject:"price alert"',
  '-subject:"fare alert"',
  '-label:promotions',
  '-label:spam',
];

// ── Stage 1: Subject blocklist (zero cost) ───────────────────────────
const SUBJECT_BLOCKLIST = [
  "% off", "flash sale", "credit card", "statement",
  "newsletter", "survey", "feedback",
  "fare alert", "explore destinations", "discover",
  "price drop", "exclusive offer", "limited time",
  "membership rewards", "gold card", "platinum card", "delta card",
  "year-end summary", "unlock $", "annual value", "perks await",
  "special offer", "rewards is here", "don't miss out",
  "your trip with uber", "uber receipt",
  "travel insurance",
  "electronic messages information",
];

// ── Stage 1b: Subject whitelist (overrides blocklist) ────────────────
// Strong positive signals — if any of these appear in the subject,
// the email passes regardless of blocklist matches.
const SUBJECT_WHITELIST = [
  "pnr",
  "ticket details",
  "confirmation number",
  "booking reference",
  "record locator",
  "e-ticket",
  "boarding pass",
  "itinerary receipt",
  "check-in confirmation",
  "booking confirmed",
  "reservation confirmed",
  "your ticket",
];

// "Booking 593629113" — a booking reference number right after the word
const BOOKING_NUMBER_REGEX = /booking\s+\d{4,}/i;

// Known sender domains for blocklist bypass (extracted from AIRLINE_SENDERS + OTA_SENDERS)
const KNOWN_SENDER_DOMAINS = [
  "airfrance", "klm.com", "turkishairlines", "thy.com", "flypgs.com",
  "pegasusairlines", "delta.com", "united.com", "aa.com",
  "southwest.com", "jetblue.com", "british-airways", "virginatlantic",
  "easyjet.com", "ryanair.com", "vueling.com", "wizzair.com", "lot.com",
  "lufthansa.com", "swiss.com", "emirates.com", "qatarairways.com",
  "kiwi.com", "booking.com", "airbnb.com", "expedia.com", "hotels.com",
  "kayak.com", "skyscanner.com", "omio.com", "trainline.com",
  "flixbus.com", "justfly.com", "flighthub.com",
  "marriott.com", "hilton.com", "ihg.com", "hyatt.com", "accor.com",
  "airmontenegro", "georgianairways", "flyone.aero", "flyone",
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

/** Run async tasks with at most `limit` in flight at once */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Retry-aware wrapper for Anthropic API calls (handles 429 rate limits) */
async function callAnthropicWithRetry(
  createFn: () => Promise<Anthropic.Message>,
  maxRetries = 3,
): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await createFn();
    } catch (err) {
      const is429 = err instanceof Error && err.message.includes("429");
      if (is429 && attempt < maxRetries) {
        // Exponential backoff: 5s, 10s, 20s
        const delay = 5000 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

/**
 * Merge overlapping or adjacent stays for the same country.
 * Prevents duplicates from multi-email extraction and fallback assembly.
 */
function mergeStays(stays: AssembledStay[]): AssembledStay[] {
  if (stays.length <= 1) return stays;

  // Sort by country, then by arrival date
  const sorted = [...stays].sort((a, b) => {
    if (a.country !== b.country) return a.country.localeCompare(b.country);
    return a.date_arrived.localeCompare(b.date_arrived);
  });

  const confidenceRank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const merged: AssembledStay[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    // Same country and overlapping or adjacent (within 1 day)
    if (next.country === current.country && next.date_arrived <= current.date_departed) {
      // Extend departure if needed
      if (next.date_departed > current.date_departed) {
        current.date_departed = next.date_departed;
      }
      // Keep higher confidence
      if ((confidenceRank[next.confidence] || 0) > (confidenceRank[current.confidence] || 0)) {
        current.confidence = next.confidence;
      }
      // Merge notes
      if (next.notes && next.notes !== current.notes) {
        current.notes = current.notes ? `${current.notes}; ${next.notes}` : next.notes;
      }
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  // Re-sort chronologically
  return merged.sort((a, b) => a.date_arrived.localeCompare(b.date_arrived));
}

/**
 * Deterministic leg → stay assembly. Replaces the AI assembly call.
 * Implements the same 10 rules that were in the Sonnet assembly prompt.
 */
function assembleLegsIntoStays(
  legs: ExtractedLeg[],
  taxHomeCountry: string,
  taxYear: number,
  userName: string,
): { stays: AssembledStay[]; warnings: string[] } {
  const warnings: string[] = [];

  // --- Rule 10: Passenger filter ---
  const nameParts = userName.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = legs.filter((leg) => {
    if (!leg.passenger_names || leg.passenger_names.length === 0) return true;
    const match = leg.passenger_names.some((pax) => {
      const paxLower = pax.toLowerCase();
      return nameParts.some((part) => paxLower.includes(part));
    });
    if (!match) {
      warnings.push(`Excluded leg: ${leg.origin_city}→${leg.destination_city} ${leg.departure_date} — booked for [${leg.passenger_names.join(", ")}], not ${userName}`);
    }
    return match;
  });

  // Filter out legs with Unknown country (bad extraction)
  const valid = filtered.filter((leg) => {
    if (leg.origin_country === "Unknown" || leg.destination_country === "Unknown") {
      warnings.push(`Dropped leg with unknown country: ${leg.origin_city}→${leg.destination_city} ${leg.departure_date}`);
      return false;
    }
    return true;
  });

  if (valid.length === 0) {
    return { stays: [], warnings };
  }

  // --- Rule 7 (sort): Chronological by departure_date ---
  const sorted = [...valid].sort((a, b) =>
    a.departure_date.localeCompare(b.departure_date) ||
    a.arrival_date.localeCompare(b.arrival_date)
  );

  // --- Rule 3: Deduplicate same origin+destination+date ---
  const seen = new Set<string>();
  const deduped = sorted.filter((leg) => {
    const key = `${leg.origin_country}:${leg.origin_city}:${leg.destination_country}:${leg.destination_city}:${leg.departure_date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // --- Rule 4: Collapse same-day connections ---
  // If leg[i] arrives city X and leg[i+1] departs city X same day, they're transit
  const collapsed: ExtractedLeg[] = [];
  let i = 0;
  while (i < deduped.length) {
    let current = deduped[i];
    // Keep chaining connections: if next leg departs from where current arrives, same day
    while (i + 1 < deduped.length) {
      const next = deduped[i + 1];
      const currentArrival = current.arrival_date || current.departure_date;
      const sameCity = next.origin_city.toLowerCase() === current.destination_city.toLowerCase();
      const sameDay = next.departure_date === currentArrival;
      if (sameCity && sameDay) {
        // Merge into one "leg" from original origin to final destination
        current = {
          ...current,
          destination_city: next.destination_city,
          destination_country: next.destination_country,
          arrival_date: next.arrival_date || next.departure_date,
        };
        i++;
      } else {
        break;
      }
    }
    collapsed.push(current);
    i++;
  }

  // --- Rule 5 & 6: Build stays from consecutive leg pairs ---
  // Each leg pair defines: stay in destination from arrival to next departure
  const stays: AssembledStay[] = [];
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;

  // Helper: find the next leg that leaves the given country (skips domestic legs)
  function findNextDeparture(fromIndex: number, country: string): string | null {
    for (let k = fromIndex + 1; k < collapsed.length; k++) {
      const next = collapsed[k];
      // If this leg leaves the country, use its departure date
      if (next.origin_country === country && next.destination_country !== country) {
        return next.departure_date;
      }
      // If this leg is within the same country, keep looking
      if (next.origin_country === country && next.destination_country === country) {
        continue;
      }
      // If this leg starts from a different country, use its departure
      return next.departure_date;
    }
    return null;
  }

  for (let j = 0; j < collapsed.length; j++) {
    const leg = collapsed[j];
    const arrivalDate = leg.arrival_date || leg.departure_date;

    // Rule 5: Skip within-country travel (doesn't create a new stay)
    if (j > 0) {
      const prevLeg = collapsed[j - 1];
      const prevDest = prevLeg.destination_country;
      if (prevDest === leg.origin_country && leg.origin_country === leg.destination_country) {
        continue;
      }
    }

    // Look ahead past domestic legs to find next real departure from this country
    const nextDeparture = findNextDeparture(j, leg.destination_country);
    const departedDate = nextDeparture || yearEnd;
    stays.push({
      country: leg.destination_country,
      date_arrived: arrivalDate,
      date_departed: departedDate,
      confidence: nextDeparture ? "HIGH" : "MEDIUM",
      notes: nextDeparture
        ? `${leg.type || "transport"}: ${leg.origin_city}→${leg.destination_city}`
        : `${leg.type || "transport"}: ${leg.origin_city}→${leg.destination_city} (end of year inferred)`,
    });
  }

  // --- Rule 9: Year boundary stays ---
  // Before first leg: if first departure is not from tax home, create stay from Jan 1
  if (collapsed.length > 0) {
    const firstLeg = collapsed[0];
    if (firstLeg.departure_date > yearStart) {
      const originCountry = firstLeg.origin_country || taxHomeCountry;
      stays.push({
        country: originCountry,
        date_arrived: yearStart,
        date_departed: firstLeg.departure_date,
        confidence: "MEDIUM",
        notes: originCountry === taxHomeCountry
          ? "Tax home: start of year until first departure"
          : "Inferred: present at departure city from start of year",
      });
    }
  }

  // --- Rule 8: Fill gaps with tax home ---
  // Sort stays so far, then find gaps
  const sortedStays = [...stays].sort((a, b) =>
    a.date_arrived.localeCompare(b.date_arrived)
  );

  const gapFills: AssembledStay[] = [];
  for (let j = 0; j < sortedStays.length - 1; j++) {
    const currentEnd = sortedStays[j].date_departed;
    const nextStart = sortedStays[j + 1].date_arrived;
    if (currentEnd < nextStart) {
      gapFills.push({
        country: taxHomeCountry,
        date_arrived: currentEnd,
        date_departed: nextStart,
        confidence: "MEDIUM",
        notes: "Tax home: gap between trips",
      });
    }
  }

  const allStays = [...stays, ...gapFills];

  // --- Rule 9: Final merge via mergeStays ---
  return { stays: mergeStays(allStays), warnings };
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
  try {
    return JSON.parse(jsonString);
  } catch (err) {
    console.error("parseJsonFromAI failed. Raw text (first 500 chars):", jsonString.slice(0, 500));
    throw new Error(`AI returned invalid JSON: ${err instanceof Error ? err.message : err}`);
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

// ── Main handler ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tax_year, force, user_hints } = await request.json();

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
      .eq("tax_year", tax_year);
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
    // STAGE 0: Gmail Query (split into 3 smaller queries)
    // Gmail silently truncates huge OR queries. We run 3 focused queries
    // in parallel and deduplicate by message ID.
    // 4-month pre-buffer, 1-month post-buffer to catch bookings made
    // before/after the tax year boundaries
    // ═══════════════════════════════════════════════════════════════════
    const errors: string[] = [];

    const afterDate = `${tax_year - 1}/09/01`;
    const beforeDate = `${tax_year + 1}/01/31`;
    const dateRange = `after:${afterDate} before:${beforeDate}`;

    // When user provides city/country hints, build a single focused query
    // instead of the broad 3-query search. Much faster (~15s vs ~60s+).
    const hints = Array.isArray(user_hints)
      ? user_hints.filter((h: unknown): h is string => typeof h === "string" && h.trim().length > 0)
      : [];

    // Server-side exclusions applied to keyword query only (sender queries are high precision)
    const exclusionClause = GMAIL_EXCLUSIONS.join(' ');

    const queries = hints.length > 0
      ? [`(${hints.map((h: string) => `"${h.trim()}"`).join(" OR ")}) ${dateRange}`]
      : [
          `(${KEYWORD_QUERIES.join(" OR ")}) ${exclusionClause} ${dateRange}`,
          `(${AIRLINE_SENDERS.join(" OR ")}) ${dateRange}`,
          `(${OTA_SENDERS.join(" OR ")}) ${dateRange}`,
        ];

    async function searchGmail(query: string, maxTotal = 500): Promise<GmailMessage[]> {
      const allMessages: GmailMessage[] = [];
      let pageToken: string | undefined;

      while (allMessages.length < maxTotal) {
        const remaining = maxTotal - allMessages.length;
        const pageSize = Math.min(250, remaining);
        let searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${pageSize}`;
        if (pageToken) {
          searchUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
        }

        const searchResponse = await fetch(searchUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!searchResponse.ok) {
          const errorText = await searchResponse.text();
          if (searchResponse.status === 403) {
            throw new Error("Gmail access denied. Make sure you granted Gmail read access when signing in.");
          } else if (searchResponse.status === 401) {
            throw new Error("Gmail token expired. Please log out and sign in again.");
          }
          throw new Error(`Gmail API error (${searchResponse.status}): ${errorText}`);
        }

        const searchData = await searchResponse.json();
        const messages: GmailMessage[] = searchData.messages || [];
        allMessages.push(...messages);

        pageToken = searchData.nextPageToken;
        if (!pageToken || messages.length === 0) break;
      }

      return allMessages;
    }

    // Run all 3 queries in parallel
    const searchResults = await Promise.all(
      queries.map((q) => searchGmail(q).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Gmail search failed: ${msg}`);
        return [] as GmailMessage[];
      }))
    );

    // Track which messages came from sender queries (high precision)
    const senderMatchIds = new Set<string>();
    if (searchResults.length > 1) {
      for (const results of searchResults.slice(1)) {
        for (const msg of results) {
          senderMatchIds.add(msg.id);
        }
      }
    }

    // Deduplicate by message ID
    const messageMap = new Map<string, GmailMessage>();
    for (const results of searchResults) {
      for (const msg of results) {
        messageMap.set(msg.id, msg);
      }
    }
    const messages: GmailMessage[] = Array.from(messageMap.values());

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
    // Concurrency-limited to avoid Gmail rate limits
    const metadataResults = await mapWithConcurrency(
      newMessages,
      20,
      async (msg) => {
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
      },
    );
    const allMetadata = metadataResults.filter((r): r is NonNullable<typeof r> => r !== null);

    // Apply subject blocklist with whitelist + sender override
    let whitelistSaved = 0;
    const whitelistedSubjects: string[] = [];
    const filtered = allMetadata.filter((email) => {
      const subjectLower = email.subject.toLowerCase();
      const fromLower = email.from.toLowerCase();

      // Whitelist override: strong positive signals always pass
      const subjectWhitelisted = SUBJECT_WHITELIST.some((term) => subjectLower.includes(term))
        || BOOKING_NUMBER_REGEX.test(email.subject);

      // Sender override: emails from known airlines/OTAs always pass
      const fromKnownSender = KNOWN_SENDER_DOMAINS.some((d) => fromLower.includes(d));

      // Subject whitelist always wins (PNR, confirmation number, etc.)
      if (subjectWhitelisted) {
        const wouldBeBlocked = SUBJECT_BLOCKLIST.some((term) => subjectLower.includes(term));
        if (wouldBeBlocked) {
          whitelistSaved++;
          whitelistedSubjects.push(email.subject);
        }
        return true;
      }

      // Known senders pass ONLY if subject isn't clearly promotional
      const blocked = SUBJECT_BLOCKLIST.some((term) => subjectLower.includes(term));
      if (fromKnownSender && !blocked) {
        return true;
      }

      // Standard blocklist
      return !blocked;
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

    // Sort: sender-matched emails first (high precision), then keyword-only
    const filteredSorted = [...filtered].sort((a, b) => {
      const aIsSender = senderMatchIds.has(a.id) ? 0 : 1;
      const bIsSender = senderMatchIds.has(b.id) ? 0 : 1;
      return aIsSender - bIsSender;
    });

    // Now fetch full bodies only for filtered emails (saves time + bandwidth)
    // Concurrency-limited to avoid Gmail rate limits
    const emailSummaries: EmailSummary[] = [];

    const bodyResults = await mapWithConcurrency(
      filteredSorted.slice(0, 300),
      20,
      async (meta) => {
        try {
          const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${meta.id}?format=full`;
          const msgResponse = await fetch(msgUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!msgResponse.ok) return null;

          const msgData: GmailMessageDetail = await msgResponse.json();
          const rawBody = extractEmailBody(msgData);
          const body = stripHtml(rawBody).slice(0, 6000);

          return { id: meta.id, subject: meta.subject, snippet: meta.snippet, body };
        } catch {
          return null;
        }
      },
    );
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
    // Batched 15 per call, concurrency-limited to avoid rate limits
    // ═══════════════════════════════════════════════════════════════════
    const TRIAGE_BATCH_SIZE = 15;
    const triageBatches = chunkArray(emailSummaries, TRIAGE_BATCH_SIZE);
    const bookingEmails: EmailSummary[] = [];

    const triageResults = await mapWithConcurrency(
      triageBatches,
      5,
      async (batch) => {
        const emailBlock = batch
          .map(
            (e, i) =>
              `[Email ${i + 1}] Subject: ${e.subject}\n${e.body.slice(0, 1000)}`
          )
          .join("\n\n");

        try {
          const response = await callAnthropicWithRetry(() =>
            anthropic.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 1024,
              messages: [
                {
                  role: "user",
                  content: `${TRIAGE_PROMPT}\n\n${emailBlock}`,
                },
              ],
            })
          );

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
        } catch (err) {
          const msg = `Stage 2 triage failed: ${err instanceof Error ? err.message : err}`;
          console.error(msg);
          errors.push(msg);
          // On triage failure, pass all emails through
          return batch;
        }
      },
    );
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
    // STAGE 3: Haiku Extraction
    // Extract individual transport LEGS from confirmed bookings
    // Batched 5 emails per call, 3 concurrent (Haiku has higher limits)
    // ═══════════════════════════════════════════════════════════════════
    const EXTRACT_BATCH_SIZE = 5;
    const extractBatches = chunkArray(bookingEmails, EXTRACT_BATCH_SIZE);
    const allLegs: ExtractedLeg[] = [];

    const extractionResults = await mapWithConcurrency(
      extractBatches,
      3, // Haiku has separate, higher rate limits
      async (batch) => {
        const emailBlock = batch
          .map(
            (e, i) =>
              `--- EMAIL ${i + 1} ---\nSubject: ${e.subject}\n\n${e.body}\n--- END EMAIL ${i + 1} ---`
          )
          .join("\n\n");

        try {
          const response = await callAnthropicWithRetry(() =>
            anthropic.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 4096,
              messages: [
                {
                  role: "user",
                  content: `${EXTRACTION_PROMPT}\n\n${emailBlock}`,
                },
              ],
            })
          );

          const parsed = parseJsonFromAI(response) as { leg_count?: number; legs: ExtractedLeg[] };
          return parsed.legs || [];
        } catch (err) {
          const msg = `Stage 3 extraction failed: ${err instanceof Error ? err.message : err}`;
          console.error(msg);
          errors.push(msg);
          return [];
        }
      },
    );
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
    // STAGE 4: Deterministic Assembly
    // Stitch legs into country stays using algorithmic rules
    // (no AI call — sorting, gap-filling, and merging are 100% deterministic)
    // ═══════════════════════════════════════════════════════════════════
    const { stays, warnings: assemblyWarnings } = assembleLegsIntoStays(
      allLegs,
      taxHomeCountry,
      tax_year,
      userName,
    );

    if (assemblyWarnings.length > 0) {
      console.warn("Assembly warnings:", assemblyWarnings);
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

    // ═══════════════════════════════════════════════════════════════════
    // Merge with existing trips so multi-scan flows don't create dupes
    // ═══════════════════════════════════════════════════════════════════
    const { data: existingTrips } = await supabase
      .from("trips")
      .select("country, date_arrived, date_departed, confidence, notes")
      .eq("user_id", user.id)
      .eq("tax_year", tax_year);

    // Convert existing trips to stays format and combine
    const existingStays: AssembledStay[] = (existingTrips || []).map((t) => ({
      country: t.country,
      date_arrived: t.date_arrived,
      date_departed: t.date_departed,
      confidence: t.confidence || "MEDIUM",
      notes: t.notes || "",
    }));

    const combinedStays = mergeStays([...existingStays, ...stays]);

    // Delete all existing trips — this assembly is now authoritative
    await supabase
      .from("trips")
      .delete()
      .eq("user_id", user.id)
      .eq("tax_year", tax_year);

    // Clip stays to the tax year boundaries and drop those entirely outside
    const yearStart = `${tax_year}-01-01`;
    const yearEnd = `${tax_year}-12-31`;

    const tripRows = combinedStays
      .filter((stay) => {
        if (!stay.country || !stay.date_arrived) return false;
        if (!stay.date_arrived.match(/^\d{4}-\d{2}-\d{2}$/)) return false;
        // Drop stays entirely before or after the tax year
        const departed = stay.date_departed?.match(/^\d{4}-\d{2}-\d{2}$/)
          ? stay.date_departed : stay.date_arrived;
        if (departed < yearStart || stay.date_arrived > yearEnd) return false;
        return true;
      })
      .map((stay) => {
        const dateDeparted = stay.date_departed?.match(/^\d{4}-\d{2}-\d{2}$/)
          ? stay.date_departed
          : stay.date_arrived;
        // Clip to tax year boundaries
        const clippedArrival = stay.date_arrived < yearStart ? yearStart : stay.date_arrived;
        const clippedDeparture = dateDeparted > yearEnd ? yearEnd : dateDeparted;
        const earlier =
          clippedArrival <= clippedDeparture ? clippedArrival : clippedDeparture;
        const later =
          clippedArrival > clippedDeparture ? clippedArrival : clippedDeparture;
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
        stage1_whitelisted: whitelistedSubjects,
        stage1_whitelist_saved: whitelistSaved,
        total_candidates_before_dedup: searchResults.reduce((sum, r) => sum + r.length, 0),
        stage2_rejected: triagedOutSubjects,
        stage3_legs: allLegs,
        stage4_stays: stays,
        stage4_warnings: assemblyWarnings,
        errors,
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
