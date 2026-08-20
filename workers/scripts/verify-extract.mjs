/**
 * Extractor verification — `workers/extract.ts` against fixed HTML.
 *
 * These are the cases that are not observable from a live URL: a page whose OG
 * block is a carousel, a `@graph` that leads with site chrome, a site that
 * advertises oEmbed instead of shipping metadata, and images that should never
 * survive the egress filter. Live pages change; these do not.
 *
 * Run:  node workers/scripts/verify-extract.mjs
 *
 * The Worker is started and stopped by this script; nothing to set up by hand.
 *
 * The fixture server binds to 127.0.0.1, and the Worker reaches it via
 * `127-0-0-1.sslip.io` — the egress guard rejects the literal `localhost` and
 * `127.0.0.1` by design, and resolving a name to loopback is exactly the
 * defense-in-depth gap the module header documents (Cloudflare's own egress is
 * public-internet only, so it does not exist in production). Requires DNS.
 */
import http from 'node:http';
import { startWorker, stopAll } from './servers.mjs';

const PORT = Number(process.env.SILO_FIXTURE_PORT ?? 8123);
const WORKER = process.env.SILO_WORKER_URL ?? 'http://localhost:8799';
const HOST = `http://127-0-0-1.sslip.io:${PORT}`;

const F = {
  // 5-frame carousel: the exact case that used to lose frames 2-5.
  '/carousel.html': `<html><head>
    <meta property="og:title" content="Five photos from Lisbon">
    <meta property="og:description" content="A carousel post">
    <meta property="og:image" content="https://cdn.example.com/1.jpg">
    <meta property="og:image" content="https://cdn.example.com/2.jpg">
    <meta property="og:image" content="https://cdn.example.com/3.jpg">
    <meta property="og:image" content="https://cdn.example.com/4.jpg">
    <meta property="og:image" content="https://cdn.example.com/5.jpg">
  </head><body>x</body></html>`,

  // No OG at all — everything must come from JSON-LD, including the duration.
  '/jsonld.html': `<html><head><title>site title</title>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Recipe",
     "name":"Miso Ramen","description":"A rich bowl",
     "author":{"@type":"Person","name":"Kenji"},
     "totalTime":"PT1H30M",
     "image":["https://cdn.example.com/a.jpg",{"@type":"ImageObject","url":"https://cdn.example.com/b.jpg"}]}
    </script></head><body>x</body></html>`,

  // @graph wrapper + relative image path.
  '/graph.html': `<html><head>
    <script type="application/ld+json">
    {"@graph":[{"@type":"WebSite","name":"ignore me"},
               {"@type":"NewsArticle","headline":"Graph headline","image":"/img/rel.jpg"}]}
    </script></head><body>x</body></html>`,

  // Same asset twice + an http/https pair: one image, not three.
  '/dupes.html': `<html><head>
    <meta property="og:title" content="Dupes">
    <meta property="og:image" content="https://cdn.example.com/same.jpg">
    <meta property="og:image" content="https://cdn.example.com/same.jpg">
    <meta property="twitter:image" content="http://cdn.example.com/same.jpg">
    <meta property="og:image" content="https://cdn.example.com/other.jpg">
  </head><body>x</body></html>`,

  // Nothing useful in the page; the site advertises its own oEmbed endpoint.
  '/oembed.html': `<html><head><title>bare</title>
    <link rel="alternate" type="application/json+oembed" href="/oembed.json">
  </head><body>x</body></html>`,

  // twitter:player is an iframe by definition.
  '/player.html': `<html><head>
    <meta property="og:title" content="A track">
    <meta property="twitter:player" content="https://player.example.com/embed/9">
  </head><body>x</body></html>`,

  // og:video that is a raw mp4 must NOT become an embed.
  '/mp4.html': `<html><head>
    <meta property="og:title" content="Raw media">
    <meta property="og:video" content="https://cdn.example.com/movie.mp4">
    <meta property="og:video:type" content="video/mp4">
  </head><body>x</body></html>`,

  // Hostile image sources must be dropped, good one kept.
  '/hostile.html': `<html><head>
    <meta property="og:title" content="Hostile">
    <meta property="og:image" content="javascript:alert(1)">
    <meta property="og:image" content="http://169.254.169.254/latest/meta-data/">
    <meta property="og:image" content="http://127.0.0.1/secret.png">
    <meta property="og:image" content="https://cdn.example.com/ok.jpg">
  </head><body>x</body></html>`,

  // Exactly one image: must stay byte-identical to the old shape.
  '/single.html': `<html><head>
    <meta property="og:title" content="Just one">
    <meta property="og:image" content="https://cdn.example.com/one.jpg">
  </head><body>x</body></html>`,

  // Relative og:image against the page URL.
  '/relative.html': `<html><head>
    <meta property="og:title" content="Relative">
    <meta property="og:image" content="/img/rel1.jpg">
    <meta property="og:image" content="img/rel2.jpg">
  </head><body>x</body></html>`,
};

const OEMBED = JSON.stringify({
  type: 'rich', title: 'Discovered title', author_name: 'Discovered author',
  thumbnail_url: 'https://cdn.example.com/oembed-thumb.jpg',
  html: '<iframe src="https://player.example.com/x"></iframe>', duration: 245,
});

const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/oembed.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(OEMBED);
  }
  const body = F[path];
  if (!body) {
    res.writeHead(404);
    return res.end('no');
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
});

async function extract(path) {
  const res = await fetch(`${WORKER}/api/gemini`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.SILO_CLIENT_TOKEN ? { 'X-Silo-Client': process.env.SILO_CLIENT_TOKEN } : {}),
    },
    body: JSON.stringify({ task: 'extract', url: `${HOST}${path}` }),
  });
  if (!res.ok) throw new Error(`worker returned ${res.status}`);
  return res.json();
}

const CASES = [
  ['/carousel.html', (r) => r.thumbnailUrls?.length === 5 && r.thumbnailUrls[4].endsWith('5.jpg') && r.thumbnailUrl.endsWith('1.jpg'),
    'all 5 carousel frames survive; thumbnailUrl is frame 1'],
  ['/single.html', (r) => r.thumbnailUrls === undefined && r.thumbnailUrl.endsWith('one.jpg'),
    'a single image omits thumbnailUrls (old clients unaffected)'],
  ['/dupes.html', (r) => r.thumbnailUrls?.length === 2,
    'http/https pair and a repeat collapse to one image each'],
  ['/jsonld.html', (r) => r.title === 'Miso Ramen' && r.author === 'Kenji' && r.duration === 90 && r.thumbnailUrls?.length === 2 && r.kind === 'article',
    'JSON-LD supplies title, author, duration, images and kind with no OG at all'],
  ['/graph.html', (r) => r.title === 'Graph headline' && r.thumbnailUrl === `${HOST}/img/rel.jpg`,
    '@graph picks the article, not the leading WebSite node'],
  ['/relative.html', (r) => r.thumbnailUrls?.length === 2 && r.thumbnailUrls[0] === `${HOST}/img/rel1.jpg` && r.thumbnailUrls[1] === `${HOST}/img/rel2.jpg`,
    'root-relative and path-relative images both absolutize'],
  ['/oembed.html', (r) => r.title === 'Discovered title' && r.author === 'Discovered author' && r.thumbnailUrl.endsWith('oembed-thumb.jpg') && r.duration === 4 && !!r.embedHtml,
    'oEmbed autodiscovery beats a bare <title> and fills every gap'],
  ['/player.html', (r) => r.embedUrl === 'https://player.example.com/embed/9',
    'twitter:player becomes an embed'],
  ['/mp4.html', (r) => r.embedUrl === undefined,
    'a raw mp4 og:video never becomes an embed (App Store 5.2.3)'],
  ['/hostile.html', (r) => r.thumbnailUrls === undefined && r.thumbnailUrl === 'https://cdn.example.com/ok.jpg',
    'javascript:, cloud-metadata and loopback images are dropped'],
];

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
console.log('▸ starting the Worker…');
await startWorker(8799);
console.log('▸ ready\n');

let pass = 0;
const failures = [];
for (const [path, check, label] of CASES) {
  try {
    const body = await extract(path);
    if (check(body)) {
      pass++;
      console.log(`PASS  ${path.padEnd(16)} ${label}`);
    } else {
      failures.push([path, label, body]);
      console.log(`FAIL  ${path.padEnd(16)} ${label}`);
      console.log(`        got: ${JSON.stringify({ title: body.title, author: body.author, duration: body.duration, kind: body.kind, thumbnailUrl: body.thumbnailUrl, thumbnailUrls: body.thumbnailUrls, embedUrl: body.embedUrl, ok: body.ok, reason: body.reason })}`);
    }
  } catch (error) {
    failures.push([path, label, String(error)]);
    console.log(`ERROR ${path.padEnd(16)} ${error.message}`);
  }
}

server.close();
await stopAll();
console.log(`\n${pass}/${CASES.length} passed`);
process.exit(failures.length ? 1 : 0);
