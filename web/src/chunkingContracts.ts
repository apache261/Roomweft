// Separate, opt-in chunk contracts. runtime-v1 remains a whole-file format.
export const streamingSchema = 'streaming-v1';
export const chunkProcessorVersion = 'chunks-v1';
export type Vec3 = [number, number, number];
export type Matrix = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
export type Bounds = { min: Vec3; max: Vec3 };
export type InventoryNode = { path: string; name: string; parent?: string; source_node?: number; source_primitive?: number; bounds: Bounds | null; matrix: Matrix; renderable: boolean; triangles: number; geometry_bytes: number; embedded_image_bytes: number; dependency_group?: string };
export type SourceInventory = { clip_count:number; skin_count:number; schema: 'source-inventory-v1'; coordinates: 'source-space'; source_sha256: string; source_bytes: number; bounds: Bounds; nodes: InventoryNode[]; dependencies: { id: string; kind: 'authored-hierarchy'; node_paths: string[] }[]; conservative_reasons: string[] };
export type PartitionRoom = { id: string; name: string; bounds: Bounds; node_paths: string[] };
export type PartitionOpening = { id: string; from: string; to: string | null; kind: 'doorway' | 'window'; corners: [Vec3, Vec3, Vec3, Vec3]; reviewed: boolean };
export type Partition = { spatial_cell_size?:number; schema: 'partition-v1'; source_sha256: string; policy: 'complete' | 'reviewed-rooms'; visibility: 'conservative' | 'reviewed-openings'; rooms: PartitionRoom[]; global_node_paths: string[]; openings: PartitionOpening[] };
export type PartitionResponse = { revision: number; source_sha256?: string; inventory: SourceInventory | null; document: Partition | null; fallback?: string };
export type StoredPayload = { key: string; sha256: string; bytes: number; texture_rgba8_bytes: number; max_texture: number };
export type DeliveredPayload = Omit<StoredPayload, 'key'> & { url: string };
export type SurfaceMapping = { source_path: string; source_primitive: number; source_triangle_start: number; chunk_path: string; chunk_primitive: number; chunk_triangle_start: number; triangle_count: number };
export type ChunkManifest<P = StoredPayload> = {
 source_node_paths:string[];source_clip_count:number;source_skin_count:number;
 schema: 'streaming-v1'; processor_version: 'chunks-v1'; parent_asset_id: string; source_sha256: string; partition_revision: number; coordinates: 'source-space'; partition: Partition;
 source_surfaces: { path: string; primitive: number; triangles: number; bounds: Bounds }[];
 global_chunks: string[];
 regions: { id: string; chunks: string[]; display_requires: string[]; movement_requires: string[] }[];
 chunks: { id: string; bounds: Bounds; primitive_count: number; triangle_count: number; local_to_source: Matrix; dependencies: string[]; surface_map: SurfaceMapping[]; variants: Record<'low' | 'balanced' | 'hq', P> }[];
 dependencies: { source_node_paths:string[];source_clip_indices:number[];source_skin_indices:number[]; id: string; kind: 'texture' | 'animation' | 'shared-contributor'; requires: string[]; variants: Record<'low' | 'balanced' | 'hq', P> }[];
 navigation: { payload: P; strategy: 'verified-exact-geometry'; floor_source_paths: string[]; authored_semantics: 'authored-only-floors' };
 occlusion: { payload: P; strategy: 'verified-authored-occluders'; floor_source_paths: string[]; authored_semantics: 'authored-material-visibility-sidedness' };
 fallback: 'complete-original';
};
const hash = /^[a-f0-9]{64}$/, id = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/, path = /^0(\/(0|[1-9][0-9]*))*$/;
const MAX = 10000;
function ensure(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function object(value: unknown, fields: string[], optional: string[] = []): Record<string, any> {
 ensure(value && typeof value === 'object' && !Array.isArray(value), 'Expected contract object');
 const o = value as Record<string, any>;
 ensure(fields.every(k => Object.hasOwn(o, k)) && Object.keys(o).every(k => fields.includes(k) || optional.includes(k)), 'Missing or unknown contract field');
 return o;
}
function list(value: unknown, limit = MAX): any[] { ensure(Array.isArray(value) && value.length <= limit, 'Invalid contract array or limit'); return value; }
function integer(n: unknown, min = 0): n is number { return typeof n === 'number' && Number.isSafeInteger(n) && n >= min; }
function vector(value: unknown, length = 3): number[] { ensure(Array.isArray(value) && value.length === length && value.every(n => typeof n === 'number' && Number.isFinite(n)), 'Invalid coordinate tuple'); return value; }
export function validateBounds(value: unknown): asserts value is Bounds {
 const b = object(value, ['min', 'max']); vector(b.min); vector(b.max); ensure(b.min.every((n: number, i: number) => n <= b.max[i]), 'Invalid bounds');
}
function contains(a: Bounds, b: Bounds) { return a.min.every((n, i) => b.min[i] >= n - 1e-5 && b.max[i] <= a.max[i] + 1e-5); }
function matrix(value: unknown) { const m = vector(value, 16); ensure(m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1, 'Expected affine source transform'); }
export function validateInventory(value: unknown): asserts value is SourceInventory {
 const v = object(value, ['clip_count','skin_count','schema', 'coordinates', 'source_sha256', 'source_bytes', 'bounds', 'nodes', 'dependencies', 'conservative_reasons']);
 ensure(integer(v.clip_count)&&v.clip_count<=MAX&&integer(v.skin_count)&&v.skin_count<=MAX&&v.schema === 'source-inventory-v1' && v.coordinates === 'source-space' && hash.test(v.source_sha256) && integer(v.source_bytes, 20), 'Invalid source inventory identity'); validateBounds(v.bounds);
 const nodes = new Map<string, InventoryNode>(), groups = new Map<string, Set<string>>();
 for (const raw of list(v.dependencies)) { const d = object(raw, ['id', 'kind', 'node_paths']); ensure(id.test(d.id) && !groups.has(d.id) && d.kind === 'authored-hierarchy', 'Invalid authored dependency'); const members = list(d.node_paths); ensure(members.length && new Set(members).size === members.length, 'Invalid dependency members'); groups.set(d.id, new Set(members)); }
 ensure(list(v.nodes).length, 'Empty source inventory');
 for (const raw of v.nodes) {
  const n = object(raw, ['path', 'name', 'bounds', 'matrix', 'renderable', 'triangles', 'geometry_bytes', 'embedded_image_bytes'], ['parent', 'source_node', 'source_primitive', 'dependency_group']);
  ensure(typeof n.path === 'string' && path.test(n.path) && !nodes.has(n.path) && typeof n.name === 'string' && typeof n.renderable === 'boolean' && integer(n.triangles) && integer(n.geometry_bytes) && integer(n.embedded_image_bytes), 'Invalid inventory node');
  for (const field of ['source_node', 'source_primitive']) ensure(n[field] === undefined || integer(n[field]), 'Invalid source node/primitive');
  matrix(n.matrix); if (n.bounds !== null) validateBounds(n.bounds);
  ensure(!n.renderable || n.bounds !== null && n.triangles > 0 && contains(v.bounds,n.bounds), 'Renderable node lacks geometry');
  ensure(!n.dependency_group || groups.has(n.dependency_group), 'Unknown dependency group'); nodes.set(n.path, n as InventoryNode);
 }
 for (const n of nodes.values()) { ensure(n.path === '0' ? n.parent === undefined : n.parent === n.path.slice(0, n.path.lastIndexOf('/')) && nodes.has(n.parent), 'Invalid source hierarchy'); if (n.dependency_group && n.renderable) ensure(groups.get(n.dependency_group)?.has(n.path), 'Incomplete dependency group'); }
 for (const [group, members] of groups) for (const p of members) ensure(nodes.get(p)?.renderable && nodes.get(p)?.dependency_group === group, 'Invalid dependency membership');
 ensure(list(v.conservative_reasons).every(r => typeof r === 'string'), 'Invalid conservative reasons');
}
export function defaultPartition(i: SourceInventory): Partition { return { schema: 'partition-v1', source_sha256: i.source_sha256, policy: 'complete', visibility: 'conservative', rooms: [], global_node_paths: i.nodes.filter(n => n.renderable).map(n => n.path), openings: [] }; }
function openingValid(o: PartitionOpening, rooms: Map<string, PartitionRoom>) {
 const sub = (a: number[], b: number[]) => a.map((n, i) => n - b[i]), cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a: number[], b: number[]) => a.reduce((n, v, i) => n + v * b[i], 0);
 const normal = cross(sub(o.corners[1], o.corners[0]), sub(o.corners[2], o.corners[0])), length = Math.sqrt(dot(normal, normal));
 if (length < 1e-6 || Math.abs(dot(normal, sub(o.corners[3], o.corners[0]))) > 1e-5 * length) return false;
 for (let j = 0; j < 4; j++) if (dot(normal, cross(sub(o.corners[(j + 1) % 4], o.corners[j]), sub(o.corners[(j + 2) % 4], o.corners[(j + 1) % 4]))) <= 1e-10) return false;
 const bounds = { min: [0, 1, 2].map(i => Math.min(...o.corners.map(c => c[i]))), max: [0, 1, 2].map(i => Math.max(...o.corners.map(c => c[i]))) };
 const intersects = (r: PartitionRoom) => r.bounds.min.every((n, i) => bounds.max[i] >= n - 1e-5 && bounds.min[i] <= r.bounds.max[i] + 1e-5);
 return intersects(rooms.get(o.from)!) && (o.to === null || intersects(rooms.get(o.to)!));
}
export function validatePartition(value: unknown, i: SourceInventory): asserts value is Partition {
 validateInventory(i); const p = object(value, ['schema', 'source_sha256', 'policy', 'visibility', 'rooms', 'global_node_paths', 'openings'],['spatial_cell_size']);
 ensure(p.schema === 'partition-v1' && p.source_sha256 === i.source_sha256 && ['complete', 'reviewed-rooms'].includes(p.policy) && ['conservative', 'reviewed-openings'].includes(p.visibility), 'Invalid partition identity or policy');
 ensure(p.spatial_cell_size===undefined||Number.isFinite(p.spatial_cell_size)&&p.spatial_cell_size>=.5&&p.spatial_cell_size<=64&&p.policy==='reviewed-rooms'&&p.visibility==='conservative','Invalid spatial cell policy');
 const nodes = new Map(i.nodes.filter(n => n.renderable).map(n => [n.path, n])), owners = new Map<string, string>(), rooms = new Map<string, PartitionRoom>();
 function assign(paths: unknown, owner: string, bounds?: Bounds) { for (const path of list(paths)) { const n = nodes.get(path); ensure(n && !owners.has(path), 'Unknown or duplicate source owner'); ensure(owner === 'global' || !n.dependency_group && bounds && contains(bounds, n.bounds!), 'Crossing or dependent nodes must remain global'); owners.set(path, owner); } }
 assign(p.global_node_paths, 'global');
 for (const raw of list(p.rooms, 512)) { const r = object(raw, ['id', 'name', 'bounds', 'node_paths']); ensure(typeof r.id === 'string' && id.test(r.id) && r.id !== 'global' && !rooms.has(r.id) && typeof r.name === 'string' && r.name.trim() && Array.from(r.name).length <= 120 && list(r.node_paths).length, 'Invalid reviewed room'); validateBounds(r.bounds); rooms.set(r.id, r as PartitionRoom); assign(r.node_paths, r.id, r.bounds); }
 ensure(owners.size === nodes.size, 'Every source surface requires exactly one owner');
 const openings = list(p.openings, 2048), ids = new Set<string>();
 for(const [path,owner] of owners){if(owner==='global')continue;const node=nodes.get(path)!;for(const room of rooms.values()){if(room.id===owner)continue;const overlaps=node.bounds!.min.every((v,axis)=>{const lo=Math.max(v,room.bounds.min[axis]),hi=Math.min(node.bounds!.max[axis],room.bounds.max[axis]);return node.bounds!.max[axis]-v<=1e-5?hi>=lo-1e-5:hi-lo>1e-5;});ensure(!overlaps,'Cross-room nodes must remain global');}}
 ensure(p.policy !== 'complete' || !rooms.size && !openings.length && p.visibility === 'conservative', 'Complete policy requires global ownership');
 ensure(p.policy !== 'reviewed-rooms' || rooms.size && !i.conservative_reasons.length && !i.clip_count && !i.skin_count && !i.dependencies.length, 'Uncertain source requires complete fallback');
 for (const raw of openings) { const o = object(raw, ['id', 'from', 'to', 'kind', 'corners', 'reviewed']); ensure(id.test(o.id) && !ids.has(o.id) && o.reviewed === true && ['doorway', 'window'].includes(o.kind) && rooms.has(o.from) && (o.to === null || rooms.has(o.to) && o.to !== o.from), 'Invalid reviewed visibility opening'); ensure(list(o.corners, 4).length === 4, 'Four opening corners required'); o.corners.forEach((c: unknown) => vector(c)); ensure(openingValid(o as PartitionOpening, rooms), 'Opening must be planar, convex and intersect its reviewed regions'); ids.add(o.id); }
 ensure(p.visibility !== 'reviewed-openings' || openings.length > 0, 'Reviewed visibility requires openings');
}
function payload(value: unknown) {
 const p = object(value, ['key', 'sha256', 'bytes', 'texture_rgba8_bytes', 'max_texture']);
 ensure(typeof p.key === 'string' && p.key.length && p.key.length <= 1024 && !p.key.includes('..') && !p.key.startsWith('/') && !/[\\?:#]/.test(p.key) && hash.test(p.sha256) && integer(p.bytes, 20) && integer(p.texture_rgba8_bytes) && integer(p.max_texture), 'Invalid private payload descriptor');
 return p as StoredPayload;
}
function coverage(ranges: number[][], count?: number) { ranges.sort((a, b) => a[0] - b[0]); let end = 0; for (const r of ranges) { if (r[0] !== end || r[1] <= r[0]) return false; end = r[1]; } return ranges.length > 0 && (count === undefined || end === count); }
export function validateChunkManifest(value: unknown): asserts value is ChunkManifest {
 const m = object(value, ['source_node_paths','source_clip_count','source_skin_count','schema', 'processor_version', 'parent_asset_id', 'source_sha256', 'partition_revision', 'coordinates', 'partition', 'source_surfaces', 'global_chunks', 'regions', 'chunks', 'dependencies', 'navigation', 'occlusion', 'fallback']);
 ensure(integer(m.source_clip_count)&&m.source_clip_count<=MAX&&integer(m.source_skin_count)&&m.source_skin_count<=MAX&&m.schema === streamingSchema && m.processor_version === chunkProcessorVersion && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(m.parent_asset_id) && hash.test(m.source_sha256) && integer(m.partition_revision, 1) && m.coordinates === 'source-space' && m.fallback === 'complete-original', 'Invalid streaming manifest identity/version');
 const surfaces = new Map<string, number>(), ranges = new Map<string, number[][]>(), nodes = new Map<string, InventoryNode>();
 const identity: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
 nodes.set('0', { path: '0', name: '', bounds: null, matrix: identity, renderable: false, triangles: 0, geometry_bytes: 0, embedded_image_bytes: 0 });
 ensure(list(m.source_surfaces).length, 'Missing source coverage');
 for (const raw of m.source_surfaces) {
  const s = object(raw, ['path', 'primitive', 'triangles', 'bounds']), key = `${s.path}:${s.primitive}`;
  ensure(typeof s.path === 'string' && path.test(s.path) && integer(s.primitive) && integer(s.triangles, 1) && !surfaces.has(key), 'Invalid source surface inventory'); validateBounds(s.bounds); surfaces.set(key, s.triangles); ranges.set(key, []);
  const parts = s.path.split('/'); for (let j = 1; j <= parts.length; j++) { const p = parts.slice(0, j).join('/'); if (!nodes.has(p)) nodes.set(p, { path: p, name: '', parent: parts.slice(0, j - 1).join('/'), bounds: null, matrix: identity, renderable: false, triangles: 0, geometry_bytes: 0, embedded_image_bytes: 0 }); }
  const n = nodes.get(s.path)!; n.renderable = true; n.triangles += s.triangles; n.bounds = n.bounds ? { min: n.bounds.min.map((v, i) => Math.min(v, s.bounds.min[i])) as Vec3, max: n.bounds.max.map((v, i) => Math.max(v, s.bounds.max[i])) as Vec3 } : s.bounds;
 }
 const declaredNodes=new Set<string>();ensure(list(m.source_node_paths).length,'Missing source hierarchy');for(const p of m.source_node_paths){ensure(typeof p==='string'&&path.test(p)&&!declaredNodes.has(p),'Invalid source hierarchy');declaredNodes.add(p);}ensure(declaredNodes.has('0'),'Missing source root');for(const p of declaredNodes)ensure(p==='0'||declaredNodes.has(p.slice(0,p.lastIndexOf('/'))),'Missing source parent');for(const p of nodes.keys())ensure(declaredNodes.has(p),'Mapping references missing source node');
 const inventory: SourceInventory = { clip_count:0,skin_count:0,schema: 'source-inventory-v1', coordinates: 'source-space', source_sha256: m.source_sha256, source_bytes: 20, bounds: { min:[0,1,2].map(axis=>Math.min(...m.source_surfaces.map((s:ChunkManifest['source_surfaces'][number])=>s.bounds.min[axis]))) as Vec3,max:[0,1,2].map(axis=>Math.max(...m.source_surfaces.map((s:ChunkManifest['source_surfaces'][number])=>s.bounds.max[axis]))) as Vec3 }, nodes: [...nodes.values()], dependencies: [], conservative_reasons: [] };
 validatePartition(m.partition, inventory);
 const refs = new Map<string, string[]>(), chunks = new Map<string, ChunkManifest['chunks'][number]>(), keys = new Map<string, string>();
 const variants = (v: unknown) => { const map = object(v, ['low', 'balanced', 'hq']); for (const tier of ['low', 'balanced', 'hq']) { const p = payload(map[tier]); ensure(!keys.has(p.key) || keys.get(p.key) === p.sha256, 'Conflicting payload identity'); keys.set(p.key, p.sha256); } };
 for (const raw of list(m.dependencies)) { const d = object(raw, ['source_node_paths','source_clip_indices','source_skin_indices','id', 'kind', 'requires', 'variants']); ensure(id.test(d.id) && !['navigation', 'occlusion'].includes(d.id) && !refs.has(d.id) && ['texture', 'animation', 'shared-contributor'].includes(d.kind), 'Invalid resource dependency'); variants(d.variants); refs.set(d.id, list(d.requires)); }
 let animationGroups=0;
 for(const d of m.dependencies){const members=list(d.source_node_paths),clips=list(d.source_clip_indices),skins=list(d.source_skin_indices);if(d.kind!=='animation'){ensure(!members.length&&!clips.length&&!skins.length,'Non-animation dependency has animation identities');continue;}animationGroups++;ensure(new Set(members).size===members.length&&members.length===declaredNodes.size&&members.every(p=>declaredNodes.has(p))&&clips.length===m.source_clip_count&&skins.length===m.source_skin_count,'Animation group must retain complete source hierarchy');for(const values of [clips,skins])ensure(new Set(values).size===values.length&&values.every(v=>integer(v)&&v<values.length),'Invalid source clip/skin indices');}
 ensure(m.source_clip_count+m.source_skin_count>0?animationGroups===1&&m.partition.policy==='complete':animationGroups===0,'Animated source requires one complete global dependency');
 ensure(list(m.chunks).length, 'Missing chunk set');
 for (const raw of m.chunks) {
  const c = object(raw, ['id', 'bounds', 'primitive_count', 'triangle_count', 'local_to_source', 'dependencies', 'surface_map', 'variants']);
  ensure(id.test(c.id) && !['navigation', 'occlusion'].includes(c.id) && !refs.has(c.id) && integer(c.primitive_count, 1) && integer(c.triangle_count, 1), 'Invalid chunk inventory'); validateBounds(c.bounds); matrix(c.local_to_source); variants(c.variants); refs.set(c.id, list(c.dependencies)); chunks.set(c.id, c as ChunkManifest['chunks'][number]);
  let count = 0; const locals = new Map<string, number[][]>(); ensure(list(c.surface_map).length, 'Missing source mappings');
  for (const raw of c.surface_map) { const s = object(raw, ['source_path', 'source_primitive', 'source_triangle_start', 'chunk_path', 'chunk_primitive', 'chunk_triangle_start', 'triangle_count']); const key = `${s.source_path}:${s.source_primitive}`, size = surfaces.get(key); ensure(size && integer(s.source_primitive) && integer(s.source_triangle_start) && integer(s.triangle_count, 1) && s.triangle_count <= size - s.source_triangle_start && path.test(s.chunk_path) && integer(s.chunk_primitive) && integer(s.chunk_triangle_start) && s.chunk_triangle_start <= c.triangle_count - s.triangle_count, 'Invalid source triangle mapping'); ranges.get(key)!.push([s.source_triangle_start, s.source_triangle_start + s.triangle_count]); const local = `${s.chunk_path}:${s.chunk_primitive}`; if (!locals.has(local)) locals.set(local, []); locals.get(local)!.push([s.chunk_triangle_start, s.chunk_triangle_start + s.triangle_count]); count += s.triangle_count; }
  ensure(count === c.triangle_count && locals.size === c.primitive_count && [...locals.values()].every(v => coverage(v)), 'Chunk inventory differs from mappings');
 }
 for (const [key, count] of surfaces) ensure(coverage(ranges.get(key)!, count), 'Lost or duplicated source triangles');
 const visiting = new Set<string>(), visited = new Set<string>();
 const visit = (ref: string) => { ensure(refs.has(ref) && !visiting.has(ref), 'Unknown or cyclic dependency'); if (visited.has(ref)) return; visiting.add(ref); const edges = refs.get(ref)!; ensure(new Set(edges).size === edges.length, 'Duplicate dependency'); edges.forEach(visit); visiting.delete(ref); visited.add(ref); }; [...refs.keys()].forEach(visit);
 const ownerPaths = new Map<string, string>(); for (const r of m.partition.rooms) for (const p of r.node_paths) ownerPaths.set(p, r.id); for (const p of m.partition.global_node_paths) ownerPaths.set(p, 'global');
 const owned = new Set<string>(), regionIds = new Set<string>(), roomIds = new Set(m.partition.rooms.map((r: PartitionRoom) => r.id));
 const own = (ids: unknown, owner: string) => { for (const id of list(ids)) { const c = chunks.get(id); ensure(c && !owned.has(id), 'Unknown or multiply owned chunk'); ensure(c.surface_map.every(s => ownerPaths.get(s.source_path) === owner), 'Chunk violates reviewed source ownership'); owned.add(id); } };
 if(animationGroups)ensure(m.chunks.every((c:ChunkManifest['chunks'][number])=>c.dependencies.some(id=>m.dependencies.some((d:ChunkManifest['dependencies'][number])=>d.id===id&&d.kind==='animation'))),'Global chunk omits animation dependency');
 own(m.global_chunks, 'global');
 for (const raw of list(m.regions, 512)) { const r = object(raw, ['id', 'chunks', 'display_requires', 'movement_requires']); ensure(roomIds.has(r.id) && !regionIds.has(r.id) && list(r.chunks).length, 'Invalid region ownership'); regionIds.add(r.id); own(r.chunks, r.id); const display = list(r.display_requires), movement = list(r.movement_requires); ensure(new Set(display).size === display.length && new Set(movement).size === movement.length && display.every(d => refs.has(d)) && movement.every(d => refs.has(d) || ['navigation', 'occlusion'].includes(d)), 'Invalid readiness references'); ensure([...r.chunks, ...m.global_chunks].every(d => display.includes(d) && movement.includes(d)) && display.every(d => movement.includes(d)) && movement.includes('navigation') && movement.includes('occlusion'), 'Movement requires visuals and exact indexes'); }
 ensure(owned.size === chunks.size && regionIds.size === roomIds.size, 'Unowned chunks or missing regions');
 const nav = object(m.navigation, ['payload', 'strategy', 'floor_source_paths', 'authored_semantics']), occ = object(m.occlusion, ['payload', 'strategy', 'floor_source_paths', 'authored_semantics']); payload(nav.payload); payload(occ.payload);
 ensure(nav.strategy === 'verified-exact-geometry' && nav.authored_semantics === 'authored-only-floors' && occ.strategy === 'verified-authored-occluders' && occ.authored_semantics === 'authored-material-visibility-sidedness', 'Invalid exact index semantics');
 const floorPaths = list(nav.floor_source_paths); ensure(new Set(floorPaths).size === floorPaths.length && floorPaths.every(p => nodes.get(p)?.renderable) && !list(occ.floor_source_paths).length, 'Invalid retained floor identity');
}
export function sourceIdentity(m: ChunkManifest, chunk: string, path: string, primitive: number, triangle: number) {
 const mapping = m.chunks.find(c => c.id === chunk)?.surface_map.find(s => s.chunk_path === path && s.chunk_primitive === primitive && triangle >= s.chunk_triangle_start && triangle < s.chunk_triangle_start + s.triangle_count);
 return mapping ? { path: mapping.source_path, primitive: mapping.source_primitive, triangle: mapping.source_triangle_start + triangle - mapping.chunk_triangle_start } : undefined;
}
export function parseChunkManifest(value: unknown) { try { validateChunkManifest(value); return value; } catch { return undefined; } }
// Validate the delivered DTO without retaining URLs as durable/cache identity.
export function validateDeliveredChunkManifest(value:unknown):asserts value is ChunkManifest<DeliveredPayload>{
 let sequence=0;
 function descriptor(raw:unknown):StoredPayload{
  const p=object(raw,['url','sha256','bytes','texture_rgba8_bytes','max_texture']);
  ensure(typeof p.url==='string'&&p.url.length<=16384,'Invalid signed descriptor URL');
  const url=new URL(p.url);ensure(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash,'Invalid signed descriptor URL');
  return {key:'descriptor-'+sequence++,sha256:p.sha256,bytes:p.bytes,texture_rgba8_bytes:p.texture_rgba8_bytes,max_texture:p.max_texture};
 }
 const converted=structuredClone(value) as Record<string,any>;
 ensure(converted&&typeof converted==='object','Expected delivered manifest');
 const variants=(v:unknown)=>{const raw=object(v,['low','balanced','hq']);return Object.fromEntries(['low','balanced','hq'].map(t=>[t,descriptor(raw[t])]));};
 for(const chunk of list(converted.chunks))chunk.variants=variants(chunk.variants);
 for(const dependency of list(converted.dependencies))dependency.variants=variants(dependency.variants);
 converted.navigation={...object(converted.navigation,['payload','strategy','floor_source_paths','authored_semantics']),payload:descriptor(converted.navigation.payload)};
 converted.occlusion={...object(converted.occlusion,['payload','strategy','floor_source_paths','authored_semantics']),payload:descriptor(converted.occlusion.payload)};
 validateChunkManifest(converted);
}

export function validateManifestAgainst(m:ChunkManifest,i:SourceInventory,p:Partition,parent:string,revision:number){
 validateChunkManifest(m);validatePartition(p,i);
 ensure(m.parent_asset_id===parent&&m.source_sha256===i.source_sha256&&m.partition_revision===revision&&m.source_clip_count===i.clip_count&&m.source_skin_count===i.skin_count,'Manifest differs from parent/source/partition revision');
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 ensure(JSON.stringify(canonical(m.partition))===JSON.stringify(canonical(p)),'Manifest changed reviewed ownership');
 const nodes=new Set(i.nodes.map(n=>n.path)),surfaces=new Map(i.nodes.filter(n=>n.renderable).map(n=>[`${n.path}:${n.source_primitive??0}`,n]));
 ensure(m.source_node_paths.length===nodes.size&&m.source_node_paths.every(path=>nodes.has(path))&&m.source_surfaces.length===surfaces.size,'Source inventory coverage mismatch');
 for(const s of m.source_surfaces){const node=surfaces.get(`${s.path}:${s.primitive}`);ensure(node&&node.triangles===s.triangles&&node.bounds&&contains(node.bounds,s.bounds)&&contains(s.bounds,node.bounds),'Source surface inventory mismatch');}
}

// In scoped-descriptors mode manifest payload URLs return JSON descriptors;
// fetch that endpoint to obtain a renewable signed binary URL.
export type ChunkDescriptorManifestResponse = { delivery: 'scoped-descriptors'; manifest: ChunkManifest<DeliveredPayload> };
