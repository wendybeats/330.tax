"use client"

import { useState } from "react"
import { format, parseISO } from "date-fns"
import type { Trip, TimelineGap, SourceType } from "@/types/database"
import { getCountryFlag } from "@/lib/trips"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Mail,
  Upload,
  PenLine,
  AlertTriangle,
  Plus,
  Calendar,
  List,
} from "lucide-react"
import { TripEditor } from "@/components/timeline/trip-editor"
import { AddTripDialog } from "@/components/timeline/add-trip-dialog"

interface TripListProps {
  trips: Trip[]
  gaps: TimelineGap[]
  sourceByTripId: Record<string, SourceType>
}

const SOURCE_ICONS: Record<SourceType, typeof Mail> = {
  gmail: Mail,
  file_upload: Upload,
  manual: PenLine,
}

function getConfidenceBadgeVariant(confidence: Trip["confidence"]) {
  switch (confidence) {
    case "HIGH":
      return "default" as const
    case "MEDIUM":
      return "secondary" as const
    case "LOW":
      return "destructive" as const
  }
}

function getConfidenceLabel(confidence: Trip["confidence"]) {
  switch (confidence) {
    case "HIGH":
      return "High"
    case "MEDIUM":
      return "Medium"
    case "LOW":
      return "Low"
  }
}

export function TripList({ trips, gaps, sourceByTripId }: TripListProps) {
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [prefillDates, setPrefillDates] = useState<{
    dateArrived?: string
    dateDeparted?: string
  }>({})

  // Build a combined chronological list of trips and gaps
  type TimelineItem =
    | { type: "trip"; trip: Trip }
    | { type: "gap"; gap: TimelineGap }

  const items: TimelineItem[] = []

  // Insert trips and gaps in chronological order
  let gapIndex = 0
  for (let i = 0; i < trips.length; i++) {
    items.push({ type: "trip", trip: trips[i] })

    // Check if there's a gap after this trip (before the next one)
    while (gapIndex < gaps.length) {
      const gap = gaps[gapIndex]
      if (gap.from_trip_id === trips[i].id) {
        items.push({ type: "gap", gap })
        gapIndex++
      } else {
        break
      }
    }
  }

  function handleTripClick(trip: Trip) {
    setEditingTrip(trip)
    setEditorOpen(true)
  }

  function handleEditorClose() {
    setEditorOpen(false)
    setEditingTrip(null)
  }

  function handleAddTripFromGap(gap: TimelineGap) {
    setPrefillDates({
      dateArrived: gap.from_date,
      dateDeparted: gap.to_date,
    })
    setAddOpen(true)
  }

  function handleAddTripOpen() {
    setPrefillDates({})
    setAddOpen(true)
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Travel Timeline
          </h1>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm">
              <List className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm">
              <Calendar className="size-4" />
            </Button>
          </div>
        </div>
        <Button onClick={handleAddTripOpen}>
          <Plus className="size-4" />
          Add Trip
        </Button>
      </div>

      <Separator />

      {/* Trip list */}
      {trips.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Calendar className="mb-4 size-12 text-muted-foreground" />
            <p className="text-lg font-medium">No trips yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your first trip to start building your travel timeline.
            </p>
            <Button className="mt-4" onClick={handleAddTripOpen}>
              <Plus className="size-4" />
              Add Trip
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item, index) => {
            if (item.type === "gap") {
              const gap = item.gap
              const gapDays = Math.abs(
                Math.round(
                  (parseISO(gap.to_date).getTime() -
                    parseISO(gap.from_date).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              )

              return (
                <Card
                  key={`gap-${index}`}
                  className="border-yellow-500/30 bg-yellow-50/50"
                >
                  <CardContent className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="size-5 shrink-0 text-yellow-600" />
                      <div>
                        <p className="font-medium text-yellow-800">
                          Gap detected: {gapDays} day{gapDays !== 1 ? "s" : ""}{" "}
                          unaccounted for
                        </p>
                        <p className="text-xs text-yellow-700/80">
                          {format(parseISO(gap.from_date), "MMM d, yyyy")} &mdash;{" "}
                          {format(parseISO(gap.to_date), "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddTripFromGap(gap)}
                    >
                      <Plus className="size-3.5" />
                      Add Trip
                    </Button>
                  </CardContent>
                </Card>
              )
            }

            // Trip card
            const trip = item.trip
            const sourceType = sourceByTripId[trip.id]
            const SourceIcon = sourceType ? SOURCE_ICONS[sourceType] : PenLine

            return (
              <Card
                key={trip.id}
                className="cursor-pointer transition-colors hover:bg-muted/50"
                onClick={() => handleTripClick(trip)}
              >
                <CardContent className="flex items-center gap-4">
                  {/* Flag */}
                  <span className="text-3xl leading-none">
                    {getCountryFlag(trip.country)}
                  </span>

                  {/* Trip details */}
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{trip.country}</span>
                      <Badge variant={getConfidenceBadgeVariant(trip.confidence)}>
                        {getConfidenceLabel(trip.confidence)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>
                        {format(parseISO(trip.date_arrived), "MMM d, yyyy")} &mdash;{" "}
                        {format(parseISO(trip.date_departed), "MMM d, yyyy")}
                      </span>
                      <span className="text-xs">
                        &middot; {trip.full_days_present} day
                        {trip.full_days_present !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>

                  {/* Source icon */}
                  <div className="flex items-center">
                    <SourceIcon className="size-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Edit trip dialog */}
      <TripEditor
        trip={editingTrip}
        open={editorOpen}
        onClose={handleEditorClose}
        onSave={handleEditorClose}
      />

      {/* Add trip dialog */}
      <AddTripDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        taxYear={trips[0]?.tax_year ?? new Date().getFullYear()}
        prefillDateArrived={prefillDates.dateArrived}
        prefillDateDeparted={prefillDates.dateDeparted}
      />
    </>
  )
}
