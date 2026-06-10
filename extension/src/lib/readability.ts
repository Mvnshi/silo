/**
 * Mozilla Readability wrapper. Runs entirely client-side in the content script
 * (spec §4.4, §7.5) — no Worker round-trip, no API key needed. We clone the
 * document so Readability's destructive mutations don't trash the live page.
 *
 * The shape returned mirrors what the popup's reader-mode pane will render in
 * later milestones. We keep nullables as empty strings/zero so consumers can
 * `if (article.title)` without optional chaining everywhere.
 */
import { Readability } from '@mozilla/readability';

export interface Article {
  /** Article title (Readability's best guess). */
  title: string;
  /** Author byline if extracted. */
  byline: string;
  /** Sanitized HTML body — safe to insert into a Shadow DOM. */
  content: string;
  /** Plain text body (no markup). */
  textContent: string;
  /** Character length of the textContent. */
  length: number;
  /** Short description / excerpt. */
  excerpt: string;
  /** Source site name if metadata exposed it. */
  siteName: string;
}

const EMPTY: Article = {
  title: '',
  byline: '',
  content: '',
  textContent: '',
  length: 0,
  excerpt: '',
  siteName: '',
};

/**
 * Extract the readable article from the current document.
 *
 * Returns an empty Article (length === 0) if Readability decides the page
 * isn't article-shaped — callers should branch on `length > 0` rather than
 * relying on a null sentinel.
 */
export function extractArticle(doc: Document = document): Article {
  // Readability mutates the DOM it's given. Cloning protects the live page.
  const clone = doc.cloneNode(true) as Document;
  const parsed = new Readability(clone).parse();
  if (!parsed) return EMPTY;
  return {
    title: parsed.title ?? '',
    byline: parsed.byline ?? '',
    content: parsed.content ?? '',
    textContent: parsed.textContent ?? '',
    length: parsed.length ?? 0,
    excerpt: parsed.excerpt ?? '',
    siteName: parsed.siteName ?? '',
  };
}
