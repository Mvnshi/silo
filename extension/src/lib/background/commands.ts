/**
 * Keyboard command routing. `_execute_action` is handled by Chrome (opens the
 * popup); we listen for the custom `open-spotlight` chord and tell the active
 * tab's content script to mount the overlay.
 *
 * M2 stub — the content script + overlay are written separately.
 */

export function registerCommands(): void {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'open-spotlight') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'silo:open-spotlight' }).catch(() => {
      // Content script may not be injected on a protected page (chrome://, …).
    });
  });
}
