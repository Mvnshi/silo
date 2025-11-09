/**
 * Screenshot Detection Module
 * 
 * This module monitors the device's photo library for new screenshots
 * and allows the user to import them into Silo for analysis and organization.
 * 
 * Features:
 * - Request media library permissions
 * - Detect new screenshots
 * - Get screenshot metadata
 * - Convert screenshots to base64 for AI analysis
 * 
 * Dependencies:
 * - expo-media-library: Access to device photos
 * - expo-file-system: File operations
 */

import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
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
 * Request media library permissions
 * 
 * @returns true if permission granted, false otherwise
 */
export async function requestMediaLibraryPermissions(): Promise<boolean> {
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('Failed to request media library permissions:', error);
    return false;
  }
}

/**
 * Detect if an asset is a screenshot based on filename patterns
 * 
 * @param filename - Asset filename
 * @returns true if filename matches screenshot pattern
 */
function isScreenshot(filename: string): boolean {
  const lowerFilename = filename.toLowerCase();
  
  // iOS screenshot patterns
  if (Platform.OS === 'ios') {
    return lowerFilename.startsWith('img_') || 
           lowerFilename.includes('screenshot');
  }
  
  // Android screenshot patterns
  if (Platform.OS === 'android') {
    return lowerFilename.includes('screenshot') ||
           lowerFilename.includes('screen_') ||
           lowerFilename.startsWith('scr_');
  }
  
  return false;
}

/**
 * Get recent screenshots from the device
 * 
 * @param limit - Maximum number of screenshots to retrieve (default: 20)
 * @returns Array of screenshot objects
 */
export async function getRecentScreenshots(limit: number = 20): Promise<Screenshot[]> {
  try {
    // Check permissions
    const hasPermission = await requestMediaLibraryPermissions();
    if (!hasPermission) {
      throw new Error('Media library permission not granted');
    }

    // Get recent photos
    const albumAssets = await MediaLibrary.getAssetsAsync({
      mediaType: 'photo',
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      first: 100, // Get more than needed to filter screenshots
    });

    // Filter screenshots
    const screenshots: Screenshot[] = [];
    
    for (const asset of albumAssets.assets) {
      if (isScreenshot(asset.filename) && screenshots.length < limit) {
        screenshots.push({
          id: asset.id,
          uri: asset.uri,
          filename: asset.filename,
          creationTime: asset.creationTime,
          width: asset.width,
          height: asset.height,
          mimeType: 'image/jpeg', // Default to JPEG
        });
      }
    }

    return screenshots;
  } catch (error) {
    console.error('Failed to get recent screenshots:', error);
    return [];
  }
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
        } catch (error) {
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

/**
 * Get new screenshots since a given timestamp
 * 
 * @param lastCheckTime - Unix timestamp of last check
 * @returns Array of new screenshots
 */
export async function getNewScreenshotsSince(lastCheckTime: number): Promise<Screenshot[]> {
  try {
    const allScreenshots = await getRecentScreenshots(50);
    return allScreenshots.filter(screenshot => screenshot.creationTime > lastCheckTime);
  } catch (error) {
    console.error('Failed to get new screenshots:', error);
    return [];
  }
}

/**
 * Delete a screenshot from the device
 * 
 * @param assetId - Media library asset ID
 * @returns true if successful, false otherwise
 */
export async function deleteScreenshot(assetId: string): Promise<boolean> {
  try {
    const hasPermission = await requestMediaLibraryPermissions();
    if (!hasPermission) {
      return false;
    }

    await MediaLibrary.deleteAssetsAsync([assetId]);
    return true;
  } catch (error) {
    console.error('Failed to delete screenshot:', error);
    return false;
  }
}

