"use client"

import { useState, type FormEvent } from "react"
import { ArrowRightIcon } from "@radix-ui/react-icons"
import { Input } from "@/components/dris/input"
import { Button } from "@/components/dris/button"

export function WaitlistForm() {
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    // Simulate API call
    setTimeout(() => {
      setIsLoading(false)
      setShowSuccess(true)
      setEmail("")
      setTimeout(() => setShowSuccess(false), 5000)
    }, 800)
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:max-w-xl">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email.."
          required
          variant="frosted"
          rounded="lg"
          size="lg"
          className="w-full sm:flex-1 sm:min-w-[300px]"
        />
        <Button
          type="submit"
          disabled={isLoading}
          variant="aqua"
          rounded="lg"
          size="lg"
          className="font-semibold whitespace-nowrap"
        >
          {isLoading ? "..." : "Join"}
          <ArrowRightIcon />
        </Button>
      </form>
      {showSuccess && (
        <div
          className="mt-4 animate-in fade-in slide-in-from-top-2 rounded-2xl p-4 text-sm font-semibold shadow-lg duration-300"
          style={{
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            background: "linear-gradient(135deg, rgba(34, 211, 238, 0.15), rgba(99, 102, 241, 0.1))",
            border: "1px solid rgba(34, 211, 238, 0.3)",
            color: "#0F172A",
          }}
          role="alert"
          aria-live="polite"
        >
          Thanks — we'll email you soon.
        </div>
      )}
    </>
  )
}
