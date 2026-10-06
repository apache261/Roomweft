import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, textureBytes, PerformanceRun, sceneFingerprint } from '../src/performanceMetrics.ts';
import { performanceFixtures } from '../scripts/performance-fixtures.mjs';
import { buildLayout } from '../src/layoutGeometry.ts';
import { WalkWorld } from '../src/navigation.ts';
test('frame distributions retain outliers and handle absent measurements', () => {
  assert.deepEqual(summarize([]), { samples: 0, median: null, p95: null, p99: null, max: null });
  assert.deepEqual(summarize([...Array(98).fill(16), 70, 100]), { samples: 100, median: 16, p95: 16, p99: 70, max: 100 });
  assert.equal(summarize([10, 20]).median, 15);
  const run = new PerformanceRun({ device: 'test' }); run.frame(100, 20, 7, 800);
  assert.equal(run.snapshot().frameMs.max, 100); assert.equal(run.snapshot().drawCalls.median, 7);
  run.usableMs = 123; run.resetFrames();
  assert.equal(run.snapshot().frameMs.samples, 0); assert.equal(run.snapshot().firstUsableViewMs, 123);
});
test('texture proxy accounts for rectangular mip chains and cube faces', () => {
  assert.equal(textureBytes(4, 2, false), 32);
  assert.equal(textureBytes(4, 2), 44);
  assert.equal(textureBytes(4, 2, true, 6), 264);
  assert.equal(sceneFingerprint({ revision: 1 }), sceneFingerprint({ revision: 1 }));
  assert.notEqual(sceneFingerprint({ revision: 1 }), sceneFingerprint({ revision: 2 }));
});
test('six benchmark scenes include a connected modular world with safe starts', () => {
  const { scenes, hotspots } = performanceFixtures(); assert.equal(scenes.length, 6); assert.equal(hotspots.length, 160);
  for (const scene of scenes.filter(s => s.layout && !s.layout.elements.some(e => e.kind === 'INSTANCE'))) {
    const prepared = buildLayout(scene.layout, new Map()); const world = new WalkWorld(prepared.root);
    assert.ok(world.start(), scene.name); world.dispose(); prepared.dispose();
  }
});

test('idle wake renders retain draw counts without contaminating frame intervals', () => { const run = new PerformanceRun({}); run.frame(null, 2, 5, 100); assert.equal(run.snapshot().frameMs.samples, 0); assert.equal(run.snapshot().drawCalls.max, 5); assert.equal(run.snapshot().renderedFrames, 1); assert.equal(run.snapshot().idleWakeFrames, 1); run.frame(1000, 20, 7, 200); assert.equal(run.snapshot().frameMs.max, 1000); });
