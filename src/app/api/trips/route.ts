import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { calculateFullDays } from "@/lib/trips"
import type { ConfidenceLevel } from "@/types/database"

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const taxYear = searchParams.get("tax_year")
  const country = searchParams.get("country")

  let query = supabase
    .from("trips")
    .select("*")
    .eq("user_id", user.id)
    .order("date_arrived", { ascending: true })

  if (taxYear) {
    query = query.eq("tax_year", parseInt(taxYear, 10))
  }

  if (country) {
    query = query.ilike("country", country)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ trips: data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const {
    country,
    date_arrived,
    date_departed,
    tax_year,
    confidence = "HIGH" as ConfidenceLevel,
    notes = null,
    us_business_days = null,
    us_income_earned = null,
  } = body

  if (!country || !date_arrived || !date_departed || !tax_year) {
    return NextResponse.json(
      { error: "Missing required fields: country, date_arrived, date_departed, tax_year" },
      { status: 400 }
    )
  }

  // IRS midnight-to-midnight rule
  const full_days_present = calculateFullDays(date_arrived, date_departed)

  // Insert the trip
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .insert({
      user_id: user.id,
      country,
      date_arrived,
      date_departed,
      tax_year,
      full_days_present,
      confidence,
      notes,
      us_business_days,
      us_income_earned,
    })
    .select()
    .single()

  if (tripError) {
    return NextResponse.json({ error: tripError.message }, { status: 500 })
  }

  // Create a raw_sources entry for manual entry
  const { error: sourceError } = await supabase
    .from("raw_sources")
    .insert({
      user_id: user.id,
      trip_id: trip.id,
      source_type: "manual",
      raw_content: JSON.stringify(body),
      parsed_at: new Date().toISOString(),
      confidence,
    })

  if (sourceError) {
    console.error("Failed to create raw_source:", sourceError.message)
  }

  return NextResponse.json({ trip }, { status: 201 })
}
