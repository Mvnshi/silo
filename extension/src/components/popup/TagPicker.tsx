/**
 * Chip-style tag input. Enter or Tab commits the current token; Backspace on
 * an empty input pops the last chip. Suggestions come from the extractor's
 * `tags` field (capped to 3 by the caller) and clicking one adds it.
 *
 * Pure controlled component — owns no state of its own besides the in-flight
 * input string. Dedupes case-insensitively but preserves the user's casing
 * for the first occurrence.
 */
import { useState, type KeyboardEvent } from 'react';
import styles from '@/entrypoints/popup/Popup.module.css';

export interface TagPickerProps {
  tags: string[];
  suggestions: string[];
  onChange: (next: string[]) => void;
}

export function TagPicker({ tags, suggestions, onChange }: TagPickerProps) {
  const [draft, setDraft] = useState('');

  const lower = new Set(tags.map((t) => t.toLowerCase()));

  function commit(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (lower.has(t.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...tags, t]);
    setDraft('');
  }

  function remove(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
      // Only intercept Tab when there's something to commit — otherwise let
      // it move focus to the next field.
      if (!draft.trim() && e.key === 'Tab') return;
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && tags.length > 0) {
      const last = tags[tags.length - 1];
      if (last !== undefined) remove(last);
    }
  }

  // Suggestions hide once added; case-insensitive against current tags.
  const visibleSuggestions = suggestions.filter(
    (s) => !lower.has(s.toLowerCase())
  );

  return (
    <div>
      <div className={styles.tagBox}>
        {tags.map((t) => (
          <span key={t} className={styles.tagChip}>
            {t}
            <button
              type="button"
              className={styles.tagChipRemove}
              aria-label={`Remove tag ${t}`}
              onClick={() => remove(t)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className={styles.tagInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          placeholder={tags.length === 0 ? 'Add tags…' : ''}
          aria-label="Add tag"
        />
      </div>
      {visibleSuggestions.length > 0 && (
        <div className={styles.suggestRow}>
          {visibleSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.suggestChip}
              onClick={() => commit(s)}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
