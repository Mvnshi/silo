/**
 * Service worker entry — MV3 background. See spec §4 for the architecture.
 *
 * Bootstraps context menus, the omnibox handler, and keyboard command routing.
 * Storage and Worker calls live in `../lib/`; this file is mostly wiring.
 *
 * NOTE: MV3 service workers are not persistent — global state here is lost
 * between events, and the whole entrypoint re-runs on the next wake. That
 * makes the split below load-bearing:
 *   - EVENT LISTENERS must be attached synchronously at the top level, on every
 *     boot, or the event that woke the worker is dropped.
 *   - One-time SETUP (creating context-menu items, which the browser persists)
 *     belongs on onInstalled/onStartup.
 * Persist everything else via `chrome.storage` or Dexie.
 */
import { defineBackground } from 'wxt/utils/define-background';
import { registerContextMenus, registerContextMenuClicks } from '@/lib/background/menus';
import { registerOmnibox } from '@/lib/background/omnibox';
import { registerCommands } from '@/lib/background/commands';
import { registerMessageBridge } from '@/lib/background/messages';

export default defineBackground(() => {
  // --- Listeners: every boot, synchronously. ---
  registerContextMenuClicks();
  registerOmnibox();
  registerCommands();
  // Content-script saves (spotlight et al.) persist through this bridge so
  // IndexedDB rows land on the extension origin, not the host page's.
  registerMessageBridge();

  // --- One-time setup: menu items survive worker eviction, so re-creating
  // them on every wake would be pure churn. onStartup covers the browser
  // restart case, where onInstalled never fires. ---
  chrome.runtime.onInstalled.addListener(() => {
    registerContextMenus();
  });
  chrome.runtime.onStartup.addListener(() => {
    registerContextMenus();
  });
});
