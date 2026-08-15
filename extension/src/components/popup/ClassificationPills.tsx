/**
 * Horizontal pill row of all Classifications. The Worker's extracted
 * classification is the preferred default, but the user can re-pick. Keep
 * the order in lockstep with the union in `lib/types.ts` so this row reads
 * the same as the phone's classification chips.
 *
 * Twelve pills overflow the 388px row by roughly 2x and the scrollbar is
 * hidden, so a selection the user didn't make by hand (the extractor's answer)
 * can land entirely off-screen — the popup then shows zero selected pills and
 * reads as "classification failed". Every value CHANGE therefore scrolls the
 * active pill to the centre.
 */
import { useEffect, useRef } from 'react';
import type { Classification } from '@/lib/types';
import styles from '@/entrypoints/popup/Popup.module.css';

/**
 * Ordered to match the `Classification` union in lib/types.ts. The shared
 * lib doesn't export an array form (the union is the source of truth), so
 * this is the popup's local mirror — change in lockstep with types.ts.
 */
export const CLASSIFICATIONS: readonly Classification[] = [
  'article',
  'video',
  'recipe',
  'product',
  'event',
  'place',
  'idea',
  'fitness',
  'food',
  'career',
  'academia',
  'other',
] as const;

const LABELS: Record<Classification, string> = {
  article: 'Article',
  video: 'Video',
  recipe: 'Recipe',
  product: 'Product',
  event: 'Event',
  place: 'Place',
  idea: 'Idea',
  fitness: 'Fitness',
  food: 'Food',
  career: 'Career',
  academia: 'Academia',
  other: 'Other',
};

export interface ClassificationPillsProps {
  value: Classification;
  onChange: (next: Classification) => void;
}

export function ClassificationPills({ value, onChange }: ClassificationPillsProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  // The popup mounts with the placeholder default ('other', the LAST pill)
  // selected. Centring it on mount would scroll the row to its far end before
  // the extractor has said anything — so only react to real changes.
  const settled = useRef(false);

  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    // block:'nearest' keeps this from also scrolling the popup body vertically.
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [value]);

  return (
    <div className={styles.pillsRow} role="radiogroup" aria-label="Classification">
      {CLASSIFICATIONS.map((c) => {
        const active = c === value;
        return (
          <button
            key={c}
            ref={active ? activeRef : undefined}
            type="button"
            role="radio"
            aria-checked={active}
            className={`${styles.pill} ${active ? styles.pillActive : ''}`}
            onClick={() => onChange(c)}
          >
            {LABELS[c]}
          </button>
        );
      })}
    </div>
  );
}
