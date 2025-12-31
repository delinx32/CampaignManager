import type { Token, Prop } from '../types';

/**
 * Parses light radius from tags (e.g., "light[30]" -> 30)
 */
export const parseLightRadius = (tags?: string): number | null => {
  if (!tags) return null;
  const match = tags.match(/light\[(\d+)\]/i);
  return match ? parseInt(match[1], 10) : null;
};

/**
 * Gets effective tags from token/prop considering active state
 */
export const getEffectiveTags = (item: Token | Prop): string | undefined => {
  if (item.activeState && item.states) {
    const activeStateObj = item.states.find(s => s.name === item.activeState);
    // If a state is active, only use that state's tags (even if undefined)
    // Don't fall back to base tags when a state is explicitly selected
    return activeStateObj?.tags;
  }
  // No active state, use base tags
  return item.tags;
};
