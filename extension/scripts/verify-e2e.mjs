/**
 * Headed-browser e2e smoke test for the Silo extension.
 *
 * Launches Brave/Chrome with the built extension, then proves the three
 * load-bearing flows with REAL browser state (no mocks):
 *   1. Spotlight: open via SW message on example.com, type a note, Enter.
 *   2. Persistence bridge: the note must appear in the EXTENSION-origin
 *      IndexedDB (regression test for the content-script origin bug).
 *   3. Popup: renders, extract settles (graceful-fallback path), Save works.
 *
 * Usage:  node scripts/verify-e2e.mjs
 * Requires: `npx wxt build` output at .output/chrome-mv3, and (optionally)
 * the local Worker on :8789 for the extract round-trip.
 * Exits non-zero on any assertion failure. Screenshots land in /tmp/silo-e2e-*.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.output/chrome-mv3');
const BROWSERS = [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

if (!existsSync(`${EXT}/manifest.json`)) {
  console.error(`No build at ${EXT}. Run: npx wxt build`);
  process.exit(1);
}
const executablePath = BROWSERS.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Brave/Chrome found.');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: false,
  userDataDir: `/tmp/silo-e2e-profile-${process.pid}`,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

try {
  // ---- Extension registers: find the MV3 service worker --------------------
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().includes('background'),
    { timeout: 15000 }
  );
  const extId = new URL(swTarget.url()).host;
  check('service worker registered', Boolean(extId), extId);
  const sw = await swTarget.worker();

  // ---- Spotlight on a real page --------------------------------------------
  const page = await browser.newPage();
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  await sleep(800); // content scripts run at document_idle

  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'silo:open-spotlight' });
  });
  await sleep(700);
  const hasOverlay = await page.evaluate(
    () => Boolean(document.querySelector('[data-silo-spotlight]'))
  );
  check('spotlight overlay mounted on example.com', hasOverlay);
  await page.screenshot({ path: '/tmp/silo-e2e-spotlight.png' });

  // Input is autofocused inside the closed shadow root — type blind.
  const NOTE_TITLE = 'E2E spotlight note';
  await page.keyboard.type(NOTE_TITLE, { delay: 20 });
  await page.keyboard.press('Enter');
  await sleep(900); // SW round-trip + close animation

  // ---- Persistence bridge: note must be in the EXTENSION origin ------------
  const popupPage = await browser.newPage();
  await popupPage.goto(`chrome-extension://${extId}/popup.html`, {
    waitUntil: 'domcontentloaded',
  });
  await sleep(2500); // give extractLink a chance to settle (or fail gracefully)

  const readItems = () =>
    popupPage.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('silo');
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('items')) return resolve([]);
            const all = db.transaction('items', 'readonly').objectStore('items').getAll();
            all.onsuccess = () => resolve(all.result);
            all.onerror = () => reject(all.error);
          };
          req.onerror = () => reject(req.error);
        })
    );

  let items = await readItems();
  const spotlightNote = items.find((i) => i.title === NOTE_TITLE);
  check(
    'spotlight note persisted to EXTENSION origin (bridge fix)',
    Boolean(spotlightNote),
    spotlightNote ? `id=${spotlightNote.id} type=${spotlightNote.type}` : `items=${items.length}`
  );

  // ---- Popup renders + Save works -------------------------------------------
  const headerText = await popupPage.evaluate(() => document.body.innerText.slice(0, 200));
  check('popup rendered', headerText.includes('Silo'), headerText.split('\n')[0]);
  await popupPage.screenshot({ path: '/tmp/silo-e2e-popup.png' });

  // Without a user invocation gesture, activeTab grants nothing — the popup
  // can't read the tab URL and must fall back to NOTE-MODE (the same path a
  // user hits on chrome:// pages). That's the path we exercise here; the
  // URL-ful path differs only by Chrome's permission grant on a real click.
  // Case-insensitive: the section-label class uppercases via CSS, and
  // innerText reflects rendered (transformed) text.
  const noteModeVisible = await popupPage.evaluate(() =>
    document.body.innerText.toLowerCase().includes('save a quick note')
  );
  check('popup degrades to note-mode without activeTab grant', noteModeVisible);

  const POPUP_NOTE = 'E2E popup note-mode save';
  await popupPage.evaluate((text) => {
    const ta = [...document.querySelectorAll('textarea')].find((t) =>
      t.placeholder.includes('remember')
    );
    if (!ta) throw new Error('note-mode textarea not found');
    // React-controlled input: use the native setter so onChange fires.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    ).set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, POPUP_NOTE);
  await sleep(300);

  const saveEnabled = await popupPage.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Save to Silo')
    );
    return btn ? !btn.disabled : null;
  });
  check('popup Save enabled after typing a note title', saveEnabled === true);

  if (saveEnabled) {
    await popupPage.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Save to Silo')
      );
      btn?.click();
    });
    await sleep(800);
    items = await readItems();
    const popupNote = items.find((i) => i.title === POPUP_NOTE);
    check('popup note-mode save persisted', Boolean(popupNote), `items=${items.length}`);
    await popupPage.screenshot({ path: '/tmp/silo-e2e-popup-saved.png' });
  }

  console.log('\nItems in extension IndexedDB:');
  for (const i of items) console.log(`  • [${i.type}/${i.classification}] ${i.title}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n🎉 ALL CHECKS PASSED' : `\n💥 ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
