/**
 * Pure-DOM spotlight overlay mounted into a closed Shadow DOM on the host page.
 * No React in the content-script bundle — every byte matters when the script
 * loads on every URL the user visits.
 *
 * Behaviour (spec §3 "Spotlight-style overlay"):
 *  - Cmd+Shift+K opens at top-center.
 *  - Title input, classification chips, comma-separated tag input, Save pill.
 *  - ESC closes; click-outside closes.
 *
 * PERSISTENCE GOES THROUGH THE BACKGROUND SERVICE WORKER, NOT lib/store.
 * IndexedDB is origin-scoped: a Dexie write from a content script lands in
 * the HOST PAGE's origin (e.g. example.com), invisible to the popup and
 * scattered across every site the user saves from. chrome.runtime.sendMessage
 * hops to the extension origin where the single shared DB lives.
 */
import type { Classification, Item, ItemType } from '@/lib/types';
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
const CLOSE_ANIM_MS = 220;

// Module-singleton — we only ever mount one overlay per page.
let host: HTMLDivElement | null = null;
let inputEl: HTMLInputElement | null = null;
let closing = false;

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

  const save = document.createElement('button');
  save.className = 'save';
  save.type = 'button';
  save.textContent = 'Save';
  save.disabled = true;

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
    chip.addEventListener('click', () => {
      selected = c;
      for (const el of chipEls) {
        el.classList.toggle('active', el.dataset['classification'] === c);
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
  tagsWrap.appendChild(tagInput);

  overlay.appendChild(topRow);
  overlay.appendChild(chipsRow);
  overlay.appendChild(tagsWrap);

  shadow.appendChild(backdrop);
  shadow.appendChild(overlay);
  document.body.appendChild(host);
  inputEl = input;

  // Enter open animation on the next frame so the transition fires.
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    input.focus();
  });

  // Wire interactions.
  input.addEventListener('input', () => {
    save.disabled = input.value.trim().length < MIN_TITLE_LEN;
  });

  const onSubmit = async () => {
    if (save.disabled || closing) return;
    save.disabled = true;
    const title = input.value.trim();
    const tags = parseTags(tagInput.value);
    try {
      // Hop to the background SW — see the header comment for why we must
      // not write IndexedDB from a content script.
      const res = (await chrome.runtime.sendMessage({
        type: 'silo:save-item',
        item: buildNoteItem(title, selected, tags),
      })) as { ok: boolean; error?: string } | undefined;
      if (!res?.ok) throw new Error(res?.error || 'background save failed');
    } catch (err) {
      // Surface failure to console — the overlay still closes so the user
      // isn't stuck. The popup will show the (lack of) save when reopened.
      console.error('[silo spotlight] save failed', err);
    }
    close(overlay);
  };

  save.addEventListener('click', onSubmit);

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

  // ESC closes from anywhere inside the shadow.
  shadow.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Escape') {
      e.preventDefault();
      close(overlay);
    }
  });

  // Click-outside (the backdrop sits behind the overlay box).
  backdrop.addEventListener('click', () => close(overlay));
}

function close(overlay: HTMLElement): void {
  if (closing) return;
  closing = true;
  overlay.classList.remove('open');
  overlay.classList.add('closing');
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

function buildNoteItem(title: string, classification: Classification, tags: string[]): Item {
  const now = new Date().toISOString();
  const type: ItemType = 'note';
  return {
    id: makeId(),
    type,
    classification,
    title,
    tags,
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
