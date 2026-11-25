import type { Metadata } from "next"
import { LegalPage } from "@/components/legal-page"
import { loadLegalDoc } from "@/lib/legal"

export async function generateMetadata(): Promise<Metadata> {
  const { title, description } = await loadLegalDoc("privacy.md")
  return { title, description }
}

export default function PrivacyPage() {
  return <LegalPage file="privacy.md" />
}
