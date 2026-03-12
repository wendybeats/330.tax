"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Globe,
  Mail,
  Sparkles,
  SkipForward,
  Loader2,
  CheckCircle2,
} from "lucide-react";

const TOTAL_STEPS = 5;

export default function OnboardPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [taxYear, setTaxYear] = useState(2025);
  const [taxHomeCountry, setTaxHomeCountry] = useState("");
  const [qualifyingStart, setQualifyingStart] = useState("");
  const [qualifyingEnd, setQualifyingEnd] = useState("");
  const [saving, setSaving] = useState(false);

  // Update qualifying period defaults when tax year changes
  function handleYearChange(year: number) {
    setTaxYear(year);
    if (!qualifyingStart || qualifyingStart.startsWith(String(taxYear))) {
      setQualifyingStart(`${year}-01-01`);
    }
    if (!qualifyingEnd || qualifyingEnd.startsWith(String(taxYear))) {
      setQualifyingEnd(`${year}-12-31`);
    }
  }

  // Initialize defaults on first render of step 3
  function ensureQualifyingDefaults() {
    if (!qualifyingStart) setQualifyingStart(`${taxYear}-01-01`);
    if (!qualifyingEnd) setQualifyingEnd(`${taxYear}-12-31`);
  }

  async function handleComplete(scanGmail: boolean) {
    setSaving(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase.from("tax_profiles").upsert(
        {
          user_id: user.id,
          tax_year: taxYear,
          tax_home_country: taxHomeCountry,
          filing_status: "single",
          qualifying_period_start: qualifyingStart || `${taxYear}-01-01`,
          qualifying_period_end: qualifyingEnd || `${taxYear}-12-31`,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,tax_year" }
      );
    }

    if (scanGmail) {
      // Trigger Gmail scan, then redirect
      // For now, just redirect - the scan API will be called from dashboard
      router.push("/dashboard");
    } else {
      router.push("/dashboard");
    }
  }

  function handleNext() {
    if (step === 3) {
      ensureQualifyingDefaults();
    }
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    }
  }

  function handleBack() {
    if (step > 1) {
      setStep(step - 1);
    }
  }

  const progressValue = (step / TOTAL_STEPS) * 100;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      {/* Progress */}
      <div className="mb-8 w-full max-w-lg">
        <Progress value={progressValue} />
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Step {step} of {TOTAL_STEPS}
        </p>
      </div>

      {/* Step Content */}
      <Card className="w-full max-w-lg">
        {/* Step 1: Tax Year */}
        {step === 1 && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Calendar className="size-6 text-primary" />
              </div>
              <CardTitle className="text-2xl">
                What tax year are you filing for?
              </CardTitle>
              <CardDescription>
                Select the tax year you want to track travel for.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-6">
              <Select
                value={taxYear}
                onValueChange={(val) => handleYearChange(Number(val))}
              >
                <SelectTrigger className="w-full max-w-xs">
                  <SelectValue placeholder="Select tax year" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={2024}>2024</SelectItem>
                  <SelectItem value={2025}>2025</SelectItem>
                  <SelectItem value={2026}>2026</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </>
        )}

        {/* Step 2: Tax Home */}
        {step === 2 && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Globe className="size-6 text-primary" />
              </div>
              <CardTitle className="text-2xl">
                Where is your tax home?
              </CardTitle>
              <CardDescription>
                This is the country where your primary place of business or
                employment is located.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-6">
              <div className="w-full max-w-xs space-y-2">
                <Label htmlFor="tax-home">Country</Label>
                <Input
                  id="tax-home"
                  placeholder="e.g. Portugal"
                  value={taxHomeCountry}
                  onChange={(e) => setTaxHomeCountry(e.target.value)}
                />
              </div>
            </CardContent>
          </>
        )}

        {/* Step 3: Qualifying Period */}
        {step === 3 && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Calendar className="size-6 text-primary" />
              </div>
              <CardTitle className="text-2xl">
                Set your qualifying period
              </CardTitle>
              <CardDescription>
                The 12-month period during which you must be physically present
                outside the US for at least 330 full days.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="start-date">Start Date</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={qualifyingStart || `${taxYear}-01-01`}
                    onChange={(e) => setQualifyingStart(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-date">End Date</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={qualifyingEnd || `${taxYear}-12-31`}
                    onChange={(e) => setQualifyingEnd(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-center text-sm text-muted-foreground">
                Most filers use January 1 &ndash; December 31 of their tax year.
              </p>
            </CardContent>
          </>
        )}

        {/* Step 4: Gmail Scan */}
        {step === 4 && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Mail className="size-6 text-primary" />
              </div>
              <CardTitle className="text-2xl">
                Ready to scan your emails?
              </CardTitle>
              <CardDescription>
                We&apos;ll search your Gmail for flight confirmations, hotel
                bookings, and other travel receipts to automatically build your
                travel timeline.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <Button
                size="lg"
                className="w-full max-w-xs"
                onClick={() => {
                  setStep(5);
                }}
              >
                <Mail className="size-4" />
                Scan My Gmail
              </Button>
              <Button
                variant="ghost"
                className="w-full max-w-xs"
                onClick={() => {
                  setStep(5);
                }}
              >
                <SkipForward className="size-4" />
                Skip for Now
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Read-only access. We never send, modify, or delete your emails.
              </p>
            </CardContent>
          </>
        )}

        {/* Step 5: All Set */}
        {step === 5 && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-green-500/10">
                <CheckCircle2 className="size-6 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle className="text-2xl">All set!</CardTitle>
              <CardDescription>
                Your tax profile for {taxYear} has been created
                {taxHomeCountry ? ` with ${taxHomeCountry} as your tax home` : ""}.
                You&apos;re ready to start tracking your travel.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <div className="w-full max-w-xs space-y-3 rounded-lg border border-border p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax Year</span>
                  <span className="font-medium">{taxYear}</span>
                </div>
                {taxHomeCountry && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax Home</span>
                    <span className="font-medium">{taxHomeCountry}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Period</span>
                  <span className="font-medium">
                    {qualifyingStart || `${taxYear}-01-01`} &mdash;{" "}
                    {qualifyingEnd || `${taxYear}-12-31`}
                  </span>
                </div>
              </div>
              <Button
                size="lg"
                className="w-full max-w-xs"
                onClick={() => handleComplete(false)}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {saving ? "Setting up..." : "Go to Dashboard"}
              </Button>
            </CardContent>
          </>
        )}
      </Card>

      {/* Navigation Buttons */}
      {step < 4 && (
        <div className="mt-6 flex w-full max-w-lg items-center justify-between">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={step === 1}
          >
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <Button
            onClick={handleNext}
            disabled={step === 2 && !taxHomeCountry.trim()}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
      {step === 4 && (
        <div className="mt-6 flex w-full max-w-lg items-center justify-start">
          <Button variant="ghost" onClick={handleBack}>
            <ChevronLeft className="size-4" />
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
