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

export type EmbedSource =
  | { kind: 'uri'; uri: string }
  | { kind: 'html'; html: string; baseUrl: string }
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
  return { kind: 'html', html: htmlDoc(body), baseUrl: 'https://www.instagram.com' };
}

function threadsDoc(url: string): EmbedSource {
  const body = `<blockquote class="text-post-media" data-text-post-permalink="${attr(
    url
  )}" data-text-post-version="0" style="width:100%;max-width:540px;min-width:300px;"></blockquote><script async src="https://www.threads.net/embed.js"></script>`;
  return { kind: 'html', html: htmlDoc(body), baseUrl: 'https://www.threads.net' };
}

function twitterDoc(url: string): EmbedSource {
  const body = `<blockquote class="twitter-tweet" data-dnt="true" data-theme="dark"><a href="${attr(
    url
  )}"></a></blockquote><script async src="https://platform.twitter.com/widgets.js"></script>`;
  return { kind: 'html', html: htmlDoc(body), baseUrl: 'https://twitter.com' };
}

function tiktokDoc(url: string): EmbedSource {
  const body = `<blockquote class="tiktok-embed" cite="${attr(
    url
  )}" style="max-width:605px;min-width:300px;"></blockquote><script async src="https://www.tiktok.com/embed.js"></script>`;
  return { kind: 'html', html: htmlDoc(body), baseUrl: 'https://www.tiktok.com' };
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
      return id ? { kind: 'uri', uri: `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0` } : { kind: 'none' };
    }
    case 'vimeo': {
      const id = vimeoId(url);
      return id ? { kind: 'uri', uri: `https://player.vimeo.com/video/${id}` } : { kind: 'none' };
    }
    case 'tiktok': {
      const id = tiktokId(url);
      return id ? { kind: 'uri', uri: `https://www.tiktok.com/embed/v2/${id}` } : tiktokDoc(url);
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

/** True when the item can render an inline platform embed. */
export function canEmbed(item: Pick<Item, 'url' | 'platform'>): boolean {
  return getEmbed(item).kind !== 'none';
}
