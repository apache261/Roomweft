import { TriangleIndex } from './TriangleIndex.ts';
export type NavigationData = { collision: TriangleIndex; floors: Map<string, TriangleIndex> };
type Entry = { data: NavigationData; owners: number; touched: number; triangles: number };
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 8, MAX_TRIANGLES = 500_000;
let clock = 0;
export function acquireNavigation(key: string): NavigationData | undefined {
 const entry = entries.get(key); if (!entry) return;
 entry.owners++; entry.touched = ++clock; return entry.data;
}
export function saveNavigation(key: string, data: NavigationData) {
 let triangles = data.collision.triangles.length;
 for (const floor of data.floors.values()) triangles += floor.triangles.length;
 entries.set(key, { data, owners: 1, touched: ++clock, triangles }); prune();
}
function prune() {
 let triangles = [...entries.values()].reduce((sum, e) => sum + e.triangles, 0);
 for (const [key, entry] of [...entries.entries()].filter(([, e]) => !e.owners).sort((a, b) => a[1].touched - b[1].touched)) {
  if (entries.size <= MAX_ENTRIES && triangles <= MAX_TRIANGLES) break;
  entries.delete(key); triangles -= entry.triangles;
  entry.data.collision.clear(); entry.data.floors.forEach(f => f.clear()); entry.data.floors.clear();
 }
}
export function releaseNavigation(key: string) { const entry = entries.get(key); if (entry) entry.owners--; prune(); }
export function navigationCacheStats() { return { entries: entries.size, owners: [...entries.values()].reduce((s, e) => s + e.owners, 0), triangles: [...entries.values()].reduce((s, e) => s + e.triangles, 0) }; }

const objectIds = new WeakMap<object, number>(); let nextId = 0;
export function navigationIdentity(object?: object) { if (!object) return 0; let id = objectIds.get(object); if (!id) { id = ++nextId; objectIds.set(object, id); } return id; }
