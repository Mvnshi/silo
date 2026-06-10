/**
 * Remote-image helpers — fetch + base64 for the Worker's `classify_image`
 * task. See EXTENSION_SPEC.md §3 (right-click image save).
 *
 * Polite cap: refuse anything over 4MB so we never ship a 30MB hero image
 * over the Worker boundary. Most page images are well under this.
 */

/** Hard cap to keep Worker requests polite. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export interface FetchedImage {
  /** Pure base64 — no `data:` prefix. */
  base64: string;
  /** e.g. 'image/jpeg'. Defaults to 'image/jpeg' if the server omits it. */
  mimeType: string;
  /** Byte length of the raw image. */
  size: number;
}

/**
 * Fetch a remote image and return its base64 + mime. Throws on transport
 * failure or when the image exceeds MAX_IMAGE_BYTES. Service workers don't
 * have FileReader, so we go Blob → ArrayBuffer → btoa manually.
 */
export async function fetchImageAsBase64(srcUrl: string): Promise<FetchedImage> {
  const res = await fetch(srcUrl, { credentials: 'omit', redirect: 'follow' });
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);

  const blob = await res.blob();
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large (${Math.round(blob.size / 1024)}KB > 4MB cap).`);
  }

  const mimeType = blob.type || 'image/jpeg';
  const buffer = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  return { base64, mimeType, size: blob.size };
}

/** Chunked btoa — avoids "Maximum call stack" on large images. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}
