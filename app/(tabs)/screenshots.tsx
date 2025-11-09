/**
 * Screenshots Screen
 * 
 * Displays recent screenshots from the device's photo library for quick
 * import and analysis. Users can select screenshots to analyze with AI
 * and add to their Silo.
 * 
 * Features:
 * - Grid view of recent screenshots
 * - Select multiple screenshots
 * - Batch import and AI analysis
 * - Delete screenshots after import
 * 
 * Dependencies:
 * - expo-media-library: Photo library access
 * - expo-image-picker: Image selection
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getRecentScreenshots,
  imageUriToBase64,
  getMimeTypeFromFilename,
  Screenshot,
} from '@/lib/screenshots';
import { analyzeImage, generateAudio } from '@/lib/api';
import { addItem } from '@/lib/storage';
import { Item } from '@/lib/types';

export default function ScreenshotsScreen() {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  /**
   * Load recent screenshots from device
   */
  async function loadScreenshots() {
    try {
      setLoading(true);
      const recentScreenshots = await getRecentScreenshots(30);
      setScreenshots(recentScreenshots);
    } catch (error) {
      console.error('Failed to load screenshots:', error);
      Alert.alert('Error', 'Failed to load screenshots. Please check permissions.');
    } finally {
      setLoading(false);
    }
  }

  // Load screenshots when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadScreenshots();
    }, [])
  );

  /**
   * Toggle screenshot selection
   */
  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }

  /**
   * Import selected screenshots
   */
  async function handleImport() {
    if (selectedIds.size === 0) {
      Alert.alert('No Selection', 'Please select screenshots to import');
      return;
    }

    try {
      setLoading(true);

      const selectedScreenshots = screenshots.filter(s => selectedIds.has(s.id));

      Alert.alert(
        'Import Screenshots',
        `Import ${selectedScreenshots.length} screenshot(s)?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import',
            onPress: async () => {
              for (const screenshot of selectedScreenshots) {
                await importScreenshot(screenshot);
              }

              Alert.alert('Success', 'Screenshots imported successfully');
              setSelectedIds(new Set());
              await loadScreenshots();
            },
          },
        ]
      );
    } catch (error) {
      console.error('Failed to import screenshots:', error);
      Alert.alert('Error', 'Failed to import screenshots');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Import a single screenshot with AI analysis
   */
  async function importScreenshot(screenshot: Screenshot) {
    try {
      // Convert to base64
      const base64 = await imageUriToBase64(screenshot.uri);
      const mimeType = getMimeTypeFromFilename(screenshot.filename);

      // Analyze with backend API
      const analysis = await analyzeImage(base64, mimeType);

      // Create item
      const item: Item = {
        id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'screenshot',
        classification: analysis.classification,
        title: analysis.title,
        description: analysis.description,
        imageUri: screenshot.uri,
        script: analysis.script,
        tags: analysis.tags || [],
        duration: analysis.duration,
        place_name: analysis.place_name,
        place_address: analysis.place_address,
        created_at: new Date().toISOString(),
        viewed: false,
        archived: false,
      };

      // Generate audio if script is available
      if (analysis.script) {
        try {
          const audioResponse = await generateAudio(analysis.script, item.id);
          item.audio_url = audioResponse.audioUrl;
        } catch (error) {
          console.error('Failed to generate audio:', error);
          // Continue without audio
        }
      }

      // Save item
      await addItem(item);
    } catch (error) {
      console.error('Failed to import screenshot:', error);
      throw error;
    }
  }

  /**
   * Render screenshot item
   */
  function renderScreenshot({ item }: { item: Screenshot }) {
    const isSelected = selectedIds.has(item.id);

    return (
      <TouchableOpacity
        style={styles.screenshotContainer}
        onPress={() => toggleSelection(item.id)}
        activeOpacity={0.8}
      >
        <Image source={{ uri: item.uri }} style={styles.screenshot} />
        
        {/* Selection Overlay */}
        {isSelected && (
          <View style={styles.selectionOverlay}>
            <View style={styles.checkmark}>
              <Ionicons name="checkmark" size={20} color="#fff" />
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {selectedIds.size > 0 
            ? `${selectedIds.size} selected` 
            : 'Recent Screenshots'}
        </Text>
        
        {selectedIds.size > 0 && (
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => setSelectedIds(new Set())}
            >
              <Text style={styles.clearButtonText}>Clear</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.importButton}
              onPress={handleImport}
              disabled={loading}
            >
              <Text style={styles.importButtonText}>Import</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Screenshots Grid */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading screenshots...</Text>
        </View>
      ) : screenshots.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="images-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>No screenshots found</Text>
          <Text style={styles.emptySubtext}>
            Take screenshots to import them here
          </Text>
        </View>
      ) : (
        <FlatList
          data={screenshots}
          renderItem={renderScreenshot}
          keyExtractor={item => item.id}
          numColumns={3}
          contentContainerStyle={styles.grid}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  clearButtonText: {
    fontSize: 16,
    color: '#007AFF',
  },
  importButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
  },
  importButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  grid: {
    padding: 2,
  },
  screenshotContainer: {
    flex: 1,
    margin: 2,
    aspectRatio: 0.75,
    position: 'relative',
  },
  screenshot: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e0e0e0',
  },
  selectionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 122, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
});

