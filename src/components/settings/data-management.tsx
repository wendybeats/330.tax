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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Trash2, Download, Loader2, AlertTriangle } from "lucide-react";

export function DataManagement() {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleDeleteAllData() {
    setDeleting(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase.from("raw_sources").delete().eq("user_id", user.id);
      await supabase.from("trips").delete().eq("user_id", user.id);
      await supabase.from("tax_profiles").delete().eq("user_id", user.id);
    }

    setDeleting(false);
    router.refresh();
  }

  async function handleExportRawData() {
    setExporting(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: trips } = await supabase
        .from("trips")
        .select("*")
        .eq("user_id", user.id);

      const { data: taxProfiles } = await supabase
        .from("tax_profiles")
        .select("*")
        .eq("user_id", user.id);

      const { data: rawSources } = await supabase
        .from("raw_sources")
        .select("*")
        .eq("user_id", user.id);

      const exportData = {
        exported_at: new Date().toISOString(),
        trips: trips ?? [],
        tax_profiles: taxProfiles ?? [],
        raw_sources: rawSources ?? [],
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `330tax-raw-data-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    setExporting(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Management</CardTitle>
        <CardDescription>
          Export your data or permanently delete all stored information.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={handleExportRawData}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Export Raw Data
          </Button>

          <Dialog>
            <DialogTrigger
              render={
                <Button variant="destructive">
                  <Trash2 className="size-4" />
                  Delete All Data
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete all data?</DialogTitle>
                <DialogDescription>
                  This will permanently delete all your trips, tax profiles, and
                  raw source data. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                <span>
                  All trip records, tax profiles, and parsed email data will be
                  permanently removed.
                </span>
              </div>
              <DialogFooter>
                <DialogClose
                  render={<Button variant="outline" />}
                >
                  Cancel
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={handleDeleteAllData}
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  {deleting ? "Deleting..." : "Delete Everything"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
