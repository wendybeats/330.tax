"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileText, FileDown, Loader2 } from "lucide-react";

interface ExportButtonsProps {
  taxYear: number;
}

type ExportFormat = "csv" | "xlsx" | "pdf";

export function ExportButtons({ taxYear }: ExportButtonsProps) {
  const [loading, setLoading] = useState<ExportFormat | null>(null);

  async function handleExport(format: ExportFormat) {
    setLoading(format);

    try {
      const response = await fetch(
        `/api/export?format=${format}&tax_year=${taxYear}`
      );

      if (!response.ok) {
        throw new Error("Export failed");
      }

      if (format === "csv" || format === "xlsx") {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `330tax-${taxYear}-export.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (format === "pdf") {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `330tax-${taxYear}-report.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("Export error:", error);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="outline"
        onClick={() => handleExport("csv")}
        disabled={loading !== null}
      >
        {loading === "csv" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileText className="size-4" />
        )}
        TurboTax CSV
      </Button>
      <Button
        variant="outline"
        onClick={() => handleExport("xlsx")}
        disabled={loading !== null}
      >
        {loading === "xlsx" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="size-4" />
        )}
        Excel Spreadsheet
      </Button>
      <Button
        variant="outline"
        onClick={() => handleExport("pdf")}
        disabled={loading !== null}
      >
        {loading === "pdf" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileDown className="size-4" />
        )}
        PDF Report
      </Button>
    </div>
  );
}
