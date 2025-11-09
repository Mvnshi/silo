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
    id: 'stack_fitness',
    name: 'Fitness',
    description: 'Workouts, routines, and health tips',
    color: '#FF6B6B',
    icon: 'fitness',
    item_count: 3,
    created_at: new Date().toISOString(),
  },
  {
    id: 'stack_food',
    name: 'Food',
    description: 'Recipes and cooking inspiration',
    color: '#FFA07A',
    icon: 'restaurant',
    item_count: 3,
    created_at: new Date().toISOString(),
  },
  {
    id: 'stack_tech',
    name: 'Tech',
    description: 'Tech news, tutorials, and tools',
    color: '#667eea',
    icon: 'laptop',
    item_count: 2,
    created_at: new Date().toISOString(),
  },
  {
    id: 'stack_places',
    name: 'Places',
    description: 'Restaurants, cafes, and spots to visit',
    color: '#30cfd0',
    icon: 'location',
    item_count: 2,
    created_at: new Date().toISOString(),
  },
];

/**
 * Sample items for demonstration - 10 legit pieces of content
 */
const SAMPLE_ITEMS: Item[] = [
  // FITNESS ITEMS (3)
  {
    id: 'item_fitness_1',
    type: 'link',
    classification: 'fitness',
    title: '20-Minute HIIT Workout for Busy Schedules',
    description: 'High-intensity interval training routine you can do anywhere. No equipment needed, perfect for fitting exercise into a packed day.',
    url: 'https://www.healthline.com/health/hiit-workouts',
    tags: ['hiit', 'cardio', 'home-workout', 'quick'],
    stack_id: 'stack_fitness',
    duration: 20,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    viewed: false,
    archived: false,
    script: 'This 20-minute HIIT workout is perfect for busy schedules and requires no equipment.',
  },
  {
    id: 'item_fitness_2',
    type: 'link',
    classification: 'fitness',
    title: 'Progressive Overload: The Key to Building Strength',
    description: 'Learn how to systematically increase training intensity to build muscle and strength over time. Includes practical examples and programming tips.',
    url: 'https://www.strongerbyscience.com/progressive-overload/',
    tags: ['strength-training', 'muscle-building', 'programming', 'science'],
    stack_id: 'stack_fitness',
    duration: 15,
    created_at: new Date(Date.now() - 172800000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Understanding progressive overload is essential for building strength and muscle effectively.',
  },
  {
    id: 'item_fitness_3',
    type: 'screenshot',
    classification: 'fitness',
    title: 'Morning Mobility Routine',
    description: '10-minute stretching and mobility flow to start your day. Improves flexibility, reduces stiffness, and prepares your body for movement.',
    tags: ['mobility', 'stretching', 'morning-routine', 'flexibility'],
    stack_id: 'stack_fitness',
    duration: 10,
    created_at: new Date(Date.now() - 259200000).toISOString(),
    viewed: false,
    archived: false,
    script: 'This morning mobility routine will help you start your day feeling loose and ready.',
  },
  
  // FOOD ITEMS (3)
  {
    id: 'item_food_1',
    type: 'link',
    classification: 'food',
    title: 'One-Pan Mediterranean Chicken Recipe',
    description: 'Easy weeknight dinner with chicken, olives, tomatoes, and feta. Ready in 30 minutes with minimal cleanup.',
    url: 'https://www.bonappetit.com/recipe/one-pan-mediterranean-chicken',
    tags: ['dinner', 'mediterranean', 'chicken', 'one-pan', 'quick'],
    stack_id: 'stack_food',
    duration: 30,
    created_at: new Date(Date.now() - 345600000).toISOString(),
    viewed: false,
    archived: false,
    script: 'This one-pan Mediterranean chicken recipe is perfect for a quick and healthy weeknight dinner.',
  },
  {
    id: 'item_food_2',
    type: 'screenshot',
    classification: 'food',
    title: 'Perfect Sourdough Starter Guide',
    description: 'Step-by-step instructions for creating and maintaining a sourdough starter. Includes troubleshooting tips and feeding schedule.',
    tags: ['baking', 'sourdough', 'bread', 'fermentation'],
    stack_id: 'stack_food',
    duration: 25,
    created_at: new Date(Date.now() - 432000000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Learn how to create and maintain a perfect sourdough starter for amazing homemade bread.',
  },
  {
    id: 'item_food_3',
    type: 'link',
    classification: 'food',
    title: 'Meal Prep: 5 Healthy Lunches Under $3',
    description: 'Budget-friendly meal prep ideas that are nutritious and delicious. Includes shopping lists and prep instructions.',
    url: 'https://www.budgetbytes.com/meal-prep-lunches/',
    tags: ['meal-prep', 'budget', 'healthy', 'lunch'],
    stack_id: 'stack_food',
    duration: 20,
    created_at: new Date(Date.now() - 518400000).toISOString(),
    viewed: false,
    archived: false,
    script: 'These meal prep ideas will help you eat healthy on a budget with lunches under three dollars.',
  },
  
  // TECH ITEMS (2)
  {
    id: 'item_tech_1',
    type: 'link',
    classification: 'article',
    title: 'React Server Components: The Future of Web Development',
    description: 'Deep dive into React Server Components and how they change the way we build web applications. Performance benefits and migration strategies.',
    url: 'https://react.dev/blog/2023/03/22/react-labs-what-we-have-been-working-on-march-2023',
    tags: ['react', 'web-development', 'performance', 'nextjs'],
    stack_id: 'stack_tech',
    duration: 18,
    created_at: new Date(Date.now() - 604800000).toISOString(),
    viewed: false,
    archived: false,
    script: 'React Server Components represent a major shift in how we build performant web applications.',
  },
  {
    id: 'item_tech_2',
    type: 'link',
    classification: 'video',
    title: 'Building AI Apps with LangChain and OpenAI',
    description: 'Tutorial on creating intelligent applications using LangChain framework. Covers chains, agents, and memory management.',
    url: 'https://www.youtube.com/watch?v=example-langchain',
    tags: ['ai', 'langchain', 'openai', 'tutorial', 'python'],
    stack_id: 'stack_tech',
    duration: 35,
    created_at: new Date(Date.now() - 691200000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Learn how to build powerful AI applications using LangChain and OpenAI in this comprehensive tutorial.',
  },
  
  // BUFFALO PLACES (2)
  {
    id: 'item_place_1',
    type: 'screenshot',
    classification: 'place',
    title: 'Anchor Bar - Original Buffalo Wings',
    description: 'The birthplace of Buffalo wings! Historic restaurant serving the original recipe since 1964. Must-try for anyone visiting Buffalo.',
    place_name: 'Anchor Bar',
    place_address: '1047 Main St, Buffalo, NY 14209',
    place_latitude: 42.9014,
    place_longitude: -78.8701,
    tags: ['wings', 'buffalo', 'historic', 'restaurant', 'must-visit'],
    stack_id: 'stack_places',
    duration: 60,
    created_at: new Date(Date.now() - 777600000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Anchor Bar is the original home of Buffalo wings and a must-visit spot in Buffalo.',
  },
  {
    id: 'item_place_2',
    type: 'screenshot',
    classification: 'place',
    title: 'Canalside - Waterfront District',
    description: 'Beautiful waterfront area with walking paths, food trucks, and summer concerts. Great spot for a walk or bike ride along the Buffalo River.',
    place_name: 'Canalside',
    place_address: '44 Prime St, Buffalo, NY 14202',
    place_latitude: 42.8784,
    place_longitude: -78.8776,
    tags: ['waterfront', 'outdoor', 'walking', 'buffalo', 'scenic'],
    stack_id: 'stack_places',
    duration: 90,
    created_at: new Date(Date.now() - 864000000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Canalside is a beautiful waterfront area perfect for walking, biking, or just enjoying the view.',
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
    console.log('🌱 Seeding data...');
    console.log(`📦 Stacks to seed: ${SAMPLE_STACKS.length}`);
    console.log(`📄 Items to seed: ${SAMPLE_ITEMS.length}`);
    
    const { getStacks, getItems } = await import('./storage');
    const existingStacks = await getStacks();
    const existingItems = await getItems();
    
    // Merge stacks - add new ones that don't exist
    const existingStackIds = new Set(existingStacks.map(s => s.id));
    const stacksToAdd = SAMPLE_STACKS.filter(s => !existingStackIds.has(s.id));
    const mergedStacks = [...existingStacks, ...stacksToAdd];
    
    if (stacksToAdd.length > 0) {
      await saveStacks(mergedStacks);
      console.log(`✅ Added ${stacksToAdd.length} new stacks:`, stacksToAdd.map(s => s.name).join(', '));
    } else {
      console.log('ℹ️ All stacks already exist');
    }
    
    // Merge items - add new ones that don't exist
    const existingItemIds = new Set(existingItems.map(i => i.id));
    const itemsToAdd = SAMPLE_ITEMS.filter(i => !existingItemIds.has(i.id));
    const mergedItems = [...existingItems, ...itemsToAdd];
    
    if (itemsToAdd.length > 0) {
      await saveItems(mergedItems);
      console.log(`✅ Added ${itemsToAdd.length} new items`);
    } else {
      console.log('ℹ️ All items already exist');
    }
    
    // Verify they were saved
    const savedStacks = await getStacks();
    const savedItems = await getItems();
    console.log(`✅ Verified: ${savedStacks.length} stacks and ${savedItems.length} items in storage`);
    console.log('📦 All stacks:', savedStacks.map(s => s.name).join(', '));
    
    console.log('🎉 Seeding complete!');
  } catch (error) {
    console.error('❌ Failed to seed data:', error);
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
    
    // Check if we have the expected stacks
    const expectedStackIds = new Set(SAMPLE_STACKS.map(s => s.id));
    const existingStackIds = new Set(stacks.map(s => s.id));
    const hasAllStacks = SAMPLE_STACKS.every(s => existingStackIds.has(s.id));
    
    // Seed if no stacks exist OR if we're missing the expected stacks
    return stacks.length === 0 || !hasAllStacks;
  } catch (error) {
    console.error('Error checking seed data:', error);
    return false;
  }
}

/**
 * Force seed data (useful for development/testing)
 * This will overwrite existing data
 */
export async function forceSeedData(): Promise<void> {
  try {
    console.log('Force seeding data...');
    await seedData();
    console.log('Force seeding complete!');
  } catch (error) {
    console.error('Failed to force seed data:', error);
    throw error;
  }
}

