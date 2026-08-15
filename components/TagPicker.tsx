/**
 * TagPicker Component
 *
 * A reusable component for selecting and managing tags.
 * Allows users to add custom tags or select from common suggestions.
 * Chips animate in/out and reflow with a layout transition, so adding or
 * removing a tag never snaps the surrounding form.
 *
 * Props:
 * - selectedTags: Array of currently selected tags
 * - onTagsChange: Callback when tags are added or removed
 * - maxTags: Maximum number of tags allowed (default: 10)
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import PressableScale from '@/components/ui/PressableScale';
import { LAYOUT } from '@/lib/motion';
import { BRAND, RADIUS, SPACE, TEXT, TYPE } from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';

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
  maxTags = 10,
}: TagPickerProps) {
  const c = useThemeColors();
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
    onTagsChange(selectedTags.filter((t) => t !== tag));
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
    (tag) => !selectedTags.includes(tag)
  );

  return (
    <View style={styles.container}>
      {/* Input Field */}
      <View
        style={[styles.inputContainer, { backgroundColor: c.field, borderColor: c.hairline }]}
      >
        <Ionicons name="pricetag-outline" size={20} color={c.decorative} />
        <TextInput
          style={[styles.input, { color: c.text }]}
          placeholder="Add a tag..."
          placeholderTextColor={c.textPlaceholder}
          value={inputValue}
          onChangeText={setInputValue}
          onSubmitEditing={handleSubmit}
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={30}
          accessibilityLabel="Add a tag"
        />
        {inputValue.length > 0 && (
          <PressableScale
            haptic="light"
            accessibilityLabel={`Add tag ${inputValue.trim().toLowerCase()}`}
            onPress={handleSubmit}
          >
            <Ionicons name="add-circle" size={24} color={c.textBrand} />
          </PressableScale>
        )}
      </View>

      {/* Selected Tags */}
      {selectedTags.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Selected Tags</Text>
          <View style={styles.tagsContainer}>
            {selectedTags.map((tag) => (
              <Animated.View key={tag} entering={FadeIn} exiting={FadeOut} layout={LAYOUT}>
                <PressableScale
                  haptic="selection"
                  accessibilityLabel={`Remove tag ${tag}`}
                  style={styles.selectedTag}
                  onPress={() => removeTag(tag)}
                >
                  <Text style={styles.selectedTagText}>#{tag}</Text>
                  <Ionicons name="close-circle" size={16} color={TEXT.inverse} />
                </PressableScale>
              </Animated.View>
            ))}
          </View>
        </View>
      )}

      {/* Suggested Tags */}
      {availableSuggestions.length > 0 && selectedTags.length < maxTags && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Suggested Tags</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestionsContainer}
          >
            {availableSuggestions.map((tag) => (
              <Animated.View key={tag} entering={FadeIn} exiting={FadeOut} layout={LAYOUT}>
                <PressableScale
                  haptic="selection"
                  accessibilityLabel={`Add tag ${tag}`}
                  style={[
                    styles.suggestedTag,
                    { backgroundColor: c.field, borderColor: c.hairline },
                  ]}
                  onPress={() => addTag(tag)}
                >
                  <Text style={[styles.suggestedTagText, { color: c.textSecondary }]}>#{tag}</Text>
                  {/* The "+" keeps the brand tint — it's the affordance that says
                      "tap to add", and it survives both grounds. */}
                  <Ionicons name="add" size={16} color={c.textBrand} />
                </PressableScale>
              </Animated.View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Tag Limit Info */}
      {selectedTags.length >= maxTags && (
        <Text style={[styles.limitText, { color: c.textTertiary }]}>
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
    gap: SPACE.sm,
    borderRadius: RADIUS.md,
    // Sub-pixel edge: on dark the field alone doesn't separate from the card,
    // and at hairline width it costs the layout nothing on light.
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    marginBottom: SPACE.base,
  },
  input: {
    flex: 1,
    ...TYPE.body,
    paddingVertical: SPACE.xs,
  },
  section: {
    marginBottom: SPACE.base,
  },
  sectionTitle: {
    ...TYPE.subhead,
    marginBottom: SPACE.sm,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
  },
  /* A selected tag is a brand fill — violet with white text in both appearances. */
  selectedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    backgroundColor: BRAND[600],
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
  },
  selectedTagText: {
    ...TYPE.subhead,
    color: TEXT.inverse,
  },
  suggestionsContainer: {
    flexDirection: 'row',
    gap: SPACE.sm,
    paddingRight: SPACE.base,
  },
  suggestedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  suggestedTagText: {
    ...TYPE.subhead,
  },
  limitText: {
    ...TYPE.caption,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: SPACE.sm,
  },
});
