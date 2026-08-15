/**
 * Single source of truth for per-classification visuals (gradient, icon, label).
 * Replaces the getClassificationColor/Icon helpers duplicated across
 * ItemCard/CompactCard/StreamCard (AUDIT.md LOW). Import `classConfig`.
 */
import { Ionicons } from '@expo/vector-icons';
import { Classification } from './types';

export interface ClassConfig {
  /** Gradient start — used for large fills (tiles, hero blocks). */
  from: string;
  /** Gradient end. */
  to: string;
  /**
   * Darkened variant for TEXT and glyphs on a soft tint of the same hue.
   *
   * Pills render `color` on `from + '1A'` (a 10% wash of the same colour), and
   * at that ratio `from` itself lands around 2:1 — unreadable at 11px. Every
   * value here clears 4.5:1 on its own tint, so pills stay legible.
   */
  deep: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}

export const CLASS_CONFIG: Record<Classification, ClassConfig> = {
  article: { from: '#6366f1', to: '#8b5cf6', deep: '#4338ca', icon: 'newspaper', label: 'Article' },
  video: { from: '#ec4899', to: '#f472b6', deep: '#be185d', icon: 'play', label: 'Video' },
  recipe: { from: '#f59e0b', to: '#fb923c', deep: '#b45309', icon: 'restaurant', label: 'Recipe' },
  product: { from: '#10b981', to: '#34d399', deep: '#047857', icon: 'pricetag', label: 'Product' },
  event: { from: '#f43f5e', to: '#fb7185', deep: '#be123c', icon: 'calendar', label: 'Event' },
  place: { from: '#06b6d4', to: '#22d3ee', deep: '#0e7490', icon: 'location', label: 'Place' },
  idea: { from: '#f59e0b', to: '#fbbf24', deep: '#b45309', icon: 'bulb', label: 'Idea' },
  fitness: { from: '#ef4444', to: '#f87171', deep: '#b91c1c', icon: 'barbell', label: 'Fitness' },
  food: { from: '#f97316', to: '#fb923c', deep: '#c2410c', icon: 'fast-food', label: 'Food' },
  career: { from: '#14b8a6', to: '#2dd4bf', deep: '#0f766e', icon: 'briefcase', label: 'Career' },
  academia: { from: '#8b5cf6', to: '#a78bfa', deep: '#6d28d9', icon: 'school', label: 'Academia' },
  other: { from: '#64748b', to: '#94a3b8', deep: '#475569', icon: 'document-text', label: 'Note' },
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
