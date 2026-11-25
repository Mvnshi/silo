import type { Metadata } from "next"
import { LegalPage } from "@/components/legal-page"
import { loadLegalDoc } from "@/lib/legal"

export async function generateMetadata(): Promise<Metadata> {
  const { title, description } = await loadLegalDoc("terms.md")
  return { title, description }
}

export default function TermsPage() {
  return <LegalPage file="terms.md" />
}
