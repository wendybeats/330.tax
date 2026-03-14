"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, CheckCircle2 } from "lucide-react";

export function ScanEmailsButton({ taxYear }: { taxYear: number }) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleScan() {
    setScanning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/ingest/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tax_year: taxYear }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Scan failed (${res.status})`);
      } else {
        setResult(
          `Found ${data.total_found} emails, created ${data.trips_created} trips`
        );
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
        onClick={handleScan}
        disabled={scanning}
      >
        {scanning ? (
          <Loader2 className="size-4 animate-spin" />
        ) : result ? (
          <CheckCircle2 className="size-4 text-green-600" />
        ) : (
          <Mail className="size-4" />
        )}
        {scanning ? "Scanning..." : "Scan Emails"}
      </Button>
      {result && (
        <p className="text-xs text-green-600 dark:text-green-400">{result}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
