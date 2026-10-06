import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Mesh, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { performanceFixtures, benchmarkVersion } from './performance-fixtures.mjs';
import { buildLayout } from '../src/layoutGeometry.ts';
import { HotspotVisibility, hotspotPoint, visibilityResult } from '../src/hotspotVisibility.ts';

// Preserve the pre-Phase-3 path for repeatable CPU/work comparisons.
function legacy(point, camera, objects) {
  camera.updateMatrixWorld();
  const projected = point.clone().project(camera);
  if (projected.z < -1 || projected.z > 1) return false;
  const origin = camera.getWorldPosition(new Vector3()), delta = point.clone().sub(origin);
  const ray = new Raycaster(origin, delta.clone().normalize(), 0, Math.max(0, delta.length() - .07));
  ray.camera = camera;
  return !ray.intersectObjects(objects, true).some(hit => hit.object instanceof Mesh && hit.object.visible);
}
const { scenes, hotspots } = performanceFixtures(), scene = scenes.find(s => s.name.startsWith('Many hotspots'));
const prepared = buildLayout(scene.layout, new Map()), objects = [prepared.root];
const points = hotspots.filter(h => h.scene_id === scene.id).map(h => hotspotPoint(h.position));
const camera = new PerspectiveCamera(60, 1280 / 900, .05, 100);
camera.position.set(0, 1.75, 0);
let intersections = 0;
prepared.root.traverse(object => {
  if (object instanceof Mesh) { const raycast = object.raycast; object.raycast = function (...args) { intersections++; return raycast.apply(this, args); }; }
});
function run(optimized, moving, adjacent = false) {
  camera.position.set(0, 1.75, adjacent ? 6 : 0);
  const evaluator = new HotspotVisibility(), results = points.map(visibilityResult);
  intersections = 0;
  const start = performance.now();
  for (let frame = 0; frame < 180; frame++) {
    camera.rotation.y = moving ? Math.sin(frame / 30) * 1.2 : 0;
    if (optimized) { evaluator.begin(camera, objects, false); for (const result of results) evaluator.evaluate(result); }
    else for (const point of points) legacy(point, camera, objects);
  }
  return { cpuMsPerFrame: (performance.now() - start) / 180, meshRaycasts: intersections, ...(optimized ? { work: { ...evaluator.stats } } : {}) };
}
try {
  // Verify visitor answers agree inside the full view, including camera turns.
  const evaluator = new HotspotVisibility();
  for (const adjacent of [false, true]) for (const angle of [0, .4, 1.2, Math.PI]) {
    camera.position.set(0, 1.75, adjacent ? 6 : 0);
    camera.rotation.y = angle; evaluator.begin(camera, objects, false);
    for (const point of points) {
      const result = evaluator.evaluate(visibilityResult(point)), p = point.clone().project(camera);
      const inView = Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1;
      assert.equal(result.visible, inView && legacy(point, camera, objects));
    }
  }
  for (const moving of [false, true]) { run(false, moving); run(true, moving); }
  const workloads = [];
  for (const [moving, adjacent] of [[false, false], [true, false], [true, true]]) {
    const before = [], after = [];
    for (let i = 0; i < 3; i++) { before.push(run(false, moving, adjacent)); after.push(run(true, moving, adjacent)); }
    assert.ok(after.every((r, i) => r.meshRaycasts < before[i].meshRaycasts));
    workloads.push({ name: adjacent ? 'panning from adjacent room' : moving ? 'panning' : 'stationary rendered frames', before, after });
  }
  const report = { runtime: { node: process.version, platform: process.platform, architecture: process.arch }, camera: { fov: 60, aspect: 1280 / 900, near: .05, far: 100, initialPosition: [0, 1.75, 0], adjacentPosition: [0, 1.75, 6], panYaw: 'sin(frame / 30) * 1.2' }, benchmarkVersion, scene: scene.name, hotspots: points.length, framesPerRun: 180, execution: 'Node CPU visibility microbenchmark; excludes DOM, GPU and total browser frame time; not physical-device acceptance', workloads };
  const output = process.env.HOTSPOT_PERFORMANCE_OUTPUT || '/tmp/hotspot-visibility-performance.json';
  await writeFile(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); console.log(`Report: ${output}`);
} finally { prepared.dispose(); }
