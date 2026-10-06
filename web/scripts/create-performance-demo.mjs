import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performanceFixtures, performanceFiles, benchmarkVersion } from './performance-fixtures.mjs';
const origin = process.env.TOUR_ORIGIN || 'http://localhost:5173';
async function request(path, method = 'GET', data) {
  const response = await fetch(`${origin}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  if (!response.ok) throw new Error(`${method} ${path}: ${await response.text()}`);
  return response.status === 204 ? undefined : response.json();
}
const fixtures = performanceFixtures(), files = await performanceFiles();
const project = await request('/projects', 'POST', { name: fixtures.project.name, description: 'Versioned phase 1 benchmark suite. Synthetic stress cases; see docs/performance-benchmarks.md.' });
try {
  const assets = new Map(), scenes = new Map();
  for (const asset of fixtures.assets) {
    const bytes = files.get(asset.name), ticket = await request(`/projects/${project.id}/uploads`, 'POST', { name: asset.name, size: bytes.length, file_type: asset.file_type });
    const form = new FormData(); for (const [key, value] of Object.entries(ticket.upload.fields)) form.append(key, value);
    form.append('file', new Blob([bytes], { type: asset.file_type === 'GLB' ? 'model/gltf-binary' : 'image/png' }), asset.name);
    const response = await fetch(ticket.upload.url, { method: 'POST', body: form }); if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
    assets.set(asset.id, (await request(`/assets/${ticket.asset.id}/complete`, 'POST')).id);
  }
  for (const fixture of fixtures.scenes) {
    const doc = structuredClone(fixture.layout);
    if (doc) { for (const e of doc.elements) if (e.asset_id) e.asset_id = assets.get(e.asset_id); for (const m of doc.materials || []) m.base_color = assets.get(m.base_color); }
    const scene = await request(`/projects/${project.id}/scenes`, 'POST', { name: fixture.name, type: fixture.type, asset_id: assets.get(fixture.asset_id), layout: doc });
    const saved = await request(`/scenes/${scene.id}`, 'PATCH', { settings: fixture.settings, start_camera: fixture.start_camera });
    scenes.set(fixture.id, saved);
  }
  for (const h of fixtures.hotspots) await request(`/scenes/${scenes.get(h.scene_id).id}/hotspots`, 'POST', { type: h.type, title: h.title, description: h.description, position: h.position });
  const manifest = { benchmarkVersion, projectId: project.id, origin, scenes: [...scenes.values()], assets: [...files].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })) };
  const output = process.env.PERFORMANCE_MANIFEST || '/tmp/performance-benchmarks.json'; await writeFile(output, JSON.stringify(manifest, null, 2));
  console.log(`Created ${fixtures.scenes.length} benchmarks: ${origin}/projects/${project.id}?perf=1\nManifest: ${output}`);
} catch (error) { await request(`/projects/${project.id}`, 'DELETE'); throw error; }
