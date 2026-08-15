/**
 * Pure-DOM spotlight overlay mounted into a closed Shadow DOM on the host page.
 * No React in the content-script bundle — every byte matters when the script
 * loads on every URL the user visits.
 *
 * Behaviour (spec §3 "Spotlight-style overlay"):
 *  - Cmd+Shift+K opens at top-center, prefilled with the page title (selected,
 *    so typing replaces it).
 *  - Title input, classification chips, comma-separated tag input, Save pill.
 *  - ESC closes; click-outside closes; focus is trapped while open and restored
 *    on close.
 *
 * THIS IS THE ONE CAPTURE PATH THAT RUNS ON THE PAGE, so it is the only one
 * that can see the page: it records `location.href` (normalized) and the
 * og:image. Without those a spotlight save was a bare note — no "open
 * original", and invisible to duplicate detection.
 *
 * A FAILED SAVE KEEPS THE OVERLAY OPEN. Closing on failure — as this used to,
 * logging to console on the way out — discards whatever the user typed with
 * nothing persisted anywhere.
 *
 * PERSISTENCE GOES THROUGH THE BACKGROUND SERVICE WORKER, NOT lib/store.
 * IndexedDB is origin-scoped: a Dexie write from a content script lands in
 * the HOST PAGE's origin (e.g. example.com), invisible to the popup and
 * scattered across every site the user saves from. chrome.runtime.sendMessage
 * hops to the extension origin where the single shared DB lives.
 */
import type { Classification, Item, ItemType } from '@/lib/types';
import { normalizeUrl } from '@/lib/url';
import { SPOTLIGHT_CSS } from './styles';

/** Classifications shown as inline chips. Subset of the full set so the row
 *  fits without scrolling — matches the phone's "quick pick" set. */
const QUICK_CLASSIFICATIONS: readonly Classification[] = [
  'idea',
  'article',
  'recipe',
  'video',
  'food',
  'place',
] as const;

const CLASS_LABELS: Record<Classification, string> = {
  idea: 'Idea',
  article: 'Article',
  recipe: 'Recipe',
  video: 'Video',
  food: 'Food',
  place: 'Place',
  product: 'Product',
  event: 'Event',
  fitness: 'Fitness',
  career: 'Career',
  academia: 'Academia',
  other: 'Note',
};

const MIN_TITLE_LEN = 3;
/** Matches the longest exit transition in SPOTLIGHT_CSS. */
const CLOSE_ANIM_MS = 260;
/** Dwell on the success checkmark so the save is legible before we vanish. */
const SAVED_HOLD_MS = 600;

// Module-singleton — we only ever mount one overlay per page.
let host: HTMLDivElement | null = null;
let inputEl: HTMLInputElement | null = null;
let closing = false;
/** Tears down document-level listeners and restores focus. Set on mount. */
let detach: (() => void) | null = null;

/**
 * Open the overlay. If it's already mounted, just refocus the input (toggle
 * via key-press becomes a no-op-with-focus, which is the right UX).
 */
export function openSpotlight(): void {
  if (host) {
    inputEl?.focus();
    inputEl?.select();
    return;
  }
  mount();
}

function mount(): void {
  closing = false;
  // Remember where focus was so we can hand it back — the shortcut can fire
  // from anywhere on the page.
  const previouslyFocused = document.activeElement as HTMLElement | null;

  host = document.createElement('div');
  // No inline styles on the host itself — Shadow DOM isolates everything.
  // We still want zero impact on the page if it queries body children.
  host.setAttribute('data-silo-spotlight', '');
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = SPOTLIGHT_CSS;
  shadow.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.setAttribute('role', 'dialog');
  // Without aria-modal a screen reader keeps announcing the page behind a
  // dialog that has, in fact, taken over every click.
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Save to Silo');

  // Top row: sparkles icon + title input + Save button.
  const topRow = document.createElement('div');
  topRow.className = 'row';

  const sparkles = sparklesIcon();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.placeholder = 'What did you find?';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Title');
  // Prefill with the page title: the common case is "save this page", and a
  // blank field makes the user retype what is already on screen.
  input.value = document.title.trim();

  const save = document.createElement('button');
  save.className = 'save';
  save.type = 'button';
  save.textContent = 'Save';
  save.disabled = input.value.trim().length < MIN_TITLE_LEN;

  topRow.appendChild(sparkles);
  topRow.appendChild(input);
  topRow.appendChild(save);

  // Classification chips. Default selection = 'idea'.
  const chipsRow = document.createElement('div');
  chipsRow.className = 'chips';
  let selected: Classification = 'idea';
  const chipEls: HTMLButtonElement[] = [];
  for (const c of QUICK_CLASSIFICATIONS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (c === selected ? ' active' : '');
    chip.textContent = CLASS_LABELS[c];
    chip.dataset['classification'] = c;
    chip.setAttribute('aria-pressed', String(c === selected));
    chip.addEventListener('click', () => {
      selected = c;
      for (const el of chipEls) {
        const on = el.dataset['classification'] === c;
        el.classList.toggle('active', on);
        el.setAttribute('aria-pressed', String(on));
      }
    });
    chipsRow.appendChild(chip);
    chipEls.push(chip);
  }

  // Tags row (comma-separated).
  const tagsWrap = document.createElement('div');
  tagsWrap.className = 'tags';
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.className = 'tagInput';
  tagInput.placeholder = 'Tags, comma separated';
  tagInput.autocomplete = 'off';
  tagInput.spellcheck = false;
  tagInput.setAttribute('aria-label', 'Tags, comma separated');
  tagsWrap.appendChild(tagInput);

  const errorEl = document.createElement('p');
  errorEl.className = 'error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;

  overlay.appendChild(topRow);
  overlay.appendChild(chipsRow);
  overlay.appendChild(tagsWrap);
  overlay.appendChild(errorEl);

  shadow.appendChild(backdrop);
  shadow.appendChild(overlay);
  document.body.appendChild(host);
  inputEl = input;

  // Enter open animation on the next frame so the transition fires.
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    backdrop.classList.add('open');
    input.focus();
    // Selected, not just focused: the prefill is a suggestion, and the first
    // keystroke should be able to replace it wholesale.
    input.select();
  });

  // Wire interactions.
  input.addEventListener('input', () => {
    save.disabled = input.value.trim().length < MIN_TITLE_LEN;
    if (save.textContent === 'Try again') save.textContent = 'Save';
  });

  const onSubmit = async () => {
    if (save.disabled || closing) return;
    save.disabled = true;
    save.textContent = 'Saving…';
    errorEl.hidden = true;

    const title = input.value.trim();
    const tags = parseTags(tagInput.value);
    try {
      // Hop to the background SW — see the header comment for why we must
      // not write IndexedDB from a content script.
      const res = (await chrome.runtime.sendMessage({
        type: 'silo:save-item',
        item: buildItem(title, selected, tags),
      })) as { ok: boolean; error?: string } | undefined;
      if (!res?.ok) throw new Error(res?.error || 'background save failed');
    } catch (err) {
      // STAY OPEN. Nothing was persisted, so closing would silently throw the
      // user's input away.
      errorEl.textContent =
        err instanceof Error ? `Couldn’t save: ${err.message}` : 'Couldn’t save. Try again.';
      errorEl.hidden = false;
      save.disabled = false;
      save.textContent = 'Try again';
      save.focus();
      return;
    }
    save.textContent = 'Saved ✓';
    save.classList.add('saved');
    save.disabled = true;
    window.setTimeout(() => close(overlay, backdrop), SAVED_HOLD_MS);
  };

  save.addEventListener('click', () => void onSubmit());

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void onSubmit();
    }
  });
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void onSubmit();
    }
  });

  // Focus trap. Without it Tab walks straight out of the closed shadow root
  // into the host page, and from there the Escape handler (which used to be
  // bound to `shadow`) could never fire again — leaving the user inside a
  // modal whose full-viewport backdrop eats every click.
  shadow.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== 'Tab') return;
    const list = Array.from(
      overlay.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
    );
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) return;
    const active = shadow.activeElement;
    if (ke.shiftKey) {
      if (active === first || active === null) {
        ke.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      ke.preventDefault();
      first.focus();
    }
  });

  // Escape lives on the DOCUMENT (capture phase), not the shadow root: the
  // shortcut has to work even if focus somehow escapes, and capture beats a
  // host page that stops keydown propagation.
  const onDocumentKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close(overlay, backdrop);
  };
  document.addEventListener('keydown', onDocumentKeydown, true);

  detach = () => {
    document.removeEventListener('keydown', onDocumentKeydown, true);
    if (previouslyFocused?.isConnected) {
      try {
        previouslyFocused.focus({ preventScroll: true });
      } catch {
        // The element may no longer be focusable; the page keeps focus instead.
      }
    }
  };

  // Click-outside (the backdrop sits behind the overlay box).
  backdrop.addEventListener('click', () => close(overlay, backdrop));
}

function close(overlay: HTMLElement, backdrop: HTMLElement): void {
  if (closing) return;
  closing = true;
  detach?.();
  detach = null;
  overlay.classList.remove('open');
  overlay.classList.add('closing');
  backdrop.classList.remove('open');
  // Unmount after the exit transition so the fade isn't cut off.
  window.setTimeout(() => {
    host?.remove();
    host = null;
    inputEl = null;
    closing = false;
  }, CLOSE_ANIM_MS);
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * The page's address, canonicalized the same way every other capture path does
 * it so duplicate detection can match. `undefined` for non-web schemes
 * (file://, about:) — there is nothing to reopen, so the item stays a note.
 */
function pageUrl(): string | undefined {
  const href = location.href;
  if (!/^https?:/i.test(href)) return undefined;
  return normalizeUrl(href);
}

/** og:image (or the twitter: fallback), resolved against the page. */
function pageImage(): string | undefined {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[property="og:image"], meta[name="og:image"], meta[property="twitter:image"], meta[name="twitter:image"]'
  );
  const raw = meta?.content?.trim();
  if (!raw) return undefined;
  try {
    // og:image is allowed to be a relative path; the store needs it absolute.
    return new URL(raw, location.href).toString();
  } catch {
    return undefined;
  }
}

function buildItem(title: string, classification: Classification, tags: string[]): Item {
  const now = new Date().toISOString();
  const url = pageUrl();
  const imageUri = pageImage();
  // A capture with a source page IS a link, whatever else the user typed —
  // that's what gives it "open original" and a dedupe key.
  const type: ItemType = url ? 'link' : 'note';
  return {
    id: makeId(),
    type,
    classification,
    title,
    tags,
    ...(url ? { url } : {}),
    ...(imageUri ? { imageUri } : {}),
    archived: false,
    viewed: false,
    created_at: now,
    updated_at: now,
  };
}

function makeId(): string {
  // crypto.randomUUID is available in MV3 service workers and modern content
  // scripts. Fallback keeps strict-mode TS quiet on older typings.
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `silo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function sparklesIcon(): SVGSVGElement {
  // Inline sparkles glyph — keeps the bundle independent of an icon font.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  // Three-point sparkle cluster.
  path.setAttribute(
    'd',
    'M12 3l1.6 4.2L18 9l-4.4 1.8L12 15l-1.6-4.2L6 9l4.4-1.8L12 3zM19 14l.8 2.1L22 17l-2.2.9L19 20l-.8-2.1L16 17l2.2-.9L19 14zM5 14l.8 2.1L8 17l-2.2.9L5 20l-.8-2.1L2 17l2.2-.9L5 14z'
  );
  svg.appendChild(path);
  return svg;
}
