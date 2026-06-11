/**
 * Library — the browsable grid of everything saved in this browser.
 *
 * mymind-style masonry (CSS columns — cheap and resize-friendly), live search
 * (same tokenized index the omnibox uses), classification filter chips, and
 * per-card open/delete. All data is the extension-origin IndexedDB; nothing
 * leaves the machine.
 *
 * URL contract:
 *   library.html?q=<query>     — pre-filled search (omnibox fallback)
 *   library.html#item=<id>     — scrolls the item into view + highlights it
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Classification, Item } from '@/lib/types';
import { getItems, deleteItem } from '@/lib/store';
import { searchItems } from '@/lib/search';
import styles from './Library.module.css';

/** Gradient pairs per classification — mirrors the phone's classConfig vibe. */
const CLASS_GRADIENTS: Record<Classification, [string, string]> = {
  article: ['#6366f1', '#8b5cf6'],
  video: ['#ec4899', '#f472b6'],
  recipe: ['#f59e0b', '#f97316'],
  product: ['#06b6d4', '#22d3ee'],
  event: ['#8b5cf6', '#d946ef'],
  place: ['#10b981', '#34d399'],
  idea: ['#f59e0b', '#fbbf24'],
  fitness: ['#ef4444', '#f87171'],
  food: ['#f97316', '#fb923c'],
  career: ['#0ea5e9', '#38bdf8'],
  academia: ['#6366f1', '#818cf8'],
  other: ['#64748b', '#94a3b8'],
};

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function Library() {
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState(
    () => new URLSearchParams(window.location.search).get('q') ?? ''
  );
  const [results, setResults] = useState<Item[] | null>(null);
  const [activeClass, setActiveClass] = useState<Classification | 'all'>('all');
  const highlightId = useRef<string | null>(
    new URLSearchParams(window.location.hash.replace(/^#/, '')).get('item')
  );

  const reload = useCallback(async () => {
    setItems(await getItems());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Debounced search through the shared tokenized index.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const t = window.setTimeout(() => {
      void searchItems(q, 200).then(setResults);
    }, 150);
    return () => window.clearTimeout(t);
  }, [query]);

  // Scroll the deep-linked item into view once, then drop the highlight.
  useEffect(() => {
    if (!highlightId.current || items.length === 0) return;
    const el = document.getElementById(`item-${highlightId.current}`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.classList.add(styles.cardHighlight);
      window.setTimeout(() => el.classList.remove(styles.cardHighlight), 2000);
    }
    highlightId.current = null;
  }, [items]);

  // Which classifications actually exist — drives the chip row.
  const presentClasses = useMemo(() => {
    const s = new Set<Classification>();
    for (const i of items) s.add(i.classification);
    return [...s].sort();
  }, [items]);

  const visible = useMemo(() => {
    const base = results ?? items;
    return activeClass === 'all'
      ? base
      : base.filter((i) => i.classification === activeClass);
  }, [items, results, activeClass]);

  const onDelete = useCallback(
    async (id: string) => {
      await deleteItem(id);
      await reload();
    },
    [reload]
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Your Silo</h1>
          <p className={styles.subtitle}>
            {items.length} saved · all on this device
          </p>
        </div>
        <input
          className={styles.search}
          type="search"
          placeholder="Search your saves…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={!highlightId.current}
        />
      </header>

      <div className={styles.chips}>
        <button
          type="button"
          className={`${styles.chip} ${activeClass === 'all' ? styles.chipActive : ''}`}
          onClick={() => setActiveClass('all')}
        >
          All
        </button>
        {presentClasses.map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.chip} ${activeClass === c ? styles.chipActive : ''}`}
            onClick={() => setActiveClass(c)}
          >
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyOrb}>✦</div>
          <h2>{items.length === 0 ? 'Nothing saved yet' : 'No matches'}</h2>
          <p>
            {items.length === 0
              ? 'Hit ⌘⇧S on any page, or right-click anything, to start filling your Silo.'
              : 'Try a different search or filter.'}
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((item) => {
            const [from, to] = CLASS_GRADIENTS[item.classification] ?? CLASS_GRADIENTS.other;
            return (
              <article key={item.id} id={`item-${item.id}`} className={styles.card}>
                {item.imageUri ? (
                  <img className={styles.cardImg} src={item.imageUri} alt="" loading="lazy" />
                ) : (
                  <div
                    className={styles.cardTile}
                    style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
                  >
                    {item.title.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className={styles.cardBody}>
                  <span className={styles.cardClass}>{item.classification}</span>
                  <h3 className={styles.cardTitle}>{item.title}</h3>
                  {item.quote ? (
                    <blockquote className={styles.cardQuote}>“{item.quote}”</blockquote>
                  ) : item.description ? (
                    <p className={styles.cardDesc}>{item.description}</p>
                  ) : null}
                  {item.tags.length > 0 && (
                    <div className={styles.cardTags}>
                      {item.tags.slice(0, 4).map((t) => (
                        <span key={t} className={styles.tag}>
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={styles.cardFooter}>
                    <span className={styles.cardDate}>{relativeDate(item.created_at)}</span>
                    <span className={styles.cardActions}>
                      {item.url ? (
                        <button
                          type="button"
                          className={styles.actionBtn}
                          title="Open original"
                          onClick={() => window.open(item.url, '_blank')}
                        >
                          ↗
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.actionDanger}`}
                        title="Delete"
                        onClick={() => void onDelete(item.id)}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
