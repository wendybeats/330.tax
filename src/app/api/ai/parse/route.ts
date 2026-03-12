import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"
import type { ParsedBooking } from "@/types/database"

const anthropic = new Anthropic() // uses ANTHROPIC_API_KEY env var

const EXTRACTION_PROMPT = `You are a travel document parser for the IRS Foreign Earned Income Exclusion (Form 2555) Physical Presence Test. Extract structured travel booking data from the following content.

Return ONLY valid JSON in this exact format:
{
  "bookings": [
    {
      "type": "flight" | "train" | "bus" | "ferry",
      "operator": "airline or operator name",
      "service_number": "flight/train number",
      "origin": {
        "city": "city name",
        "code": "airport/station code if available, otherwise empty string",
        "country": "full country name"
      },
      "destination": {
        "city": "city name",
        "code": "airport/station code if available, otherwise empty string",
        "country": "full country name"
      },
      "departure_date": "YYYY-MM-DD",
      "departure_time": "HH:MM in 24h format, or empty string if unknown",
      "arrival_date": "YYYY-MM-DD",
      "arrival_time": "HH:MM in 24h format, or empty string if unknown",
      "booking_reference": "confirmation/PNR code if available, otherwise empty string",
      "passenger_names": ["passenger name(s)"],
      "class": "economy/business/first or empty string if unknown",
      "booked_via": "booking platform or airline direct"
    }
  ],
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "notes": "any relevant notes about ambiguities or assumptions made"
}

Rules:
- Use full country names (e.g., "United States", not "US" or "USA")
- Dates must be in YYYY-MM-DD format
- If a date is ambiguous (e.g., 01/02/2025 could be Jan 2 or Feb 1), use the most likely interpretation based on context and note the ambiguity
- If information is missing, use empty strings rather than omitting fields
- Set confidence to LOW if dates are uncertain, MEDIUM if some fields are inferred, HIGH if all data is clearly stated
- Extract ALL bookings found in the content, including multi-leg itineraries`

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { content, source_type } = body

  if (!content || !source_type) {
    return NextResponse.json(
      { error: "Missing required fields: content, source_type" },
      { status: 400 }
    )
  }

  if (source_type !== "email" && source_type !== "document") {
    return NextResponse.json(
      { error: "source_type must be 'email' or 'document'" },
      { status: 400 }
    )
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `${EXTRACTION_PROMPT}\n\n--- BEGIN ${source_type.toUpperCase()} CONTENT ---\n${content}\n--- END CONTENT ---`,
        },
      ],
    })

    // Extract text from the response
    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")

    // Parse the JSON from the response (handle potential markdown code blocks)
    let parsedData: ParsedBooking
    try {
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/)
      const jsonString = jsonMatch ? jsonMatch[1].trim() : responseText.trim()
      parsedData = JSON.parse(jsonString)
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response as JSON", raw_response: responseText },
        { status: 500 }
      )
    }

    // Store in raw_sources
    const { data: rawSource, error: sourceError } = await supabase
      .from("raw_sources")
      .insert({
        user_id: user.id,
        source_type: source_type === "email" ? "gmail" : "file_upload",
        raw_content: content,
        parsed_json: parsedData,
        parsed_at: new Date().toISOString(),
        confidence: parsedData.confidence,
      })
      .select()
      .single()

    if (sourceError) {
      return NextResponse.json(
        { error: "Failed to store parsed data", details: sourceError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      parsed: parsedData,
      raw_source_id: rawSource.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json(
      { error: "AI parsing failed", details: message },
      { status: 500 }
    )
  }
}
