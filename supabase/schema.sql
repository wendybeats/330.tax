-- 330.tax Supabase Database Schema
-- Full SQL schema for IRS Form 330 foreign earned income exclusion tracker

-- =============================================================================
-- TRIGGER FUNCTION: auto-update updated_at columns
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- TABLE: users (extends Supabase auth.users)
-- =============================================================================

CREATE TABLE users (
  id                   uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                text        NOT NULL,
  google_refresh_token text,       -- encrypted at the application layer
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own row"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own row"
  ON users FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own row"
  ON users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can delete their own row"
  ON users FOR DELETE
  USING (auth.uid() = id);

-- =============================================================================
-- TABLE: tax_profiles
-- =============================================================================

CREATE TABLE tax_profiles (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tax_year                int         NOT NULL,
  tax_home_country        text,
  qualifying_period_start date,
  qualifying_period_end   date,
  filing_status           text        CHECK (filing_status IN ('single', 'married_joint', 'married_separate')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, tax_year)
);

ALTER TABLE tax_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tax profiles"
  ON tax_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tax profiles"
  ON tax_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tax profiles"
  ON tax_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tax profiles"
  ON tax_profiles FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_tax_profiles_user_id  ON tax_profiles(user_id);
CREATE INDEX idx_tax_profiles_tax_year ON tax_profiles(tax_year);

CREATE TRIGGER trg_tax_profiles_updated_at
  BEFORE UPDATE ON tax_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- TABLE: trips
-- =============================================================================

CREATE TABLE trips (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tax_year         int            NOT NULL,
  country          text           NOT NULL,
  date_arrived     date           NOT NULL,
  date_departed    date           NOT NULL,
  full_days_present int           NOT NULL,
  us_business_days int,
  us_income_earned decimal,
  confidence       text           NOT NULL DEFAULT 'HIGH'
                                  CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  notes            text,
  sort_order       int            NOT NULL DEFAULT 0,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT chk_trips_dates CHECK (date_departed >= date_arrived)
);

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own trips"
  ON trips FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own trips"
  ON trips FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own trips"
  ON trips FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own trips"
  ON trips FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_trips_user_id  ON trips(user_id);
CREATE INDEX idx_trips_tax_year ON trips(tax_year);

CREATE TRIGGER trg_trips_updated_at
  BEFORE UPDATE ON trips
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- TABLE: raw_sources
-- =============================================================================

CREATE TABLE raw_sources (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id          uuid        REFERENCES trips(id) ON DELETE SET NULL,
  source_type      text        NOT NULL CHECK (source_type IN ('gmail', 'file_upload', 'manual')),
  gmail_message_id text,
  file_path        text,
  raw_content      text,
  parsed_json      jsonb,
  parsed_at        timestamptz,
  confidence       text        CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE raw_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own raw sources"
  ON raw_sources FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own raw sources"
  ON raw_sources FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own raw sources"
  ON raw_sources FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own raw sources"
  ON raw_sources FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_raw_sources_user_id ON raw_sources(user_id);
CREATE INDEX idx_raw_sources_trip_id ON raw_sources(trip_id);
