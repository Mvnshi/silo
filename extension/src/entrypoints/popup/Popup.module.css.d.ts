/**
 * Ambient declaration so the CSS Modules import in App.tsx (and the popup
 * components in @/components/popup) resolves to a typed class-name map.
 * Vite handles the runtime injection; this file just satisfies tsc.
 *
 * Listing keys explicitly (vs. an open `[k: string]: string`) keeps typos
 * surface-visible in TypeScript — adding a new class to Popup.module.css
 * means adding it here, which is the desired friction.
 */
declare const styles: {
  readonly root: string;
  readonly header: string;
  readonly headerActions: string;
  readonly wordmark: string;
  readonly closeBtn: string;
  readonly scroll: string;
  readonly previewCard: string;
  readonly previewThumb: string;
  readonly previewThumbPlaceholder: string;
  readonly previewBody: string;
  readonly previewHeadline: string;
  readonly favicon: string;
  readonly previewTitle: string;
  readonly previewUrl: string;
  readonly previewDesc: string;
  readonly previewDescMuted: string;
  readonly shimmer: string;
  readonly label: string;
  readonly pillsRow: string;
  readonly pill: string;
  readonly pillActive: string;
  readonly tagBox: string;
  readonly tagChip: string;
  readonly tagChipRemove: string;
  readonly tagInput: string;
  readonly suggestRow: string;
  readonly suggestChip: string;
  readonly note: string;
  readonly footer: string;
  readonly cta: string;
  readonly ctaSaved: string;
  readonly footerError: string;
  readonly dupBadge: string;
  readonly dupBadgeMeta: string;
};
export default styles;
