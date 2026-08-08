import { Medicine } from '../models/Medicine';

/**
 * The shelf hierarchy, worked out from what is actually on the shelves.
 *
 * The supplier bundle ships a 1,204-row category table and none of it is
 * imported, on purpose. A stored tree is a second place the hierarchy lives:
 * move a product and the tree is wrong until something rebuilds it, and it
 * would list branches holding nothing — a buyer clicking "Nebulisers" to find
 * an empty page because the tree remembers a line that was delisted last year.
 *
 * Derived from `categoryPath` instead, so a branch exists exactly when
 * something is filed under it, and the count beside it is true by construction.
 *
 * There are 997 distinct paths across 55,998 products, five deep at most, so
 * the grouping is small and the tree is built from its result rather than by
 * asking the database to shape it.
 */

export interface CategoryNode {
  name: string;
  /** The full trail to here, which is what a caller filters on. */
  path: string[];
  /** Products filed at or under this branch. */
  count: number;
  children: CategoryNode[];
}

interface Grouped {
  _id: string[];
  count: number;
}

/**
 * @param activeOnly Count only what can be ordered. A shop owner browsing must
 *   not be offered a branch whose every product is delisted; a buyer looking at
 *   the whole catalogue wants them.
 */
export async function categoryTree(activeOnly: boolean): Promise<CategoryNode[]> {
  const rows = (await Medicine.aggregate([
    {
      $match: {
        ...(activeOnly ? { isActive: true } : {}),
        categoryPath: { $exists: true, $ne: [] },
      },
    },
    { $group: { _id: '$categoryPath', count: { $sum: 1 } } },
  ])) as Grouped[];

  const roots: CategoryNode[] = [];
  /** Every node by its joined path, so a trail is walked once rather than searched. */
  const byPath = new Map<string, CategoryNode>();

  for (const row of rows) {
    const trail: string[] = [];
    let siblings = roots;
    for (const name of row._id) {
      trail.push(name);
      /*
       * A separator no category name can contain, so joining a trail cannot
       * collide: without it `['Baby', 'Care']` and `['Baby Care']` produce the
       * same key, and two unrelated shelves merge into one node with a summed
       * count.
       *
       * Written as the escape, never as the raw character. It was a raw U+0000,
       * which every editor and `cat` render as a single space — so the file
       * read as `join(' ')` — that exact collision bug — while running as
       * something else. Git also classified the whole service as binary, so
       * its diffs could not be reviewed or merged as text.
       */
      const key = trail.join('\u0000');
      let node = byPath.get(key);
      if (!node) {
        node = { name, path: [...trail], count: 0, children: [] };
        byPath.set(key, node);
        siblings.push(node);
      }
      // Counted at every level it passes through, so a parent's figure is the
      // total underneath it rather than only what is filed directly at it.
      node.count += row.count;
      siblings = node.children;
    }
  }

  const sort = (nodes: CategoryNode[]): CategoryNode[] => {
    nodes.sort((left, right) => left.name.localeCompare(right.name));
    for (const node of nodes) sort(node.children);
    return nodes;
  };
  return sort(roots);
}
