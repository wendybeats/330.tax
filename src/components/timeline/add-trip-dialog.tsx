"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import type { ConfidenceLevel } from "@/types/database"
import { calculateFullDays } from "@/lib/trips"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

interface AddTripDialogProps {
  open: boolean
  onClose: () => void
  prefillDateArrived?: string
  prefillDateDeparted?: string
}

export function AddTripDialog({
  open,
  onClose,
  prefillDateArrived,
  prefillDateDeparted,
}: AddTripDialogProps) {
  const router = useRouter()

  const [country, setCountry] = useState("")
  const [dateArrived, setDateArrived] = useState("")
  const [dateDeparted, setDateDeparted] = useState("")
  const [fullDaysPresent, setFullDaysPresent] = useState(0)
  const [fullDaysOverride, setFullDaysOverride] = useState(false)
  const [usBusinessDays, setUsBusinessDays] = useState<string>("")
  const [usIncome, setUsIncome] = useState<string>("")
  const [confidence, setConfidence] = useState<ConfidenceLevel>("HIGH")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setCountry("")
      setDateArrived(prefillDateArrived ?? "")
      setDateDeparted(prefillDateDeparted ?? "")
      setFullDaysPresent(0)
      setFullDaysOverride(false)
      setUsBusinessDays("")
      setUsIncome("")
      setConfidence("HIGH")
      setNotes("")
    }
  }, [open, prefillDateArrived, prefillDateDeparted])

  // Auto-calculate full days when dates change
  const recalculateDays = useCallback(() => {
    if (dateArrived && dateDeparted && !fullDaysOverride) {
      const days = calculateFullDays(dateArrived, dateDeparted)
      setFullDaysPresent(days)
    }
  }, [dateArrived, dateDeparted, fullDaysOverride])

  useEffect(() => {
    recalculateDays()
  }, [recalculateDays])

  async function handleSave() {
    setSaving(true)

    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country,
          date_arrived: dateArrived,
          date_departed: dateDeparted,
          full_days_present: fullDaysPresent,
          us_business_days: usBusinessDays ? Number(usBusinessDays) : null,
          us_income_earned: usIncome ? Number(usIncome) : null,
          confidence,
          notes: notes || null,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        console.error("Failed to create trip:", err)
        return
      }

      router.refresh()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Trip</DialogTitle>
          <DialogDescription>
            Manually add a trip to your travel timeline.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Country */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-country">Country</Label>
            <Input
              id="add-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="e.g. Germany"
            />
          </div>

          {/* Dates row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-date-arrived">Date Arrived</Label>
              <Input
                id="add-date-arrived"
                type="date"
                value={dateArrived}
                onChange={(e) => setDateArrived(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-date-departed">Date Departed</Label>
              <Input
                id="add-date-departed"
                type="date"
                value={dateDeparted}
                onChange={(e) => setDateDeparted(e.target.value)}
              />
            </div>
          </div>

          {/* Full days present */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="add-full-days">Full Days Present</Label>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  if (fullDaysOverride) {
                    setFullDaysOverride(false)
                    recalculateDays()
                  } else {
                    setFullDaysOverride(true)
                  }
                }}
              >
                {fullDaysOverride ? "Auto-calculate" : "Override"}
              </Button>
            </div>
            <Input
              id="add-full-days"
              type="number"
              min={1}
              value={fullDaysPresent}
              onChange={(e) => setFullDaysPresent(Number(e.target.value))}
              disabled={!fullDaysOverride}
            />
          </div>

          {/* Optional fields row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-us-biz-days">US Business Days</Label>
              <Input
                id="add-us-biz-days"
                type="number"
                min={0}
                value={usBusinessDays}
                onChange={(e) => setUsBusinessDays(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-us-income">US Income ($)</Label>
              <Input
                id="add-us-income"
                type="number"
                min={0}
                step="0.01"
                value={usIncome}
                onChange={(e) => setUsIncome(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          {/* Confidence */}
          <div className="flex flex-col gap-1.5">
            <Label>Confidence</Label>
            <Select
              value={confidence}
              onValueChange={(val) => setConfidence(val as ConfidenceLevel)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-notes">Notes</Label>
            <Textarea
              id="add-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional context..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !country || !dateArrived || !dateDeparted}
          >
            {saving ? "Adding..." : "Add Trip"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
