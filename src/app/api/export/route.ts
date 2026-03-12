import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { format, parseISO } from "date-fns"
import * as XLSX from "xlsx"
import type { Trip } from "@/types/database"

interface ExportRow {
  Country: string
  "Date Arrived": string
  "Date Left": string
  "Full Days Present": number
  "US Business Days": number | string
  "US Income": number | string
}

function formatTripsForExport(trips: Trip[]): ExportRow[] {
  return trips.map((trip) => ({
    Country: trip.country,
    "Date Arrived": format(parseISO(trip.date_arrived), "MM/dd/yyyy"),
    "Date Left": format(parseISO(trip.date_departed), "MM/dd/yyyy"),
    "Full Days Present": trip.full_days_present,
    "US Business Days": trip.us_business_days ?? "",
    "US Income": trip.us_income_earned ?? "",
  }))
}

function generateCSV(rows: ExportRow[]): string {
  if (rows.length === 0) return ""

  const headers = Object.keys(rows[0])
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const value = row[h as keyof ExportRow]
          // Quote strings that may contain commas
          if (typeof value === "string" && value.includes(",")) {
            return `"${value}"`
          }
          return String(value)
        })
        .join(",")
    ),
  ]

  return lines.join("\n")
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { tax_year, format: exportFormat } = body

  if (!tax_year || !exportFormat) {
    return NextResponse.json(
      { error: "Missing required fields: tax_year, format" },
      { status: 400 }
    )
  }

  if (!["csv", "xlsx", "pdf"].includes(exportFormat)) {
    return NextResponse.json(
      { error: "format must be 'csv', 'xlsx', or 'pdf'" },
      { status: 400 }
    )
  }

  // Fetch trips for the tax year
  const { data: trips, error: tripsError } = await supabase
    .from("trips")
    .select("*")
    .eq("user_id", user.id)
    .eq("tax_year", tax_year)
    .order("date_arrived", { ascending: true })

  if (tripsError) {
    return NextResponse.json({ error: tripsError.message }, { status: 500 })
  }

  const exportRows = formatTripsForExport((trips ?? []) as Trip[])

  if (exportFormat === "csv") {
    const csv = generateCSV(exportRows)

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="330_tax_trips_${tax_year}.csv"`,
      },
    })
  }

  if (exportFormat === "xlsx") {
    const worksheet = XLSX.utils.json_to_sheet(exportRows)

    // Set column widths for readability
    worksheet["!cols"] = [
      { wch: 20 }, // Country
      { wch: 14 }, // Date Arrived
      { wch: 14 }, // Date Left
      { wch: 18 }, // Full Days Present
      { wch: 16 }, // US Business Days
      { wch: 14 }, // US Income
    ]

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, `Tax Year ${tax_year}`)

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="330_tax_trips_${tax_year}.xlsx"`,
      },
    })
  }

  if (exportFormat === "pdf") {
    // Placeholder: return JSON data that a client-side PDF generator can consume
    return NextResponse.json({
      title: `IRS Form 2555 - Physical Presence Test - Tax Year ${tax_year}`,
      generated_at: new Date().toISOString(),
      tax_year,
      trip_count: exportRows.length,
      rows: exportRows,
      message: "PDF generation is handled client-side. Use this data with jsPDF or similar.",
    })
  }

  return NextResponse.json({ error: "Unsupported format" }, { status: 400 })
}
