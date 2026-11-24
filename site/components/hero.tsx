"use client"
import { WaitlistForm } from "@/components/waitlist-form"
import { GitHubLogoIcon, PlayIcon } from "@radix-ui/react-icons"
import { Button } from "@/components/dris/button"

export function Hero() {
  return (
    <section className="mx-auto max-w-3xl px-3 py-16 md:px-4 md:py-24 lg:py-32">
      <div
        className="rounded-[32px] p-6 shadow-2xl md:p-12"
        style={{
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          backgroundColor: "rgba(255, 255, 255, 0.7)",
          border: "1px solid rgba(255, 255, 255, 0.3)",
        }}
      >
        <div
          className="mb-6 inline-block rounded-full px-4 py-2 text-xs font-semibold shadow-sm"
          style={{
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            background: "linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(34, 211, 238, 0.1))",
            border: "1px solid rgba(99, 102, 241, 0.2)",
            color: "#4F46E5",
          }}
        >
          Made at UBHacks '25
        </div>
        <h1
          className="mb-4 text-4xl font-bold leading-tight text-balance md:text-5xl lg:text-6xl"
          style={{
            color: "#0F172A",
            textShadow: "0 2px 8px rgba(0, 0, 0, 0.02)",
          }}
        >
          Save it → Schedule it.
        </h1>
        <p className="mb-8 text-base leading-relaxed text-pretty md:text-lg" style={{ color: "#64748B" }}>
          Make what you save… actually happen.
        </p>
        <WaitlistForm />
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:gap-3">
          <a
            href="https://github.com/Mvnshi/silo"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1"
          >
            <Button variant="silver" rounded="lg" size="lg" className="w-full font-semibold">
              <GitHubLogoIcon className="h-5 w-5" />
              Check out the MVP
            </Button>
          </a>
          <a
            href="https://devpost.com/software/silo-7bcdix"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1"
          >
            <Button variant="lilac" rounded="lg" size="lg" className="w-full font-semibold">
              <PlayIcon className="h-5 w-5" />
              Watch the demo
            </Button>
          </a>
        </div>
      </div>
    </section>
  )
}
