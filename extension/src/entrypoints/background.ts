/**
 * Service worker entry — MV3 background. See spec §4 for the architecture.
 *
 * Bootstraps context menus, the omnibox handler, and keyboard command routing.
 * Storage and Worker calls live in `../lib/`; this file is mostly wiring.
 *
 * NOTE: MV3 service workers are not persistent — global state here is lost
 * between events. Persist everything via `chrome.storage` or Dexie.
 */
import { defineBackground } from 'wxt/utils/define-background';
import { registerContextMenus } from '@/lib/background/menus';
import { registerOmnibox } from '@/lib/background/omnibox';
import { registerCommands } from '@/lib/background/commands';

export default defineBackground(() => {
  // Idempotent: chrome will warn but not break if menus already exist.
  chrome.runtime.onInstalled.addListener(() => {
    registerContextMenus();
  });
  registerOmnibox();
  registerCommands();
});
