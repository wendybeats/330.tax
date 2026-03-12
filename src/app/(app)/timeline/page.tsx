import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { detectGaps } from "@/lib/trips"
import type { Trip, RawSource } from "@/types/database"
import { TripList } from "@/components/timeline/trip-list"

export default async function TimelinePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  // Fetch trips ordered by arrival date
  const { data: trips, error: tripsError } = await supabase
    .from("trips")
    .select("*")
    .eq("user_id", user.id)
    .order("date_arrived", { ascending: true })

  if (tripsError) {
    console.error("Failed to fetch trips:", tripsError)
  }

  // Fetch raw sources linked to trips
  const tripIds = (trips ?? []).map((t: Trip) => t.id)
  let sources: RawSource[] = []

  if (tripIds.length > 0) {
    const { data: rawSources, error: sourcesError } = await supabase
      .from("raw_sources")
      .select("*")
      .in("trip_id", tripIds)

    if (sourcesError) {
      console.error("Failed to fetch raw sources:", sourcesError)
    } else {
      sources = rawSources ?? []
    }
  }

  const typedTrips: Trip[] = trips ?? []
  const gaps = detectGaps(typedTrips)

  // Build a map of trip_id -> source_type for display
  const sourceByTripId: Record<string, RawSource["source_type"]> = {}
  for (const s of sources) {
    if (s.trip_id) {
      sourceByTripId[s.trip_id] = s.source_type
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <TripList trips={typedTrips} gaps={gaps} sourceByTripId={sourceByTripId} />
    </div>
  )
}
