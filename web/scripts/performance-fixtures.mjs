import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { template, layoutIssues } from '../src/layout.ts';
import { defaultSettings } from '../src/sceneSettings.ts';
import { newMaterial } from '../src/materials.ts';

export const benchmarkVersion = 1;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function room(kind, x, z, n, size = 6) { return { ...template(kind, x, z), id: id(n), width: size, depth: size, name: `Room ${n}` }; }
function grid(side) {
  const elements = [], doors = [];
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const n = z * side + x, e = room(n ? 'ROOM' : 'LOBBY', x * 6, -z * 6, 100 + n); elements.push(e);
    if (x) doors.push({ id: id(300 + doors.length), a: id(100 + n - 1), b: e.id, at: e.z, width: 1.2, height: 2.2 });
    if (z) doors.push({ id: id(300 + doors.length), a: id(100 + n - side), b: e.id, at: e.x, width: 1.2, height: 2.2 });
  }
  return { version: 1, elements, doors };
}
export function performanceFixtures() {
  const project = { id: id(1), name: 'Performance benchmarks v1', slug: 'performance-v1', published: true, start_scene_id: id(10) };
  const asset = (n, name, file_type = 'GLB') => ({ id: id(n), name, file_type, upload_status: 'ready', project_id: project.id });
  const assets = [asset(2, 'house.glb'), asset(3, 'layout-table.glb'), asset(4, 'room-fan.glb'), ...Array.from({ length: 4 }, (_, i) => asset(500 + i, `benchmark-2048-${i}.png`, 'TEXTURE_BASE_COLOR'))];
  const scene = (n, name, type, extra) => ({ id: id(n), project_id: project.id, name, type, settings: structuredClone(defaultSettings), layout_revision: 1, start_camera: { position: [0, 1.65, 0], yaw: 0, pitch: 0 }, ...extra });
  const furniture = { version: 1, elements: [room('LOBBY', 0, 0, 100, 20)], doors: [] };
  for (let i = 0; i < 64; i++) furniture.elements.push({ ...template('INSTANCE', (i % 8) * 2 - 7, Math.floor(i / 8) * 2 - 7), id: id(600 + i), name: `Table ${i}`, asset_id: assets[1].id });
  const textured = grid(2);
  textured.materials = assets.slice(3).map((a, i) => ({ ...newMaterial(`2048 texture ${i}`), id: id(700 + i), base_color: a.id }));
  textured.elements.forEach((e, i) => { e.floor_material = textured.materials[i].id; e.wall_material = textured.materials[i].id; });
  const houseSettings = { ...structuredClone(defaultSettings), navigation: { regions: [{ id: 'house-floor', name: 'Fixture reviewed floor', left: -3, right: 3, top: -2.5, bottom: 2.5, min_y: 0, max_y: .11, floor_meshes: ['0/0'] }] } };
  const fanSettings = { ...structuredClone(defaultSettings), navigation: { regions: [{ id: 'fan-floor', name: 'Fixture reviewed floor', left: -2, right: 2, top: -1.5, bottom: 1.5, min_y: -.01, max_y: .01, floor_meshes: ['0/0/0'] }] } };
  const scenes = [scene(10, 'Small house', '3D', { asset_id: assets[0].id, settings: houseSettings }), scene(11, 'Large modular interior (25 rooms)', 'LAYOUT', { layout: grid(5) }), scene(12, 'Repeated furniture (64 tables)', 'LAYOUT', { layout: furniture }), scene(13, 'Texture-heavy uploads (4 × 2048)', 'LAYOUT', { layout: textured }), scene(14, 'Animated fan room', '3D', { asset_id: assets[2].id, settings: fanSettings }), scene(15, 'Many hotspots (160)', 'LAYOUT', { layout: grid(2) })];
  const hotspots = Array.from({ length: 160 }, (_, i) => ({ id: id(800 + i), scene_id: scenes[5].id, type: 'INFO', title: `Marker ${i + 1}`, description: 'Visibility benchmark', position: { x: -2.8 + (i % 20) * .28, y: .4 + Math.floor(i / 20) * .25, z: -2.88 } }));
  for (const s of scenes) if (s.layout && layoutIssues(s.layout).errors.length) throw new Error(layoutIssues(s.layout).errors.join('\n'));
  return { project, scenes, assets, hotspots };
}
export async function performanceFiles() {
  const files = new Map();
  for (const [name, path] of [['house.glb', '../../tests/testdata/house.glb'], ['layout-table.glb', '../../tests/testdata/layout-table.glb'], ['room-fan.glb', '../../assets/prefabs/practice-house/room-fan.glb']]) files.set(name, await readFile(new URL(path, import.meta.url)));
  for (let n = 0; n < 4; n++) {
    const png = new PNG({ width: 2048, height: 2048 });
    for (let y = 0; y < 2048; y++) for (let x = 0; x < 2048; x++) {
      const i = (y * 2048 + x) * 4;
      png.data[i] = (x * (n + 1) + y) % 256; png.data[i + 1] = (y * 3 + n * 40) % 256; png.data[i + 2] = (x ^ y ^ n * 51) % 256; png.data[i + 3] = 255;
    }
    files.set(`benchmark-2048-${n}.png`, PNG.sync.write(png));
  }
  return files;
}
