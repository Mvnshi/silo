/**
 * WXT config — see ../EXTENSION_SPEC.md §4.1 for the manifest design.
 *
 * Intentionally tight permissions:
 * - activeTab + scripting: we read only the tab the user explicitly invokes a
 *   save on.
 * - contextMenus: image / selection / link right-click entry points.
 * - storage: chrome.storage.local for tiny settings (the bulk of the data
 *   lives in IndexedDB via Dexie).
 * - host_permissions: empty. We will NEVER request <all_urls> at install time.
 */
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Silo',
    description: 'Save anything from the web. Silo files it.',
    version: '0.1.0',
    permissions: ['activeTab', 'scripting', 'contextMenus', 'storage', 'notifications'],
    host_permissions: [],
    action: {
      default_title: 'Save to Silo',
    },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
        description: 'Save the current page to Silo',
      },
      'open-spotlight': {
        suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' },
        description: 'Open Silo spotlight on this page',
      },
    },
    omnibox: { keyword: 'silo' },
  },
});
