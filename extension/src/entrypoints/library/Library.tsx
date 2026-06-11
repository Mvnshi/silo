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
import type { SyncState } from '@/lib/store';
import { getItems, deleteItem, getSyncState, setSyncState } from '@/lib/store';
import { DEFAULT_SERVER_URL, generateSpaceKey } from '@/lib/sync';
import { searchItems } from '@/lib/search';
import styles from './Library.module.css';

/** Background SW's reply to 'silo:sync-now' (see lib/background/messages.ts). */
interface SyncNowResponse {
  ok: boolean;
  pushed?: number;
  pulled?: number;
  error?: string;
}

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

/** Compact last-synced age for the chip: "now", "2m", "3h", "5d". */
function relativeSync(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(mins) || mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
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

  const [sync, setSync] = useState<SyncState | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  const reload = useCallback(async () => {
    setItems(await getItems());
  }, []);

  const refreshSync = useCallback(async () => {
    setSync(await getSyncState());
  }, []);

  useEffect(() => {
    void reload();
    void refreshSync();
  }, [reload, refreshSync]);

  // Sync in the background on open; refresh the grid + chip when it lands.
  // Guarded so a plain-browser dev tab (no chrome.runtime) still renders.
  useEffect(() => {
    let cancelled = false;
    try {
      void chrome.runtime
        .sendMessage({ type: 'silo:sync-now' })
        .then((res: SyncNowResponse | undefined) => {
          if (cancelled || !res?.ok) return;
          void reload();
          void refreshSync();
        })
        .catch(() => {
          /* SW unreachable or sync failed — the library is local-first */
        });
    } catch {
      /* chrome.runtime missing outside the extension context */
    }
    return () => {
      cancelled = true;
    };
  }, [reload, refreshSync]);

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
            {items.length} saved · {sync?.lastSyncAt ? 'synced across devices' : 'all on this device'}
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
        <button
          type="button"
          className={`${styles.syncChip} ${sync?.lastSyncAt ? styles.syncChipPaired : ''}`}
          onClick={() => setSyncOpen(true)}
          title="Sync across devices"
        >
          <CloudIcon />
          {sync?.lastSyncAt ? `Synced • ${relativeSync(sync.lastSyncAt)}` : 'Set up sync'}
        </button>
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

      {syncOpen && sync ? (
        <SyncModal
          initial={sync}
          onClose={() => setSyncOpen(false)}
          onSynced={() => {
            void reload();
            void refreshSync();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Pairing modal — enter (or mint) a space code, point at a server, sync.
 * Persists to the kv 'syncState' row, then asks the background SW to run the
 * actual round-trip so page and SW never race two sync loops.
 */
function SyncModal({
  initial,
  onClose,
  onSynced,
}: {
  initial: SyncState;
  onClose: () => void;
  onSynced: () => void;
}) {
  const [code, setCode] = useState(initial.spaceKey ?? '');
  const [server, setServer] = useState(initial.serverUrl ?? DEFAULT_SERVER_URL);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle');
  const [result, setResult] = useState<{ up: number; down: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Esc closes from anywhere — standard modal manners.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Let "Up N / Down M" flash briefly, then re-arm the button.
  useEffect(() => {
    if (phase !== 'done') return;
    const t = window.setTimeout(() => setPhase('idle'), 2500);
    return () => window.clearTimeout(t);
  }, [phase]);

  const onSubmit = useCallback(async () => {
    setPhase('busy');
    setError(null);
    try {
      const nextKey = code.trim() || null;
      await setSyncState({
        spaceKey: nextKey,
        serverUrl: server.trim() || null,
        // Pairing into a DIFFERENT space invalidates the old cursor; resetting
        // to 0 triggers the full first upload (idempotent server merge).
        ...(nextKey !== initial.spaceKey ? { cursor: 0 } : {}),
      });
      const res = (await chrome.runtime.sendMessage({
        type: 'silo:sync-now',
      })) as SyncNowResponse | undefined;
      if (!res?.ok) throw new Error(res?.error || 'Sync failed — is the server running?');
      setResult({ up: res.pushed ?? 0, down: res.pulled ?? 0 });
      setPhase('done');
      onSynced(); // grid + chip refresh while the result flashes
    } catch (err) {
      setPhase('idle');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [code, server, initial.spaceKey, onSynced]);

  return (
    // Backdrop click closes; clicks inside the card don't bubble to it.
    <div
      className={styles.modalOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modalCard} role="dialog" aria-modal="true" aria-label="Sync across devices">
        <h2 className={styles.modalTitle}>Sync across devices</h2>
        <p className={styles.modalText}>
          Use the same space code on your phone and this browser — saves flow both ways. The code
          is the secret; share it only with your own devices.
        </p>

        <label className={styles.modalLabel} htmlFor="silo-space-code">
          Space code
        </label>
        <div className={styles.modalInputRow}>
          <input
            id="silo-space-code"
            className={`${styles.modalInput} ${styles.modalMono}`}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="silo-…"
            spellCheck={false}
            autoComplete="off"
          />
          {code.trim() === '' ? (
            <button type="button" className={styles.generateBtn} onClick={() => setCode(generateSpaceKey())}>
              Generate
            </button>
          ) : null}
        </div>

        <label className={styles.modalLabel} htmlFor="silo-server-url">
          Server URL
        </label>
        <input
          id="silo-server-url"
          className={styles.modalInput}
          type="url"
          value={server}
          onChange={(e) => setServer(e.target.value)}
          placeholder={DEFAULT_SERVER_URL || 'http://192.168.x.x:8787'}
          spellCheck={false}
          autoComplete="off"
        />

        <button
          type="button"
          className={styles.modalCta}
          disabled={phase === 'busy'}
          onClick={() => void onSubmit()}
        >
          {phase === 'busy' ? (
            <>
              <span className={styles.spinner} aria-hidden />
              Syncing…
            </>
          ) : phase === 'done' && result ? (
            `Up ${result.up} / Down ${result.down} ✓`
          ) : (
            'Save & Sync now'
          )}
        </button>
        {error ? <p className={styles.modalError}>{error}</p> : null}
      </div>
    </div>
  );
}

function CloudIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}
