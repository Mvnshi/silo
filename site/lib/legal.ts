import { readFile } from "node:fs/promises"
import path from "node:path"
import { marked } from "marked"

export type LegalFile = "privacy.md" | "terms.md"

export interface LegalDoc {
  title: string
  description: string
  html: string
}

/**
 * Loads one of the legal documents from docs/legal at build time and renders it.
 * The markdown stays the single source of truth: edit it there, not here.
 */
export async function loadLegalDoc(file: LegalFile): Promise<LegalDoc> {
  // `next build` runs with site/ as the working directory.
  const raw = await readFile(path.join(process.cwd(), "..", "docs", "legal", file), "utf8")

  // The docs open with a `---\ntitle: …\n---` block.
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const title = fm?.[1].match(/^title:\s*(.*)$/m)?.[1].trim() || `Silo — ${file.replace(".md", "")}`
  const body = fm ? raw.slice(fm[0].length) : raw

  let html = await marked.parse(body, { gfm: true })

  // Wide tables scroll inside their own box instead of widening the page.
  html = html
    .replace(/<table>/g, '<div class="legal-table-scroll"><table>')
    .replace(/<\/table>/g, "</table></div>")

  // The docs are written to be read on GitHub, where relative links to sibling
  // files work. On the site they would 404, so refuse to publish one.
  const broken = [...html.matchAll(/href="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((href) => !/^(https?:|mailto:|#)/.test(href))
  if (broken.length > 0) {
    throw new Error(`docs/legal/${file} has links that will not resolve on the site: ${broken.join(", ")}`)
  }

  const lead = html.match(/<p>([\s\S]*?)<\/p>/)
  const description = lead ? lead[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").slice(0, 200) : title

  return { title, description, html }
}
