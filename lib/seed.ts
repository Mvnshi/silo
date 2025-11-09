/**
 * Seed Data Module
 * 
 * This module provides example content for testing and demonstration purposes.
 * It includes sample items and stacks that showcase all features of the app.
 * 
 * Usage:
 * - Call seedData() to populate the app with example content
 * - Useful for development, testing, and first-time user onboarding
 * 
 * Dependencies:
 * - lib/storage: For saving seed data
 */

import { Item, Stack } from './types';
import { saveItems, saveStacks } from './storage';

/**
 * Sample stacks for demonstration
 */
const SAMPLE_STACKS: Stack[] = [
  {
    id: 'stack_1',
    name: 'Weekend Reading',
    description: 'Articles to read over the weekend',
    color: '#FF6B6B',
    icon: 'book',
    item_count: 3,
    created_at: new Date().toISOString(),
  },
  {
    id: 'stack_2',
    name: 'Recipe Collection',
    description: 'Recipes to try',
    color: '#4ECDC4',
    icon: 'restaurant',
    item_count: 2,
    created_at: new Date().toISOString(),
  },
  {
    id: 'stack_3',
    name: 'Gift Ideas',
    description: 'Products for upcoming birthdays',
    color: '#95E1D3',
    icon: 'gift',
    item_count: 1,
    created_at: new Date().toISOString(),
  },
];

/**
 * Sample items for demonstration
 */
const SAMPLE_ITEMS: Item[] = [
  {
    id: 'item_1',
    type: 'link',
    classification: 'article',
    title: 'The Future of Mobile Development',
    description: 'An in-depth look at React Native and cross-platform development trends for 2025.',
    url: 'https://example.com/mobile-dev-future',
    tags: ['technology', 'mobile', 'programming'],
    stack_id: 'stack_1',
    scheduled_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    scheduled_time: '09:00',
    duration: 10,
    created_at: new Date().toISOString(),
    viewed: false,
    archived: false,
    script: 'Check out this fascinating article about the future of mobile development and React Native trends.',
  },
  {
    id: 'item_2',
    type: 'screenshot',
    classification: 'recipe',
    title: 'Homemade Pizza Recipe',
    description: 'A simple recipe for making authentic Italian pizza at home with just a few ingredients.',
    tags: ['cooking', 'italian', 'dinner'],
    stack_id: 'stack_2',
    duration: 45,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    viewed: false,
    archived: false,
    script: 'This homemade pizza recipe looks amazing and is surprisingly easy to make.',
  },
  {
    id: 'item_3',
    type: 'link',
    classification: 'video',
    title: 'Building Productive Habits',
    description: 'A 15-minute video on establishing and maintaining productive daily habits.',
    url: 'https://example.com/productive-habits',
    tags: ['productivity', 'self-improvement', 'habits'],
    scheduled_date: new Date(Date.now() + 172800000).toISOString().split('T')[0],
    scheduled_time: '19:00',
    duration: 15,
    created_at: new Date(Date.now() - 7200000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Learn how to build productive habits that actually stick in this short video.',
  },
  {
    id: 'item_4',
    type: 'note',
    classification: 'idea',
    title: 'App Feature Ideas',
    description: 'Brainstorming session notes for potential new features: dark mode, export function, and sharing capabilities.',
    tags: ['ideas', 'brainstorming', 'features'],
    duration: 5,
    created_at: new Date(Date.now() - 10800000).toISOString(),
    viewed: true,
    archived: false,
  },
  {
    id: 'item_5',
    type: 'link',
    classification: 'product',
    title: 'Wireless Noise-Canceling Headphones',
    description: 'Premium headphones with active noise cancellation and 30-hour battery life.',
    url: 'https://example.com/headphones',
    tags: ['shopping', 'electronics', 'audio'],
    stack_id: 'stack_3',
    duration: 5,
    created_at: new Date(Date.now() - 14400000).toISOString(),
    viewed: false,
    archived: false,
    script: 'These wireless headphones have great reviews and would make a perfect gift.',
  },
  {
    id: 'item_6',
    type: 'screenshot',
    classification: 'event',
    title: 'Concert: The Midnight',
    description: 'Upcoming concert on Saturday, March 15th at 8 PM. Tickets available online.',
    tags: ['music', 'concert', 'entertainment'],
    scheduled_date: '2025-03-13',
    scheduled_time: '18:00',
    duration: 10,
    created_at: new Date(Date.now() - 18000000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Don\'t forget about The Midnight concert this Saturday evening!',
  },
  {
    id: 'item_7',
    type: 'link',
    classification: 'recipe',
    title: 'Thai Green Curry',
    description: 'Authentic Thai green curry recipe with coconut milk and fresh vegetables.',
    url: 'https://example.com/thai-curry',
    tags: ['cooking', 'thai', 'curry', 'dinner'],
    stack_id: 'stack_2',
    duration: 40,
    created_at: new Date(Date.now() - 21600000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Try this delicious Thai green curry recipe for a flavorful dinner.',
  },
  {
    id: 'item_8',
    type: 'screenshot',
    classification: 'place',
    title: 'Blue Bottle Coffee',
    description: 'Cozy coffee shop with excellent pour-over coffee and pastries.',
    place_name: 'Blue Bottle Coffee',
    place_address: '123 Main St, San Francisco, CA 94102',
    tags: ['coffee', 'cafe', 'san-francisco'],
    duration: 30,
    created_at: new Date(Date.now() - 25200000).toISOString(),
    viewed: true,
    archived: false,
    script: 'Blue Bottle Coffee is a must-visit spot for excellent coffee in San Francisco.',
  },
];

/**
 * Seed the app with example data
 * 
 * This function populates the local storage with sample items and stacks.
 * Useful for testing, development, and first-time user onboarding.
 * 
 * @returns Promise that resolves when seeding is complete
 */
export async function seedData(): Promise<void> {
  try {
    console.log('Seeding data...');
    
    // Save stacks
    await saveStacks(SAMPLE_STACKS);
    console.log(`Seeded ${SAMPLE_STACKS.length} stacks`);
    
    // Save items
    await saveItems(SAMPLE_ITEMS);
    console.log(`Seeded ${SAMPLE_ITEMS.length} items`);
    
    console.log('Seeding complete!');
  } catch (error) {
    console.error('Failed to seed data:', error);
    throw new Error('Failed to seed data');
  }
}

/**
 * Check if app needs seeding (no items or stacks exist)
 * 
 * @returns true if seeding is recommended
 */
export async function shouldSeedData(): Promise<boolean> {
  try {
    const { getItems, getStacks } = await import('./storage');
    const items = await getItems();
    const stacks = await getStacks();
    
    return items.length === 0 && stacks.length === 0;
  } catch (error) {
    return false;
  }
}

