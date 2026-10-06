import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WalkingEffects} from '../src/walkingEffects.ts';

test('head bob follows actual travelled distance, stays gentle and settles when stopped',()=>{
 const effects=new WalkingEffects();let max=0,last=0;
 for(let i=0;i<120;i++){last=effects.step(2/60,1/60,true);max=Math.max(max,Math.abs(last));assert.ok(Math.abs(last)<=.018);}
 assert.ok(max>.015,'Walking produces a visible, bounded bob');
 for(let i=0;i<120;i++)last=effects.step(0,1/60,true);
 assert.equal(last,0,'Stopping or pushing against a wall removes the bob');
 assert.equal(effects.step(1,1/60,false),0,'Disabling effects immediately restores a level camera');
 assert.equal(effects.step(0,1/60,true),0,'Enabling effects while stationary does not bob');
 effects.step(.1,1/60,true);assert.equal(effects.step(.1,1,true),0,'Suspended tabs reset motion');
 assert.equal(effects.step(.1,NaN,true),0);
});

test('head bob is consistent across frame rates and reset removes residual motion',()=>{
 const outputs=[30,60,120].map(fps=>{const effects=new WalkingEffects();let offset;for(let i=0;i<fps*2;i++)offset=effects.step(1.7/fps,1/fps,true);effects.reset();assert.equal(effects.step(0,1/fps,true),0);return offset;});
 assert.ok(Math.max(...outputs)-Math.min(...outputs)<1e-8);
});
