/**
 * Token-bridge verification — `src/assets/tailwind.css`.
 *
 * The bridge makes two claims that are invisible to `tsc` and to `wxt build`,
 * and that would fail silently (a button that merely looks slightly wrong):
 *
 *  1. shadcn's semantic variables resolve to Silo's palette — `bg-primary` must
 *     end up at `lib/theme.ts`'s brand gradient/colour, not a registry default.
 *  2. `rounded-*` resolves to Silo's radius scale. Nothing declares this: it
 *     works because `injectTokens()` appends Silo's `:root` block to <head>
 *     AFTER the bundled stylesheet, so it wins the cascade. That is an ordering
 *     dependency, so it gets asserted rather than trusted.
 *
 * Run:  npx wxt build && node scripts/verify-tokens.mjs
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

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const executablePath = BROWSERS.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Brave/Chrome found.');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
});

try {
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 15000 });
  const extId = new URL(target.url()).host;

  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 900));

  const probe = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const token = (name) => root.getPropertyValue(name).trim();
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Save to Silo')
    );
    const cs = btn ? getComputedStyle(btn) : null;
    return {
      // Silo's own tokens, from lib/theme.ts.
      brand600: token('--brand-600'),
      textSecondary: token('--text-secondary'),
      hairline: token('--hairline'),
      radiusPill: token('--radius-pill'),
      // shadcn's contract as the browser resolves it. `@theme inline` keeps the
      // var() reference rather than copying a value, so these can only match if
      // the bridge is actually wired to Silo's palette.
      colorPrimary: token('--color-primary'),
      colorMutedFg: token('--color-muted-foreground'),
      colorBorder: token('--color-border'),
      // The real shadcn component on screen — this is what proves the utilities
      // survive the cascade, not just that the variables are defined.
      ctaFound: Boolean(btn),
      ctaImage: cs?.backgroundImage ?? '',
      ctaRadius: cs?.borderRadius ?? '',
    };
  });

  check('Silo tokens are present on :root', probe.brand600 !== '', `--brand-600: ${probe.brand600}`);
  check('shadcn --color-primary IS Silo --brand-600',
    probe.colorPrimary === probe.brand600, `${probe.colorPrimary} vs ${probe.brand600}`);
  check('shadcn --color-muted-foreground IS Silo --text-secondary',
    probe.colorMutedFg === probe.textSecondary, `${probe.colorMutedFg} vs ${probe.textSecondary}`);
  check('shadcn --color-border IS Silo --hairline',
    probe.colorBorder === probe.hairline, `${probe.colorBorder} vs ${probe.hairline}`);
  check('the CTA is a shadcn Button', probe.ctaFound);
  check("the CTA renders Silo's brand gradient (utilities beat the base resets)",
    probe.ctaImage.startsWith('linear-gradient'), probe.ctaImage.slice(0, 52));
  check('the CTA radius resolves to Silo --radius-pill',
    probe.ctaRadius === probe.radiusPill, `${probe.ctaRadius} vs ${probe.radiusPill}`);
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\n🎉 TOKEN BRIDGE VERIFIED');
process.exit(failures ? 1 : 0);
