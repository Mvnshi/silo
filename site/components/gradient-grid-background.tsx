"use client"

import { useEffect, useRef } from "react"

export function GradientGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const setCanvasSize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    setCanvasSize()
    window.addEventListener("resize", setCanvasSize)

    let animationFrame: number

    // Animation state
    let offset = 0

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const gradient = ctx.createRadialGradient(
        canvas.width * 0.5,
        canvas.height * 0.3,
        0,
        canvas.width * 0.5,
        canvas.height * 0.5,
        canvas.width * 0.8,
      )
      gradient.addColorStop(0, "#fdfcff")
      gradient.addColorStop(0.3, "#faf8ff")
      gradient.addColorStop(0.6, "#f0f9ff")
      gradient.addColorStop(1, "#ecfeff")
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const gridSize = 80
      const offsetX = offset * 0.5
      const offsetY = offset * 0.3

      ctx.strokeStyle = "rgba(99, 102, 241, 0.06)"
      ctx.lineWidth = 1

      // Vertical lines
      for (let x = -gridSize; x < canvas.width + gridSize; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x + (offsetX % gridSize), 0)
        ctx.lineTo(x + (offsetX % gridSize), canvas.height)
        ctx.stroke()
      }

      // Horizontal lines
      for (let y = -gridSize; y < canvas.height + gridSize; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y + (offsetY % gridSize))
        ctx.lineTo(canvas.width, y + (offsetY % gridSize))
        ctx.stroke()
      }

      const spots = [
        { x: 0.15, y: 0.25, radius: 0.35, color: "rgba(99, 102, 241, 0.08)" },
        { x: 0.85, y: 0.5, radius: 0.4, color: "rgba(34, 211, 238, 0.07)" },
        { x: 0.5, y: 0.85, radius: 0.3, color: "rgba(168, 85, 247, 0.06)" },
      ]

      spots.forEach((spot) => {
        const spotGradient = ctx.createRadialGradient(
          canvas.width * spot.x,
          canvas.height * spot.y,
          0,
          canvas.width * spot.x,
          canvas.height * spot.y,
          canvas.width * spot.radius,
        )
        spotGradient.addColorStop(0, spot.color)
        spotGradient.addColorStop(1, "rgba(0, 0, 0, 0)")
        ctx.fillStyle = spotGradient
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      })

      // Subtle animation
      offset += 0.15
      animationFrame = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener("resize", setCanvasSize)
      cancelAnimationFrame(animationFrame)
    }
  }, [])

  return <canvas ref={canvasRef} className="fixed inset-0 -z-10" aria-hidden="true" />
}
