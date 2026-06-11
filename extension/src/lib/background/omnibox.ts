/**
 * Omnibox keyword: type `silo` + Space in the URL bar to search saved items
 * without opening the popup. Mirrors mymind's `mm` shortcut (spec §3).
 *
 * Backed by the tokenized in-memory index in `lib/search.ts`. We map the top
 * hits to omnibox suggestions and reserve the bolded default for a "search all
 * results in your Silo" fallback so the user always has an exit.
 */
import type { Item } from '@/lib/types';
import { searchItems } from '@/lib/search';

const MAX_SUGGESTIONS = 8;
/** Sentinel prefix for the bolded default suggestion. */
const FALLBACK_PREFIX = 'silo:search:';

/**
 * XML-encode a string for inclusion in chrome.omnibox suggestion markup. The
 * omnibox uses a tiny XML subset and will throw at runtime on unescaped <, &,
 * etc. that occur inside user titles.
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Short relative-date label: "today", "yesterday", "3d", "2mo", "1y". */
function shortDateLabel(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const now = Date.now();
  const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Build the description XML for one suggestion row. */
function describe(item: Item, query: string): string {
  const title = xmlEscape(item.title);
  const cls = xmlEscape(item.classification);
  const date = shortDateLabel(item.created_at);
  const queryHi = xmlEscape(query);
  const trailing = date ? ` · ${date}` : '';
  // <match> bolds, <dim> de-emphasizes — the supported tags in chrome.omnibox.
  return `<match>${queryHi}</match> <match>${title}</match> <dim>— ${cls}${trailing}</dim>`;
}

/** Where to navigate when the user picks a suggestion. */
function targetUrl(item: Item): string {
  if (item.url) return item.url;
  // Notes/screenshots have no web URL — open the popup focused on this id.
  // The popup will read `location.hash` and route accordingly.
  return chrome.runtime.getURL(`library.html#item=${encodeURIComponent(item.id)}`);
}

export function registerOmnibox(): void {
  chrome.omnibox.setDefaultSuggestion({
    description: 'Search <match>your Silo</match> — type to filter saved items',
  });

  chrome.omnibox.onInputChanged.addListener((query, suggest) => {
    const q = query.trim();
    // Always resolve, even on empty — Chrome expects a synchronous-ish callback.
    void (async () => {
      const hits = await searchItems(q, MAX_SUGGESTIONS);
      const suggestions: chrome.omnibox.SuggestResult[] = hits.map((item) => ({
        content: item.url ?? targetUrl(item),
        description: describe(item, q),
      }));
      suggest(suggestions);

      // Update the bolded default to act as a "see all results" fallback that
      // routes into the popup's search view. setDefaultSuggestion is allowed
      // mid-flight (unlike the suggest callback which is one-shot).
      const safeQ = xmlEscape(q);
      chrome.omnibox.setDefaultSuggestion({
        description: q
          ? `Search <match>"${safeQ}"</match> in your Silo`
          : 'Search <match>your Silo</match> — type to filter saved items',
      });
    })();
  });

  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    const url = resolveEnteredUrl(text);
    openUrl(url, disposition);
  });
}

function resolveEnteredUrl(text: string): string {
  const trimmed = text.trim();
  // Hits from the suggestion list arrive as their `content` field (a real URL).
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('chrome-extension://')) {
    return trimmed;
  }
  if (trimmed.startsWith(FALLBACK_PREFIX)) {
    const q = trimmed.slice(FALLBACK_PREFIX.length);
    return chrome.runtime.getURL(`library.html?q=${encodeURIComponent(q)}`);
  }
  // Anything else: treat as a free-text query and open the popup search view.
  return chrome.runtime.getURL(`library.html?q=${encodeURIComponent(trimmed)}`);
}

function openUrl(url: string, disposition: chrome.omnibox.OnInputEnteredDisposition): void {
  switch (disposition) {
    case 'currentTab':
      void chrome.tabs.update({ url });
      return;
    case 'newForegroundTab':
      void chrome.tabs.create({ url, active: true });
      return;
    case 'newBackgroundTab':
      void chrome.tabs.create({ url, active: false });
      return;
  }
}
