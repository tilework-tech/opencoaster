/**
 * Atlas page categories. Each category packs into its own pages so the runtime can load the
 * pages of a lazy category only when something of that kind is first drawn or offered.
 */
export interface AtlasCategoryRule {
  /** Page group name, or the prefix of `<category>-<subdirectory>` when `perSubdirectory` is set. */
  category: string;
  /** Sprite key prefixes (including the trailing slash) that belong to the category. */
  prefixes: readonly string[];
  /** Lazy pages load the first time one of their sprites is wanted; eager pages load at start. */
  lazy: boolean;
  /** Give every directory directly under a prefix its own category (one per coaster family). */
  perSubdirectory?: boolean;
}

/** First matching rule wins. Sprites matching no rule belong to the eager `world` category. */
export const ATLAS_CATEGORIES: readonly AtlasCategoryRule[] = [
  { category: 'people', prefixes: ['people/', 'guests/', 'staff/'], lazy: false },
  { category: 'flat-rides', prefixes: ['rides/flat/'], lazy: true },
  { category: 'stalls', prefixes: ['stalls/', 'facilities/'], lazy: true },
  { category: 'coaster', prefixes: ['rides/coaster/'], lazy: true, perSubdirectory: true },
  { category: 'vehicles', prefixes: ['vehicles/'], lazy: true },
];

export const DEFAULT_ATLAS_CATEGORY = 'world';

export interface ResolvedCategory {
  name: string;
  lazy: boolean;
}

export function categoryForSprite(
  spriteKey: string,
  rules: readonly AtlasCategoryRule[] = ATLAS_CATEGORIES,
): ResolvedCategory {
  for (const rule of rules) {
    const prefix = rule.prefixes.find((candidate) => spriteKey.startsWith(candidate));
    if (!prefix) continue;
    if (!rule.perSubdirectory) return { name: rule.category, lazy: rule.lazy };
    const family = spriteKey.slice(prefix.length).split('/');
    if (family.length > 1) return { name: `${rule.category}-${family[0]}`, lazy: rule.lazy };
    return { name: rule.category, lazy: rule.lazy };
  }
  return { name: DEFAULT_ATLAS_CATEGORY, lazy: false };
}
