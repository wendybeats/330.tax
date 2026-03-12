"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import type { Trip, ConfidenceLevel } from "@/types/database"
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
import { Separator } from "@/components/ui/separator"
import { Trash2 } from "lucide-react"

interface TripEditorProps {
  trip: Trip | null
  open: boolean
  onClose: () => void
  onSave: () => void
}

export function TripEditor({ trip, open, onClose, onSave }: TripEditorProps) {
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
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reset form when trip changes
  useEffect(() => {
    if (trip) {
      setCountry(trip.country)
      setDateArrived(trip.date_arrived)
      setDateDeparted(trip.date_departed)
      setFullDaysPresent(trip.full_days_present)
      setFullDaysOverride(false)
      setUsBusinessDays(trip.us_business_days?.toString() ?? "")
      setUsIncome(trip.us_income_earned?.toString() ?? "")
      setConfidence(trip.confidence)
      setNotes(trip.notes ?? "")
      setConfirmDelete(false)
    }
  }, [trip])

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
    if (!trip) return
    setSaving(true)

    try {
      const res = await fetch("/api/trips", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: trip.id,
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
        console.error("Failed to update trip:", err)
        return
      }

      router.refresh()
      onSave()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!trip) return

    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    setDeleting(true)

    try {
      const res = await fetch(`/api/trips?id=${trip.id}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const err = await res.json()
        console.error("Failed to delete trip:", err)
        return
      }

      router.refresh()
      onClose()
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!trip) return null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Trip</DialogTitle>
          <DialogDescription>
            Update trip details. Changes affect your physical presence
            calculation.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Country */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-country">Country</Label>
            <Input
              id="edit-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="e.g. Germany"
            />
          </div>

          {/* Dates row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-date-arrived">Date Arrived</Label>
              <Input
                id="edit-date-arrived"
                type="date"
                value={dateArrived}
                onChange={(e) => setDateArrived(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-date-departed">Date Departed</Label>
              <Input
                id="edit-date-departed"
                type="date"
                value={dateDeparted}
                onChange={(e) => setDateDeparted(e.target.value)}
              />
            </div>
          </div>

          {/* Full days present */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-full-days">Full Days Present</Label>
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
              id="edit-full-days"
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
              <Label htmlFor="edit-us-biz-days">US Business Days</Label>
              <Input
                id="edit-us-biz-days"
                type="number"
                min={0}
                value={usBusinessDays}
                onChange={(e) => setUsBusinessDays(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-us-income">US Income ($)</Label>
              <Input
                id="edit-us-income"
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
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea
              id="edit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional context..."
              rows={3}
            />
          </div>
        </div>

        <Separator />

        <DialogFooter>
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 className="size-3.5" />
                {confirmDelete ? "Confirm Delete" : "Delete"}
              </Button>
              {/* Split Trip placeholder */}
              <Button variant="ghost" size="sm" disabled>
                Split Trip
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || !country || !dateArrived || !dateDeparted}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
