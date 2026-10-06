import {reviewedInterior} from '../scripts/reviewed-interior.mjs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAppearanceDemo } from '../scripts/create-appearance-demo.mjs';
const origin = process.env.TOUR_ORIGIN || 'http://localhost:5173';
const frontend = process.env.TOUR_FRONTEND_ORIGIN;
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
let fixture, page;
const errors = [];
function colorCounts(bytes) {
  const { data } = PNG.sync.read(bytes);
  let red = 0, blue = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [r,g,b] = data.subarray(i,i+3);
    if (r > 90 && r > g * 1.4 && r > b * 1.4) red++;
    if (b > 90 && b > g * 1.25 && b > r * 1.4) blue++;
  }
  return { red, blue };
}
function rewriteGLB(bytes, edit) {
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20,20+length).toString()); edit(json);
  let document = Buffer.from(JSON.stringify(json));
  document = Buffer.concat([document,Buffer.alloc((4-document.length%4)%4,32)]);
  const bin = bytes.subarray(28+length);
  const result = Buffer.alloc(28+document.length+bin.length);
  result.write('glTF'); result.writeUInt32LE(2,4); result.writeUInt32LE(result.length,8);
  result.writeUInt32LE(document.length,12); result.writeUInt32LE(0x4e4f534a,16); document.copy(result,20);
  result.writeUInt32LE(bin.length,20+document.length); result.writeUInt32LE(0x004e4942,24+document.length); bin.copy(result,28+document.length);
  return result;
}
try {
  fixture = await createAppearanceDemo(frontend || origin);
  const { project, lobby, corrected, request, upload, settings } = fixture;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['local-network-access'] });
  if (frontend) await context.route(origin+'/**',async route => {
    const response = await route.fetch({ url: frontend + route.request().url().slice(origin.length) });
    await route.fulfill({ response });
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/projects/${project.id}`);
  await page.getByText(/Prepared dimensions:.*Standing floor found/).waitFor();
  await page.getByRole('button',{name:'Walk inside',exact:true}).click();
  await page.waitForTimeout(400);
  const initial = colorCounts(await page.locator('canvas').screenshot());
  assert.ok(initial.red > 100 && initial.blue > 100, `paint colors missing: ${JSON.stringify(initial)}`);
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();await page.getByLabel('Exposure',{exact:true}).fill('1.3');
  await page.getByLabel('Environment lighting',{exact:true}).fill('0.8');
  await page.getByLabel('Light intensity',{exact:true}).fill('0.6');
  await page.getByLabel('Background',{exact:true}).fill('#d9e3ed');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved.',{exact:true}).waitFor();
  let persisted = await request(`/scenes/${lobby.id}`);
  assert.equal(persisted.settings.appearance.exposure,1.3);
  assert.deepEqual(persisted.start_camera,{position:[0,1.75,2],yaw:0,pitch:0});
  await page.reload();
  await page.getByText(/Prepared dimensions:.*Standing floor found/).waitFor();
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();assert.equal(await page.getByLabel('Exposure',{exact:true}).inputValue(),'1.3');
  await page.getByRole('button',{name:'Walk inside',exact:true}).click();
  await page.waitForTimeout(400);
  const savedColors=colorCounts(await page.locator('canvas').screenshot());
  assert.ok(savedColors.red>100 && savedColors.blue>100);
  // Preview and public share the saved appearance and camera.
  await page.getByRole('button',{name:'Preview tour',exact:true}).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Inspect model' && !b.disabled));
  await page.waitForTimeout(400);
  const previewColors=colorCounts(await page.locator('canvas').screenshot());
  assert.ok(previewColors.red>100 && previewColors.blue>100, JSON.stringify(previewColors));
  await request(`/projects/${project.id}/publish`,'POST');
  for (const route of ['/t/','/embed/']) {
    await page.goto(origin+route+project.slug);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Inspect model' && !b.disabled));
    await page.waitForTimeout(500);
    const colors=colorCounts(await page.locator('canvas').screenshot());
    assert.ok(colors.red>100 && colors.blue>100, `missing colors on ${route}: ${JSON.stringify(colors)}`);
    assert.equal(await page.locator('.scene-settings').count(),0);
  }
  // Transform persistence, hotspot attachment, valid spawn, and reset.
  await page.goto(`${origin}/projects/${project.id}`);
  await page.getByText(/Prepared dimensions:.*Standing floor found/).waitFor();
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();await page.getByLabel('Model rotation (degrees)',{exact:true}).fill('90');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved. Hotspots moved with the model. Walk inside and save a new start view.',{exact:true}).waitFor();
  persisted=await request(`/scenes/${lobby.id}`); assert.deepEqual(persisted.start_camera,{});
  const hotspots=await request(`/scenes/${lobby.id}/hotspots`);
  const red=hotspots.find(h=>h.title==='Red artwork');
  assert.ok(Math.abs(red.position.x + 0.78)<1e-8 && Math.abs(red.position.z-0.6)<1e-8);
  await request(`/scenes/${lobby.id}`,'PATCH',{settings:{...persisted.settings,navigation:reviewedInterior(await readFile(new URL('../../tests/testdata/textured-interior.glb',import.meta.url)),persisted.settings.model)}});await page.reload();await page.getByText(/Prepared dimensions:.*Standing floor found/).waitFor();
  await page.getByRole('button',{name:'Walk inside',exact:true}).click();
  await page.getByRole('button',{name:'Save start view',exact:true}).click();
  await page.getByText('Start view saved.',{exact:true}).waitFor();
  assert.equal((await request(`/scenes/${lobby.id}`)).start_camera.position.length,3);
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();await page.getByRole('button',{name:'Reset settings',exact:true}).click();
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved. Hotspots moved with the model. Walk inside and save a new start view.',{exact:true}).waitFor();
  await page.locator('.scene-select select').selectOption(corrected.id);
  await page.getByText(/Prepared dimensions:.*Standing floor found/).waitFor();
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();assert.equal(await page.getByLabel('Model scale (metres per source unit)',{exact:true}).inputValue(),'0.01');
  assert.equal(await page.getByLabel('Source up axis',{exact:true}).inputValue(),'Z');
  await page.getByRole('button',{name:'Walk inside',exact:true}).click();
  await page.waitForTimeout(500);
  const correctedColors=colorCounts(await page.locator('canvas').screenshot());
  assert.ok(correctedColors.red>100 && correctedColors.blue>100);
  // Originals remain identical; optional material overrides are reversible.
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();await page.getByLabel('Override material color',{exact:true}).check();
  await page.getByLabel('Material color',{exact:true}).fill('#45a050');
  await page.getByLabel('Override material roughness',{exact:true}).check();
  await page.getByLabel('Material roughness',{exact:true}).fill('0.25');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved.',{exact:true}).waitFor();
  const asset=await request(`/assets/${corrected.asset_id}`);
  const original=Buffer.from(await (await fetch(asset.url)).arrayBuffer());
  assert.deepEqual(original,await readFile(new URL('../../tests/testdata/textured-interior-cm-z.glb',import.meta.url)));
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();await page.getByLabel('Override material color',{exact:true}).uncheck();
  await page.getByLabel('Override material roughness',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved.',{exact:true}).waitFor();
  await page.waitForTimeout(400);
  const restoredColors=colorCounts(await page.locator('canvas').screenshot());
  assert.ok(restoredColors.red>100 && restoredColors.blue>100, JSON.stringify(restoredColors));
  await page.screenshot({path:'/tmp/phase2-textured-interior.png',fullPage:true});
  // Unsupported required extensions and broken embedded images remain ready originals,
  // but rendering rejects them with specific diagnostics rather than silently dropping textures.
  const source=await readFile(new URL('../../tests/testdata/textured-interior.glb',import.meta.url));
  for (const [name,edit,message] of [
    ['draco.glb',json=>{json.extensionsUsed=['KHR_draco_mesh_compression'];json.extensionsRequired=['KHR_draco_mesh_compression'];},'KHR_draco_mesh_compression'],
    ['unsupported.glb',json=>{json.extensionsUsed=['VENDOR_unknown'];json.extensionsRequired=['VENDOR_unknown'];},'Unsupported required extension'],
    ['broken-texture.glb',json=>{json.images[0].bufferView=0;},'An embedded texture is missing or could not be decoded'],
  ]) {
    const broken=await upload(rewriteGLB(source,edit),name,name);
    await page.reload();await page.locator('.scene-select select').selectOption(broken.id);
    await page.getByRole('alert').filter({hasText:message}).waitFor();
    assert.equal((await request(`/assets/${broken.asset_id}`)).upload_status,'ready');
  }
  const empty=await upload(rewriteGLB(source,json=>{json.nodes=[];json.scenes[0].nodes=[];}),'no-floor.glb','No floor');
  await request(`/scenes/${empty.id}`,'PATCH',{settings:{...settings,navigation:reviewedInterior(source)}});
  await page.reload();await page.locator('.scene-select select').selectOption(empty.id);
  await page.getByText(/No standing floor found/).waitFor();
  assert.ok(await page.getByRole('button',{name:'Set up walking',exact:true}).isEnabled());await page.getByRole('button',{name:'Set up walking',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Inspect model',exact:true}).count(),0);
  const unexpected=errors.filter(error=>!error.includes('Model import:'));
  assert.deepEqual(unexpected,[]);
  console.log('PASS neutral textured colors across builder/reload/preview/public/embed, settings persistence/reset, original preservation, scale/up-axis/rotation, hotspot movement, safe starts, missing floor and import diagnostics.');
} catch(error) {
  if(page) { console.error((await page.locator('body').innerText()).slice(0,3500)); await page.screenshot({path:'/tmp/appearance-browser-failure.png',fullPage:true}); }
  console.error('Browser errors:',errors);throw error;
} finally {
  if(fixture)await fixture.request(`/projects/${fixture.project.id}`,'DELETE');
  await browser.close();
}
