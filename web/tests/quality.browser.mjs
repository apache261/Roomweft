import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { performanceFixtures } from '../scripts/performance-fixtures.mjs';
const origin = process.env.TOUR_ORIGIN || 'http://localhost:5173';
const { project, scenes, assets } = performanceFixtures();
let active = scenes[1];
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 650 }, deviceScaleFactor: 2 });
  const fan = await readFile(new URL('../../assets/prefabs/practice-house/room-fan.glb', import.meta.url));
  await context.route(origin + '/room-fan.glb', r => r.fulfill({ body: fan, contentType: 'model/gltf-binary' }));
  await context.route(origin + '/api/v1/**', async r => {
    const path = new URL(r.request().url()).pathname.slice('/api/v1'.length); let data;
    if (path === `/projects/${project.id}`) data = { ...project, start_scene_id: active.id };
    else if (path.endsWith('/assets')) data = assets;
    else if (path.endsWith(`/assets/${assets[2].id}`)) data = { ...assets[2], url: origin + '/room-fan.glb' };
    else if (path.endsWith('/scenes')) data = [active];
    else if (path.endsWith('/hotspots')) data = [{ id: 'marker', scene_id: active.id, type: 'INFO', title: 'Quality test marker', description: 'Overlay wake check', position: { x: 0, y: 1.4, z: -2.88 } }];
    else if (path.endsWith('/layout')) data = { document: active.layout, revision: 1 };
    else if (path === `/scenes/${active.id}`) { if (r.request().method() === 'PATCH') active = { ...active, ...r.request().postDataJSON() }; data = active; }
    else if (path === `/public/tours/${project.slug}`) data = { ...project, start_scene_id: active.id, scenes: [active] };
    else throw new Error('Unexpected route ' + path);
    await r.fulfill({ json: data });
  });
  const page = await context.newPage(), errors = [], evidence = [];
  page.on('pageerror', e => errors.push(e.message));
  const snapshot = () => page.evaluate(() => window.__tourPerformance);
  const ratio = () => page.locator('canvas').evaluate(c => c.width / c.clientWidth);
  async function waitForIdle() { await page.evaluate(() => { delete window.__qualityIdle; }); await page.waitForFunction(() => { const r = window.__tourPerformance; if (!r) return false; const now = performance.now(); const last = window.__qualityIdle; if (!last || last.frames !== r.renderedFrames || r.metadata.activeRenderTasks) { window.__qualityIdle = { frames: r.renderedFrames, since: now }; return false; } return now - last.since > 650; }, null, { timeout: 30000 }); }
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  async function open(route = '/t/') { await page.goto(origin + route + project.slug + '?perf=1'); await page.getByRole('button', { name: 'Inspect model', exact: true }).waitFor(); await page.waitForFunction(() => window.__tourPerformance?.firstUsableViewMs !== null && window.__tourPerformance?.firstUsableViewMs !== undefined); await page.waitForTimeout(300); }
  await open();
  const quality = page.getByLabel('Rendering quality', { exact: true });
  for (const [setting, expected] of [['low', 1], ['balanced', 1.5], ['hq', 2]]) {
    const before = (await snapshot()).metadata.cameraPosition;
    await quality.selectOption(setting); await page.waitForTimeout(400);
    assert.ok(Math.abs(await ratio() - expected) < .01, setting);
    assert.ok(distance(before, (await snapshot()).metadata.cameraPosition) < 1e-5, 'quality must preserve standing position: ' + JSON.stringify({ setting, before, after: (await snapshot()).metadata.cameraPosition }));
    const first = await snapshot(); await page.waitForTimeout(800); const last = await snapshot();
    assert.ok(last.renderedFrames - first.renderedFrames <= 1, `idle ${setting}: ${last.renderedFrames - first.renderedFrames}`);
    evidence.push({ setting, dpr: await ratio(), idleWindowMs: 800, idleFrames: last.renderedFrames - first.renderedFrames });
  }
  await page.reload(); await page.getByRole('button', { name: 'Inspect model', exact: true }).waitFor(); assert.equal(await quality.inputValue(), 'hq');
  await quality.selectOption('low'); await page.waitForTimeout(300);
  // Restart movement after the renderer has slept, and retain collision support.
  const canvas = page.locator('canvas'); await canvas.focus(); const initial = (await snapshot()).metadata.cameraPosition;
  await page.keyboard.down('w'); await page.waitForTimeout(700); await page.keyboard.up('w'); await page.waitForTimeout(500);
  const moved = (await snapshot()).metadata.cameraPosition; assert.ok(distance(initial, moved) > .1, 'walking wakes after idle'); assert.ok(Math.abs(initial[1] - moved[1]) < .02, 'standing floor preserved');
  await waitForIdle();
  const settled = await snapshot(); await page.waitForTimeout(600); const settledEnd = await snapshot(); assert.ok(settledEnd.renderedFrames - settled.renderedFrames <= 1, 'braking settles into idle: ' + JSON.stringify({ start: settled.renderedFrames, end: settledEnd.renderedFrames, startPosition: settled.metadata.cameraPosition, endPosition: settledEnd.metadata.cameraPosition, tasks: settledEnd.metadata.activeRenderTasks }));
  await canvas.focus(); await page.keyboard.down('s'); await page.waitForTimeout(200);
  const beforeHidden = (await snapshot()).metadata.cameraPosition;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(500); const hidden = await snapshot(); assert.equal(hidden.metadata.frameloop, 'never'); await page.waitForTimeout(400); assert.equal((await snapshot()).renderedFrames, hidden.renderedFrames, 'hidden render loop stopped');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(500); const resumed = (await snapshot()).metadata.cameraPosition; assert.ok(distance(beforeHidden, resumed) < .03, 'held key cleared on hide; no resume teleport'); await page.keyboard.up('s');
  // Orbit damping must schedule its tail and eventually become idle.
  await page.getByRole('button', { name: 'Inspect model', exact: true }).click(); await page.waitForTimeout(400);
  const beforeOrbit = (await snapshot()).metadata.cameraQuaternion, box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .6, box.y + box.height * .45, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(2000);
  assert.ok(distance(beforeOrbit, (await snapshot()).metadata.cameraQuaternion) > .05, 'orbit updates');
  await waitForIdle();
  const orbitSettled = await snapshot(); await page.waitForTimeout(600); assert.ok((await snapshot()).renderedFrames - orbitSettled.renderedFrames <= 2, 'damping becomes idle');
  await page.getByRole('button', { name: 'Hotspots', exact: true }).click(); await page.getByRole('button', { name: 'Show hotspot', exact: true }).click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Hotspots', exact: true }).click(); await page.getByRole('button', { name: 'Open information', exact: true }).click(); await page.getByRole('dialog').waitFor(); await page.getByRole('button', { name: 'Close information', exact: true }).click();
  // Manual choice applies in public, embed, preview and editor viewers.
  await open('/embed/'); assert.equal(await quality.inputValue(), 'low'); assert.ok(await ratio() <= 1.01);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  const controls = await page.locator('.walk-toolbar button, .walk-toolbar select').evaluateAll(elements => elements.map(e => { const r = e.getBoundingClientRect(); return { name: e.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
  for (const a of controls) { assert.ok(a.left >= 0 && a.right <= 391 && a.bottom <= 844, 'mobile quality/controls fit'); for (const b of controls) if (a !== b) assert.ok(Math.min(a.right, b.right) - Math.max(a.left, b.left) < 1 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < 1, 'mobile controls overlap: ' + a.name + ' / ' + b.name); }
  await page.setViewportSize({ width: 900, height: 650 });
  await page.goto(origin + '/projects/' + project.id + '?perf=1'); await page.getByRole('button', { name: 'Walk inside', exact: true }).waitFor(); assert.equal(await quality.inputValue(), 'low');
  await page.getByRole('button', { name: 'Preview tour', exact: true }).click(); await quality.waitFor(); assert.equal(await quality.inputValue(), 'low');
  // Embedded clips keep animating with a stationary camera and pause while hidden.
  active = scenes[4]; await open(); await page.waitForTimeout(300); const animationStart = await snapshot(); await page.waitForTimeout(700); const animationEnd = await snapshot();
  assert.ok(animationEnd.renderedFrames - animationStart.renderedFrames >= 5, 'animation keeps scheduling frames');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300); const animationHidden = await snapshot(); await page.waitForTimeout(500); assert.equal((await snapshot()).renderedFrames, animationHidden.renderedFrames);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForTimeout(500); assert.ok((await snapshot()).renderedFrames > animationHidden.renderedFrames);
  await quality.selectOption('auto'); await page.reload(); await quality.waitFor(); assert.equal(await quality.inputValue(), 'auto');
  assert.deepEqual(errors, []);
  const output = process.env.QUALITY_OUTPUT || '/tmp/quality-smoke'; await mkdir(output, { recursive: true }); await writeFile(output + '/quality-smoke.json', JSON.stringify({ execution: 'headless ANGLE SwiftShader; simulated visibility changes; not physical-device evidence', evidence, animationFramesDuring700ms: animationEnd.renderedFrames - animationStart.renderedFrames }, null, 2));
  console.log('Quality checks passed: caps, persistence, idle, walking, damping, overlays, hidden resume, animation, builder/preview/public/embed.');
} finally { await browser.close(); }
