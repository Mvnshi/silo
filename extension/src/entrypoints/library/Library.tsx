/**
 * Library — the browsable grid of everything saved in this browser.
 *
 * mymind-style masonry (CSS columns — cheap and resize-friendly), live search
 * (same tokenized index the omnibox uses), classification filter chips, and
 * per-card open/delete. All data is the extension-origin IndexedDB; nothing
 * leaves the machine.
 *
 * Two behaviours worth knowing before you edit:
 *  - DELETE IS OPTIMISTIC + UNDOABLE. A delete here writes a tombstone that
 *    propagates to the phone, so it is not a local-only action. The card leaves
 *    immediately and the real `deleteItem` only fires when the 6s undo window
 *    closes — until then nothing has been written and Undo is a pure re-read.
 *  - SEARCH RESULTS ARE A SEPARATE LIST. `visible` is `results ?? items`, so
 *    any mutation must touch BOTH or the deleted card lingers in a filtered view.
 *
 * URL contract:
 *   library.html?q=<query>     — pre-filled search (omnibox fallback)
 *   library.html#item=<id>     — scrolls the item into view + highlights it
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Classification, Item } from '@/lib/types';
import type { SyncState } from '@/lib/store';
import { getItems, deleteItem, getSyncState, setSyncState } from '@/lib/store';
import { DEFAULT_SERVER_URL, generateSpaceKey } from '@/lib/sync';
import { searchItems } from '@/lib/search';
import { classConfig } from '@/lib/theme';
import styles from './Library.module.css';

/** Background SW's reply to 'silo:sync-now' (see lib/background/messages.ts). */
interface SyncNowResponse {
  ok: boolean;
  pushed?: number;
  pulled?: number;
  error?: string;
}

/** Grace period before a delete is actually written. Long enough to read the toast. */
const UNDO_MS = 6000;
/** Past this, "Synced • 3d" is a lie of omission — surface it as stale instead. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/**
 * First-paint placeholders. Varied heights so the masonry columns settle at
 * roughly their real proportions and don't jump when the data lands.
 */
const SKELETON_HEIGHTS = [180, 120, 220, 160, 140, 200, 120, 180];

/**
 * What the sync chip is actually telling the user.
 * `unpaired` — no space code / no server, sync has never been set up.
 * `syncing`  — a round-trip is in flight.
 * `ok`       — the last round-trip succeeded, recently.
 * `stale`    — paired and last attempt didn't fail, but the data is old.
 * `error`    — the last round-trip rejected. Actionable, so it says so.
 */
type SyncStatus = 'unpaired' | 'syncing' | 'ok' | 'stale' | 'error';

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
  // Distinct from `items.length === 0`: without it, every user's first paint is
  // the "Nothing saved yet" hero, including users with 400 items.
  const [loaded, setLoaded] = useState(false);
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
  const [syncPhase, setSyncPhase] = useState<'idle' | 'syncing' | 'error'>('idle');

  // Search re-runs when this bumps — used by Undo, which restores from the DB
  // (the row is still there; the delete hasn't been written).
  const [dataVersion, setDataVersion] = useState(0);

  const undoItemRef = useRef<Item | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const [undoItem, setUndoItem] = useState<Item | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await getItems());
    } finally {
      setLoaded(true);
    }
  }, []);

  const refreshSync = useCallback(async () => {
    setSync(await getSyncState());
  }, []);

  useEffect(() => {
    void reload();
    void refreshSync();
  }, [reload, refreshSync]);

  // Sync in the background on open; refresh the grid + chip when it lands.
  // A rejection here used to vanish into an empty catch while the chip happily
  // kept reading "Synced • 3d" off a stale lastSyncAt — so failures now land in
  // syncPhase and the chip says so.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return; // plain dev tab
    let cancelled = false;
    setSyncPhase('syncing');
    chrome.runtime
      .sendMessage({ type: 'silo:sync-now' })
      .then((res: SyncNowResponse | undefined) => {
        if (cancelled) return;
        if (!res?.ok) {
          setSyncPhase('error');
          return;
        }
        setSyncPhase('idle');
        void reload();
        void refreshSync();
      })
      .catch(() => {
        if (!cancelled) setSyncPhase('error');
      });
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
  }, [query, dataVersion]);

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

  /** Write the pending delete for real, closing the undo window. */
  const commitDelete = useCallback(() => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    const item = undoItemRef.current;
    undoItemRef.current = null;
    setUndoItem(null);
    if (!item) return;
    void deleteItem(item.id).catch(() => {
      // The card is already gone from the UI; put it back if the write failed.
      void reload();
    });
  }, [reload]);

  const onDelete = useCallback(
    (item: Item) => {
      // A second delete during someone else's undo window commits the first.
      commitDelete();
      // Optimistic removal from BOTH lists — `visible` is `results ?? items`,
      // so filtering only `items` leaves a ghost card in a filtered view that
      // throws on the next click.
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setResults((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
      undoItemRef.current = item;
      setUndoItem(item);
      undoTimerRef.current = window.setTimeout(commitDelete, UNDO_MS);
    },
    [commitDelete]
  );

  const undoDelete = useCallback(() => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    undoItemRef.current = null;
    setUndoItem(null);
    // Nothing was written, so the row is still in Dexie — re-read rather than
    // splicing it back at a guessed index.
    void reload();
    setDataVersion((v) => v + 1);
  }, [reload]);

  // Never leave a delete half-applied: if the tab closes mid-window, flush it.
  useEffect(() => {
    function flush() {
      const item = undoItemRef.current;
      undoItemRef.current = null;
      if (item) void deleteItem(item.id);
    }
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const syncStatus = useMemo<SyncStatus>(() => {
    const configured = !!sync?.spaceKey && !!(sync.serverUrl ?? DEFAULT_SERVER_URL);
    // Checked first: "no server configured" is a setup gap, not a failure.
    if (!configured) return 'unpaired';
    if (syncPhase === 'syncing') return 'syncing';
    if (syncPhase === 'error') return 'error';
    if (!sync?.lastSyncAt) return 'stale';
    return Date.now() - Date.parse(sync.lastSyncAt) > STALE_AFTER_MS ? 'stale' : 'ok';
  }, [sync, syncPhase]);

  const syncChipClass = [
    styles.syncChip,
    syncStatus === 'ok' ? styles.syncChipPaired : '',
    syncStatus === 'error' ? styles.syncChipError : '',
    syncStatus === 'stale' ? styles.syncChipStale : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Your Silo</h1>
          <p className={styles.subtitle}>
            {loaded
              ? `${items.length} saved · ${sync?.lastSyncAt ? 'synced across devices' : 'all on this device'}`
              : 'Opening your library…'}
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
          className={syncChipClass}
          onClick={() => setSyncOpen(true)}
          title={syncStatus === 'error' ? 'Sync failed — open sync settings' : 'Sync across devices'}
        >
          {syncStatus === 'syncing' ? <span className={styles.spinner} aria-hidden /> : <CloudIcon />}
          {syncStatus === 'unpaired'
            ? 'Set up sync'
            : syncStatus === 'syncing'
              ? 'Syncing…'
              : syncStatus === 'error'
                ? 'Sync failed — tap to fix'
                : syncStatus === 'stale'
                  ? `Sync stale${sync?.lastSyncAt ? ` • ${relativeSync(sync.lastSyncAt)}` : ''}`
                  : `Synced • ${sync?.lastSyncAt ? relativeSync(sync.lastSyncAt) : 'now'}`}
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
            {classConfig(c).label}
          </button>
        ))}
      </div>

      {!loaded ? (
        <div className={styles.grid} aria-busy="true" aria-label="Loading your saves">
          {SKELETON_HEIGHTS.map((h, i) => (
            <div key={i} className={styles.skeletonCard} aria-hidden>
              <div className={styles.skeletonBlock} style={{ height: h }} />
              <div className={styles.skeletonBody}>
                <div className={styles.skeletonLine} style={{ width: '38%' }} />
                <div className={styles.skeletonLine} style={{ width: '85%' }} />
                <div className={styles.skeletonLine} style={{ width: '62%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
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
            const cfg = classConfig(item.classification);
            return (
              <article key={item.id} id={`item-${item.id}`} className={styles.card}>
                {item.imageUri ? (
                  <img className={styles.cardImg} src={item.imageUri} alt="" loading="lazy" />
                ) : (
                  <div
                    className={styles.cardTile}
                    style={{ background: `linear-gradient(135deg, ${cfg.from}, ${cfg.to})` }}
                  >
                    {item.title.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className={styles.cardBody}>
                  {/* The pill text sits on a 10% wash of its own hue. On white
                      that needs `deep` (`from` lands around 2:1); on a dark card
                      `deep` is the one that vanishes, so the stylesheet swaps in
                      a lifted `to` under prefers-color-scheme: dark. */}
                  <span
                    className={styles.cardClass}
                    style={
                      {
                        '--pill-deep': cfg.deep,
                        '--pill-to': cfg.to,
                        background: `${cfg.from}1A`,
                      } as CSSProperties
                    }
                  >
                    {cfg.label}
                  </span>
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
                          aria-label={`Open original for ${item.title}`}
                          onClick={() => window.open(item.url, '_blank')}
                        >
                          ↗
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.actionDanger}`}
                        title="Delete"
                        aria-label={`Delete ${item.title}`}
                        onClick={() => onDelete(item)}
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

      {undoItem ? (
        <div className={styles.toast} role="status">
          <span className={styles.toastMsg}>Deleted “{undoItem.title}”</span>
          <button type="button" className={styles.toastAction} onClick={undoDelete}>
            Undo
          </button>
        </div>
      ) : null}

      {syncOpen && sync ? (
        <SyncModal
          initial={sync}
          onClose={() => setSyncOpen(false)}
          onSynced={() => {
            setSyncPhase('idle');
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
