import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Timer} from 'three';
import {createTimerClock} from '../scripts/fiber-timer-clock.mjs';

test('Timer compatibility keeps frame deltas, elapsed time and Clock start/stop semantics',t=>{
 let now=1000;t.mock.method(performance,'now',()=>now);
 const clock=createTimerClock(Timer);
 assert.equal(clock.running,false);assert.equal(clock.getDelta(),0);assert.equal(clock.running,true);
 now=1250;assert.equal(clock.getDelta(),.25);assert.equal(clock.getElapsedTime(),.25);
 now=1500;clock.stop();assert.equal(clock.elapsedTime,.5);assert.equal(clock.running,false);assert.equal(clock.autoStart,false);
 now=6000;assert.equal(clock.getDelta(),0);assert.equal(clock.getElapsedTime(),.5,'Stopped time does not accumulate');
 clock.start();assert.equal(clock.elapsedTime,0);assert.equal(clock.startTime,6000);
 now=6100;assert.equal(clock.getDelta(),.1);assert.equal(clock.oldTime,6100);
});

test('Timer compatibility supports Fiber manual frame state and paused frameloops',t=>{
 let now=1000;t.mock.method(performance,'now',()=>now);
 const clock=createTimerClock(Timer,false);assert.equal(clock.getDelta(),0);
 // Fiber's never frameloop writes these fields when advance(timestamp) is used.
 clock.oldTime=clock.elapsedTime;clock.elapsedTime=2;assert.equal(clock.getElapsedTime(),2);
 clock.stop();clock.elapsedTime=0;assert.equal(clock.getDelta(),0);
 clock.start();now=1100;assert.equal(clock.getDelta(),.1);
});
