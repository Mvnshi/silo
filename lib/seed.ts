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

import { Item, Stack, ChecklistItem } from './types';
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
    item_count: 5,
    created_at: new Date().toISOString(),
  },
  {
    id: 'stack_academia',
    name: 'Academia',
    description: 'Study plans, research, and academic resources',
    color: '#9b59b6',
    icon: 'school',
    item_count: 2,
    created_at: new Date().toISOString(),
  },
  {
    id: 'stack_career',
    name: 'Career',
    description: 'Interview prep, networking, and career growth',
    color: '#3498db',
    icon: 'briefcase',
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
    scheduled_date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
    scheduled_time: '18:00', // Evening workout
    viewed: false,
    archived: false,
    script: 'This 20-minute HIIT workout is perfect for busy schedules and requires no equipment.',
    checklist: [
      { id: '1', text: 'Warm-up: 2 min jumping jacks', completed: false },
      { id: '2', text: '30 sec burpees (4 rounds)', completed: false },
      { id: '3', text: '30 sec mountain climbers (4 rounds)', completed: false },
      { id: '4', text: '30 sec high knees (4 rounds)', completed: false },
      { id: '5', text: '30 sec plank hold (4 rounds)', completed: false },
      { id: '6', text: 'Cool-down: 2 min stretching', completed: false },
    ],
  },
  {
    id: 'item_fitness_2',
    type: 'link',
    classification: 'fitness',
    title: 'Upper Body Strength Routine',
    description: 'Complete upper body workout targeting chest, back, shoulders, and arms. Perfect for building muscle and strength.',
    url: 'https://www.strongerbyscience.com/progressive-overload/',
    tags: ['strength-training', 'muscle-building', 'upper-body', 'gym'],
    stack_id: 'stack_fitness',
    duration: 45,
    created_at: new Date(Date.now() - 172800000).toISOString(),
    viewed: false,
    archived: false,
    script: 'This upper body strength routine will help you build muscle and increase your strength.',
    checklist: [
      { id: '1', text: 'Bench press: 4 sets x 8 reps', completed: false },
      { id: '2', text: 'Bent-over rows: 4 sets x 8 reps', completed: false },
      { id: '3', text: 'Overhead press: 3 sets x 10 reps', completed: false },
      { id: '4', text: 'Pull-ups: 3 sets to failure', completed: false },
      { id: '5', text: 'Bicep curls: 3 sets x 12 reps', completed: false },
      { id: '6', text: 'Tricep dips: 3 sets x 12 reps', completed: false },
    ],
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
    checklist: [
      { id: '1', text: 'Neck circles: 10 each direction', completed: false },
      { id: '2', text: 'Shoulder rolls: 10 forward, 10 backward', completed: false },
      { id: '3', text: 'Cat-cow stretch: 10 reps', completed: false },
      { id: '4', text: 'Hip circles: 10 each direction', completed: false },
      { id: '5', text: 'Leg swings: 10 each leg', completed: false },
      { id: '6', text: 'Deep squat hold: 30 seconds', completed: false },
    ],
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
    scheduled_date: new Date(Date.now() + 172800000).toISOString().split('T')[0], // Day after tomorrow
    scheduled_time: '19:00', // Dinner time
    viewed: false,
    archived: false,
    script: 'This one-pan Mediterranean chicken recipe is perfect for a quick and healthy weeknight dinner.',
    checklist: [
      { id: '1', text: '4 boneless chicken thighs', completed: false },
      { id: '2', text: '1 cup cherry tomatoes', completed: false },
      { id: '3', text: '1/2 cup kalamata olives', completed: false },
      { id: '4', text: '4 oz feta cheese', completed: false },
      { id: '5', text: '2 tbsp olive oil', completed: false },
      { id: '6', text: 'Fresh oregano and lemon', completed: false },
    ],
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
    checklist: [
      { id: '1', text: '100g whole wheat flour', completed: false },
      { id: '2', text: '100g warm water (75-80°F)', completed: false },
      { id: '3', text: 'Glass jar with lid', completed: false },
      { id: '4', text: 'Rubber band for marking', completed: false },
      { id: '5', text: 'Feed daily: 50g flour + 50g water', completed: false },
    ],
  },
  {
    id: 'item_food_3',
    type: 'link',
    classification: 'food',
    title: 'Buffalo Chicken Wrap Meal Prep',
    description: 'Spicy buffalo chicken wraps with fresh veggies. Perfect for meal prep - makes 4 servings, ready in 20 minutes.',
    url: 'https://www.budgetbytes.com/meal-prep-lunches/',
    tags: ['meal-prep', 'buffalo', 'chicken', 'lunch', 'quick'],
    stack_id: 'stack_food',
    duration: 20,
    created_at: new Date(Date.now() - 518400000).toISOString(),
    viewed: false,
    archived: false,
    script: 'These buffalo chicken wraps are perfect for meal prep and will keep you satisfied all week.',
    checklist: [
      { id: '1', text: '1 lb chicken breast, cooked and shredded', completed: false },
      { id: '2', text: '1/2 cup buffalo sauce', completed: false },
      { id: '3', text: '4 large tortillas', completed: false },
      { id: '4', text: '1 cup shredded lettuce', completed: false },
      { id: '5', text: '1/2 cup diced celery', completed: false },
      { id: '6', text: '1/4 cup blue cheese crumbles', completed: false },
      { id: '7', text: 'Ranch dressing for dipping', completed: false },
    ],
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
  // ACADEMIA ITEMS
  {
    id: 'item_academia_1',
    type: 'note',
    classification: 'academia',
    title: 'Machine Learning Fundamentals Study Plan',
    description: 'Comprehensive 8-week study plan for mastering machine learning basics. Covers theory, math, and hands-on projects.',
    tags: ['machine-learning', 'study-plan', 'academia', 'data-science'],
    duration: 120,
    created_at: new Date(Date.now() - 518400000).toISOString(),
    viewed: false,
    archived: false,
    script: 'This study plan will help you master machine learning fundamentals in just 8 weeks.',
    stack_id: 'stack_academia',
    checklist: [
      { id: '1', text: 'Week 1: Linear algebra basics', completed: false },
      { id: '2', text: 'Week 2: Calculus for ML', completed: false },
      { id: '3', text: 'Week 3: Python & NumPy mastery', completed: false },
      { id: '4', text: 'Week 4: Linear regression project', completed: false },
      { id: '5', text: 'Week 5: Neural networks theory', completed: false },
      { id: '6', text: 'Week 6: Build first neural network', completed: false },
      { id: '7', text: 'Week 7: Deep learning concepts', completed: false },
      { id: '8', text: 'Week 8: Final capstone project', completed: false },
    ],
  },
  {
    id: 'item_academia_2',
    type: 'link',
    classification: 'academia',
    title: 'Research Paper Writing Checklist',
    description: 'Essential checklist for writing and submitting academic research papers. Covers structure, citations, and peer review process.',
    url: 'https://example.com/research-paper-guide',
    tags: ['research', 'writing', 'academia', 'papers'],
    duration: 45,
    created_at: new Date(Date.now() - 432000000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Follow this checklist to write and submit a successful research paper.',
    stack_id: 'stack_academia',
    checklist: [
      { id: '1', text: 'Abstract (250 words max)', completed: false },
      { id: '2', text: 'Introduction with clear research question', completed: false },
      { id: '3', text: 'Literature review section', completed: false },
      { id: '4', text: 'Methodology clearly explained', completed: false },
      { id: '5', text: 'Results with data visualization', completed: false },
      { id: '6', text: 'Discussion and implications', completed: false },
      { id: '7', text: 'References formatted correctly', completed: false },
      { id: '8', text: 'Proofread and spell-check', completed: false },
    ],
  },
  // CAREER ITEMS
  {
    id: 'item_career_1',
    type: 'note',
    classification: 'career',
    title: 'Technical Interview Preparation Roadmap',
    description: 'Complete guide to preparing for software engineering interviews. Covers algorithms, system design, and behavioral questions.',
    tags: ['interview', 'career', 'tech', 'preparation'],
    duration: 60,
    created_at: new Date(Date.now() - 345600000).toISOString(),
    viewed: false,
    archived: false,
    script: 'This roadmap will help you prepare thoroughly for technical interviews.',
    stack_id: 'stack_career',
    checklist: [
      { id: '1', text: 'Review data structures (arrays, trees, graphs)', completed: false },
      { id: '2', text: 'Practice 50+ LeetCode problems', completed: false },
      { id: '3', text: 'Study system design fundamentals', completed: false },
      { id: '4', text: 'Prepare STAR method stories', completed: false },
      { id: '5', text: 'Mock interviews with peers', completed: false },
      { id: '6', text: 'Research company and role', completed: false },
      { id: '7', text: 'Prepare questions for interviewer', completed: false },
    ],
  },
  {
    id: 'item_career_2',
    type: 'link',
    classification: 'career',
    title: 'Networking Event Preparation',
    description: 'How to maximize your networking opportunities at industry events. Includes conversation starters and follow-up strategies.',
    url: 'https://example.com/networking-guide',
    tags: ['networking', 'career', 'professional', 'events'],
    duration: 30,
    created_at: new Date(Date.now() - 259200000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Use this checklist to prepare for your next networking event.',
    stack_id: 'stack_career',
    checklist: [
      { id: '1', text: 'Update LinkedIn profile', completed: false },
      { id: '2', text: 'Prepare 30-second elevator pitch', completed: false },
      { id: '3', text: 'Print business cards', completed: false },
      { id: '4', text: 'Research attendees and companies', completed: false },
      { id: '5', text: 'Prepare conversation starters', completed: false },
      { id: '6', text: 'Set networking goals', completed: false },
      { id: '7', text: 'Plan follow-up email templates', completed: false },
    ],
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
  
  // BUFFALO PLACES (5 - more map pins!)
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
  {
    id: 'item_place_3',
    type: 'screenshot',
    classification: 'place',
    title: 'Niagara Falls State Park',
    description: 'One of the world\'s most famous waterfalls, just 20 minutes from Buffalo. Stunning views, boat tours, and hiking trails.',
    place_name: 'Niagara Falls State Park',
    place_address: '332 Prospect St, Niagara Falls, NY 14303',
    place_latitude: 43.0962,
    place_longitude: -79.0377,
    tags: ['waterfall', 'nature', 'tourist', 'hiking', 'scenic'],
    stack_id: 'stack_places',
    duration: 180,
    created_at: new Date(Date.now() - 691200000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Niagara Falls is one of the most spectacular natural wonders in the world, just a short drive from Buffalo.',
  },
  {
    id: 'item_place_4',
    type: 'screenshot',
    classification: 'place',
    title: 'Duff\'s Famous Wings',
    description: 'Another legendary Buffalo wing spot! Known for their extra-spicy sauce and crispy wings. A local favorite.',
    place_name: 'Duff\'s Famous Wings',
    place_address: '3651 Sheridan Dr, Amherst, NY 14226',
    place_latitude: 42.9801,
    place_longitude: -78.8001,
    tags: ['wings', 'buffalo', 'restaurant', 'spicy', 'local'],
    stack_id: 'stack_places',
    duration: 45,
    created_at: new Date(Date.now() - 604800000).toISOString(),
    viewed: false,
    archived: false,
    script: 'Duff\'s Famous Wings is a must-try for wing lovers, known for their extra-spicy sauce.',
  },
  {
    id: 'item_place_5',
    type: 'screenshot',
    classification: 'place',
    title: 'Albright-Knox Art Gallery',
    description: 'World-class art museum featuring modern and contemporary art. Beautiful building and rotating exhibitions.',
    place_name: 'Albright-Knox Art Gallery',
    place_address: '1285 Elmwood Ave, Buffalo, NY 14222',
    place_latitude: 42.9331,
    place_longitude: -78.8765,
    tags: ['museum', 'art', 'culture', 'buffalo', 'exhibitions'],
    stack_id: 'stack_places',
    duration: 120,
    created_at: new Date(Date.now() - 518400000).toISOString(),
    viewed: false,
    archived: false,
    script: 'The Albright-Knox Art Gallery is a world-class museum featuring incredible modern and contemporary art.',
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

