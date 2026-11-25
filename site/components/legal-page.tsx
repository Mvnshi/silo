import Link from "next/link"
import { Footer } from "@/components/footer"
import { GradientGridBackground } from "@/components/gradient-grid-background"
import { loadLegalDoc, type LegalFile } from "@/lib/legal"

export async function LegalPage({ file }: { file: LegalFile }) {
  const { html } = await loadLegalDoc(file)

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <GradientGridBackground />
      <div className="relative z-10">
        <article className="mx-auto max-w-3xl px-3 py-12 md:px-4 md:py-20">
          <div
            className="rounded-[32px] p-6 shadow-2xl md:p-12"
            style={{
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              backgroundColor: "rgba(255, 255, 255, 0.7)",
              border: "1px solid rgba(255, 255, 255, 0.3)",
            }}
          >
            <Link
              href="/"
              className="inline-block text-sm font-semibold underline-offset-4 hover:underline"
              style={{ color: "#4F46E5" }}
            >
              ← Silo
            </Link>
            <div className="legal-prose" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </article>
        <Footer />
      </div>
    </main>
  )
}
