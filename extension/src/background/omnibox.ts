/**
 * Omnibox keyword: type `silo` + Space in the URL bar to search saved items
 * without opening the popup. Mirrors mymind's `mm` shortcut (spec §3).
 *
 * M3 stub.
 */
import { getItems } from '@/lib/store';

export function registerOmnibox(): void {
  chrome.omnibox.onInputChanged.addListener(async (query, suggest) => {
    const q = query.toLowerCase().trim();
    if (!q) return;
    // M3: replace with a proper indexed search (title + tags + description).
    const items = await getItems();
    const hits = items
      .filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.description || '').toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q))
      )
      .slice(0, 8);
    suggest(
      hits.map((i) => ({
        content: i.id,
        description: i.title,
      }))
    );
  });

  chrome.omnibox.onInputEntered.addListener((itemId) => {
    // M3: open the web view (or the popup focused on this item).
    void itemId;
  });
}
