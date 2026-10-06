import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoQualityController, ViewerFrameClock, qualityCapabilities, readQualityPreference, saveQualityPreference } from '../src/viewerQuality.ts';
function feed(controller, ms, cpu, duration, start = 8000, dpr = 2) { let t = start; for (; t < start + duration; t += ms) controller.sample(ms, cpu, t, dpr); return t; }
test('Auto requires sustained samples, verifies resolution benefit and observes cooldown', () => {
  const c = new AutoQualityController();
  feed(c, 40, 2, 2000); assert.equal(c.tier, 'balanced');
  let t = feed(c, 40, 2, 2200, 10000); assert.equal(c.tier, 'low'); assert.equal(c.assetTier,'balanced','pixel probe leaves asset workload unchanged');
  t = feed(c, 20, 2, 4500, t); assert.equal(c.tier, 'low'); assert.match(c.reason, /improved/);assert.equal(c.assetTier,'low','accepted quality commits asset tier');
  feed(c, 15, 2, 15000, t); assert.equal(c.tier, 'low', 'cooldown prevents immediate upgrade');
});
test('Auto restores an ineffective DPR trial and leaves CPU-bound/native-DPR costs alone', () => {
  const c = new AutoQualityController(); let t = feed(c, 40, 2, 4100); assert.equal(c.tier, 'low');
  feed(c, 40, 2, 4100, t); assert.equal(c.tier, 'balanced'); assert.match(c.reason, /did not help/);assert.equal(c.assetTier,'balanced');
  const cpu = new AutoQualityController(); feed(cpu, 40, 30, 10000); assert.equal(cpu.tier, 'balanced'); assert.match(cpu.reason, /CPU/);
  const native = new AutoQualityController(); feed(native, 40, 2, 10000, 8000, 1); assert.equal(native.tier, 'balanced'); assert.match(native.reason, /Native/);
});
test('interrupted resolution trials restore their original tier', () => { const c = new AutoQualityController(); feed(c, 40, 2, 4100); assert.equal(c.tier, 'low'); c.interrupt(13000); assert.equal(c.tier, 'balanced'); assert.match(c.reason, /interrupted/); feed(c, 40, 2, 10000, 14000); assert.equal(c.tier, 'balanced'); });

test('fast samples upgrade slowly; capability ceilings and threshold noise avoid oscillation', () => {
  const c = new AutoQualityController(); feed(c, 1000 / 60, 2, 10100); assert.equal(c.tier, 'hq');
  feed(c, 20, 2, 12000, 18100); assert.equal(c.tier, 'hq');
  const limited = new AutoQualityController('balanced'); feed(limited, 15, 2, 30000); assert.equal(limited.tier, 'balanced');
  assert.deepEqual(qualityCapabilities(2048, 8, 8), { maximum: 'low', targetMs: 1000 / 60 });
  assert.deepEqual(qualityCapabilities(8192, 4, 4), { maximum: 'balanced', targetMs: 1000 / 30 });
});
test('idle/hidden gaps never become simulation steps but visible stalls remain measurable', () => {
  const clock = new ViewerFrameClock(); clock.begin(100, 20); assert.equal(clock.seconds, 0);
  clock.end(true); clock.begin(116, .016); assert.equal(clock.seconds, .016); assert.equal(clock.intervalMs, 16);
  clock.end(false); clock.begin(5000, 4.884); assert.equal(clock.seconds, 0); assert.equal(clock.intervalMs, null);
  clock.end(true); clock.begin(6000, 1); assert.equal(clock.seconds, 0); assert.equal(clock.intervalMs, 1000); assert.equal(clock.animationSeconds, 1);
  clock.reset(); clock.begin(100000, 94); assert.equal(clock.seconds, 0); assert.equal(clock.animationSeconds, 0); assert.equal(clock.intervalMs, null);
});
test('manual preference validation and unavailable storage remain safe', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); const data = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) } });
  try { assert.equal(readQualityPreference(), 'auto'); saveQualityPreference('hq'); assert.equal(readQualityPreference(), 'hq'); data.set('tour-render-quality', 'invalid'); assert.equal(readQualityPreference(), 'auto'); Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } }); assert.equal(readQualityPreference(), 'auto'); assert.doesNotThrow(() => saveQualityPreference('low')); assert.equal(readQualityPreference(), 'low'); saveQualityPreference('auto'); }
  finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; }
});

import {sceneAssetTier} from '../src/assetPolicy.ts';
test('scene texture budgets aggregate distinct asset variants and retain explicit unknown/over-budget diagnostics',()=>{
 const response=bytes=>({url:'original',runtime:{state:'ready',manifest:{variants:Object.fromEntries(['low','balanced','hq'].map((tier,i)=>[tier,{texture_rgba8_bytes:bytes*(i===0?1:i===1?4:16)}]))}}});
 const fit=sceneAssetTier([response(8*1024**2),response(8*1024**2)],'hq');assert.equal(fit.tier,'hq');
 const limited=sceneAssetTier([response(20*1024**2),response(20*1024**2)],'hq');assert.equal(limited.tier,'balanced');assert.equal(limited.bytes,160*1024**2);
 const excessive=sceneAssetTier([response(80*1024**2),{url:'unprocessed'}],'hq');assert.equal(excessive.tier,'low');assert.ok(excessive.overBudget);assert.equal(excessive.unknown,1);
});
