import { Hero } from "@/components/hero"
import { Features } from "@/components/features"
import { ProofStrip } from "@/components/proof-strip"
import { Footer } from "@/components/footer"
import { GradientGridBackground } from "@/components/gradient-grid-background"

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <GradientGridBackground />
      <div className="relative z-10">
        <Hero />
        <ProofStrip />
        <Features />
        <Footer />
      </div>
    </main>
  )
}
