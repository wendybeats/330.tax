import { redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import {
  Globe,
  Calendar,
  Flag,
  FileCheck,
  Plus,
  Mail,
  Download,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getCountryFlag } from "@/lib/trips";
import type { Trip, TaxProfile } from "@/types/database";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScanEmailsButton } from "@/components/scan-emails-button";

function isUSCountry(country: string): boolean {
  const upper = country.toUpperCase();
  return (
    upper === "UNITED STATES" ||
    upper === "US" ||
    upper === "USA" ||
    upper === "PUERTO RICO"
  );
}

function getConfidenceVariant(
  confidence: Trip["confidence"]
): "default" | "secondary" | "destructive" {
  switch (confidence) {
    case "HIGH":
      return "default";
    case "MEDIUM":
      return "secondary";
    case "LOW":
      return "destructive";
  }
}

function getFEIEStatus(daysAbroad: number) {
  if (daysAbroad >= 330) {
    return {
      label: "Qualifies",
      description: "You meet the 330-day threshold",
      variant: "default" as const,
    };
  }
  if (daysAbroad >= 280) {
    return {
      label: "Needs Review",
      description: `${330 - daysAbroad} more days needed`,
      variant: "secondary" as const,
    };
  }
  return {
    label: "Not Yet",
    description: `${330 - daysAbroad} more days needed`,
    variant: "destructive" as const,
  };
}

function getProgressColor(daysAbroad: number): string {
  if (daysAbroad >= 330) return "bg-primary";
  if (daysAbroad >= 280) return "bg-amber-500";
  return "bg-red-500";
}

function formatDate(dateStr: string | null | undefined, fallback = "—") {
  if (!dateStr) return fallback;
  try {
    return format(new Date(dateStr), "MMM d, yyyy");
  } catch {
    return fallback;
  }
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch tax profile — use maybeSingle to avoid throwing on 0 rows
  const { data: taxProfile } = await supabase
    .from("tax_profiles")
    .select("*")
    .eq("user_id", user.id)
    .order("tax_year", { ascending: false })
    .limit(1)
    .maybeSingle<TaxProfile>();

  // If no tax profile exists, prompt onboarding
  if (!taxProfile) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Card className="w-full max-w-lg text-center">
          <CardHeader>
            <CardTitle className="text-2xl">Welcome to 330.tax</CardTitle>
            <CardDescription className="text-base">
              Let&apos;s set up your tax profile so we can start tracking your
              physical presence for the Foreign Earned Income Exclusion.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/onboard">
              <Button size="lg" className="w-full">
                Complete Onboarding
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fetch trips for this tax year
  const { data: trips } = await supabase
    .from("trips")
    .select("*")
    .eq("user_id", user.id)
    .eq("tax_year", taxProfile.tax_year)
    .order("date_arrived", { ascending: false });

  const taxYearTrips: Trip[] = (trips as Trip[]) ?? [];

  // Calculate summary stats
  const distinctCountries = new Set(taxYearTrips.map((t) => t.country));
  const totalCountries = distinctCountries.size;

  const rawDaysAbroad = taxYearTrips
    .filter((t) => !isUSCountry(t.country))
    .reduce((sum, t) => sum + t.full_days_present, 0);
  const totalDaysAbroad = Math.min(rawDaysAbroad, 365);

  const rawUSDays = taxYearTrips
    .filter((t) => isUSCountry(t.country))
    .reduce((sum, t) => sum + t.full_days_present, 0);
  const totalUSDays = Math.min(rawUSDays, 365);

  const feieStatus = getFEIEStatus(totalDaysAbroad);
  const progressPercent = Math.min((totalDaysAbroad / 330) * 100, 100);
  const progressColor = getProgressColor(totalDaysAbroad);

  const recentTrips = taxYearTrips.slice(0, 5);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Tax Year {taxProfile.tax_year} &middot; Physical Presence Test Tracker
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Countries Visited
              </CardTitle>
              <Globe className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalCountries}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {totalCountries === 1 ? "country" : "countries"} this tax year
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Days Abroad
              </CardTitle>
              <Calendar className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalDaysAbroad}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              full days outside the US
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                US Days
              </CardTitle>
              <Flag className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalUSDays}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              full days in the United States
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                FEIE Status
              </CardTitle>
              <FileCheck className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge variant={feieStatus.variant}>{feieStatus.label}</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {feieStatus.description}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Physical Presence Test Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Physical Presence Test</CardTitle>
          <CardDescription>
            You need at least 330 full days outside the US in a 12-month
            qualifying period to claim the Foreign Earned Income Exclusion.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Days Abroad</span>
            <span className="tabular-nums text-muted-foreground">
              {totalDaysAbroad} / 330 days
            </span>
          </div>
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={totalDaysAbroad}
            aria-valuemin={0}
            aria-valuemax={330}
          >
            <div
              className={`h-full rounded-full transition-all ${progressColor}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0 days</span>
            <span className="font-medium">
              {totalDaysAbroad >= 330
                ? "Threshold met!"
                : `${330 - totalDaysAbroad} days remaining`}
            </span>
            <span>330 days</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Trips */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recent Trips</CardTitle>
                <Link href="/timeline">
                  <Button variant="ghost" size="sm">
                    View All
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {recentTrips.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Globe className="mx-auto mb-3 size-10 opacity-50" />
                  <p className="font-medium">No trips recorded yet</p>
                  <p className="mt-1 text-sm">
                    Add your first trip to start tracking your physical
                    presence.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentTrips.map((trip) => (
                    <div
                      key={trip.id}
                      className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="text-2xl"
                          role="img"
                          aria-label={trip.country}
                        >
                          {getCountryFlag(trip.country)}
                        </span>
                        <div>
                          <p className="font-medium">{trip.country}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(trip.date_arrived, "")}&nbsp;–&nbsp;
                            {formatDate(trip.date_departed, "")}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <div>
                          <p className="text-sm font-medium tabular-nums">
                            {trip.full_days_present}{" "}
                            {trip.full_days_present === 1 ? "day" : "days"}
                          </p>
                        </div>
                        <Badge
                          variant={getConfidenceVariant(trip.confidence)}
                        >
                          {trip.confidence}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions + Qualifying Period */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/timeline" className="block">
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full justify-start gap-2"
                >
                  <Plus className="size-4" />
                  Add Trip
                </Button>
              </Link>
              <ScanEmailsButton taxYear={taxProfile.tax_year} />
              <Link href="/export" className="block">
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full justify-start gap-2"
                >
                  <Download className="size-4" />
                  Export Data
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Qualifying Period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Start</span>
                <span className="font-medium">
                  {formatDate(taxProfile.qualifying_period_start)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">End</span>
                <span className="font-medium">
                  {formatDate(taxProfile.qualifying_period_end)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Filing Status</span>
                <span className="font-medium capitalize">
                  {(taxProfile.filing_status || "single").replace("_", " ")}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
