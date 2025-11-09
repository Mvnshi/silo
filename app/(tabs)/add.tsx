/**
 * Add Content Screen
 * 
 * Main screen for adding new content to Silo. Supports multiple input methods:
 * - Paste or type URLs
 * - Take photos with camera
 * - Select images from gallery
 * - Create text notes
 * 
 * Features:
 * - AI analysis for links and images
 * - Manual classification editing
 * - Tag management
 * - Stack assignment
 * - Auto-schedule suggestions
 * 
 * Dependencies:
 * - expo-image-picker: Camera and gallery access
 * - lib/api: Backend AI analysis
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import TagPicker from '@/components/TagPicker';
import ChatBot from '@/components/ChatBot';
import { analyzeLink, analyzeImage, generateAudio, suggestScheduleTime, generateEmbedding } from '@/lib/api';
import { addItem, getUserId, updateItem } from '@/lib/storage';
import { scheduleItemReview } from '@/lib/scheduler';
import { Item, Classification } from '@/lib/types';
import { imageUriToBase64 } from '@/lib/screenshots';
import * as Location from 'expo-location';

export default function AddScreen() {
  const insets = useSafeAreaInsets();
  const [inputType, setInputType] = useState<'url' | 'note' | 'image' | null>(null);
  const [url, setUrl] = useState('');
  const [noteText, setNoteText] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [classification, setClassification] = useState<Classification>('other');
  const [tags, setTags] = useState<string[]>([]);
  const [script, setScript] = useState<string>(''); // AI-generated script for audio
  const [placeName, setPlaceName] = useState<string>(''); // Place name from AI
  const [placeAddress, setPlaceAddress] = useState<string>(''); // Place address from AI
  const [loading, setLoading] = useState(false);

  /**
   * Handle URL submission for analysis
   */
  async function handleAnalyzeUrl() {
    if (!url.trim()) {
      Alert.alert('Error', 'Please enter a URL');
      return;
    }

    try {
      setLoading(true);
      // Validate URL format before sending
      const urlToAnalyze = url.trim();
      try {
        new URL(urlToAnalyze);
      } catch {
        Alert.alert('Invalid URL', 'Please enter a valid URL (e.g., https://example.com)');
        setLoading(false);
        return;
      }

      const analysis = await analyzeLink(urlToAnalyze);
      
      setTitle(analysis.title);
      setDescription(analysis.description || '');
      setClassification(analysis.classification);
      setTags(analysis.tags || []);
      setScript(analysis.script || ''); // Store script for audio generation
      // Store place data if detected
      setPlaceName(analysis.place_name || '');
      setPlaceAddress(analysis.place_address || '');
    } catch (error) {
      console.error('Failed to analyze URL:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to analyze URL';
      Alert.alert('Error', errorMessage.includes('Invalid URL') 
        ? 'Please enter a valid URL (e.g., https://example.com)'
        : 'Failed to analyze URL. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Handle image selection from camera or gallery
   */
  async function handleSelectImage(source: 'camera' | 'gallery') {
    try {
      let result;

      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission Required', 'Camera access is needed to take photos');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.8,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission Required', 'Photo library access is needed');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets[0]) {
        setImageUri(result.assets[0].uri);
        setInputType('image');
        await analyzeSelectedImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Failed to select image:', error);
      Alert.alert('Error', 'Failed to select image');
    }
  }

  /**
   * Analyze selected image with AI
   */
  async function analyzeSelectedImage(uri: string) {
    try {
      setLoading(true);
      const base64 = await imageUriToBase64(uri);
      const analysis = await analyzeImage(base64, 'image/jpeg');
      
      setTitle(analysis.title);
      setDescription(analysis.description || '');
      setClassification(analysis.classification);
      setTags(analysis.tags || []);
      setScript(analysis.script || ''); // Store script for audio generation
    } catch (error) {
      console.error('Failed to analyze image:', error);
      Alert.alert('Error', 'Failed to analyze image. Please enter details manually.');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Save the item to storage
   */
  async function handleSave() {
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a title');
      return;
    }

    try {
      setLoading(true);

      // Create item
      const item: Item = {
        id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: inputType === 'url' ? 'link' : inputType === 'image' ? 'screenshot' : 'note',
        classification: classification,
        title: title.trim(),
        description: description.trim() || undefined,
        url: inputType === 'url' ? url.trim() : undefined,
        imageUri: imageUri || undefined,
        script: script.trim() || undefined, // Store AI-generated script
        tags,
        // Include location data if detected by AI or if classification is 'place'
        place_name: placeName.trim() || (classification === 'place' ? title.trim() : undefined),
        place_address: placeAddress.trim() || (classification === 'place' ? description.trim() : undefined),
        created_at: new Date().toISOString(),
        viewed: false,
        archived: false,
      };

      // Generate audio narration using script (from AI analysis) or fallback to description
      const audioText = script.trim() || description.trim();
      if (audioText) {
        try {
          const audioResponse = await generateAudio(audioText, item.id);
          item.audio_url = audioResponse.audioUrl;
        } catch (error) {
          // Silently fail - audio is optional
          console.warn('Audio generation skipped (optional feature):', error instanceof Error ? error.message : error);
        }
      }

      // Save item
      await addItem(item);

      // If it's a place with address but no coordinates, geocode it
      if ((item.place_name || item.place_address) && !item.place_latitude && !item.place_longitude) {
        try {
          const addressToGeocode = item.place_address || item.place_name || '';
          if (addressToGeocode) {
            const geocoded = await Location.geocodeAsync(addressToGeocode);
            if (geocoded && geocoded.length > 0) {
              const { latitude, longitude } = geocoded[0];
              // Update item with coordinates
              await updateItem(item.id, {
                place_latitude: latitude,
                place_longitude: longitude,
              });
              console.log(`📍 Geocoded ${addressToGeocode}: ${latitude}, ${longitude}`);
            }
          }
        } catch (error) {
          console.warn('Failed to geocode address (continuing without coordinates):', error);
          // Don't show error - geocoding is optional
        }
      }

      // Generate embedding for RAG (async, don't wait - optional feature)
      try {
        const userId = await getUserId();
        generateEmbedding({
          userId,
          itemId: item.id,
          title: item.title,
          description: item.description,
          tags: item.tags,
        }).catch(error => {
          // Silently fail - embedding is optional (quota limits on free tier)
          console.warn('Embedding generation skipped (optional feature):', error instanceof Error ? error.message : error);
        });
      } catch (error) {
        // Silently fail - embedding is optional
        console.warn('Embedding generation skipped (optional feature):', error instanceof Error ? error.message : error);
      }

      // Suggest scheduling (like screenshots tab)
      try {
        const suggestion = await suggestScheduleTime({
          title: item.title,
          classification: item.classification || 'other',
          description: item.description,
          duration: item.duration,
        });
        
        // Show alert with suggestion
        Alert.alert(
          'Schedule this item?',
          `${suggestion.reason}\n\nDate: ${suggestion.date}\nTime: ${suggestion.time}`,
          [
            {
              text: 'No thanks',
              style: 'cancel',
              onPress: () => {
                // Reset form
                setInputType(null);
                setUrl('');
                setNoteText('');
                setImageUri(null);
                setTitle('');
                setDescription('');
                setClassification('other');
                setTags([]);
                setScript('');
                setPlaceName('');
                setPlaceAddress('');
              },
            },
            {
              text: 'Add to Calendar',
              onPress: async () => {
                try {
                  await scheduleItemReview(item, suggestion.date, suggestion.time, item.duration || 15);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert('Success', 'Event added to calendar', [
                    {
                      text: 'OK',
                      onPress: () => {
                        // Reset form
                        setInputType(null);
                        setUrl('');
                        setNoteText('');
                        setImageUri(null);
                        setTitle('');
                        setDescription('');
                        setClassification('other');
                        setTags([]);
                        setScript('');
                        setPlaceName('');
                        setPlaceAddress('');
                      },
                    },
                  ]);
                } catch (error) {
                  console.error('Failed to schedule event:', error);
                  Alert.alert('Error', 'Failed to add event to calendar', [
                    {
                      text: 'OK',
                      onPress: () => {
                        // Reset form
                        setInputType(null);
                        setUrl('');
                        setNoteText('');
                        setImageUri(null);
                        setTitle('');
                        setDescription('');
                        setClassification('other');
                        setTags([]);
                        setScript('');
                        setPlaceName('');
                        setPlaceAddress('');
                      },
                    },
                  ]);
                }
              },
            },
          ]
        );
      } catch (error) {
        console.warn('Failed to suggest schedule (continuing without suggestion):', error);
        // Don't show error - schedule suggestion is optional
        Alert.alert('Success', 'Item added successfully', [
          {
            text: 'OK',
            onPress: () => {
              // Reset form
              setInputType(null);
              setUrl('');
              setNoteText('');
              setImageUri(null);
              setTitle('');
              setDescription('');
              setClassification('other');
              setTags([]);
              setScript('');
              setPlaceName('');
              setPlaceAddress('');
            },
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to save item:', error);
      Alert.alert('Error', 'Failed to save item');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Gradient Background */}
      <LinearGradient
        colors={['#B4F5E8', '#D7FFF5', '#F0FFF9']}
        style={StyleSheet.absoluteFill}
      />
      <ChatBot onClose={() => {}} />
      <ScrollView 
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, 4), paddingBottom: insets.bottom + 120 }
        ]}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Input Type Selection */}
        {!inputType && (
          <View style={styles.typeSelection}>
            <Text style={styles.sectionTitle}>Add Content</Text>
            
            <TouchableOpacity
              style={styles.typeButton}
              onPress={() => setInputType('url')}
            >
              <Ionicons name="link" size={32} color="#007AFF" />
              <Text style={styles.typeButtonText}>Link</Text>
              <Text style={styles.typeButtonSubtext}>Add a URL</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.typeButton}
              onPress={() => handleSelectImage('camera')}
            >
              <Ionicons name="camera" size={32} color="#007AFF" />
              <Text style={styles.typeButtonText}>Camera</Text>
              <Text style={styles.typeButtonSubtext}>Take a photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.typeButton}
              onPress={() => handleSelectImage('gallery')}
            >
              <Ionicons name="images" size={32} color="#007AFF" />
              <Text style={styles.typeButtonText}>Gallery</Text>
              <Text style={styles.typeButtonSubtext}>Choose from photos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.typeButton}
              onPress={() => setInputType('note')}
            >
              <Ionicons name="create" size={32} color="#007AFF" />
              <Text style={styles.typeButtonText}>Note</Text>
              <Text style={styles.typeButtonSubtext}>Write a text note</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* URL Input */}
        {inputType === 'url' && (
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <View style={styles.urlHeader}>
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => {
                    setInputType(null);
                    setUrl('');
                    setTitle('');
                    setDescription('');
                    setClassification('other');
                    setTags([]);
                    setScript('');
                    setPlaceName('');
                    setPlaceAddress('');
                  }}
                >
                  <Ionicons name="arrow-back" size={24} color="#333" />
                </TouchableOpacity>
                <Text style={styles.label}>URL</Text>
              </View>
              <TextInput
                style={styles.input}
                placeholder="https://example.com"
                placeholderTextColor="#999"
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <TouchableOpacity
                style={styles.analyzeButton}
                onPress={handleAnalyzeUrl}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.analyzeButtonText}>Analyze with AI</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Note Input */}
        {inputType === 'note' && (
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Note</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Write your note..."
                placeholderTextColor="#999"
                value={noteText}
                onChangeText={text => {
                  setNoteText(text);
                  setDescription(text);
                }}
                multiline
                numberOfLines={5}
              />
            </View>
          </View>
        )}

        {/* Common Fields (shown after analysis or for manual entry) */}
        {(title || inputType === 'note') && (
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="Item title"
                placeholderTextColor="#999"
                value={title}
                onChangeText={setTitle}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Add a description..."
                placeholderTextColor="#999"
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Classification</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {['article', 'video', 'recipe', 'product', 'event', 'place', 'idea', 'fitness', 'food', 'career', 'academia', 'other'].map(type => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.classificationChip,
                      classification === type && styles.classificationChipActive,
                    ]}
                    onPress={() => setClassification(type as Classification)}
                  >
                    <Text
                      style={[
                        styles.classificationChipText,
                        classification === type && styles.classificationChipTextActive,
                      ]}
                    >
                      {type}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Tags</Text>
              <TagPicker selectedTags={tags} onTagsChange={setTags} />
            </View>

            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSave}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Save Item</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setInputType(null)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading && !title && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Analyzing with AI...</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingTop: 0,
  },
  typeSelection: {
    gap: 16,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
    marginTop: 0,
  },
  typeButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  typeButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginTop: 12,
  },
  typeButtonSubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
  },
  helpText: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
    fontStyle: 'italic',
  },
  form: {
    gap: 20,
  },
  inputGroup: {
    gap: 8,
  },
  urlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  backButton: {
    padding: 4,
    marginLeft: -4,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#333',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  analyzeButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  analyzeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  classificationChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  classificationChipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  classificationChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    textTransform: 'capitalize',
  },
  classificationChipTextActive: {
    color: '#fff',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  cancelButton: {
    padding: 16,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
});

