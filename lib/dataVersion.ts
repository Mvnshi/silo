/**
 * dataVersion — "something changed, reload".
 *
 * Every screen reloads its data in a `useFocusEffect`, which is exactly right
 * for the app as it was: the only way to change an item was to be on a screen,
 * or to be on a different one and come back.
 *
 * The assistant breaks that assumption. It is an OVERLAY, not a route, so
 * archiving six items from the Stacks tab never blurs the Stacks tab — the
 * focus effect does not re-run, and the six rows sit there looking untouched
 * until you switch tabs and come back. An action layer whose effects are
 * invisible until you navigate is not an action layer anyone will trust.
 *
 * This is the smallest thing that fixes it: a counter, and a hook that
 * re-renders on it. Screens add `dataVersion` to the dependency list their focus
 * effect already has, and keep every other line unchanged.
 *
 *     const dataVersion = useDataVersion();
 *     useFocusEffect(useCallback(() => { loadData(); }, [loadData, dataVersion]));
 *
 * Deliberately NOT a general event bus: there is one signal, it carries no
 * payload, and it means "re-read from storage". Anything finer would need every
 * caller to describe what it changed, which is how a store like this turns into
 * a second source of truth alongside `lib/storage`.
 */
import { useSyncExternalStore } from 'react';

let version = 0;
const listeners = new Set<() => void>();

/**
 * Announce that stored items changed outside the focused screen's knowledge.
 *
 * Call this AFTER the write settles — subscribers re-read storage immediately,
 * so bumping first would have them read the old rows.
 */
export function bumpDataVersion(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return version;
}

/**
 * The current version. Put it in a focus effect's dependency array to reload
 * when something off-screen changes the library.
 */
export function useDataVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
