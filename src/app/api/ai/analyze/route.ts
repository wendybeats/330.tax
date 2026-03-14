import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"
import { detectGaps, sortTripsChronologically } from "@/lib/trips"
import type { Trip, TimelineGap } from "@/types/database"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { tax_year } = body

  if (!tax_year) {
    return NextResponse.json(
      { error: "Missing required field: tax_year" },
      { status: 400 }
    )
  }

  // Fetch all trips for the tax year
  const { data: trips, error: tripsError } = await supabase
    .from("trips")
    .select("*")
    .eq("user_id", user.id)
    .eq("tax_year", tax_year)
    .order("date_arrived", { ascending: true })

  if (tripsError) {
    return NextResponse.json({ error: tripsError.message }, { status: 500 })
  }

  if (!trips || trips.length === 0) {
    return NextResponse.json({
      gaps: [],
      overlaps: [],
      issues: [],
      summary: "No trips found for this tax year.",
    })
  }

  // Run local gap detection first
  const sortedTrips = sortTripsChronologically(trips as Trip[])
  const localGaps = detectGaps(sortedTrips)

  // Build trip summary for Claude analysis
  const tripSummary = sortedTrips
    .map(
      (t, i) =>
        `${i + 1}. ${t.country}: ${t.date_arrived} to ${t.date_departed} (${t.full_days_present} full days, confidence: ${t.confidence})`
    )
    .join("\n")

  const gapSummary = localGaps.length > 0
    ? localGaps.map((g) => `- ${g.description}`).join("\n")
    : "No gaps detected by automated analysis."

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are an IRS Form 2555 Physical Presence Test advisor. Analyze the following travel timeline for tax year ${tax_year} and identify potential issues.

TRIPS:
${tripSummary}

AUTOMATED GAP DETECTION:
${gapSummary}

Please analyze and return ONLY valid JSON in this format:
{
  "gaps": [
    {
      "type": "gap",
      "description": "description of the gap",
      "from_date": "YYYY-MM-DD",
      "to_date": "YYYY-MM-DD",
      "suggested_country": "likely country if inferable, or null",
      "severity": "high" | "medium" | "low"
    }
  ],
  "overlaps": [
    {
      "type": "overlap",
      "description": "description of the overlap",
      "from_date": "YYYY-MM-DD",
      "to_date": "YYYY-MM-DD",
      "severity": "high" | "medium" | "low"
    }
  ],
  "issues": [
    {
      "type": "warning" | "error" | "suggestion",
      "description": "description of the issue or suggestion"
    }
  ],
  "summary": "brief overall assessment of the timeline completeness and any concerns for the Physical Presence Test"
}

Consider:
- Gaps where the person's location is unaccounted for
- Overlapping dates that are physically impossible
- Whether the total days abroad could meet the 330-day requirement
- Transit days that might be miscounted
- US visits that could affect qualification
- Low-confidence entries that need verification
- Whether the qualifying 12-month period is optimally chosen`,
        },
      ],
    })

    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")

    let analysis
    try {
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/)
      const jsonString = jsonMatch ? jsonMatch[1].trim() : responseText.trim()
      analysis = JSON.parse(jsonString)
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI analysis", raw_response: responseText },
        { status: 500 }
      )
    }

    // Merge local gap detection with AI analysis
    const mergedGaps: TimelineGap[] = localGaps.map((g) => ({
      ...g,
      from_trip_id: g.from_trip_id,
      to_trip_id: g.to_trip_id,
    }))

    return NextResponse.json({
      ...analysis,
      local_gaps: mergedGaps,
      trip_count: trips.length,
      tax_year,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json(
      { error: "AI analysis failed", details: errorMessage },
      { status: 500 }
    )
  }
}
