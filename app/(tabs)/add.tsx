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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import TagPicker from '@/components/TagPicker';
import { analyzeLink, analyzeImage, generateAudio, suggestScheduleTime } from '@/lib/api';
import { addItem } from '@/lib/storage';
import { Item, Classification } from '@/lib/types';
import { imageUriToBase64 } from '@/lib/screenshots';

export default function AddScreen() {
  const insets = useSafeAreaInsets();
  const [inputType, setInputType] = useState<'url' | 'note' | 'image' | 'instagram' | null>(null);
  const [url, setUrl] = useState('');
  const [noteText, setNoteText] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [classification, setClassification] = useState<Classification>('other');
  const [tags, setTags] = useState<string[]>([]);
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
      const analysis = await analyzeLink(url.trim());
      
      setTitle(analysis.title);
      setDescription(analysis.description || '');
      setClassification(analysis.classification);
      setTags(analysis.tags || []);
    } catch (error) {
      console.error('Failed to analyze URL:', error);
      Alert.alert('Error', 'Failed to analyze URL. Please try again.');
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
    if (!title.trim() && inputType !== 'instagram') {
      Alert.alert('Error', 'Please enter a title');
      return;
    }
    
    if (inputType === 'instagram' && !url.trim()) {
      Alert.alert('Error', 'Please enter an Instagram reel URL');
      return;
    }

    try {
      setLoading(true);

      // Create item
      const item: Item = {
        id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: inputType === 'url' || inputType === 'instagram' ? 'link' : inputType === 'image' ? 'screenshot' : 'note',
        classification: inputType === 'instagram' ? 'video' : classification,
        title: title.trim() || (inputType === 'instagram' ? 'Instagram Reel' : ''),
        description: description.trim() || undefined,
        url: (inputType === 'url' || inputType === 'instagram') ? url.trim() : undefined,
        imageUri: imageUri || undefined,
        tags,
        created_at: new Date().toISOString(),
        viewed: false,
        archived: false,
      };

      // Generate audio narration if description exists
      if (description.trim()) {
        try {
          const audioResponse = await generateAudio(description.trim(), item.id);
          item.audio_url = audioResponse.audioUrl;
        } catch (error) {
          console.error('Failed to generate audio:', error);
          // Continue without audio
        }
      }

      // Save item
      await addItem(item);

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
          },
        },
      ]);
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
      <ScrollView 
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 120 }
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

            <TouchableOpacity
              style={styles.typeButton}
              onPress={() => setInputType('instagram')}
            >
              <Ionicons name="logo-instagram" size={32} color="#007AFF" />
              <Text style={styles.typeButtonText}>Instagram Reel</Text>
              <Text style={styles.typeButtonSubtext}>Add Instagram reel link</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* URL Input */}
        {inputType === 'url' && (
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>URL</Text>
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
                <Text style={styles.analyzeButtonText}>Analyze with AI</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Instagram Reel Input */}
        {inputType === 'instagram' && (
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Instagram Reel URL</Text>
              <TextInput
                style={styles.input}
                placeholder="https://www.instagram.com/reel/DOE-opugX2H/"
                placeholderTextColor="#999"
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Text style={styles.helpText}>
                Paste an Instagram reel link. It will be embedded without AI processing.
              </Text>
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
        {(title || inputType === 'note' || inputType === 'instagram') && (
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
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
  },
  typeSelection: {
    gap: 16,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  typeButton: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
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
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  input: {
    backgroundColor: '#fff',
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
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
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

