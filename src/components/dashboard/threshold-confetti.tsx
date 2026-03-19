"use client"

import { useEffect, useRef } from "react"
import confetti from "canvas-confetti"

export function ThresholdConfetti({ daysAbroad }: { daysAbroad: number }) {
  const firedRef = useRef(false)

  useEffect(() => {
    if (daysAbroad >= 330 && !firedRef.current) {
      firedRef.current = true

      const duration = 3000
      const end = Date.now() + duration

      function frame() {
        confetti({
          particleCount: 3,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.6 },
          colors: ["#1F9D55", "#168046", "#DCFCE7", "#0F766E"],
        })
        confetti({
          particleCount: 3,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.6 },
          colors: ["#1F9D55", "#168046", "#DCFCE7", "#0F766E"],
        })

        if (Date.now() < end) {
          requestAnimationFrame(frame)
        }
      }

      frame()
    }
  }, [daysAbroad])

  return null
}
