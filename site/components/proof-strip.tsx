"use client"

import Image from "next/image"
import { withBasePath } from "@/lib/base-path"

export function ProofStrip() {
  const logos = [
    {
      id: "cloudflare",
      content: (
        <div className="flex items-center gap-2 whitespace-nowrap px-6">
          <Image src={withBasePath("/logos/cloudflare.png")} alt="Cloudflare" width={32} height={32} className="h-8 w-auto" />
          <span className="text-sm font-semibold">Cloudflare</span>
        </div>
      ),
    },
    {
      id: "vultr",
      content: <Image src={withBasePath("/logos/vultr-full.png")} alt="Vultr" width={120} height={32} className="w-auto h-16 px-6" />,
    },
    {
      id: "elevenlabs",
      content: (
        <Image src={withBasePath("/logos/elevenlabs.png")} alt="ElevenLabs" width={90} height={24} className="h-6 w-auto px-6" />
      ),
    },
    {
      id: "gemini",
      content: (
        <div className="flex items-center gap-2 whitespace-nowrap px-6">
          <Image src={withBasePath("/logos/gemini.png")} alt="Gemini" width={32} height={32} className="h-8 w-auto" />
          <span className="text-sm font-semibold">Gemini</span>
        </div>
      ),
    },
    {
      id: "godaddy",
      content: (
        <div className="flex items-center gap-2 whitespace-nowrap px-6">
          <Image src={withBasePath("/logos/godaddy.png")} alt="GoDaddy" width={32} height={32} className="h-8 w-auto" />
          <span className="text-sm font-semibold">GoDaddy</span>
        </div>
      ),
    },
  ]

  return (
    <section className="mx-auto max-w-[1100px] px-6 py-12">
      <div
        className="hidden md:flex flex-wrap items-center justify-center rounded-[32px] py-px px-8 gap-4"
        style={{
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          backgroundColor: "rgba(255, 255, 255, 0.65)",
        }}
      >
        <span className="text-xs font-medium" style={{ color: "#475569" }}>
          Built with
        </span>
        <div className="flex flex-wrap items-center justify-center opacity-80">
          {logos.map((logo, index) => (
            <div key={logo.id} className="flex items-center">
              {logo.content}
              {index < logos.length - 1 && <span className="text-sm text-gray-400">·</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="md:hidden">
        <div className="text-center mb-4">
          <span className="text-xs font-medium" style={{ color: "#475569" }}>
            Built with
          </span>
        </div>
        <div className="relative overflow-hidden">
          <div className="flex animate-scroll-infinite items-center opacity-80">
            {logos.map((logo) => logo.content)}
            {logos.map((logo) => (
              <div key={`${logo.id}-dup1`}>{logo.content}</div>
            ))}
            {logos.map((logo) => (
              <div key={`${logo.id}-dup2`}>{logo.content}</div>
            ))}
            {logos.map((logo) => (
              <div key={`${logo.id}-dup3`}>{logo.content}</div>
            ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes scroll-infinite {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-scroll-infinite {
          animation: scroll-infinite 30s linear infinite;
          width: max-content;
        }
        .animate-scroll-infinite:hover {
          animation-play-state: paused;
        }
      `}</style>
    </section>
  )
}
