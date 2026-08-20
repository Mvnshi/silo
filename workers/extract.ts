/**
 * Universal social-link extractor (Tier-1: metadata + thumbnail + embed).
 *
 * Given any URL, resolves the platform and returns a normalized object using
 * the platform's SANCTIONED surface — oEmbed (YouTube / TikTok / X / Vimeo) or
 * Open Graph / Twitter-Card tags (Instagram / Reddit / Threads / Facebook / any
 * site). It NEVER downloads media (see TODO "Social Extraction" for the Tier-2
 * ToS / App-Store / legal rationale) — it returns the source link + metadata +
 * the official embed, which is what the app renders inline in a WebView.
 *
 * SSRF posture: the cost-pass removed the old "fetch any user URL" surface. This
 * re-introduces a fetch, but with CONTROLLED EGRESS:
 *   - http(s) only;
 *   - private / link-local / loopback / CGNAT / metadata IP-literal hosts and
 *     localhost/*.local/*.internal blocked;
 *   - redirects followed MANUALLY and re-validated at every hop;
 *   - a per-request AbortController timeout + a response-size cap.
 * (Cloudflare egress is public-internet only, so RFC-1918 isn't reachable from
 * the edge regardless; the host checks are defense-in-depth + block obvious
 * SSRF attempts before the request leaves.)
 *
 * Pure module — no Gemini dependency. The classify chain that turns the result
 * into category + tags lives in gemini.ts (handleExtract), so extraction works
 * (and is verifiable via `wrangler dev`) even with no GEMINI_API_KEY set.
 */

export type Platform =
  | 'youtube'
  | 'tiktok'
  | 'twitter'
  | 'instagram'
  | 'reddit'
  | 'threads'
  | 'facebook'
  | 'vimeo'
  | 'web';

/** Content shape (distinct from the app's capture `type` of link/screenshot/note). */
export type ContentKind = 'video' | 'image' | 'article' | 'post' | 'link';

export interface ExtractedLink {
  platform: Platform;
  kind: ContentKind;
  title: string;
  author?: string;
  caption?: string;
  thumbnailUrl?: string;
  /**
   * Every image on the post, in order — a carousel/gallery keeps all its frames.
   * Set only when there is more than one; `thumbnailUrl` is always `[0]`, so a
   * client that only knows the old field is unaffected.
   */
  thumbnailUrls?: string[];
  /** Clean iframe src when constructable (YouTube / TikTok). */
  embedUrl?: string;
  /** oEmbed html when the provider returns it (TikTok / X). */
  embedHtml?: string;
  /** Best-effort minutes (rarely available from oEmbed/OG). */
  duration?: number;
  /** Resolved/canonical URL after following redirects. */
  sourceUrl: string;
  /** true when rich metadata was obtained; false → caller saves a bare fallback. */
  ok: boolean;
  /** When !ok: invalid_url | blocked_scheme | blocked_host | dead | login_walled | extract_failed | unsupported. */
  reason?: string;
}

/** A real mobile Safari UA — maximizes OG success (e.g. Instagram serves OG to this, login-walls bare bots). */
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const HTML_CAP_BYTES = 512 * 1024;
const JSON_CAP_BYTES = 96 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;
/** Instagram carousels cap at 20 frames and Reddit galleries at 20, so 20 loses nothing. */
const MAX_IMAGES = 20;
const LD_NODE_CAP = 20;
const LINK_CAP = 40;

/* --------------------------------------------------------------------------
 * Egress guards
 * ------------------------------------------------------------------------ */

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (o.some((n) => n > 255)) return true; // malformed octet → block
  const [a, b] = o;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local, incl. 169.254.169.254 cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64/10
  );
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal') return true;
  if (h.includes(':')) return true; // IPv6 literal — social URLs use names; block to be safe
  // Non-standard IPv4 encodings DNS/fetch still resolve to a real address —
  // decimal (http://2130706433/) and hex (http://0x7f000001/) = 127.0.0.1.
  if (/^0x[0-9a-f]+$/.test(h)) return true;
  if (/^[0-9]+$/.test(h)) return true;
  if (isPrivateIpv4(h)) return true;
  return false;
}

/** Validate a URL for egress. Throws on bad scheme / blocked host. */
export function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('invalid_url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('blocked_scheme');
  if (isBlockedHost(u.hostname)) throw new Error('blocked_host');
  return u;
}

/* --------------------------------------------------------------------------
 * Bounded fetch with manual, re-validated redirects
 * ------------------------------------------------------------------------ */

async function readCapped(resp: Response, maxBytes: number): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
    }
  }
  const out = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    if (off >= out.length) break;
    const slice = c.subarray(0, out.length - off);
    out.set(slice, off);
    off += slice.length;
  }
  return new TextDecoder('utf-8').decode(out);
}

interface FetchResult {
  resp: Response;
  finalUrl: string;
}

async function safeFetch(rawUrl: string, accept: string): Promise<FetchResult> {
  let target = assertSafeUrl(rawUrl).toString();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(target, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': MOBILE_UA,
          Accept: accept,
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) return { resp, finalUrl: target };
      // Re-validate the redirect target before following it.
      target = assertSafeUrl(new URL(loc, target).toString()).toString();
      continue;
    }
    return { resp, finalUrl: target };
  }
  throw new Error('too_many_redirects');
}

/* --------------------------------------------------------------------------
 * Platform routing
 * ------------------------------------------------------------------------ */

export function resolvePlatform(host: string): Platform {
  const h = host.toLowerCase().replace(/^www\./, '');
  if (h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be' || h === 'youtube-nocookie.com')
    return 'youtube';
  if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) return 'tiktok';
  if (h === 'twitter.com' || h === 'x.com' || h === 't.co' || h.endsWith('.twitter.com') || h.endsWith('.x.com'))
    return 'twitter';
  if (h === 'instagram.com' || h.endsWith('.instagram.com') || h === 'instagr.am') return 'instagram';
  if (h === 'reddit.com' || h.endsWith('.reddit.com') || h === 'redd.it') return 'reddit';
  if (h === 'threads.net' || h.endsWith('.threads.net') || h === 'threads.com' || h.endsWith('.threads.com'))
    return 'threads';
  if (h === 'facebook.com' || h.endsWith('.facebook.com') || h === 'fb.watch' || h === 'fb.com') return 'facebook';
  if (h === 'vimeo.com' || h.endsWith('.vimeo.com')) return 'vimeo';
  return 'web';
}

/* --------------------------------------------------------------------------
 * oEmbed (YouTube / TikTok / X / Vimeo) — verified token-free 2026-06-04
 * ------------------------------------------------------------------------ */

const OEMBED_ENDPOINT: Partial<Record<Platform, (u: string) => string>> = {
  youtube: (u) => `https://www.youtube.com/oembed?url=${encodeURIComponent(u)}&format=json`,
  tiktok: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
  // omit_script: we inject the widget script ourselves in the client embed doc.
  twitter: (u) => `https://publish.twitter.com/oembed?url=${encodeURIComponent(u)}&omit_script=1&dnt=true`,
  vimeo: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`,
};

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
  if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
  return u.searchParams.get('v');
}

function mapOembedKind(type: unknown): ContentKind {
  switch (type) {
    case 'video':
      return 'video';
    case 'photo':
      return 'image';
    case 'rich':
      return 'post';
    default:
      return 'link';
  }
}

async function viaOembed(platform: Platform, srcUrl: string): Promise<ExtractedLink | null> {
  const endpoint = OEMBED_ENDPOINT[platform]?.(srcUrl);
  if (!endpoint) return null;

  const data = await fetchOembed(endpoint);
  if (!data) return null;

  const authorName = typeof data.author_name === 'string' && data.author_name ? data.author_name : undefined;
  // Some providers (notably X) return no `title` — fall back to the author so the
  // saved item isn't titled with the raw URL.
  const fallbackTitle = authorName ? (platform === 'twitter' ? `${authorName} on X` : authorName) : srcUrl;
  const result: ExtractedLink = {
    platform,
    kind: mapOembedKind(data.type),
    title: typeof data.title === 'string' && data.title ? data.title : fallbackTitle,
    author: authorName,
    thumbnailUrl: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : undefined,
    embedHtml: typeof data.html === 'string' ? data.html : undefined,
    // Vimeo and several other providers return seconds here; most return nothing.
    duration:
      typeof data.duration === 'number' && data.duration > 0 ? Math.round(data.duration / 60) : undefined,
    sourceUrl: srcUrl,
    ok: true,
  };

  // Clean iframe URLs where we can construct them (more reliable in a WebView).
  if (platform === 'youtube') {
    const id = youtubeId(assertSafeUrl(srcUrl));
    if (id) {
      result.embedUrl = `https://www.youtube-nocookie.com/embed/${id}`;
      if (!result.thumbnailUrl) result.thumbnailUrl = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
    result.kind = 'video';
  } else if (platform === 'tiktok') {
    const m = (result.embedHtml || '').match(/data-video-id="(\d+)"/) || srcUrl.match(/\/video\/(\d+)/);
    if (m) result.embedUrl = `https://www.tiktok.com/embed/v2/${m[1]}`;
    result.kind = 'video';
  }
  return result;
}

/* --------------------------------------------------------------------------
 * Open Graph / Twitter-Card (Instagram / Reddit / Threads / Facebook / any)
 * ------------------------------------------------------------------------ */

type MetaProps = Record<string, string>;

/** Everything one HTML document can tell us, before any interpretation. */
interface PageMeta {
  /** First value wins — the OG semantics for a scalar property. */
  props: MetaProps;
  /** Every value, in document order. `og:image` repeats once per carousel frame. */
  multi: Record<string, string[]>;
  /** `<link rel>` hrefs: `image_src`, and oEmbed autodiscovery. */
  links: { rel: string; type: string; href: string }[];
  /** `application/ld+json` blocks, flattened out of any `@graph` wrapper. */
  jsonLd: Record<string, unknown>[];
  documentTitle: string;
}

/** JSON-LD arrives as a node, an array of nodes, or a `@graph` wrapper. Flatten it. */
function flattenLd(value: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (!value || depth > 4 || out.length >= LD_NODE_CAP) return;
  if (Array.isArray(value)) {
    for (const entry of value) flattenLd(entry, out, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  if (node['@graph']) flattenLd(node['@graph'], out, depth + 1);
  if (node['@type'] || node.name || node.headline || node.image) out.push(node);
}

async function parseMeta(html: string): Promise<PageMeta> {
  const props: MetaProps = {};
  const multi: Record<string, string[]> = {};
  const links: { rel: string; type: string; href: string }[] = [];
  const jsonLd: Record<string, unknown>[] = [];
  let titleText = '';
  let ldBuffer = '';

  const keep = (key: string, content: string) => {
    if (props[key] === undefined) props[key] = content;
    (multi[key] ??= []).push(content);
  };

  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const content = el.getAttribute('content');
        if (content == null) return;
        const key = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
        if (
          key &&
          (key.startsWith('og:') ||
            key.startsWith('twitter:') ||
            key.startsWith('al:') ||
            key.startsWith('article:') ||
            key.startsWith('video:') ||
            key.startsWith('music:') ||
            key === 'description' ||
            key === 'author')
        ) {
          keep(key, content);
        }
        // Schema.org microdata — the fallback when a page ships neither OG nor JSON-LD.
        const itemprop = (el.getAttribute('itemprop') || '').toLowerCase();
        if (itemprop) keep(`itemprop:${itemprop}`, content);
      },
    })
    .on('link', {
      element(el) {
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        const href = el.getAttribute('href');
        if (!rel || !href || links.length >= LINK_CAP) return;
        links.push({ rel, type: (el.getAttribute('type') || '').toLowerCase(), href });
      },
    })
    .on('script[type="application/ld+json"]', {
      element() {
        ldBuffer = '';
      },
      text(t) {
        // Text arrives in chunks; accumulate until the parser closes the node.
        if (ldBuffer.length < JSON_CAP_BYTES) ldBuffer += t.text;
        if (!t.lastInTextNode) return;
        const raw = ldBuffer.trim();
        ldBuffer = '';
        if (!raw) return;
        try {
          flattenLd(JSON.parse(raw), jsonLd);
        } catch {
          // Malformed ld+json is extremely common in the wild, and never fatal.
        }
      },
    })
    .on('title', {
      text(t) {
        titleText += t.text;
      },
    });
  // Consuming the transformed body drives the handlers. Input is already capped.
  await rewriter.transform(new Response(html)).arrayBuffer();
  return { props, multi, links, jsonLd, documentTitle: titleText.trim() };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&#x2022;|&#8226;/gi, '•')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/* --------------------------------------------------------------------------
 * Images — a carousel is N frames, not one
 * ------------------------------------------------------------------------ */

/** Ordered by trustworthiness: OG, then Twitter-Card, then microdata. */
const IMAGE_META_KEYS = [
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'twitter:image',
  'twitter:image:src',
  'itemprop:image',
  'itemprop:thumbnailurl',
];

/**
 * Resolve a possibly-relative URL against the page and apply the same egress
 * rules as a fetch. We never fetch these — the client renders them — but a
 * `javascript:` or private-host "image" is not a thumbnail worth storing.
 */
function absolutize(href: string, base: string): string | null {
  const raw = decodeEntities(href);
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (isBlockedHost(u.hostname)) return null;
  return u.toString();
}

/** Image URLs out of a JSON-LD value: string | string[] | ImageObject | ImageObject[]. */
function ldImageUrls(value: unknown, push: (raw: string) => void, depth = 0): void {
  if (!value || depth > 3) return;
  if (typeof value === 'string') return push(value);
  if (Array.isArray(value)) {
    for (const entry of value) ldImageUrls(entry, push, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const node = value as Record<string, unknown>;
    ldImageUrls(node.url ?? node.contentUrl ?? node['@id'], push, depth + 1);
  }
}

/**
 * Every image on the page, in document order, deduped and absolutized.
 *
 * A carousel or gallery post repeats `og:image` once per frame. Reading a single
 * value kept frame 1 and silently dropped the rest — this is that fix.
 */
function collectImages(meta: PageMeta, base: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined | null) => {
    if (!raw || out.length >= MAX_IMAGES) return;
    const abs = absolutize(raw, base);
    if (!abs) return;
    // The same asset over http vs https, or with a bare trailing '?', is one image.
    const key = abs.replace(/^https?:\/\//, '').replace(/\?$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(abs);
  };

  for (const key of IMAGE_META_KEYS) for (const value of meta.multi[key] ?? []) push(value);
  for (const node of meta.jsonLd) {
    ldImageUrls(node.image, push);
    ldImageUrls(node.thumbnailUrl, push);
  }
  for (const link of meta.links) if (link.rel === 'image_src') push(link.href);
  return out;
}

/* --------------------------------------------------------------------------
 * JSON-LD scalars
 * ------------------------------------------------------------------------ */

/**
 * An author worth displaying. `article:author` is a *profile URL* per the OGP
 * spec, and plenty of sites put a bare URL in `author` too — showing
 * "https://facebook.com/seriouseats" as the author is worse than showing none.
 */
function cleanAuthor(raw: string): string {
  const s = decodeEntities(raw);
  if (!s || s.length > 120) return '';
  if (/^(https?:)?\/\//i.test(s) || /^www\./i.test(s)) return '';
  return s;
}

function ldString(value: unknown, depth = 0): string {
  if (depth > 3) return '';
  if (typeof value === 'string') return decodeEntities(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const s = ldString(entry, depth + 1);
      if (s) return s;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    return ldString(node.name ?? node['@value'], depth + 1);
  }
  return '';
}

/**
 * ISO-8601 duration (`PT1H23M45S`) → whole minutes. oEmbed and OG almost never
 * carry a duration; JSON-LD routinely does, which is why `duration` was
 * documented as "rarely available".
 */
function isoDurationToMinutes(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?)?$/i.exec(value.trim());
  if (!m || !m.slice(1).some(Boolean)) return undefined;
  const total =
    Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60;
  if (!Number.isFinite(total) || total <= 0) return undefined;
  return Math.round(total);
}

const LD_VIDEO_TYPES = new Set(['videoobject', 'movie', 'episode', 'musicvideoobject', 'podcastepisode']);
const LD_ARTICLE_TYPES = new Set([
  'article',
  'newsarticle',
  'blogposting',
  'techarticle',
  'report',
  'recipe',
  'howto',
]);
const LD_IMAGE_TYPES = new Set(['imageobject', 'photograph']);
/**
 * Site chrome, not content. A `@graph` almost always leads with these, so
 * reading nodes in document order titles the item with the site name.
 */
const LD_CHROME_TYPES = new Set([
  'website',
  'webpage',
  'organization',
  'breadcrumblist',
  'sitenavigationelement',
  'collectionpage',
  'searchaction',
  'listitem',
]);

function ldTypeKeys(node: Record<string, unknown>): string[] {
  const raw = node['@type'];
  return (Array.isArray(raw) ? raw : [raw])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.toLowerCase().replace(/^https?:\/\/schema\.org\//, ''));
}

/** Content nodes before chrome nodes, so the first match is the real subject. */
function ldContentFirst(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
  const primary: Record<string, unknown>[] = [];
  const chrome: Record<string, unknown>[] = [];
  for (const node of nodes) {
    const keys = ldTypeKeys(node);
    (keys.length && keys.every((k) => LD_CHROME_TYPES.has(k)) ? chrome : primary).push(node);
  }
  return [...primary, ...chrome];
}

/** Content shape straight from `@type` — more reliable than guessing from a URL. */
function ldKind(nodes: Record<string, unknown>[]): ContentKind | null {
  for (const node of ldContentFirst(nodes)) {
    for (const key of ldTypeKeys(node)) {
      if (LD_VIDEO_TYPES.has(key)) return 'video';
      if (LD_ARTICLE_TYPES.has(key)) return 'article';
      if (LD_IMAGE_TYPES.has(key)) return 'image';
      if (key === 'socialmediaposting' || key === 'discussionforumposting') return 'post';
    }
  }
  return null;
}

function kindFromOg(platform: Platform, srcUrl: string, ogType: string, imageCount: number): ContentKind {
  if (/\/(reel|reels|video|tv|watch|shorts)\b/.test(srcUrl)) return 'video';
  if (ogType.startsWith('video')) return 'video';
  if (ogType === 'article') return 'article';
  if (ogType === 'profile') return 'post';
  if (platform === 'instagram' || platform === 'threads' || platform === 'facebook' || platform === 'reddit')
    return 'post';
  // A page whose metadata is a stack of images is a gallery, not a bare link.
  if (imageCount > 1) return 'image';
  return 'link';
}

function baseFallback(platform: Platform, srcUrl: string, reason: string): ExtractedLink {
  return { platform, kind: 'link', title: srcUrl, sourceUrl: srcUrl, ok: false, reason };
}

/**
 * Detect metadata that isn't really the content: a bot/JS challenge (common when
 * a datacenter IP hits Reddit/Instagram) or a bare site title (a dead/private
 * item that redirected to the platform homepage). Returns a reason, or null when
 * the metadata looks real. This is what keeps failure states HONEST — without it
 * a challenge page or homepage would be saved as if extraction succeeded.
 */
const GENERIC_SITE_TITLES = new Set([
  'youtube',
  'instagram',
  'tiktok',
  'reddit',
  'threads',
  'facebook',
  'x',
  'twitter',
  'vimeo',
  'watch',
  'log in',
  'login',
]);
const CHALLENGE_RE =
  /please wait|verifying|just a moment|are you a robot|attention required|enable javascript|sign up to (see|view)|video unavailable|content isn.t available|page not found/i;

function lowQualityReason(title: string, caption: string): string | null {
  const t = title.trim();
  if (!t) return 'login_walled';
  if (CHALLENGE_RE.test(t) || (caption && CHALLENGE_RE.test(caption))) return 'blocked';
  if (GENERIC_SITE_TITLES.has(t.toLowerCase())) return 'unavailable';
  return null;
}

/* --------------------------------------------------------------------------
 * oEmbed autodiscovery — the generic half of the fallback
 * ------------------------------------------------------------------------ */

/** Fetch and parse an oEmbed endpoint. Null on any failure; never throws. */
async function fetchOembed(endpoint: string): Promise<Record<string, any> | null> {
  try {
    const { resp } = await safeFetch(endpoint, 'application/json');
    if (!resp.ok) return null;
    const data = JSON.parse(await readCapped(resp, JSON_CAP_BYTES));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/**
 * `<link rel="alternate" type="application/json+oembed">` — the standard way any
 * site advertises its own oEmbed endpoint. This is what extends provider-quality
 * metadata past the four hardcoded platforms, without hardcoding anything.
 */
function oembedDiscoveryUrl(meta: PageMeta, base: string): string | null {
  for (const link of meta.links) {
    if (!link.rel.split(/\s+/).includes('alternate')) continue;
    if (link.type !== 'application/json+oembed' && link.type !== 'text/json+oembed') continue;
    const abs = absolutize(link.href, base);
    if (abs) return abs;
  }
  return null;
}

async function viaOpenGraph(platform: Platform, srcUrl: string): Promise<ExtractedLink> {
  // old.reddit.com serves clean OG far more readily than the JS-walled new Reddit.
  const fetchUrl =
    platform === 'reddit' ? srcUrl.replace(/:\/\/(www\.)?reddit\.com/i, '://old.reddit.com') : srcUrl;
  const { resp, finalUrl } = await safeFetch(fetchUrl, 'text/html,application/xhtml+xml,*/*;q=0.8');
  // Preserve the canonical link the user saved (not the old.reddit rewrite).
  const canonical = platform === 'reddit' ? srcUrl : finalUrl;
  if (!resp.ok) {
    return baseFallback(platform, canonical, resp.status === 401 || resp.status === 403 ? 'login_walled' : 'dead');
  }
  const html = await readCapped(resp, HTML_CAP_BYTES);
  const meta = await parseMeta(html);
  const og = meta.props;

  let title = decodeEntities(og['og:title'] || og['twitter:title'] || '');
  let caption = decodeEntities(og['og:description'] || og['twitter:description'] || og['description'] || '');
  let author =
    cleanAuthor(og['article:author'] || '') ||
    cleanAuthor(og['author'] || '') ||
    cleanAuthor(og['twitter:creator'] || '');
  let images = collectImages(meta, finalUrl);
  let duration: number | undefined;
  let embedHtml: string | undefined;

  // JSON-LD fills what OG leaves out — and is the only common source of a duration.
  for (const node of ldContentFirst(meta.jsonLd)) {
    if (!title) title = ldString(node.headline) || ldString(node.name);
    if (!caption) caption = ldString(node.description);
    if (!author) author = cleanAuthor(ldString(node.author)) || cleanAuthor(ldString(node.creator));
    if (duration === undefined) {
      duration = isoDurationToMinutes(node.duration ?? node.totalTime ?? node.timeRequired ?? node.cookTime);
    }
  }
  // The site's own oEmbed endpoint, discovered from the page it served us. This
  // is what turns "any URL" from a title-and-image guess into the provider's own
  // answer — Spotify, SoundCloud, Flickr, Substack, gists, most CMSs.
  let oembedKind: ContentKind | null = null;
  if (!title || !author || images.length === 0) {
    const endpoint = oembedDiscoveryUrl(meta, finalUrl);
    const data = endpoint ? await fetchOembed(endpoint) : null;
    if (data) {
      oembedKind = mapOembedKind(data.type);
      if (!title && typeof data.title === 'string') title = decodeEntities(data.title);
      if (!author && typeof data.author_name === 'string') author = cleanAuthor(data.author_name);
      if (typeof data.thumbnail_url === 'string') {
        const abs = absolutize(data.thumbnail_url, finalUrl);
        if (abs && !images.includes(abs)) images = [abs, ...images].slice(0, MAX_IMAGES);
      }
      if (typeof data.html === 'string') embedHtml = data.html;
      if (duration === undefined && typeof data.duration === 'number' && data.duration > 0) {
        duration = Math.round(data.duration / 60);
      }
    }
  }

  // Last-resort scalars. These are weaker than anything above — in particular
  // weaker than the provider's own oEmbed answer — so they run only at the end.
  if (!title) title = meta.documentTitle;
  if (!author) author = cleanAuthor(og['og:site_name'] || '');

  // An iframe-able player. `twitter:player` is an iframe by definition; `og:video`
  // counts only when the page says it is text/html — otherwise it is a raw media
  // file, which we deliberately never touch (App Store 5.2.3 / platform ToS).
  const player = og['twitter:player'];
  const ogVideo = og['og:video:url'] || og['og:video:secure_url'] || og['og:video'];
  const ogVideoIsHtml = (og['og:video:type'] || '').toLowerCase().includes('text/html');
  const embedUrl = player
    ? absolutize(player, finalUrl) ?? undefined
    : ogVideo && ogVideoIsHtml
      ? absolutize(ogVideo, finalUrl) ?? undefined
      : undefined;

  const ogType = (og['og:type'] || '').toLowerCase();
  const lowReason = lowQualityReason(title, caption);
  const hasRich = Boolean(title || images.length) && !lowReason;
  return {
    platform,
    kind: ldKind(meta.jsonLd) ?? oembedKind ?? kindFromOg(platform, canonical, ogType, images.length),
    title: title || canonical,
    author: author || undefined,
    caption: caption || undefined,
    thumbnailUrl: images[0],
    // Only set for a genuine multi-image post, so a single-image page is
    // byte-identical to what it produced before.
    thumbnailUrls: images.length > 1 ? images : undefined,
    embedUrl,
    embedHtml,
    duration,
    sourceUrl: canonical,
    ok: hasRich,
    // !ok: a generic site title / bot-challenge / empty metadata — usually a
    // datacenter-IP login wall or a dead/private item. The caller still saves the link.
    reason: hasRich ? undefined : lowReason || 'login_walled',
  };
}

/* --------------------------------------------------------------------------
 * Orchestrator
 * ------------------------------------------------------------------------ */

/**
 * Extract normalized metadata for any URL. Order: oEmbed (where available, works
 * from datacenter IPs, no auth) → Open Graph → bare fallback (never lose a save).
 * Throws only on egress-guard rejections (invalid/blocked URL); all network
 * failures degrade to an `ok:false` result.
 */
export async function extractLink(rawUrl: string): Promise<ExtractedLink> {
  const u = assertSafeUrl(rawUrl); // throws on bad scheme / blocked host
  const platform = resolvePlatform(u.hostname);
  const srcUrl = u.toString();

  // 1) oEmbed where available.
  if (OEMBED_ENDPOINT[platform]) {
    try {
      const r = await viaOembed(platform, srcUrl);
      if (r && r.ok) return r;
    } catch {
      /* fall through to OG */
    }
  }

  // 2) Open Graph / Twitter-Card for everything else (and as an oEmbed fallback).
  try {
    return await viaOpenGraph(platform, srcUrl);
  } catch {
    // 3) Total failure → never lose the save.
    return baseFallback(platform, srcUrl, 'extract_failed');
  }
}
