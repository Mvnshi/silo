/**
 * promptForText — a promise-based "ask the user for a string" dialog.
 *
 * `Alert.prompt` is iOS-only, so every call site that used it silently did
 * nothing on Android. This is the cross-platform replacement: the UI lives in
 * `components/ui/TextPrompt.tsx` (mounted once at the root) and registers
 * itself here, so callers stay plain async functions with no local modal state.
 *
 *   const name = await promptForText({ title: 'New stack', confirmLabel: 'Create' });
 *   if (!name) return;   // cancelled or empty
 */

export interface TextPromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  /** Cap so a pasted paragraph can't become a stack name. */
  maxLength?: number;
}

type Opener = (options: TextPromptOptions) => Promise<string | null>;

let opener: Opener | null = null;

/** Called by `TextPromptHost` on mount. Not for general use. */
export function registerTextPrompt(fn: Opener | null): void {
  opener = fn;
}

/**
 * Resolves to the trimmed string, or `null` if the user cancelled or left it
 * empty. Resolves to `null` (rather than throwing) if no host is mounted, so a
 * missing provider degrades to "nothing happened" instead of a crash.
 */
export async function promptForText(options: TextPromptOptions): Promise<string | null> {
  if (!opener) {
    console.warn('promptForText called with no <TextPromptHost /> mounted');
    return null;
  }
  const value = await opener(options);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
