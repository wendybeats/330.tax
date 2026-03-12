"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TaxProfile, FilingStatus } from "@/types/database";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";

interface TaxProfileFormProps {
  profile: TaxProfile | null;
  userId: string;
}

export function TaxProfileForm({ profile, userId }: TaxProfileFormProps) {
  const [taxYear, setTaxYear] = useState(
    profile?.tax_year ?? new Date().getFullYear()
  );
  const [taxHomeCountry, setTaxHomeCountry] = useState(
    profile?.tax_home_country ?? ""
  );
  const [filingStatus, setFilingStatus] = useState<FilingStatus>(
    profile?.filing_status ?? "single"
  );
  const [qualifyingStart, setQualifyingStart] = useState(
    profile?.qualifying_period_start ?? `${taxYear}-01-01`
  );
  const [qualifyingEnd, setQualifyingEnd] = useState(
    profile?.qualifying_period_end ?? `${taxYear}-12-31`
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);

    const supabase = createClient();

    const data = {
      user_id: userId,
      tax_year: taxYear,
      tax_home_country: taxHomeCountry,
      filing_status: filingStatus,
      qualifying_period_start: qualifyingStart,
      qualifying_period_end: qualifyingEnd,
      updated_at: new Date().toISOString(),
    };

    if (profile?.id) {
      await supabase.from("tax_profiles").update(data).eq("id", profile.id);
    } else {
      await supabase.from("tax_profiles").insert(data);
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax Profile</CardTitle>
        <CardDescription>
          Configure your tax year and qualifying period for the Physical Presence
          Test.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tax-year">Tax Year</Label>
            <Select
              value={taxYear}
              onValueChange={(val) => setTaxYear(Number(val))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={2024}>2024</SelectItem>
                <SelectItem value={2025}>2025</SelectItem>
                <SelectItem value={2026}>2026</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tax-home-country">Tax Home Country</Label>
            <Input
              id="tax-home-country"
              value={taxHomeCountry}
              onChange={(e) => setTaxHomeCountry(e.target.value)}
              placeholder="e.g. Portugal"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filing-status">Filing Status</Label>
          <Select
            value={filingStatus}
            onValueChange={(val) => setFilingStatus(val as FilingStatus)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select filing status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single">Single</SelectItem>
              <SelectItem value="married_joint">Married Filing Jointly</SelectItem>
              <SelectItem value="married_separate">
                Married Filing Separately
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="qualifying-start">Qualifying Period Start</Label>
            <Input
              id="qualifying-start"
              type="date"
              value={qualifyingStart}
              onChange={(e) => setQualifyingStart(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qualifying-end">Qualifying Period End</Label>
            <Input
              id="qualifying-end"
              type="date"
              value={qualifyingEnd}
              onChange={(e) => setQualifyingEnd(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
          {saved && (
            <span className="text-sm text-muted-foreground">
              Profile saved successfully.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
