// Builds the static site into site/dist.
//
//   - index.html, 404.html, style.css and assets/ are copied across.
//   - docs/legal/*.md are rendered to /privacy/ and /terms/. Those two paths are
//     what `PRIVACY_URL` / `TERMS_URL` in lib/config.ts point at, and the legal
//     documents stay the single source of truth: edit the markdown, not the HTML.
//
// SITE_URL (no trailing slash) is used for canonical and social-preview URLs.
// It defaults to the project-pages address; set it if the site moves to a
// custom domain.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const SITE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SITE, '..');
const OUT = join(SITE, 'dist');
const SITE_URL = (process.env.SITE_URL || 'https://mvnshi.github.io/silo').replace(/\/+$/, '');

const LEGAL = [
  { src: 'privacy.md', dir: 'privacy' },
  { src: 'terms.md', dir: 'terms' },
];

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Split off the `---\ntitle: …\n---` block the legal docs open with. */
function parseFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

/** Shell shared by the legal pages. `base` is the relative path back to the site root. */
function legalPage({ title, description, dir, body }) {
  const base = '../';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="theme-color" content="#f5f3ff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0b0b10" media="(prefers-color-scheme: dark)" />
    <link rel="canonical" href="${SITE_URL}/${dir}/" />
    <link rel="icon" type="image/png" sizes="32x32" href="${base}assets/favicon-32.png" />
    <link rel="apple-touch-icon" href="${base}assets/apple-touch-icon.png" />
    <link rel="stylesheet" href="${base}style.css" />
  </head>
  <body>
    <header class="nav">
      <div class="wrap">
        <a class="brand" href="${base}"><img src="${base}assets/icon-512.png" alt="" width="30" height="30" />Silo</a>
        <nav class="nav-links" aria-label="Primary">
          <a href="${base}privacy/">Privacy</a>
          <a href="${base}terms/">Terms</a>
        </nav>
      </div>
    </header>
    <main class="doc">
      <a class="back" href="${base}">&larr; Silo</a>
${body}
    </main>
    <footer class="footer">
      <div class="wrap">
        <span>&copy; 2026 Silo</span>
        <nav aria-label="Legal">
          <a href="${base}privacy/">Privacy</a>
          <a href="${base}terms/">Terms</a>
        </nav>
      </div>
    </footer>
  </body>
</html>
`;
}

async function renderLegal({ src, dir }) {
  const raw = await readFile(join(ROOT, 'docs', 'legal', src), 'utf8');
  const { meta, body } = parseFrontMatter(raw);
  const title = meta.title || `Silo — ${dir}`;

  let html = marked.parse(body, { gfm: true });
  // Wide tables scroll inside their own box instead of widening the page.
  html = html.replace(/<table>/g, '<div class="table-scroll"><table>').replace(/<\/table>/g, '</table></div>');

  // The docs are written to be read on GitHub, where relative links to sibling
  // files work. On the site they would 404, so refuse to publish one.
  const bad = [...html.matchAll(/href="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((href) => !/^(https?:|mailto:|#)/.test(href));
  if (bad.length) {
    throw new Error(`docs/legal/${src} has links that will not resolve on the site: ${bad.join(', ')}`);
  }

  const lead = html.match(/<p>([\s\S]*?)<\/p>/);
  const description = lead ? lead[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 200) : title;

  await mkdir(join(OUT, dir), { recursive: true });
  await writeFile(join(OUT, dir, 'index.html'), legalPage({ title, description, dir, body: html }));
}

async function copyTemplated(file) {
  const html = (await readFile(join(SITE, file), 'utf8')).replaceAll('%SITE_URL%', SITE_URL);
  await writeFile(join(OUT, file), html);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await copyTemplated('index.html');
await copyTemplated('404.html');
await cp(join(SITE, 'style.css'), join(OUT, 'style.css'));
await cp(join(SITE, 'assets'), join(OUT, 'assets'), { recursive: true });
for (const doc of LEGAL) await renderLegal(doc);
// Static output only; make sure Pages never runs it through Jekyll.
await writeFile(join(OUT, '.nojekyll'), '');

console.log(`site built -> ${OUT} (SITE_URL=${SITE_URL})`);
