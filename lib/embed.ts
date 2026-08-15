/**
 * Inline embed builder — token-free official embeds for saved social links.
 *
 * Given a saved Item, returns a WebView source that renders the post via the
 * platform's OWN embed (no download, no API token, keyed only off the URL/ID):
 *   - YouTube / Vimeo  -> a clean <iframe> player URL  ({ kind: 'uri' })
 *   - TikTok           -> /embed/v2/<id> iframe, else blockquote + embed.js
 *   - X / Instagram /
 *     Threads          -> official blockquote + the platform's embed script
 *                          ({ kind: 'html' } document, loaded with a baseUrl)
 *   - Reddit / Facebook / generic web -> no embed ({ kind: 'none' } -> the card
 *                          shows the thumbnail or the AI-generated visual)
 *
 * This is the playback half of the Tier-1 social pipeline (see TODO "Social
 * Extraction"). It replaces the old third-party `eeinstagram.com` proxy with
 * Instagram's own embed.js. Pure + synchronous — safe to call during render.
 */

import { Item, SocialPlatform } from './types';

/**
 * How the embed wants to be laid out inside the full-screen feed card.
 *
 * This matters: rendering a 16:9 YouTube player edge-to-edge on a portrait
 * phone makes the player scale its own chrome up until the title bar collides
 * with the status bar. Give each embed its natural box and let a blurred
 * poster fill the rest of the card instead.
 */
export type EmbedAspect =
  /** 16:9 landscape player, centred vertically (YouTube, Vimeo). */
  | 'wide'
  /** Portrait video that should fill the card (TikTok). */
  | 'tall'
  /** Content-sized document; give it most of the card and let it scroll (X, IG, Threads). */
  | 'card';

export type EmbedSource =
  /**
   * headers: sent with the initial WebView request only (e.g. Referer — see the
   * YouTube note below).
   * autoplayUri: same player, primed to start immediately. Present only for
   * platforms where playback is a deliberate user action (see `posterFirst`).
   * posterFirst: render our own thumbnail + play button and mount the WebView
   * only on tap. YouTube deprecated `modestbranding` in 2023, so the player
   * always draws its own title bar and "Watch on YouTube" strip over the
   * poster — showing our poster instead keeps the card clean AND means an
   * un-played card costs no WKWebView at all.
   */
  | {
      kind: 'uri';
      uri: string;
      autoplayUri?: string;
      posterFirst?: boolean;
      headers?: Record<string, string>;
      aspect: EmbedAspect;
    }
  | { kind: 'html'; html: string; baseUrl: string; aspect: EmbedAspect }
  | { kind: 'none' };

/* ---------- id extractors ---------- */

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
    if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2] || null;
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

function tiktokId(url: string): string | null {
  const m = url.match(/\/video\/(\d+)/) || url.match(/\/embed\/v2\/(\d+)/);
  return m ? m[1] : null;
}

function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}

/** Client-side platform detection (mirrors the Worker's resolvePlatform) for items saved without a `platform`. */
export function detectPlatform(url?: string): SocialPlatform {
  if (!url) return 'web';
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'web';
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'twitter.com' || host === 'x.com' || host === 't.co' || host.endsWith('.twitter.com') || host.endsWith('.x.com'))
    return 'twitter';
  if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') return 'instagram';
  if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') return 'reddit';
  if (host === 'threads.net' || host.endsWith('.threads.net') || host === 'threads.com' || host.endsWith('.threads.com'))
    return 'threads';
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch' || host === 'fb.com') return 'facebook';
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) return 'vimeo';
  return 'web';
}

/* ---------- embed-document builder for blockquote-based platforms ---------- */

/** Escape a URL for safe insertion into an HTML attribute. */
function attr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlDoc(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><style>html,body{margin:0;padding:0;background:#000;min-height:100%;display:flex;align-items:center;justify-content:center;overflow-x:hidden}blockquote{margin:0!important;background:#000}iframe{max-width:100%}</style></head><body>${body}</body></html>`;
}

function instagramDoc(url: string): EmbedSource {
  const body = `<blockquote class="instagram-media" data-instgrm-permalink="${attr(
    url
  )}" data-instgrm-version="14" style="width:100%;max-width:540px;min-width:300px;"></blockquote><script async src="https://www.instagram.com/embed.js"></script>`;
  return { kind: 'html', html: htmlDoc(body), baseUrl: 'https://www.instagram.com', aspect: 'card' };
}

function threadsDoc(url: string): EmbedSource {
  const body = `<blockquote class="text-post-media" data-text-post-permalink="${attr(
    url
  )}" data-text-post-version="0" style="width:100%;max-width:540px;min-width:300px;"></blockquote><script async src="https://www.threads.net/embed.js"></script>`;
  return { kind: 'html', html: htmlDoc(body), baseUrl: 'https://www.threads.net', aspect: 'card' };
}

function twitterDoc(url: string): EmbedSource {
  const body = `<blockquote class="twitter-tweet" data-dnt="true" data-theme="dark"><a href="${attr(
    url
  )}"></a></blockquote><script async src="https://platform.twitter.com/widgets.js"></script>`;
  return { kind: 'html', html: htmlDoc(body), baseUrl: 'https://twitter.com', aspect: 'card' };
}

function tiktokDoc(url: string): EmbedSource {
  const body = `<blockquote class="tiktok-embed" cite="${attr(
    url
  )}" style="max-width:605px;min-width:300px;"></blockquote><script async src="https://www.tiktok.com/embed.js"></script>`;
  return { kind: 'html', html: htmlDoc(body), baseUrl: 'https://www.tiktok.com', aspect: 'tall' };
}

/* ---------- public API ---------- */

/**
 * Build the inline embed for an item. Returns { kind: 'none' } when the platform
 * has no token-free embed (Reddit/Facebook/web) or there's no usable URL —
 * callers fall back to the thumbnail / AI-generated visual.
 */
export function getEmbed(item: Pick<Item, 'url' | 'platform'>): EmbedSource {
  const url = (item.url || '').trim();
  if (!url) return { kind: 'none' };
  const platform = item.platform || detectPlatform(url);

  switch (platform) {
    case 'youtube': {
      const id = youtubeId(url);
      // A Referer header is REQUIRED: refererless embed loads fail with
      // "Error 153 — video player configuration error". It must be a normal
      // third-party site origin — claiming youtube.com itself gets rejected
      // with error 152. WKWebView sends custom headers on the initial request,
      // which is the one YouTube validates.
      // rel=0 + iv_load_policy=3 drop end-screen recommendations and
      // annotations. `modestbranding` is a no-op since 2023 — YouTube always
      // draws its title bar over the poster — so the card renders OUR poster
      // and only mounts the player once the user taps play.
      const base =
        `https://www.youtube-nocookie.com/embed/${id}` +
        '?playsinline=1&rel=0&iv_load_policy=3&color=white';
      return id
        ? {
            kind: 'uri',
            uri: base,
            autoplayUri: `${base}&autoplay=1`,
            posterFirst: true,
            headers: { Referer: 'https://silo.app/' },
            aspect: 'wide',
          }
        : { kind: 'none' };
    }
    case 'vimeo': {
      const id = vimeoId(url);
      const base = `https://player.vimeo.com/video/${id}?byline=0&title=0&portrait=0`;
      return id
        ? { kind: 'uri', uri: base, autoplayUri: `${base}&autoplay=1`, posterFirst: true, aspect: 'wide' }
        : { kind: 'none' };
    }
    case 'tiktok': {
      const id = tiktokId(url);
      return id
        ? { kind: 'uri', uri: `https://www.tiktok.com/embed/v2/${id}`, aspect: 'tall' }
        : tiktokDoc(url);
    }
    case 'twitter':
      return twitterDoc(url);
    case 'instagram':
      return instagramDoc(url);
    case 'threads':
      return threadsDoc(url);
    default:
      return { kind: 'none' };
  }
}
