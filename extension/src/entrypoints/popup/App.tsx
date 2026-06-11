/**
 * Popup App — M0's "save the current page" flow.
 *
 * Lifecycle on open:
 *  1. chrome.tabs.query → grab the active tab's url/title/favIcon.
 *  2. extractLink(url) kicks off immediately (does NOT block render — we
 *     paint the preview card with a shimmer where the description will be).
 *  3. getItemByUrl(url) runs in parallel; if it hits we show a "Already
 *     saved" badge linking to the original.
 *  4. User can pick a Classification (extractor result is the default,
 *     falling back to 'other'), edit tags (extractor suggests up to 3),
 *     and add a note.
 *  5. Save → createItem + store.addItem → 'Saved ✓' for 1.5s → window.close.
 *
 * Never lose a save: if extractLink errors (worker down, no API base), we
 * still let the user save with the raw URL + tab title. This mirrors the
 * phone's contract that capture must always succeed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Classification, Item, ItemType } from '@/lib/types';
import type { ExtractedLink } from '@/lib/api';
import { extractLink } from '@/lib/api';
import { createItem } from '@/lib/items';
import { addItem, getItemByUrl } from '@/lib/store';
import { ClassificationPills } from '@/components/popup/ClassificationPills';
import { TagPicker } from '@/components/popup/TagPicker';
import styles from './Popup.module.css';

interface TabInfo {
  url: string;
  title: string;
  favIconUrl?: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Clamp the Worker's string classification to the on-device union. */
const VALID: ReadonlySet<Classification> = new Set([
  'article', 'video', 'recipe', 'product', 'event', 'place',
  'idea', 'fitness', 'food', 'career', 'academia', 'other',
]);
function asClassification(value: string | undefined): Classification {
  return value && (VALID as Set<string>).has(value)
    ? (value as Classification)
    : 'other';
}

/** Pretty-print a hostname from a URL string. Falls back to the raw URL. */
function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function App() {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [extract, setExtract] = useState<ExtractedLink | null>(null);
  const [extractLoading, setExtractLoading] = useState(true);
  const [extractFailed, setExtractFailed] = useState(false);
  const [classification, setClassification] = useState<Classification>('other');
  const [classificationTouched, setClassificationTouched] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [duplicate, setDuplicate] = useState<Item | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Note-mode fallback title. With only the `activeTab` permission, tab.url is
  // readable ONLY after a real user invocation (toolbar click / shortcut) —
  // on chrome:// pages, the Web Store, or a popup opened without a gesture,
  // it's undefined. "Never lose a save": degrade to a quick note, don't brick.
  const [manualTitle, setManualTitle] = useState('');

  // Avoid stomping a user choice after a slow extractor returns.
  const classificationTouchedRef = useRef(false);
  classificationTouchedRef.current = classificationTouched;

  // 1) Read the active tab. Bail to a sensible empty state if chrome.tabs is
  //    unavailable (popup opened standalone during dev).
  useEffect(() => {
    let cancelled = false;
    async function loadTab() {
      try {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (cancelled || !active?.url) {
          if (!cancelled) setTab({ url: '', title: '' });
          return;
        }
        setTab({
          url: active.url,
          title: active.title ?? active.url,
          favIconUrl: active.favIconUrl,
        });
      } catch {
        if (!cancelled) setTab({ url: '', title: '' });
      }
    }
    void loadTab();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) Kick off the extractor + duplicate check the instant we have the URL.
  useEffect(() => {
    if (!tab) return;
    const url = tab.url;
    if (!url) {
      setExtractLoading(false);
      return;
    }

    let cancelled = false;

    // Duplicate check is fire-and-forget; failure shouldn't block save.
    getItemByUrl(url)
      .then((hit) => {
        if (!cancelled && hit) setDuplicate(hit);
      })
      .catch(() => {
        /* ignore — duplicate badge is best-effort. */
      });

    // Extractor runs in parallel; never let it block saving.
    extractLink({ url })
      .then((result) => {
        if (cancelled) return;
        setExtract(result);
        setExtractLoading(false);
        if (!classificationTouchedRef.current) {
          setClassification(asClassification(result.classification));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setExtractFailed(true);
        setExtractLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tab]);

  // Extractor's suggestions: cap to 3 per the spec.
  const suggestedTags = useMemo<string[]>(() => {
    if (!extract?.tags) return [];
    return extract.tags.slice(0, 3);
  }, [extract]);

  const previewTitle = extract?.title?.trim() || tab?.title?.trim() || tab?.url || 'Untitled';
  const previewUrl = tab?.url ? prettyUrl(tab.url) : '';
  const previewDesc = extract?.description ?? extract?.caption ?? '';
  const thumbnail = extract?.thumbnailUrl;

  // Note-mode (no readable URL) needs a typed title; page-mode needs extract
  // to have settled (success OR failure — both unblock).
  const noteMode = !!tab && !tab.url;
  const canSave =
    !!tab &&
    !extractLoading &&
    saveState !== 'saving' &&
    saveState !== 'saved' &&
    (noteMode ? manualTitle.trim().length > 0 : true);

  const onPickClassification = useCallback((c: Classification) => {
    setClassification(c);
    setClassificationTouched(true);
  }, []);

  const onSave = useCallback(async () => {
    if (!tab) return;
    if (!tab.url && !manualTitle.trim()) return;
    setSaveState('saving');
    setErrorMsg(null);
    try {
      // Note-mode: no readable URL -> persist a plain note built from the
      // typed title (+ optional note body). Page-mode: the link item.
      const type: ItemType = tab.url ? 'link' : 'note';
      const item = createItem({
        type,
        classification,
        title: tab.url ? previewTitle : manualTitle.trim(),
        url: tab.url || undefined,
        description: previewDesc || undefined,
        // Note overrides description if both exist — capture the user's
        // intent first; the extracted description is metadata.
        ...(note.trim()
          ? { description: note.trim() }
          : previewDesc
            ? { description: previewDesc }
            : {}),
        tags,
        imageUri: thumbnail || undefined,
      });
      await addItem(item);
      setSaveState('saved');
      window.setTimeout(() => {
        window.close();
      }, 1500);
    } catch (err) {
      setSaveState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    }
  }, [tab, classification, previewTitle, previewDesc, note, tags, thumbnail, manualTitle]);

  // Submit on Cmd/Ctrl+Enter from anywhere in the popup — small power-user perk.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (canSave) void onSave();
      } else if (e.key === 'Escape') {
        window.close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSave, onSave]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Silo</span>
        <span style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Open your library"
            title="See everything you've saved"
            onClick={() => {
              window.open(chrome.runtime.getURL('library.html'), '_blank');
              window.close();
            }}
          >
            <GridIcon />
          </button>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Close"
            onClick={() => window.close()}
          >
            <CloseIcon />
          </button>
        </span>
      </header>

      <div className={styles.scroll}>
        {/* Note-mode: the page URL isn't readable (protected page or no
            invocation gesture) — offer a quick note instead of a dead end. */}
        {noteMode ? (
          <section>
            <div className={styles.label}>
              Can&apos;t read this page — save a quick note instead
            </div>
            <textarea
              className={styles.note}
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              placeholder="What do you want to remember?"
              rows={2}
              autoFocus
            />
          </section>
        ) : null}

        {/* Preview card — always visible, shimmers description while loading. */}
        <div className={styles.previewCard} style={noteMode ? { display: 'none' } : undefined}>
          {thumbnail ? (
            <img className={styles.previewThumb} src={thumbnail} alt="" />
          ) : (
            <div className={styles.previewThumbPlaceholder} aria-hidden>
              {(previewTitle[0] ?? 'S').toUpperCase()}
            </div>
          )}
          <div className={styles.previewBody}>
            <div className={styles.previewHeadline}>
              {tab?.favIconUrl ? (
                <img className={styles.favicon} src={tab.favIconUrl} alt="" />
              ) : null}
              <span className={styles.previewTitle}>{previewTitle}</span>
            </div>
            <span className={styles.previewUrl}>{previewUrl}</span>
            {extractLoading ? (
              <div className={styles.shimmer} aria-hidden />
            ) : previewDesc ? (
              <p className={styles.previewDesc}>{previewDesc}</p>
            ) : extractFailed ? (
              <p className={styles.previewDesc} style={{ color: 'var(--ink-400)' }}>
                Preview unavailable — you can still save.
              </p>
            ) : null}
          </div>
        </div>

        <section>
          <div className={styles.label}>Classification</div>
          <ClassificationPills value={classification} onChange={onPickClassification} />
        </section>

        <section>
          <div className={styles.label}>Tags</div>
          <TagPicker tags={tags} suggestions={suggestedTags} onChange={setTags} />
        </section>

        <section>
          <div className={styles.label}>Note</div>
          <textarea
            className={styles.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a quick note (optional)"
            rows={2}
          />
        </section>
      </div>

      <footer className={styles.footer}>
        {duplicate && duplicate.url ? (
          <button
            type="button"
            className={styles.dupBadge}
            onClick={() => {
              if (duplicate.url) window.open(duplicate.url, '_blank');
            }}
            title="Open the original save"
          >
            <span>Already saved</span>
            <span className={styles.dupBadgeMeta}>{formatDate(duplicate.created_at)}</span>
          </button>
        ) : null}

        <button
          type="button"
          className={`${styles.cta} ${saveState === 'saved' ? styles.ctaSaved : ''}`}
          disabled={!canSave}
          onClick={() => void onSave()}
        >
          {saveState === 'saved'
            ? 'Saved ✓'
            : saveState === 'saving'
              ? 'Saving…'
              : extractLoading
                ? 'Reading page…'
                : 'Save to Silo'}
        </button>
        {errorMsg ? (
          <p style={{ margin: 0, fontSize: 11, color: '#b91c1c' }}>{errorMsg}</p>
        ) : null}
      </footer>
    </div>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
