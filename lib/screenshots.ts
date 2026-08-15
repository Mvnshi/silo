/**
 * Screenshot Detection Module
 *
 * Reads the device photo library and surfaces *only screenshots* for the triage
 * deck, plus the helpers that turn one into something the AI endpoint accepts.
 *
 * Two things callers must know:
 * - Permission state is RETURNED, never swallowed. `queryRecentScreenshots`
 *   reports `denied` / `undetermined` alongside an empty list so the UI can
 *   prime before the OS dialog and route a hard denial to Settings, instead of
 *   lying with "No screenshots found".
 * - Detection is platform-specific. iOS tags real screenshots with a PhotoKit
 *   media subtype; the filename heuristic is Android-only (on iOS `IMG_####`
 *   is every camera photo, which turned the deck into the whole camera roll).
 *
 * Dependencies:
 * - expo-media-library: Access to device photos
 */

import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';

/**
 * Screenshot asset with metadata
 */
export interface Screenshot {
  id: string;
  uri: string;
  filename: string;
  creationTime: number;
  width: number;
  height: number;
  mimeType: string;
}

/**
 * Media-library access as the UI needs to reason about it.
 *
 * `limited` is iOS 14+ / Android 14+ "selected photos": queries succeed but
 * only ever see the subset the user picked, so it deserves its own message.
 */
export type MediaPermissionStatus = 'granted' | 'limited' | 'denied' | 'undetermined';

/** Result of a screenshot query — assets are empty whenever access isn't usable. */
export interface ScreenshotQuery {
  status: MediaPermissionStatus;
  assets: Screenshot[];
}

function toPermissionStatus(response: MediaLibrary.PermissionResponse): MediaPermissionStatus {
  if (response.status === MediaLibrary.PermissionStatus.GRANTED) {
    return response.accessPrivileges === 'limited' ? 'limited' : 'granted';
  }
  if (response.status === MediaLibrary.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

/** True while the library can actually be queried (full or partial access). */
function isReadable(status: MediaPermissionStatus): boolean {
  return status === 'granted' || status === 'limited';
}

/**
 * Read the current permission WITHOUT showing the OS dialog.
 *
 * Lets a screen render its priming card first — the system prompt can only be
 * shown once, so firing it unexplained on mount burns the single ask.
 */
export async function getMediaLibraryPermissionStatus(): Promise<MediaPermissionStatus> {
  try {
    return toPermissionStatus(await MediaLibrary.getPermissionsAsync());
  } catch (error) {
    console.error('Failed to read media library permissions:', error);
    return 'undetermined';
  }
}

/**
 * Show the OS permission dialog.
 *
 * @returns the resulting status — `denied` means Settings is the only way back.
 */
export async function requestMediaLibraryPermissions(): Promise<MediaPermissionStatus> {
  try {
    return toPermissionStatus(await MediaLibrary.requestPermissionsAsync());
  } catch (error) {
    console.error('Failed to request media library permissions:', error);
    return 'denied';
  }
}

/**
 * Android screenshot detection. Android exposes no media subtype, so the
 * filename is all we have — and unlike iOS it is actually discriminating.
 */
function isAndroidScreenshot(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.includes('screenshot') || lower.includes('screen_') || lower.startsWith('scr_')
  );
}

/**
 * Get recent screenshots from the device, along with the permission status.
 *
 * Never prompts — call `requestMediaLibraryPermissions()` from the priming UI
 * and re-query. A failed query returns the status with an empty list rather
 * than throwing, so the caller only has one shape to render.
 *
 * @param limit - Maximum number of screenshots to retrieve (default: 20)
 */
export async function queryRecentScreenshots(limit: number = 20): Promise<ScreenshotQuery> {
  const status = await getMediaLibraryPermissionStatus();
  if (!isReadable(status)) return { status, assets: [] };

  const isIOS = Platform.OS === 'ios';
  const options: MediaLibrary.AssetsOptions = {
    mediaType: 'photo',
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    // iOS filters server-side by subtype, so `limit` is exact. Android has to
    // over-fetch and filter by filename below.
    first: isIOS ? limit : 100,
  };
  if (isIOS) options.mediaSubtypes = ['screenshot'];

  try {
    const page = await MediaLibrary.getAssetsAsync(options);
    const assets: Screenshot[] = [];
    for (const asset of page.assets) {
      if (assets.length >= limit) break;
      if (!isIOS && !isAndroidScreenshot(asset.filename)) continue;
      assets.push({
        id: asset.id,
        uri: asset.uri,
        filename: asset.filename,
        creationTime: asset.creationTime,
        width: asset.width,
        height: asset.height,
        mimeType: getMimeTypeFromFilename(asset.filename),
      });
    }
    return { status, assets };
  } catch (error) {
    console.error('Failed to get recent screenshots:', error);
    return { status, assets: [] };
  }
}

/**
 * Array-only convenience wrapper for callers with no permission UI of their own
 * (the Add screen's recent-shots strip) — it owns the prompt, and cannot tell
 * "no screenshots" from "denied". Prefer `queryRecentScreenshots`.
 */
export async function getRecentScreenshots(limit: number = 20): Promise<Screenshot[]> {
  const first = await queryRecentScreenshots(limit);
  if (first.status !== 'undetermined') return first.assets;
  if (!isReadable(await requestMediaLibraryPermissions())) return [];
  return (await queryRecentScreenshots(limit)).assets;
}

/**
 * Convert image URI to base64 string for API transmission
 *
 * @param uri - Image URI
 * @returns Base64-encoded image data (without data URI prefix)
 */
export async function imageUriToBase64(uri: string): Promise<string> {
  try {
    // Handle different URI schemes
    let fileUri = uri;

    // If it's a media library URI (ph:// or assets-library://), we need to get the actual file path
    if (uri.startsWith('ph://') || uri.startsWith('assets-library://')) {
      // Extract asset ID from URI
      const assetId = uri.replace(/^(ph:\/\/|assets-library:\/\/)/, '').split('/')[0];

      // Get asset info to get the proper URI
      const asset = await MediaLibrary.getAssetInfoAsync(assetId);
      if (asset.localUri) {
        fileUri = asset.localUri;
      } else if (asset.uri) {
        fileUri = asset.uri;
      }
    }

    // Use fetch to get the file as a blob, then convert to base64
    // This works for both file:// URIs and other URI schemes
    const response = await fetch(fileUri);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const blob = await response.blob();

    // Convert blob to base64 using FileReader
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        try {
          const base64String = reader.result as string;
          // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
          const base64 = base64String.includes(',')
            ? base64String.split(',')[1]
            : base64String;
          resolve(base64);
        } catch {
          reject(new Error('Failed to parse base64 string'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to convert image to base64:', error);
    throw new Error('Failed to process image');
  }
}

/**
 * Get MIME type from file extension
 *
 * @param filename - Filename with extension
 * @returns MIME type string
 */
export function getMimeTypeFromFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg'; // Default fallback
  }
}
