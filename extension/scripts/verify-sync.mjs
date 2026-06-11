/**
 * S3 sync round-trip harness — the browser half. See SYNC.md.
 *
 * Modes (composable; the full phone↔browser choreography is driven from the
 * session that also controls the iOS simulator):
 *
 *   node scripts/verify-sync.mjs pair <spaceKey> <serverUrl>
 *       → seeds the extension's kv syncState, fires 'silo:sync-now', prints
 *         {pushed, pulled}, reloads the library, prints visible item count.
 *
 *   node scripts/verify-sync.mjs expect "<title substring>"
 *       → syncs, then asserts the library lists a card whose text includes the
 *         given title (proof that a phone-pushed item arrived). Screenshots to
 *         /tmp/silo-sync-library.png. Exits non-zero on failure.
 *
 *   node scripts/verify-sync.mjs push-note "<title>"
 *       → saves a note via the spotlight on example.com (the proven e2e path),
 *         syncs, prints the result. The phone side then pulls and must see it.
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

const [, , mode, arg1, arg2] = process.argv;
if (!['pair', 'expect', 'push-note'].includes(mode)) {
  console.error('usage: verify-sync.mjs pair <spaceKey> <serverUrl> | expect "<title>" | push-note "<title>"');
  process.exit(1);
}

const executablePath = BROWSERS.find((p) => existsSync(p));
if (!executablePath || !existsSync(`${EXT}/manifest.json`)) {
  console.error('missing browser or extension build');
  process.exit(1);
}

// One persistent profile across invocations so the IndexedDB state carries
// between `pair` / `expect` / `push-note` runs of the choreography.
const browser = await puppeteer.launch({
  executablePath,
  headless: false,
  userDataDir: '/tmp/silo-sync-e2e-profile',
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

try {
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().includes('background'),
    { timeout: 15000 }
  );
  const extId = new URL(swTarget.url()).host;

  const lib = await browser.newPage();
  await lib.goto(`chrome-extension://${extId}/library.html`, { waitUntil: 'domcontentloaded' });
  await sleep(800);

  /** Run a sync via the background bridge and return its result. */
  const syncNow = () =>
    lib.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'silo:sync-now' }, (res) => resolve(res ?? null));
        })
    );

  if (mode === 'pair') {
    const spaceKey = arg1;
    const serverUrl = arg2;
    if (!spaceKey || !serverUrl) {
      console.error('pair needs <spaceKey> <serverUrl>');
      process.exit(1);
    }
    // Seed kv.syncState directly (same shape store.ts uses).
    await lib.evaluate(
      ({ spaceKey, serverUrl }) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('silo');
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('kv')) {
              return reject(new Error('kv store missing — was the Dexie v2 migration built?'));
            }
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put({
              key: 'syncState',
              value: { spaceKey, serverUrl, cursor: 0, lastSyncAt: null },
            });
            tx.oncomplete = () => resolve(null);
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        }),
      { spaceKey, serverUrl }
    );
    check('kv syncState seeded', true, `${spaceKey} @ ${serverUrl}`);

    const res = await syncNow();
    check('sync-now responded', Boolean(res?.ok), JSON.stringify(res));
    await lib.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1200);
    const text = await lib.evaluate(() => document.body.innerText);
    const m = text.match(/(\d+) saved/);
    console.log(`library shows: ${m ? m[1] : '?'} saved`);
    await lib.screenshot({ path: '/tmp/silo-sync-library.png' });
  }

  if (mode === 'expect') {
    const res = await syncNow();
    check('sync-now responded', Boolean(res?.ok), JSON.stringify(res));
    await lib.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1500);
    const text = await lib.evaluate(() => document.body.innerText);
    check(`library lists "${arg1}"`, text.includes(arg1));
    const m = text.match(/(\d+) saved/);
    console.log(`library shows: ${m ? m[1] : '?'} saved`);
    await lib.screenshot({ path: '/tmp/silo-sync-library.png' });
  }

  if (mode === 'push-note') {
    const page = await browser.newPage();
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await sleep(900);
    const sw = await swTarget.worker();
    await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { type: 'silo:open-spotlight' });
    });
    await sleep(700);
    await page.keyboard.type(arg1, { delay: 18 });
    await page.keyboard.press('Enter');
    await sleep(900);
    const res = await syncNow();
    check('note saved + synced up', Boolean(res?.ok), JSON.stringify(res));
  }
} finally {
  await browser.close();
}
console.log(failures === 0 ? 'SYNC-HALF: PASS' : 'SYNC-HALF: FAIL');
process.exit(failures === 0 ? 0 : 1);
