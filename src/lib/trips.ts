import { differenceInDays, parseISO } from "date-fns";
import type { Trip, PresenceTestResult, TimelineGap } from "@/types/database";

/**
 * Calculate full days present using IRS midnight-to-midnight rule.
 * The day of arrival and day of departure are NOT counted as full days.
 * Minimum 1 day per the TurboTax validation requirement.
 */
export function calculateFullDays(dateArrived: string, dateDeparted: string): number {
  const arrived = parseISO(dateArrived);
  const departed = parseISO(dateDeparted);
  const days = differenceInDays(departed, arrived) - 1;
  return Math.max(days, 1);
}

/**
 * Calculate Physical Presence Test results.
 * Must be outside the US for 330 full days in a 12-month period.
 */
export function calculatePresenceTest(
  trips: Trip[],
  qualifyingStart: string,
  qualifyingEnd: string
): PresenceTestResult {
  const start = parseISO(qualifyingStart);
  const end = parseISO(qualifyingEnd);
  const totalPeriodDays = differenceInDays(end, start);

  let totalUsDays = 0;
  const daysByCountry: Record<string, number> = {};

  for (const trip of trips) {
    const tripStart = parseISO(trip.date_arrived);
    const tripEnd = parseISO(trip.date_departed);

    // Only count trips within qualifying period
    const effectiveStart = tripStart < start ? start : tripStart;
    const effectiveEnd = tripEnd > end ? end : tripEnd;

    if (effectiveStart >= effectiveEnd) continue;

    const days = trip.full_days_present;
    const country = trip.country.toUpperCase();

    if (country === "UNITED STATES" || country === "US" || country === "USA") {
      totalUsDays += days;
    }

    daysByCountry[trip.country] = (daysByCountry[trip.country] || 0) + days;
  }

  const totalDaysAbroad = Math.min(totalPeriodDays - totalUsDays, 365);

  return {
    total_days_abroad: totalDaysAbroad,
    total_us_days: Math.min(totalUsDays, 365),
    qualifying_days_needed: 330,
    qualifies: totalDaysAbroad >= 330,
    qualifying_period_start: qualifyingStart,
    qualifying_period_end: qualifyingEnd,
    days_by_country: daysByCountry,
  };
}

/**
 * Detect gaps in the timeline where no trip data exists.
 */
export function detectGaps(trips: Trip[]): TimelineGap[] {
  if (trips.length < 2) return [];

  const sorted = [...trips].sort(
    (a, b) => parseISO(a.date_arrived).getTime() - parseISO(b.date_arrived).getTime()
  );

  const gaps: TimelineGap[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];

    const currentEnd = parseISO(current.date_departed);
    const nextStart = parseISO(next.date_arrived);

    const gapDays = differenceInDays(nextStart, currentEnd);

    // Flag gaps of more than 1 day
    if (gapDays > 1) {
      gaps.push({
        type: "gap",
        description: `${gapDays} day gap: left ${current.country} on ${current.date_departed}, arrived in ${next.country} on ${next.date_arrived}`,
        from_trip_id: current.id,
        to_trip_id: next.id,
        from_date: current.date_departed,
        to_date: next.date_arrived,
      });
    }

    // Flag overlaps
    if (gapDays < 0) {
      gaps.push({
        type: "overlap",
        description: `Overlap: ${current.country} (until ${current.date_departed}) overlaps with ${next.country} (from ${next.date_arrived})`,
        from_trip_id: current.id,
        to_trip_id: next.id,
        from_date: next.date_arrived,
        to_date: current.date_departed,
      });
    }
  }

  return gaps;
}

/**
 * Sort trips chronologically by arrival date.
 */
export function sortTripsChronologically(trips: Trip[]): Trip[] {
  return [...trips].sort(
    (a, b) => parseISO(a.date_arrived).getTime() - parseISO(b.date_arrived).getTime()
  );
}

/**
 * Get country flag emoji from country name.
 */
const COUNTRY_CODES: Record<string, string> = {
  "United States": "US", "USA": "US", "Turkey": "TR", "Türkiye": "TR",
  "Georgia": "GE", "Colombia": "CO", "Mexico": "MX", "Thailand": "TH",
  "Portugal": "PT", "Spain": "ES", "France": "FR", "Germany": "DE",
  "Italy": "IT", "United Kingdom": "GB", "UK": "GB", "Canada": "CA",
  "Japan": "JP", "South Korea": "KR", "Brazil": "BR", "Argentina": "AR",
  "Netherlands": "NL", "Croatia": "HR", "Greece": "GR", "Montenegro": "ME",
  "Albania": "AL", "Serbia": "RS", "Romania": "RO", "Bulgaria": "BG",
  "Czech Republic": "CZ", "Czechia": "CZ", "Hungary": "HU", "Poland": "PL",
  "Austria": "AT", "Switzerland": "CH", "Belgium": "BE", "Ireland": "IE",
  "Sweden": "SE", "Norway": "NO", "Denmark": "DK", "Finland": "FI",
  "Estonia": "EE", "Latvia": "LV", "Lithuania": "LT", "Indonesia": "ID",
  "Vietnam": "VN", "Malaysia": "MY", "Singapore": "SG", "Philippines": "PH",
  "India": "IN", "Australia": "AU", "New Zealand": "NZ", "UAE": "AE",
  "United Arab Emirates": "AE", "Egypt": "EG", "Morocco": "MA",
  "South Africa": "ZA", "Kenya": "KE", "Costa Rica": "CR", "Panama": "PA",
  "Peru": "PE", "Chile": "CL", "Ecuador": "EC", "Bolivia": "BO",
  "Uruguay": "UY", "Paraguay": "PY", "Dominican Republic": "DO",
  "Puerto Rico": "PR", "Taiwan": "TW", "Hong Kong": "HK", "China": "CN",
  "Israel": "IL", "Jordan": "JO", "Cyprus": "CY", "Malta": "MT",
  "Iceland": "IS", "Luxembourg": "LU", "Slovakia": "SK", "Slovenia": "SI",
  "Bosnia and Herzegovina": "BA", "North Macedonia": "MK", "Moldova": "MD",
  "Ukraine": "UA", "Belarus": "BY", "Armenia": "AM", "Azerbaijan": "AZ",
};

export function getCountryFlag(country: string): string {
  const code = COUNTRY_CODES[country];
  if (!code) return "🌍";
  return String.fromCodePoint(
    ...code.split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}
