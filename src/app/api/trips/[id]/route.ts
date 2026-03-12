import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { calculateFullDays } from "@/lib/trips"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: trip, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (error || !trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 })
  }

  return NextResponse.json({ trip })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 })
  }

  const body = await request.json()
  const updates: Record<string, unknown> = {}

  // Allow updating these fields
  const allowedFields = [
    "country",
    "date_arrived",
    "date_departed",
    "tax_year",
    "confidence",
    "notes",
    "us_business_days",
    "us_income_earned",
    "sort_order",
  ]

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field]
    }
  }

  // Recalculate full_days_present if dates change
  const dateArrived = (updates.date_arrived as string) || existing.date_arrived
  const dateDeparted = (updates.date_departed as string) || existing.date_departed

  if (updates.date_arrived !== undefined || updates.date_departed !== undefined) {
    updates.full_days_present = calculateFullDays(dateArrived, dateDeparted)
  }

  const { data: trip, error: updateError } = await supabase
    .from("trips")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ trip })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Delete associated raw_sources first
  await supabase
    .from("raw_sources")
    .delete()
    .eq("trip_id", id)
    .eq("user_id", user.id)

  // Delete the trip
  const { error } = await supabase
    .from("trips")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
