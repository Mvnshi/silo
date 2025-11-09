/**
 * Calendar Screen
 * 
 * Displays scheduled content review sessions in a calendar view.
 * Users can see upcoming reviews, reschedule items, and create new
 * schedule blocks.
 * 
 * Features:
 * - Calendar view of scheduled items
 * - Upcoming events list
 * - Quick reschedule
 * - Integration with device calendar
 * 
 * Dependencies:
 * - expo-calendar: Device calendar integration
 * - date-fns: Date formatting and manipulation
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import ItemCard from '@/components/ItemCard';
import { Item } from '@/lib/types';
import { getItems } from '@/lib/storage';

export default function CalendarScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());

  /**
   * Load scheduled items from storage
   */
  async function loadItems() {
    try {
      const allItems = await getItems();
      // Filter items that have scheduled dates
      const scheduledItems = allItems.filter(
        item => item.scheduled_date && !item.archived
      );
      setItems(scheduledItems);
    } catch (error) {
      console.error('Failed to load items:', error);
      Alert.alert('Error', 'Failed to load scheduled items');
    }
  }

  // Load items when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [])
  );

  /**
   * Get items scheduled for a specific date
   */
  function getItemsForDate(date: Date): Item[] {
    return items.filter(item => {
      if (!item.scheduled_date) return false;
      const itemDate = new Date(item.scheduled_date);
      return isSameDay(itemDate, date);
    });
  }

  /**
   * Generate week dates for calendar header
   */
  function getWeekDates(): Date[] {
    const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }

  /**
   * Get upcoming scheduled items (next 7 days)
   */
  const upcomingItems = items
    .filter(item => {
      if (!item.scheduled_date) return false;
      const itemDate = new Date(item.scheduled_date);
      const now = new Date();
      const sevenDaysFromNow = addDays(now, 7);
      return itemDate >= now && itemDate <= sevenDaysFromNow;
    })
    .sort((a, b) => {
      const dateA = new Date(`${a.scheduled_date}T${a.scheduled_time || '00:00'}`);
      const dateB = new Date(`${b.scheduled_date}T${b.scheduled_time || '00:00'}`);
      return dateA.getTime() - dateB.getTime();
    });

  /**
   * Handle item press
   */
  function handleItemPress(itemId: string) {
    router.push(`/item/${itemId}`);
  }

  /**
   * Handle date selection
   */
  function handleDatePress(date: Date) {
    setSelectedDate(date);
  }

  const weekDates = getWeekDates();
  const selectedDateItems = getItemsForDate(selectedDate);

  return (
    <View style={styles.container}>
      {/* Week Calendar Header */}
      <View style={styles.calendarHeader}>
        <View style={styles.weekContainer}>
          {weekDates.map((date, index) => {
            const isSelected = isSameDay(date, selectedDate);
            const isToday = isSameDay(date, new Date());
            const itemCount = getItemsForDate(date).length;

            return (
              <TouchableOpacity
                key={index}
                style={[
                  styles.dayContainer,
                  isSelected && styles.dayContainerSelected,
                ]}
                onPress={() => handleDatePress(date)}
              >
                <Text
                  style={[
                    styles.dayLabel,
                    isSelected && styles.dayLabelSelected,
                  ]}
                >
                  {format(date, 'EEE')}
                </Text>
                <Text
                  style={[
                    styles.dayNumber,
                    isSelected && styles.dayNumberSelected,
                    isToday && !isSelected && styles.dayNumberToday,
                  ]}
                >
                  {format(date, 'd')}
                </Text>
                {itemCount > 0 && (
                  <View
                    style={[
                      styles.indicator,
                      isSelected && styles.indicatorSelected,
                    ]}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Selected Date Items */}
      <View style={styles.content}>
        <Text style={styles.sectionTitle}>
          {format(selectedDate, 'MMMM d, yyyy')}
        </Text>

        {selectedDateItems.length > 0 ? (
          <FlatList
            data={selectedDateItems}
            renderItem={({ item }) => (
              <ItemCard item={item} onPress={handleItemPress} />
            )}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="calendar-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No items scheduled</Text>
            <Text style={styles.emptySubtext}>
              Schedule items from the feed or add screen
            </Text>
          </View>
        )}
      </View>

      {/* Upcoming Section */}
      {upcomingItems.length > 0 && (
        <View style={styles.upcomingSection}>
          <Text style={styles.sectionTitle}>Upcoming This Week</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.upcomingList}
          >
            {upcomingItems.slice(0, 5).map(item => (
              <TouchableOpacity
                key={item.id}
                style={styles.upcomingCard}
                onPress={() => handleItemPress(item.id)}
              >
                <Text style={styles.upcomingTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={styles.upcomingMeta}>
                  <Ionicons name="calendar-outline" size={12} color="#666" />
                  <Text style={styles.upcomingDate}>
                    {format(new Date(item.scheduled_date!), 'MMM d')}
                  </Text>
                  {item.scheduled_time && (
                    <Text style={styles.upcomingTime}>
                      {item.scheduled_time}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  calendarHeader: {
    backgroundColor: '#fff',
    paddingVertical: 16,
  },
  weekContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
  },
  dayContainer: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  dayContainerSelected: {
    backgroundColor: '#007AFF',
  },
  dayLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  dayLabelSelected: {
    color: '#fff',
  },
  dayNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  dayNumberSelected: {
    color: '#fff',
  },
  dayNumberToday: {
    color: '#007AFF',
  },
  indicator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#007AFF',
    marginTop: 4,
  },
  indicatorSelected: {
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 16,
  },
  listContent: {
    paddingBottom: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
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
  upcomingSection: {
    backgroundColor: '#fff',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  upcomingList: {
    paddingHorizontal: 16,
  },
  upcomingCard: {
    width: 140,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
  },
  upcomingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    height: 40,
  },
  upcomingMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  upcomingDate: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
  },
  upcomingTime: {
    fontSize: 12,
    color: '#999',
    marginLeft: 8,
  },
});

