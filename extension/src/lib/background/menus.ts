/**
 * Right-click context menus — image / selection / link. See
 * EXTENSION_SPEC.md §3 rows "Right-click image save", "Right-click highlight",
 * "Save link without leaving the page".
 *
 * Behaviour:
 * - Idempotent registration: removeAll first, then re-create. Necessary
 *   because MV3 service workers respawn and onInstalled doesn't fire on
 *   every wake, so we may end up here with menus already present.
 * - All work funnels through `saveActions.ts` so M2's spotlight can reuse
 *   the exact same code path (single behaviour, one place to fix bugs).
 * - Best-effort toast via chrome.notifications. If the `notifications`
 *   permission isn't granted yet (we ship without it), the API returns
 *   undefined and we swallow it — the save itself still succeeded.
 */
import { saveImage, saveLink, saveSelection } from './saveActions';

const MENU_IMAGE = 'silo-save-image';
const MENU_SELECTION = 'silo-save-selection';
const MENU_LINK = 'silo-save-link';

export function registerContextMenus(): void {
  // SW respawn: a stale menu from the previous worker invocation would
  // collide on create. Tear them all down first.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      { id: MENU_IMAGE, title: 'Save image to Silo', contexts: ['image'] },
      swallowLastError
    );
    chrome.contextMenus.create(
      { id: MENU_SELECTION, title: 'Save highlight to Silo', contexts: ['selection'] },
      swallowLastError
    );
    chrome.contextMenus.create(
      { id: MENU_LINK, title: 'Save link to Silo', contexts: ['link'] },
      swallowLastError
    );
  });

  // onClicked is module-global and survives SW respawn registration —
  // attaching here on every cold boot is correct.
  chrome.contextMenus.onClicked.addListener((info) => {
    void handleClick(info);
  });
}

async function handleClick(info: chrome.contextMenus.OnClickData): Promise<void> {
  try {
    switch (info.menuItemId) {
      case MENU_IMAGE: {
        if (!info.srcUrl) throw new Error('No image source');
        const item = await saveImage(info.srcUrl, info.pageUrl);
        notify(item.title);
        break;
      }
      case MENU_SELECTION: {
        if (!info.selectionText) throw new Error('No selection');
        const item = await saveSelection(info.selectionText, info.pageUrl);
        notify(item.title);
        break;
      }
      case MENU_LINK: {
        if (!info.linkUrl) throw new Error('No link');
        const item = await saveLink(info.linkUrl);
        notify(item.title);
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Save failed';
    notify(msg, 'Couldn’t save to Silo');
  }
}

/**
 * Best-effort toast. `chrome.notifications` requires the `notifications`
 * permission, which we deliberately don't ship with yet (spec §4.1 keeps
 * the permission set minimal). The defensive guard means callers don't
 * crash when the API is unavailable — the save itself already succeeded.
 */
function notify(message: string, title = 'Saved to Silo'): void {
  if (typeof chrome === 'undefined' || !chrome.notifications?.create) return;
  try {
    chrome.notifications.create({
      type: 'basic',
      // runtime.getURL resolves an extension-relative path. If the icon
      // asset doesn't exist yet, chrome.notifications will set
      // lastError but won't throw — swallowed below.
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title,
      message,
    }, () => {
      // Swallow lastError — toast is best-effort.
      void chrome.runtime.lastError;
    });
  } catch {
    // Same: any throw here doesn't affect the actual save.
  }
}

function swallowLastError(): void {
  // contextMenus.create surfaces "duplicate id" through lastError on SW
  // respawn races. Read it to acknowledge, then drop.
  void chrome.runtime.lastError;
}
