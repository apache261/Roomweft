import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHotspotDemo } from '../scripts/create-hotspot-demo.mjs';

const origin = process.env.TOUR_ORIGIN || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function useWorkspaceFrontend(context) {
  if (!process.env.TOUR_FRONTEND_ORIGIN) return;
  await context.route(`${origin}/**`, async route => {
    const url = route.request().url();
    const response = await route.fetch({ url: process.env.TOUR_FRONTEND_ORIGIN + url.slice(origin.length) });
    await route.fulfill({ response });
  });
}
let fixture;
let desktop;
const errors = [];
try {
  fixture = await createHotspotDemo(process.env.TOUR_FRONTEND_ORIGIN || origin);
  const { project, lobby, room, request } = fixture;
  const context = await browser.newContext({ permissions: ['local-network-access'], viewport: { width: 1440, height: 1000 } });
  await useWorkspaceFrontend(context);
  const page = await context.newPage(); desktop = page;
  page.on('pageerror', error => errors.push(error.message));
  const directory = page.locator('.hotspot-directory');
  const entry = title => directory.locator('li').filter({ hasText: title });
  await page.goto(`${origin}/projects/${project.id}`);
  await page.getByRole('button', { name: 'Walk inside', exact: true }).waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Walk inside' && !b.disabled));
  await entry('Lobby artwork').getByRole('button', { name: 'Show hotspot', exact: true }).click();
  await page.getByRole('button', { name: 'Information: Lobby artwork', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('.selected-marker').count(), 1);
  await page.getByRole('button', { name: 'Information: Lobby artwork', exact: true }).click();
  assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Lobby artwork');
  await entry('Lobby artwork').getByRole('button', { name: 'Test hotspot', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Close information', exact: true }).click();

  // Place a real marker on a model surface; preview and persistence are visible.
  await page.getByRole('button', { name: 'New hotspot', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Placed marker');
  await page.getByRole('button', { name: 'Place hotspot', exact: true }).click();
  const canvas = page.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.hotspot-ghost').waitFor({ state: 'visible' });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByText('Unsaved placement — click Save hotspot.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save hotspot', exact: true }).click();
  await page.getByText('Hotspot saved.', { exact: true }).waitFor();
  assert.equal(await page.locator('.hotspot-ghost').count(), 0);
  await page.reload();
  await entry('Placed marker').getByRole('button', { name: 'Show hotspot', exact: true }).click();
  await page.getByRole('button', { name: 'Information: Placed marker', exact: true }).waitFor({ state: 'visible' });

  // Retry a failed hotspot request without resetting the scene/camera.
  let fail = true;
  await page.route(`**/scenes/${lobby.id}/hotspots`, route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Test temporary failure"}' }) : route.fallback());
  await page.reload();
  await page.getByRole('button', { name: 'Retry hotspots', exact: true }).waitFor();
  fail = false;
  await page.getByRole('button', { name: 'Retry hotspots', exact: true }).click();
  await entry('Lobby artwork').waitFor();
  await page.unroute(`**/scenes/${lobby.id}/hotspots`);

  // Occluded markers stay hidden for visitors but can be revealed by authors.
  await request(`/scenes/${lobby.id}/hotspots`, 'POST', { type: 'INFO', title: 'Behind wall', position: { x: 0, y: 1.75, z: -3 }, description: 'Hidden by the back wall.' });
  await page.reload();
  await page.getByRole('button', { name: 'Walk inside', exact: true }).click();
  await page.getByRole('button', { name: 'Information: Behind wall', exact: true }).waitFor({ state: 'hidden' });
  await page.getByLabel('Reveal hidden hotspots (builder only)').check();
  await page.getByRole('button', { name: 'Information: Behind wall', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Preview tour', exact: true }).click();
  await page.getByRole('button', { name: 'Information: Behind wall', exact: true }).waitFor({ state: 'hidden' });

  await page.getByRole('button',{name:'Hotspots',exact:true}).click();
  // Pointer-lock activation must open information and release capture.
  await entry('Lobby artwork').getByRole('button', { name: 'Show hotspot', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  await canvas.click({ position: { x: 30, y: 30 } });
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.getByText('Click: Lobby artwork', { exact: true }).waitFor();
  await page.mouse.down(); await page.mouse.up();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.evaluate(() => !!document.pointerLockElement), false);
  assert.equal(await page.getByRole('button', { name: 'Move forward', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Close information', exact: true }).click();
  assert.equal(await page.evaluate(() => !!document.pointerLockElement), false);

  // Navigation, panorama aiming, and explicit testing in the builder.
  await page.getByRole('button',{name:'Hotspots',exact:true}).click();
  await entry('Visit second room').getByRole('button', { name: 'Go to scene', exact: true }).click();
  await page.waitForFunction(id => document.querySelector('.scene-select select')?.value === id, room.id);
  await page.getByRole('button',{name:'Hotspots',exact:true}).click();
  await entry('Room information').getByRole('button', { name: 'Show hotspot', exact: true }).click();
  await page.getByRole('button', { name: 'Information: Room information', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Close information', exact: true }).click();
  await page.getByRole('button',{name:'Hotspots',exact:true}).click();
  await entry('Return to lobby').getByRole('button', { name: 'Go to scene', exact: true }).click();
  await page.waitForFunction(id => document.querySelector('.scene-select select')?.value === id, lobby.id);
  // Panorama placement has the same ghost, save, edit, and reload behavior.
  await page.getByRole('button', { name: 'Back to builder', exact: true }).click();
  await page.locator('.scene-select select').selectOption(room.id);
  await page.getByRole('button', { name: 'New hotspot', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Placed panorama marker');
  await page.getByRole('button', { name: 'Place hotspot', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const panoramaBox = await canvas.boundingBox();
  const panoramaX = panoramaBox.x + panoramaBox.width * 0.8;
  const panoramaY = panoramaBox.y + panoramaBox.height * 0.7;
  await page.mouse.move(panoramaX, panoramaY);
  await page.locator('.hotspot-ghost').waitFor({ state: 'visible' });
  await page.mouse.click(panoramaX, panoramaY);
  await page.getByRole('button', { name: 'Save hotspot', exact: true }).click();
  await page.getByText('Hotspot saved.', { exact: true }).waitFor();
  await page.reload();
  await page.locator('.scene-select select').selectOption(room.id);
  await entry('Placed panorama marker').getByRole('button', { name: 'Show hotspot', exact: true }).click();
  await page.getByRole('button', { name: 'Information: Placed panorama marker', exact: true }).click();
  assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Placed panorama marker');
  await entry('Placed panorama marker').getByRole('button', { name: 'Test hotspot', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Close information', exact: true }).click();
  await request(`/projects/${project.id}/publish`, 'POST');

  // Public and embedded viewers use the same controls and visibility policy.
  for (const route of [`/t/${project.slug}`, `/embed/${project.slug}`]) {
    await page.goto(origin + route);
  await page.getByRole('button',{name:'Hotspots',exact:true}).click();
    await entry('Lobby artwork').getByRole('button', { name: 'Open information', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: 'Close information', exact: true }).click();
    assert.equal(await page.getByLabel('Reveal hidden hotspots (builder only)').count(), 0);
    await page.getByRole('button', { name: 'Information: Behind wall', exact: true }).waitFor({ state: 'hidden' });
  }
  const mobileContext = await browser.newContext({ permissions: ['local-network-access'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await useWorkspaceFrontend(mobileContext);
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(`${origin}/t/${project.slug}`);
  await mobile.getByRole('button',{name:'Hotspots',exact:true}).tap();
  await mobile.locator('.hotspot-directory li').filter({ hasText: 'Lobby artwork' }).getByRole('button', { name: 'Show hotspot', exact: true }).tap();
  await mobile.getByRole('button', { name: 'Information: Lobby artwork', exact: true }).tap();
  await mobile.getByRole('dialog').waitFor();
  await mobile.getByRole('button', { name: 'Close information', exact: true }).tap();
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: '/tmp/hotspots-phase1-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS placement ghost, saved visibility/reload, Show/Edit/Test, retry, occlusion/reveal, pointer-lock activation, popup pause, scene navigation, panorama, public/embed, and touch.');
} catch (error) {
  console.error('Browser errors:', errors);
  if (desktop) {
    console.error((await desktop.locator('body').innerText()).slice(0,2500));
    await desktop.screenshot({ path: '/tmp/hotspots-browser-failure.png', fullPage: true });
  }
  throw error;
} finally {
  if (fixture) await fixture.request(`/projects/${fixture.project.id}`, 'DELETE');
  await browser.close();
}
