import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import {
  getCountryFlag,
  calculatePresenceTest,
  detectGaps,
  sortTripsChronologically,
} from "@/lib/trips";
import type { Trip, TaxProfile } from "@/types/database";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ExportButtons } from "@/components/export/export-buttons";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Download,
  FileWarning,
} from "lucide-react";

function formatDate(dateString: string): string {
  return format(parseISO(dateString), "MM/dd/yyyy");
}

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(amount);
}

export default async function ExportPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: taxProfile } = await supabase
    .from("tax_profiles")
    .select("*")
    .eq("user_id", user.id)
    .order("tax_year", { ascending: false })
    .limit(1)
    .single();

  const { data: trips } = await supabase
    .from("trips")
    .select("*")
    .eq("user_id", user.id)
    .eq("tax_year", taxProfile?.tax_year ?? new Date().getFullYear())
    .order("date_arrived", { ascending: true });

  const sortedTrips = sortTripsChronologically(
    (trips as Trip[]) ?? []
  );

  const profile = taxProfile as TaxProfile | null;

  const presenceTest = profile
    ? calculatePresenceTest(
        sortedTrips,
        profile.qualifying_period_start,
        profile.qualifying_period_end
      )
    : null;

  const gaps = detectGaps(sortedTrips);
  const lowConfidenceCount = sortedTrips.filter(
    (t) => t.confidence === "LOW"
  ).length;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Export</h1>
        <p className="mt-1 text-muted-foreground">
          Preview and export your travel data in IRS Form 2555 format.
        </p>
      </div>

      {/* Validation Warnings */}
      {(lowConfidenceCount > 0 || gaps.length > 0) && (
        <div className="space-y-3">
          {lowConfidenceCount > 0 && (
            <Alert>
              <FileWarning className="size-4" />
              <AlertTitle>Low confidence trips detected</AlertTitle>
              <AlertDescription>
                {lowConfidenceCount} trip{lowConfidenceCount !== 1 ? "s" : ""}{" "}
                {lowConfidenceCount !== 1 ? "have" : "has"} LOW confidence
                scores. Review these trips before exporting to ensure accuracy.
              </AlertDescription>
            </Alert>
          )}
          {gaps.length > 0 && (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle>Timeline gaps detected</AlertTitle>
              <AlertDescription>
                {gaps.length} gap{gaps.length !== 1 ? "s" : ""} found in your
                travel timeline. Missing days may affect your Physical Presence
                Test calculation.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Export Buttons */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="size-5" />
            Export Formats
          </CardTitle>
          <CardDescription>
            Choose a format to download your travel data. CSV is compatible with
            TurboTax and most tax software.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExportButtons taxYear={profile?.tax_year ?? new Date().getFullYear()} />
        </CardContent>
      </Card>

      {/* Trip Data Preview Table */}
      <Card>
        <CardHeader>
          <CardTitle>Form 2555 Preview</CardTitle>
          <CardDescription>
            {sortedTrips.length} trip{sortedTrips.length !== 1 ? "s" : ""} for
            tax year {profile?.tax_year ?? new Date().getFullYear()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedTrips.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No trips found. Add trips from the timeline or scan your Gmail to
              get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead>Date Arrived</TableHead>
                  <TableHead>Date Left</TableHead>
                  <TableHead className="text-right">Full Days</TableHead>
                  <TableHead className="text-right">US Business Days</TableHead>
                  <TableHead className="text-right">US Income</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTrips.map((trip) => (
                  <TableRow key={trip.id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span>{getCountryFlag(trip.country)}</span>
                        <span>{trip.country}</span>
                      </span>
                    </TableCell>
                    <TableCell>{formatDate(trip.date_arrived)}</TableCell>
                    <TableCell>{formatDate(trip.date_departed)}</TableCell>
                    <TableCell className="text-right">
                      {trip.full_days_present}
                    </TableCell>
                    <TableCell className="text-right">
                      {trip.us_business_days ?? "--"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(trip.us_income_earned)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          trip.confidence === "HIGH"
                            ? "default"
                            : trip.confidence === "MEDIUM"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {trip.confidence}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Physical Presence Test Summary */}
      {presenceTest && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {presenceTest.qualifies ? (
                <CheckCircle2 className="size-5 text-primary" />
              ) : (
                <XCircle className="size-5 text-destructive" />
              )}
              Physical Presence Test
            </CardTitle>
            <CardDescription>
              Qualifying period:{" "}
              {formatDate(presenceTest.qualifying_period_start)} &ndash;{" "}
              {formatDate(presenceTest.qualifying_period_end)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Days Abroad</p>
                <p className="text-2xl font-bold tabular-nums">
                  {presenceTest.total_days_abroad}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">US Days</p>
                <p className="text-2xl font-bold tabular-nums">
                  {presenceTest.total_us_days}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Required</p>
                <p className="text-2xl font-bold tabular-nums">
                  {presenceTest.qualifying_days_needed}
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-border p-4">
              {presenceTest.qualifies ? (
                <p className="flex items-center gap-2 text-sm font-medium text-primary">
                  <CheckCircle2 className="size-4" />
                  You meet the 330-day Physical Presence Test requirement.
                </p>
              ) : (
                <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <XCircle className="size-4" />
                  You need{" "}
                  {presenceTest.qualifying_days_needed -
                    presenceTest.total_days_abroad}{" "}
                  more days abroad to meet the Physical Presence Test.
                </p>
              )}
            </div>

            {Object.keys(presenceTest.days_by_country).length > 0 && (
              <div className="mt-6">
                <p className="mb-3 text-sm font-medium">Days by Country</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(presenceTest.days_by_country)
                    .sort(([, a], [, b]) => b - a)
                    .map(([country, days]) => (
                      <span
                        key={country}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm"
                      >
                        <span>{getCountryFlag(country)}</span>
                        <span>{country}</span>
                        <span className="font-medium tabular-nums">{days}d</span>
                      </span>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
