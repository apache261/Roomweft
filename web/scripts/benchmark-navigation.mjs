import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { WalkWorld } from '../src/navigation.ts';
import { defaultNavigation } from '../src/navigationSettings.ts';
import { navigationCacheStats } from '../src/navigationCache.ts';
import assert from 'node:assert/strict';
const root=new Group(),geometry=new BoxGeometry(1,2,1),material=new MeshBasicMaterial();
for(let i=0;i<600;i++){const mesh=new Mesh(geometry,material);mesh.position.set(i%30*2,1,Math.floor(i/30)*2);root.add(mesh);}
const floor=new Mesh(new BoxGeometry(62,.2,42),material);floor.position.set(29,-.1,19);floor.userData.walkFloor=true;root.add(floor);
root.userData.walkRegions=[{id:'reviewed-floor',name:'Reviewed floor',left:-2,right:60,top:-2,bottom:40,min_y:-.01,max_y:.01}];
const settings={...defaultNavigation},cold=[],warm=[];
// Distinct settings force a rebuild without changing geometry or its size.
for(let i=0;i<12;i++){const started=performance.now(),world=new WalkWorld(root,{...settings,step_height:settings.step_height+i/100000});cold.push(performance.now()-started);world.dispose();}
const owner=new WalkWorld(root,settings),initial=navigationCacheStats();
for(let i=0;i<100;i++){const started=performance.now(),world=new WalkWorld(root,settings);warm.push(performance.now()-started);assert.equal(world.collision,owner.collision);world.dispose();}
const final=navigationCacheStats();assert.equal(final.owners,initial.owners);assert.equal(final.entries,initial.entries);owner.dispose();
const distribution=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.floor((sorted.length-1)*.95)]};};
console.log(JSON.stringify({execution:'Native Node CPU microbenchmark; excludes network, decode, DOM, GPU and walkthrough FPS',fixture:{meshes:601,inputTriangles:601*12,collisionTriangles:601*24},cold:distribution(cold),cached:distribution(warm),initial,final,checks:['shared triangle identity','100 repeated worlds retain stable entries/owners']},null,2));
