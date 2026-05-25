import type { CategoryNode } from '@/modules/catalog/categories';

/**
 * Flatten a category tree into a depth-indented option list for select inputs.
 * `label` carries em-dash prefixes proportional to depth.
 */
export function flattenCategories(
  nodes: CategoryNode[],
  depth = 0,
): Array<{ id: string; label: string; name: string; depth: number }> {
  const out: Array<{ id: string; label: string; name: string; depth: number }> = [];
  for (const n of nodes) {
    out.push({ id: n.id, label: `${'— '.repeat(depth)}${n.name}`, name: n.name, depth });
    out.push(...flattenCategories(n.children, depth + 1));
  }
  return out;
}
