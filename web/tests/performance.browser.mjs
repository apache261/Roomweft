import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { performanceFixtures, performanceFiles, benchmarkVersion } from '../scripts/performance-fixtures.mjs';
const origin = process.env.TOUR_ORIGIN || 'http://localhost:5173';
const { project, scenes, assets, hotspots } = performanceFixtures(), files = await performanceFiles();
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(origin + '/benchmark-assets/**', r => r.fulfill({ body: files.get(new URL(r.request().url()).pathname.split('/').at(-1)), contentType: r.request().url().endsWith('.png') ? 'image/png' : 'model/gltf-binary' }));
  let active = scenes[0];
  await context.route(origin + '/api/v1/**', async r => {
    const path = new URL(r.request().url()).pathname.slice('/api/v1'.length); let data;
    if (path === `/projects/${project.id}`) data = project;
    else if (path.endsWith('/assets')) data = assets;
    else if (assets.some(a => path.endsWith(`/assets/${a.id}`))) { const a = assets.find(a => path.endsWith(`/assets/${a.id}`)); data = { ...a, url: origin + '/benchmark-assets/' + a.name }; }
    else if (path.endsWith('/scenes')) data = [active];
    else if (path.endsWith('/hotspots')) data = hotspots.filter(h => h.scene_id === active.id);
    else if (path.endsWith('/layout')) data = { document: active.layout, revision: 1 };
    else if (path === `/public/tours/${project.slug}`) data = { ...project, start_scene_id: active.id, scenes: [active] };
    else throw new Error('Unexpected route ' + path);
    await r.fulfill({ json: data });
  });
  const page = await context.newPage(), errors = [], output = process.env.PERFORMANCE_OUTPUT || '/tmp/performance-smoke';
  page.on('pageerror', e => errors.push(e.message)); await mkdir(output, { recursive: true });
  async function record(scene, route, name) {
    active = scene;
    await page.goto(origin + route + '?perf=1&device=chromium-swiftshader-emulation'+(process.env.SPATIAL_RENDERING==='0'?'&spatial=0':''));
    await page.getByRole('button', { name: 'Inspect model', exact: true }).waitFor();
    let profiler;
    if (process.env.PERFORMANCE_CPU_PROFILE === '1') { profiler = await context.newCDPSession(page); await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
    await page.waitForTimeout(Number(process.env.PERFORMANCE_SAMPLE_MS || 1500));
    if (profiler) {
      const { profile } = await profiler.send('Profiler.stop');
      await writeFile(`${output}/${name}.cpuprofile`, JSON.stringify(profile));
      await profiler.detach();
    }
    await page.getByText('Performance diagnostics (development)', { exact: true }).click();
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export performance run', exact: true }).click();
    const download = await downloaded, report = JSON.parse(await readFile(await download.path(), 'utf8'));
    report.metadata.cpuProfilerEnabled = process.env.PERFORMANCE_CPU_PROFILE === '1';
    assert.ok(report.renderedFrames > 0, scene.name); assert.ok(report.firstUsableViewMs > 0, scene.name);
    assert.ok(report.drawCalls.max > 0); assert.ok(report.triangles.max > 0); assert.ok(report.timings.some(t => t.stage === 'collision-preparation'));
    if (scene.type === '3D') assert.ok(report.timings.some(t => t.stage === 'gltf-decode' && t.bytes > 0));
    if (scene.name.startsWith('Texture')) { assert.ok(report.resources.textureInventory.filter(t => t.width === 2048).length >= 4); assert.ok(report.resources.textureRgba8EquivalentBytes >= 4 * 2048 * 2048 * 4); }
    assert.ok(!JSON.stringify(report).includes('/benchmark-assets/'), 'URLs omitted');
    await page.getByRole('button', { name: 'Start new frame sample', exact: true }).click();
    await writeFile(`${output}/${name}.json`, JSON.stringify({ ...report, benchmarkVersion, execution: 'headless software renderer; instrumentation smoke only; not a physical-device baseline' }, null, 2));
  }
  const benchmarkScenes = scenes.filter(s => !process.env.PERFORMANCE_SCENE || s.name.startsWith(process.env.PERFORMANCE_SCENE));
  for (const scene of benchmarkScenes) await record(scene, '/t/' + project.slug, scene.id);
  await record(scenes[0], '/embed/' + project.slug, 'embed');
  active = scenes[1];
  await page.goto(origin + '/projects/' + project.id + '?perf=1'); await page.getByText('Performance diagnostics (development)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Walk inside', exact: true }).waitFor();
  await page.goto(origin + '/t/' + project.slug); await page.getByRole('button', { name: 'Inspect model', exact: true }).waitFor();
  assert.equal(await page.getByText('Performance diagnostics (development)', { exact: true }).count(), 0);
  assert.deepEqual(errors, []); console.log(`Performance instrumentation and ${benchmarkScenes.length} benchmark scenes passed. Smoke reports: ${output}`);
} finally { await browser.close(); }
