/**
 * Right-click context menus — image / selection / link. See spec §3 row
 * "Right-click image save" et al.
 *
 * M1 stub. When implementing, route each action through `lib/store.ts` and
 * (for image/article) `lib/api.ts`.
 */

export function registerContextMenus(): void {
  chrome.contextMenus.create(
    { id: 'silo-save-image', title: 'Save image to Silo', contexts: ['image'] },
    handleCreateError
  );
  chrome.contextMenus.create(
    { id: 'silo-save-selection', title: 'Save highlight to Silo', contexts: ['selection'] },
    handleCreateError
  );
  chrome.contextMenus.create(
    { id: 'silo-save-link', title: 'Save link to Silo', contexts: ['link'] },
    handleCreateError
  );

  chrome.contextMenus.onClicked.addListener((info, _tab) => {
    switch (info.menuItemId) {
      case 'silo-save-image':
        // TODO: M1 — fetch info.srcUrl as base64, call analyzeImage, addItem.
        break;
      case 'silo-save-selection':
        // TODO: M1 — createItem({ type: 'quote', quote: info.selectionText,
        //   url: info.pageUrl }).
        break;
      case 'silo-save-link':
        // TODO: M1 — extractLink(info.linkUrl), addItem.
        break;
    }
  });
}

function handleCreateError() {
  if (chrome.runtime.lastError) {
    // Most likely cause: menu already exists on a service-worker re-spawn.
    // Safe to swallow.
  }
}
