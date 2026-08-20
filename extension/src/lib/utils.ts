/**
 * `cn` — the class merger every shadcn component imports.
 *
 * `clsx` resolves conditionals; `tailwind-merge` then drops earlier utilities
 * that a later one overrides, so a caller's `className` wins over a variant's
 * default instead of depending on stylesheet order.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
