export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type SourceType = "gmail" | "file_upload" | "manual";
export type FilingStatus = "single" | "married_joint" | "married_separate";

export interface User {
  id: string;
  email: string;
  google_refresh_token: string | null;
  created_at: string;
}

export interface TaxProfile {
  id: string;
  user_id: string;
  tax_year: number;
  tax_home_country: string;
  qualifying_period_start: string;
  qualifying_period_end: string;
  filing_status: FilingStatus;
  created_at: string;
  updated_at: string;
}

export interface Trip {
  id: string;
  user_id: string;
  tax_year: number;
  country: string;
  date_arrived: string;
  date_departed: string;
  full_days_present: number;
  us_business_days: number | null;
  us_income_earned: number | null;
  confidence: ConfidenceLevel;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RawSource {
  id: string;
  user_id: string;
  trip_id: string | null;
  source_type: SourceType;
  gmail_message_id: string | null;
  file_path: string | null;
  raw_content: string | null;
  parsed_json: ParsedBooking | null;
  parsed_at: string | null;
  confidence: ConfidenceLevel | null;
  created_at: string;
}

export interface ParsedBooking {
  bookings: Booking[];
  confidence: ConfidenceLevel;
  notes: string;
}

export interface Booking {
  type: "flight" | "train" | "bus" | "ferry";
  operator: string;
  service_number: string;
  origin: Location;
  destination: Location;
  departure_date: string;
  departure_time: string;
  arrival_date: string;
  arrival_time: string;
  booking_reference: string;
  passenger_names: string[];
  class: string;
  booked_via: string;
}

export interface Location {
  city: string;
  code: string;
  country: string;
}

// Physical Presence Test
export interface PresenceTestResult {
  total_days_abroad: number;
  total_us_days: number;
  qualifying_days_needed: number;
  qualifies: boolean;
  qualifying_period_start: string;
  qualifying_period_end: string;
  days_by_country: Record<string, number>;
}

// Gap detection
export interface TimelineGap {
  type: "gap" | "overlap" | "missing_return";
  description: string;
  from_trip_id: string | null;
  to_trip_id: string | null;
  from_date: string;
  to_date: string;
  suggested_country?: string;
}
