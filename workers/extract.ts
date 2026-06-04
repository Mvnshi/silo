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

  const { resp } = await safeFetch(endpoint, 'application/json');
  if (!resp.ok) return null;
  const raw = await readCapped(resp, JSON_CAP_BYTES);
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;

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

async function parseMeta(html: string): Promise<MetaProps> {
  const props: MetaProps = {};
  let titleText = '';
  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const key = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
        const content = el.getAttribute('content');
        if (!key || content == null) return;
        if (
          key.startsWith('og:') ||
          key.startsWith('twitter:') ||
          key.startsWith('al:') ||
          key.startsWith('article:') ||
          key === 'description'
        ) {
          if (props[key] === undefined) props[key] = content;
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
  if (titleText.trim() && props['__title'] === undefined) props['__title'] = titleText.trim();
  return props;
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

function kindFromOg(platform: Platform, srcUrl: string, ogType: string): ContentKind {
  if (/\/(reel|reels|video|tv|watch)\b/.test(srcUrl)) return 'video';
  if (ogType.startsWith('video')) return 'video';
  if (ogType === 'article') return 'article';
  if (ogType === 'profile') return 'post';
  if (platform === 'instagram' || platform === 'threads' || platform === 'facebook' || platform === 'reddit')
    return 'post';
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
  const og = await parseMeta(html);

  const title = decodeEntities(og['og:title'] || og['twitter:title'] || og['__title'] || '');
  const caption = decodeEntities(og['og:description'] || og['twitter:description'] || og['description'] || '');
  const thumb =
    og['og:image'] || og['og:image:url'] || og['og:image:secure_url'] || og['twitter:image'] || og['twitter:image:src'];
  const ogType = (og['og:type'] || '').toLowerCase();
  const author = decodeEntities(og['og:site_name'] || og['article:author'] || '');

  const lowReason = lowQualityReason(title, caption);
  const hasRich = Boolean(title || thumb) && !lowReason;
  return {
    platform,
    kind: kindFromOg(platform, canonical, ogType),
    title: title || canonical,
    author: author || undefined,
    caption: caption || undefined,
    thumbnailUrl: thumb || undefined,
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
