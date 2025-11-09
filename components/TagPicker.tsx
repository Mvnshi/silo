/**
 * TagPicker Component
 * 
 * A reusable component for selecting and managing tags.
 * Allows users to add custom tags or select from common suggestions.
 * 
 * Props:
 * - selectedTags: Array of currently selected tags
 * - onTagsChange: Callback when tags are added or removed
 * - maxTags: Maximum number of tags allowed (default: 10)
 * 
 * Dependencies:
 * - React Native core components
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface TagPickerProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  maxTags?: number;
}

/**
 * Common tag suggestions for quick selection
 */
const SUGGESTED_TAGS = [
  'work',
  'personal',
  'urgent',
  'ideas',
  'reading',
  'learning',
  'recipes',
  'shopping',
  'travel',
  'health',
  'finance',
  'entertainment',
  'diy',
  'inspiration',
];

export default function TagPicker({ 
  selectedTags, 
  onTagsChange, 
  maxTags = 10 
}: TagPickerProps) {
  const [inputValue, setInputValue] = useState('');

  /**
   * Add a tag to the selected list
   */
  function addTag(tag: string) {
    const trimmedTag = tag.trim().toLowerCase();
    
    // Validate tag
    if (!trimmedTag) return;
    if (selectedTags.includes(trimmedTag)) return;
    if (selectedTags.length >= maxTags) return;
    
    onTagsChange([...selectedTags, trimmedTag]);
    setInputValue('');
  }

  /**
   * Remove a tag from the selected list
   */
  function removeTag(tag: string) {
    onTagsChange(selectedTags.filter(t => t !== tag));
  }

  /**
   * Handle input submission
   */
  function handleSubmit() {
    addTag(inputValue);
  }

  /**
   * Get suggested tags that aren't already selected
   */
  const availableSuggestions = SUGGESTED_TAGS.filter(
    tag => !selectedTags.includes(tag)
  );

  return (
    <View style={styles.container}>
      {/* Input Field */}
      <View style={styles.inputContainer}>
        <Ionicons name="pricetag-outline" size={20} color="#666" />
        <TextInput
          style={styles.input}
          placeholder="Add a tag..."
          placeholderTextColor="#999"
          value={inputValue}
          onChangeText={setInputValue}
          onSubmitEditing={handleSubmit}
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={30}
        />
        {inputValue.length > 0 && (
          <TouchableOpacity onPress={handleSubmit}>
            <Ionicons name="add-circle" size={24} color="#007AFF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Selected Tags */}
      {selectedTags.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Selected Tags</Text>
          <View style={styles.tagsContainer}>
            {selectedTags.map((tag, index) => (
              <TouchableOpacity
                key={index}
                style={styles.selectedTag}
                onPress={() => removeTag(tag)}
              >
                <Text style={styles.selectedTagText}>#{tag}</Text>
                <Ionicons name="close-circle" size={16} color="#fff" />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Suggested Tags */}
      {availableSuggestions.length > 0 && selectedTags.length < maxTags && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Suggested Tags</Text>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestionsContainer}
          >
            {availableSuggestions.map((tag, index) => (
              <TouchableOpacity
                key={index}
                style={styles.suggestedTag}
                onPress={() => addTag(tag)}
              >
                <Text style={styles.suggestedTagText}>#{tag}</Text>
                <Ionicons name="add" size={16} color="#007AFF" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Tag Limit Info */}
      {selectedTags.length >= maxTags && (
        <Text style={styles.limitText}>
          Maximum {maxTags} tags reached
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    marginLeft: 8,
    paddingVertical: 4,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  selectedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  selectedTagText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 4,
  },
  suggestionsContainer: {
    paddingRight: 16,
  },
  suggestedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  suggestedTagText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 4,
  },
  limitText: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
  },
});

