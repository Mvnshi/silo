/**
 * URL normalization for duplicate detection and stable identity. See spec §3
 * "save the same article twice" — we collapse the noisy variants (utm tags,
 * referral params, mixed case host, trailing slash, fragment) into a single
 * canonical string before comparing or storing.
 *
 * Pure module. No I/O, no IndexedDB. Safe to call from any context (background,
 * popup, content script).
 */

/**
 * Query params we strip unconditionally. They are tracking / attribution
 * noise that never changes the page the user is looking at, so two URLs that
 * differ only in these params should be treated as the same item.
 */
const TRACKING_PARAM_PREFIXES = ['utm_', 'mc_'];
const TRACKING_PARAM_EXACT = new Set([
  'gclid',
  'fbclid',
  '_ga',
  'ref',
  'source',
  'igshid',
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAM_EXACT.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Canonicalize a URL into its dedupe key. Returns the original string verbatim
 * if it cannot be parsed — better to mis-dedupe than to crash on a user save.
 *
 * - lowercases host
 * - strips tracking params (utm_*, gclid, fbclid, mc_*, _ga, ref, source, igshid)
 * - drops the fragment (#...)
 * - drops a trailing slash on the pathname (but not the bare "/")
 * - rewrites youtu.be/<id> short links to youtube.com/watch?v=<id>
 */
export function normalizeUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return input;
  }

  // youtu.be short links canonicalize to the long form so dedupe catches them.
  if (u.hostname.toLowerCase() === 'youtu.be') {
    const videoId = u.pathname.replace(/^\//, '').split('/')[0] ?? '';
    if (videoId) {
      const watch = new URL('https://www.youtube.com/watch');
      watch.searchParams.set('v', videoId);
      // Preserve any non-tracking params (e.g. t=) from the short link.
      for (const [k, v] of u.searchParams) {
        if (k.toLowerCase() === 'v') continue;
        if (isTrackingParam(k)) continue;
        watch.searchParams.set(k, v);
      }
      u = watch;
    }
  }

  u.hostname = u.hostname.toLowerCase();
  u.hash = '';

  // Mutate searchParams in-place; collect keys first to avoid iterator issues.
  const keys = Array.from(u.searchParams.keys());
  for (const k of keys) {
    if (isTrackingParam(k)) u.searchParams.delete(k);
  }

  let out = u.toString();

  // Trim a trailing slash on the path when there's no query/fragment — but keep
  // a bare-root "/" because "https://x.com" already serializes with one.
  if (!u.search && u.pathname !== '/' && u.pathname.endsWith('/')) {
    // Rebuild without the trailing slash; URL.toString preserves it otherwise.
    const trimmedPath = u.pathname.replace(/\/+$/, '');
    out = `${u.origin}${trimmedPath}${u.search}`;
  }

  return out;
}
