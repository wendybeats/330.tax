"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, CheckCircle2, RefreshCw } from "lucide-react";

interface ScanDebug {
  stage1_blocked: string[];
  stage2_rejected: string[];
  stage3_legs: unknown[];
  stage4_stays: unknown[];
  errors?: string[];
}

export function ScanEmailsButton({ taxYear }: { taxYear: number }) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [debug, setDebug] = useState<ScanDebug | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleScan(force = false) {
    setScanning(true);
    setError(null);
    setResult(null);
    setDebug(null);
    setShowDebug(false);

    try {
      const res = await fetch("/api/ingest/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tax_year: taxYear, force }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Scan failed (${res.status})`);
      } else {
        console.log("[330.tax] Full scan response:", JSON.stringify(data, null, 2));
        setResult(data.message || `Found ${data.total_found} emails, created ${data.trips_created} trips`);
        if (data.debug) setDebug(data.debug);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection error");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="lg"
        className="w-full justify-start gap-2"
        onClick={() => handleScan(false)}
        disabled={scanning}
      >
        {scanning ? (
          <Loader2 className="size-4 animate-spin" />
        ) : result ? (
          <CheckCircle2 className="size-4 text-primary" />
        ) : (
          <Mail className="size-4" />
        )}
        {scanning ? "Scanning..." : "Scan Emails"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-muted-foreground"
        onClick={() => handleScan(true)}
        disabled={scanning}
      >
        <RefreshCw className="size-3" />
        Re-scan All Emails
      </Button>
      {result && (
        <div className="space-y-1">
          <p className="text-xs text-primary">{result}</p>
          {debug && (
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="text-xs text-muted-foreground underline"
            >
              {showDebug ? "Hide" : "Show"} pipeline details
            </button>
          )}
        </div>
      )}
      {showDebug && debug && (
        <div className="max-h-96 overflow-y-auto rounded border border-border bg-muted/50 p-2 text-xs space-y-2">
          {debug.stage1_blocked.length > 0 && (
            <div>
              <p className="font-medium">Blocked by subject filter ({debug.stage1_blocked.length}):</p>
              {debug.stage1_blocked.map((s, i) => (
                <p key={i} className="text-muted-foreground truncate">• {s}</p>
              ))}
            </div>
          )}
          {debug.stage2_rejected.length > 0 && (
            <div>
              <p className="font-medium">Rejected by AI triage ({debug.stage2_rejected.length}):</p>
              {debug.stage2_rejected.map((s, i) => (
                <p key={i} className="text-muted-foreground truncate">• {s}</p>
              ))}
            </div>
          )}
          <div>
            <p className="font-medium">Legs extracted ({debug.stage3_legs.length}):</p>
            {(debug.stage3_legs as Array<Record<string, unknown>>).map((leg, i) => (
              <p key={i} className="text-muted-foreground truncate">
                • [{leg.departure_date}] {leg.origin_city} ({leg.origin_country}) → {leg.destination_city} ({leg.destination_country}) | {leg.type} {leg.operator} {leg.service_number}
              </p>
            ))}
          </div>
          <div>
            <p className="font-medium">Stays assembled ({debug.stage4_stays.length}):</p>
            {(debug.stage4_stays as Array<Record<string, unknown>>).map((stay, i) => (
              <p key={i} className="text-muted-foreground truncate">
                • {stay.country}: {stay.date_arrived} → {stay.date_departed} [{stay.confidence}]
              </p>
            ))}
          </div>
          {debug.errors && debug.errors.length > 0 && (
            <div>
              <p className="font-medium text-destructive">Pipeline errors ({debug.errors.length}):</p>
              {debug.errors.map((s, i) => (
                <p key={i} className="text-destructive/80 truncate">• {s}</p>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
