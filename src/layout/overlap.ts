import type { Geometry } from '../manifest/geometry.js';
export type Rect = Geometry['targets'][number]['rect'];
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
/** Connected components count identities, never drawing groups or repeated checks. */
export function denseTargetGroups(targets: Geometry['targets']): string[][] {
  const unique = [...new Map([...targets].sort((a, b) => a.n - b.n).map((target) => [target.targetId, target])).values()];
  const seen = new Set<string>(), groups: string[][] = [];
  for (const target of unique) {
    if (seen.has(target.targetId)) continue;
    const group = [target]; seen.add(target.targetId);
    for (let index = 0; index < group.length; index++) {
      for (const candidate of unique) {
        if (!seen.has(candidate.targetId) && overlaps(group[index]!.rect, candidate.rect)) {
          group.push(candidate); seen.add(candidate.targetId);
        }
      }
    }
    if (group.length >= 3) groups.push(group.sort((a, b) => a.n - b.n).map(({ targetId }) => targetId));
  }
  return groups;
}
