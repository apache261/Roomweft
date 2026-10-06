import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/spatial-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Spatial fixture</title>'}));await page.goto((process.env.TOUR_ORIGIN||'http://localhost:5174')+'/spatial-fixture');
 const result=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{prepareSpatialRendering,simplifierReady}=await import('/src/spatialRendering.ts');await simplifierReady;
  const renderer=new T.WebGLRenderer({antialias:false});renderer.setSize(800,600);
  const camera=new T.PerspectiveCamera(60,800/600,.05,1000),scene=new T.Scene(),root=new T.Group(),geometry=new T.SphereGeometry(.2,48,32),material=new T.MeshBasicMaterial({color:'#dddddd'});
  for(let i=0;i<120;i++){const mesh=new T.Mesh(geometry,material.clone());mesh.position.set((i%12)*.5,.5,Math.floor(i/12)*.5);root.add(mesh);}
  camera.position.set(3,5,20);camera.lookAt(3,0,2);camera.updateMatrixWorld();scene.add(root);renderer.render(scene,camera);
  const baseline={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};scene.remove(root);
  const optimized=prepareSpatialRendering(root,true);scene.add(optimized.root);optimized.update(camera,600);renderer.render(scene,camera);
  const near={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};camera.position.set(3,5,150);camera.lookAt(3,0,2);camera.updateMatrixWorld();optimized.update(camera,600);renderer.render(scene,camera);
  const distant={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},memory=[];scene.remove(optimized.root);optimized.dispose();
  for(let i=0;i<20;i++){const visual=prepareSpatialRendering(root,true);scene.add(visual.root);visual.update(camera,600);renderer.render(scene,camera);scene.remove(visual.root);visual.dispose();memory.push(renderer.info.memory.geometries);}
  root.traverse(o=>o.material?.dispose());geometry.dispose();material.dispose();renderer.dispose();return {baseline,near,distant,stats:optimized.stats,memoryAfterDisposal:memory,execution:'Chromium SwiftShader; draw/triangle and ownership validation, not physical-device FPS'};
 });
 assert.ok(result.near.calls<result.baseline.calls);assert.ok(result.distant.triangles<result.baseline.triangles);assert.ok(result.memoryAfterDisposal.every(v=>v===result.memoryAfterDisposal[0]));assert.deepEqual(errors,[]);
 await writeFile(process.env.SPATIAL_OUTPUT||'../docs/performance-baselines/phase5-spatial-rendering.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
