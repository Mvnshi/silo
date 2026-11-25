"use client"

import { WaitlistForm } from "@/components/waitlist-form"

export function CTASection() {
  return (
    <section className="mx-auto max-w-[1100px] px-6 py-20">
      <div
        className="rounded-[32px] p-12 text-center shadow-2xl md:p-16"
        style={{
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          backgroundColor: "rgba(255, 255, 255, 0.65)",
        }}
      >
        <h2 className="mb-6 text-4xl font-bold leading-tight text-balance md:text-5xl" style={{ color: "#0F172A" }}>
          Make what you save… actually happen.
        </h2>
        <div className="mx-auto max-w-md">
          <WaitlistForm />
          <a
            href="https://github.com/yourname/silo"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-all hover:scale-[1.03] active:scale-[0.98]"
            style={{
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              backgroundColor: "rgba(255, 255, 255, 0.5)",
              color: "#475569",
            }}
          >
            ⭐ Demo on GitHub
          </a>
        </div>
      </div>
    </section>
  )
}
