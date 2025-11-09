/**
 * Floating ChatBot Component
 * 
 * A floating chatbot that uses RAG to answer questions about saved content
 * and can suggest calendar events.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ragQuery } from '@/lib/api';
import { getUserId, getItems } from '@/lib/storage';
import { scheduleItemReview } from '@/lib/scheduler';
import { addItem } from '@/lib/storage';
import { Item } from '@/lib/types';
import { format } from 'date-fns';
import { Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  suggestedEvent?: {
    title: string;
    date: string;
    time: string;
    description: string;
  };
}

interface ChatBotProps {
  onClose: () => void;
  onEventSuggested?: (event: { title: string; date: string; time: string; description: string }) => void;
}

export default function ChatBot({ onClose, onEventSuggested }: ChatBotProps) {
  const insets = useSafeAreaInsets();
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      text: "Hey! I'm Silo, your personal AI assistant. I can help you discover your saved content and suggest activities based on your interests! Try asking me:\n\n• \"I don't know what to do\" - I'll suggest activities\n• \"What fitness content do I have?\" - I'll show your saved workouts\n• \"Suggest something for this weekend\" - I'll recommend events to schedule\n\nWhat interests you? (fitness, food, tech, career, outdoor, places, etc.)",
      isUser: false,
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const slideAnim = useRef(new Animated.Value(0)).current; // Scale from 0 to 1
  const opacityAnim = useRef(new Animated.Value(0)).current; // Opacity animation

  useEffect(() => {
    if (isExpanded) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 50,
          friction: 7,
        }),
        Animated.spring(opacityAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 50,
          friction: 7,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 50,
          friction: 7,
        }),
        Animated.spring(opacityAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 50,
          friction: 7,
        }),
      ]).start();
    }
  }, [isExpanded]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  /**
   * Handle send message
   */
  async function handleSend() {
    if (!inputText.trim() || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: inputText.trim(),
      isUser: true,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const userId = await getUserId();
      // Get all items for fallback when embeddings fail
      const allItems = await getItems();
      
      // Always suggest events - make chatbot proactive
      const response = await ragQuery({
        userId,
        query: userMessage.text,
        suggestEvent: true, // Always suggest events if relevant
        items: allItems.slice(0, 30).map(item => ({
          id: item.id,
          title: item.title,
          description: item.description,
          tags: item.tags,
          classification: item.classification, // Include classification for better suggestions
        })), // Send items for fallback
      });

      const botMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: response.answer,
        isUser: false,
        timestamp: new Date(),
        suggestedEvent: response.suggestedEvent,
      };

      setMessages(prev => [...prev, botMessage]);

      // If event was suggested, notify parent
      if (response.suggestedEvent && onEventSuggested) {
        onEventSuggested(response.suggestedEvent);
      }
    } catch (error) {
      console.error('RAG query error:', error);
      // Handle RAG errors gracefully
      const errorMessage = error instanceof Error ? error.message : 'Failed to process query';
      const botMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: errorMessage.includes('quota') || errorMessage.includes('unavailable')
          ? "I'm temporarily unavailable due to API quota limits. Please try again later, or you can still use the app to save and organize your content!"
          : "I'm having trouble processing that right now. Please try again or ask something else!",
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMessage]);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Handle event suggestion acceptance
   */
  async function handleAcceptEvent(event: { title: string; date: string; time: string; description: string }) {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Create item for the event
      const eventItem: Item = {
        id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'note',
        classification: 'event',
        title: event.title,
        description: event.description,
        scheduled_date: event.date,
        scheduled_time: event.time,
        tags: ['ai-suggested', 'event'],
        created_at: new Date().toISOString(),
        viewed: false,
        archived: false,
      };

      await addItem(eventItem);
      await scheduleItemReview(eventItem, event.date, event.time, 30);

      // Add confirmation message
      const confirmMessage: ChatMessage = {
        id: (Date.now() + 2).toString(),
        text: `✅ Event "${event.title}" added to your calendar!`,
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, confirmMessage]);
    } catch (error) {
      console.error('Failed to add event:', error);
      Alert.alert('Error', 'Failed to add event to calendar');
    }
  }

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {/* Floating Button */}
      {!isExpanded && (
        <TouchableOpacity
          style={styles.floatingButton}
          onPress={() => {
            setIsExpanded(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="chatbubbles" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Expanded Chat */}
      {isExpanded && (
        <View style={styles.backdrop} pointerEvents="box-none">
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => {
              setIsExpanded(false);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          />
        </View>
      )}
      <KeyboardAvoidingView
        style={[styles.keyboardAvoidingContainer, { top: insets.top + 20 }]}
        behavior={Platform.OS === 'ios' ? 'position' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? -SCREEN_HEIGHT * 0.2 : -100}
        pointerEvents={isExpanded ? 'box-none' : 'none'}
      >
        <Animated.View
          style={[
            styles.chatContainer,
            {
              transform: [
                { scale: slideAnim },
                { translateY: slideAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0], // Slight upward movement
                })}
              ],
              opacity: opacityAnim,
            },
          ]}
          pointerEvents={isExpanded ? 'auto' : 'none'}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.avatar}>
                <Ionicons name="sparkles" size={24} color="#007AFF" />
              </View>
              <View>
                <Text style={styles.headerTitle}>AI Assistant</Text>
                <Text style={styles.headerSubtitle}>Your personal RAG model</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => {
                setIsExpanded(false);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          {/* Messages */}
          <ScrollView
            ref={scrollViewRef}
            style={styles.messagesContainer}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            nestedScrollEnabled={true}
          >
            {messages.map((message) => (
              <View key={message.id}>
                <View
                  style={[
                    styles.message,
                    message.isUser ? styles.userMessage : styles.botMessage,
                  ]}
                >
                  <Text
                    style={[
                      styles.messageText,
                      message.isUser ? styles.userMessageText : styles.botMessageText,
                    ]}
                  >
                    {message.text}
                  </Text>
                </View>

                {/* Event Suggestion */}
                {message.suggestedEvent && (
                  <View style={styles.eventSuggestion}>
                    <View style={styles.eventSuggestionHeader}>
                      <Ionicons name="calendar" size={20} color="#007AFF" />
                      <Text style={styles.eventSuggestionTitle}>Suggested Event</Text>
                    </View>
                    <Text style={styles.eventSuggestionName}>{message.suggestedEvent.title}</Text>
                    <Text style={styles.eventSuggestionDetails}>
                      {format(new Date(message.suggestedEvent.date), 'MMM d, yyyy')} at {message.suggestedEvent.time}
                    </Text>
                    <Text style={styles.eventSuggestionDesc}>{message.suggestedEvent.description}</Text>
                    <TouchableOpacity
                      style={styles.acceptEventButton}
                      onPress={() => handleAcceptEvent(message.suggestedEvent!)}
                    >
                      <Ionicons name="checkmark-circle" size={20} color="#fff" />
                      <Text style={styles.acceptEventText}>Add to Calendar</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}

            {loading && (
              <View style={styles.botMessage}>
                <ActivityIndicator size="small" color="#007AFF" />
              </View>
            )}
          </ScrollView>

          {/* Input */}
          <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 4) }]}>
            <TextInput
              style={styles.input}
              placeholder="Ask about your saved content..."
              placeholderTextColor="#999"
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={500}
              onSubmitEditing={handleSend}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[styles.sendButton, (!inputText.trim() || loading) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!inputText.trim() || loading}
            >
              <Ionicons
                name="send"
                size={20}
                color={inputText.trim() && !loading ? '#fff' : '#999'}
              />
            </TouchableOpacity>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    pointerEvents: 'box-none',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 998,
  },
  floatingButton: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 1000,
  },
  keyboardAvoidingContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    maxHeight: SCREEN_HEIGHT * 0.55, // Reduced to match container
    zIndex: 999,
  },
  chatContainer: {
    height: SCREEN_HEIGHT * 0.55, // Reduced height to be more compact
    maxHeight: SCREEN_HEIGHT * 0.55, // Ensure it doesn't exceed
    backgroundColor: '#fff',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
  },
  messagesContainer: {
    flex: 1,
    maxHeight: SCREEN_HEIGHT * 0.4, // Limit messages area height - leaves room for header and input
  },
  messagesContent: {
    padding: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  message: {
    maxWidth: '80%',
    padding: 10,
    borderRadius: 16,
    marginBottom: 8,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF',
  },
  botMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#f0f0f0',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userMessageText: {
    color: '#fff',
  },
  botMessageText: {
    color: '#333',
  },
  eventSuggestion: {
    backgroundColor: '#E3F2FD',
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#BBDEFB',
  },
  eventSuggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  eventSuggestionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
    textTransform: 'uppercase',
  },
  eventSuggestionName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  eventSuggestionDetails: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  eventSuggestionDesc: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    lineHeight: 20,
  },
  acceptEventButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  acceptEventText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: 2, // Reduced padding
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#fff',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#333',
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#e0e0e0',
  },
});

