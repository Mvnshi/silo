/**
 * Single source of truth for per-classification visuals (gradient, icon, label).
 * Replaces the getClassificationColor/Icon helpers duplicated across
 * ItemCard/CompactCard/StreamCard (AUDIT.md LOW). Import `classConfig`.
 */
import { Ionicons } from '@expo/vector-icons';
import { Classification } from './types';

export interface ClassConfig {
  from: string;
  to: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}

export const CLASS_CONFIG: Record<Classification, ClassConfig> = {
  article: { from: '#6366f1', to: '#8b5cf6', icon: 'newspaper', label: 'Article' },
  video: { from: '#ec4899', to: '#f472b6', icon: 'play', label: 'Video' },
  recipe: { from: '#f59e0b', to: '#fb923c', icon: 'restaurant', label: 'Recipe' },
  product: { from: '#10b981', to: '#34d399', icon: 'pricetag', label: 'Product' },
  event: { from: '#f43f5e', to: '#fb7185', icon: 'calendar', label: 'Event' },
  place: { from: '#06b6d4', to: '#22d3ee', icon: 'location', label: 'Place' },
  idea: { from: '#f59e0b', to: '#fbbf24', icon: 'bulb', label: 'Idea' },
  fitness: { from: '#ef4444', to: '#f87171', icon: 'barbell', label: 'Fitness' },
  food: { from: '#f97316', to: '#fb923c', icon: 'fast-food', label: 'Food' },
  career: { from: '#14b8a6', to: '#2dd4bf', icon: 'briefcase', label: 'Career' },
  academia: { from: '#8b5cf6', to: '#a78bfa', icon: 'school', label: 'Academia' },
  other: { from: '#64748b', to: '#94a3b8', icon: 'document-text', label: 'Note' },
};

/** Safe lookup with an `other` fallback. */
export function classConfig(c?: Classification): ClassConfig {
  return (c && CLASS_CONFIG[c]) || CLASS_CONFIG.other;
}

/** Convenience for components that still want the gradient tuple. */
export function classGradient(c?: Classification): readonly [string, string] {
  const cfg = classConfig(c);
  return [cfg.from, cfg.to] as const;
}
