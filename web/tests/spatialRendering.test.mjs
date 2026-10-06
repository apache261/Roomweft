import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Box3,BoxGeometry,Group,Mesh,MeshStandardMaterial,PerspectiveCamera,SphereGeometry,Vector3} from 'three';
import {prepareSpatialRendering,resolveRuntimeSurface,simplifierReady,lodLevel} from '../src/spatialRendering.ts';
import {HotspotVisibility,visibilityResult} from '../src/hotspotVisibility.ts';
import {WalkWorld} from '../src/navigation.ts';
import {buildLayout} from '../src/layoutGeometry.ts';
import {starterLayout} from '../src/layout.ts';
function repeated(count=12,geometry=new BoxGeometry(.5,.5,.5)) {
 const root=new Group(),material=new MeshStandardMaterial();
 for(let i=0;i<count;i++){const parent=new Group();parent.userData.layoutElement='item-'+i;const mesh=new Mesh(geometry,material.clone());mesh.position.set(i%4,.5,Math.floor(i/4));mesh.userData.materialPath='0/0';parent.add(mesh);root.add(parent);}return root;
}
test('compatible repeats instance within chunks, retain authored IDs and world bounds',()=>{
 const root=repeated();root.position.set(3,0,0);const before=new Box3().setFromObject(root),parents=root.children.map(o=>o.parent);
 const visual=prepareSpatialRendering(root);assert.equal(visual.stats.sourceMeshes,12);assert.equal(visual.stats.renderMeshes,1);
 const instances=visual.root.children[0];assert.equal(instances.count,12);assert.equal(resolveRuntimeSurface(instances,7).elementId,'item-7');assert.equal(resolveRuntimeSurface(instances,7).path,'0/0');
 const after=new Box3().setFromObject(visual.root);assert.ok(before.min.distanceTo(after.min)<1e-6&&before.max.distanceTo(after.max)<1e-6);assert.deepEqual(root.children.map(o=>o.parent),parents);
 let disposed=0;root.children[0].children[0].geometry.addEventListener('dispose',()=>disposed++);visual.dispose();assert.equal(disposed,0);
});
test('batching preserves triangle ranges and excludes transparent, animated, mirrored and custom materials',()=>{
 const root=new Group(),material=new MeshStandardMaterial();
 for(let i=0;i<3;i++){const mesh=new Mesh(new BoxGeometry(.5,.5,.5),material);mesh.geometry.clearGroups();mesh.position.x=i;mesh.userData.materialPath='surface-'+i;root.add(mesh);}
 const visual=prepareSpatialRendering(root);assert.equal(visual.stats.batches,1);assert.equal(resolveRuntimeSurface(visual.root.children[0],undefined,12).path,'surface-1');visual.dispose();
 const separate=repeated(4);separate.children[0].userData.runtimeAnimated=true;separate.children[1].children[0].material.transparent=true;separate.children[2].scale.x=-1;separate.children[3].children[0].material.onBeforeCompile=()=>{};
 const safe=prepareSpatialRendering(separate);assert.equal(safe.stats.renderMeshes,4);assert.equal(safe.stats.instancedGroups,0);safe.dispose();
 const far=repeated(2);far.children[1].position.x=40;const chunks=prepareSpatialRendering(far);assert.equal(chunks.stats.renderMeshes,2);chunks.dispose();
});
test('projected LOD has hysteresis, conservative bounds and independent exact hotspot occlusion',async()=>{
 await simplifierReady;const root=repeated(4,new SphereGeometry(.4,48,32)),visual=prepareSpatialRendering(root,true);assert.equal(visual.stats.lodGroups,1);
 const mesh=visual.root.children[0],original=mesh.geometry.index.count,bounds=mesh.boundingSphere.clone();
 const camera=new PerspectiveCamera(60,1,.05,1000);camera.position.set(0,1,100);camera.lookAt(0,1,0);camera.updateMatrixWorld();visual.update(camera,800);
 assert.ok(mesh.geometry.index.count<original);assert.ok(mesh.boundingSphere.equals(bounds));camera.position.z=1;camera.updateMatrixWorld();visual.update(camera,800);assert.equal(mesh.geometry.index.count,original);
 assert.equal(lodLevel(170,0),0);assert.equal(lodLevel(140,0),1);assert.equal(lodLevel(190,1),1);assert.equal(lodLevel(210,1),0);
 const wall=new Mesh(new BoxGeometry(4,4,.2),new MeshStandardMaterial());wall.position.set(0,0,-2);const authored=new Group();authored.add(wall);const render=prepareSpatialRendering(authored);render.root.children[0].visible=false;
 camera.position.set(0,0,0);camera.lookAt(0,0,-1);camera.updateMatrixWorld();const visibility=new HotspotVisibility();visibility.begin(camera,[render.root],false);assert.equal(visibility.evaluate(visibilityResult(new Vector3(0,0,-4))).visible,false);render.dispose();visual.dispose();
});
test('approved layout navigation remains identical after optimization and render hiding',async()=>{
 await simplifierReady;
 const doc=starterLayout();
 const prepared=buildLayout(doc),world=new WalkWorld(prepared.root),start=world.start();assert.ok(start);
 const before=world.move(new Vector3(...start.position),new Vector3(10,0,0)),visual=prepareSpatialRendering(prepared.root,true);visual.root.visible=false;
 const after=new WalkWorld(prepared.root);assert.deepEqual(after.start(),start);assert.ok(after.move(new Vector3(...start.position),new Vector3(10,0,0)).distanceTo(before)<1e-8);
 after.dispose();world.dispose();visual.dispose();prepared.dispose();
});

test('an approved or oversized member keeps the entire instance group at full detail',async()=>{
 await simplifierReady;
 for(const reason of ['floor','size']){
  const root=repeated(2,new SphereGeometry(.4,48,32));
  if(reason==='floor')root.children[1].children[0].userData.walkFloor=true;
  else root.children[1].scale.setScalar(5);
  const visual=prepareSpatialRendering(root,true);
  assert.equal(visual.stats.instancedGroups,1);assert.equal(visual.stats.lodGroups,0);visual.dispose();
 }
});

test('sheared instance transforms retain original mesh normals and geometry',()=>{
 const root=repeated(2),mesh=root.children[1].children[0];
 mesh.matrixAutoUpdate=false;mesh.matrix.makeShear(.5,0,0,0,0,0);root.updateMatrixWorld(true);
 const bounds=new Box3().setFromObject(root),visual=prepareSpatialRendering(root);
 assert.equal(visual.stats.instancedGroups,0);assert.equal(visual.stats.renderMeshes,2);
 const rendered=new Box3().setFromObject(visual.root);assert.ok(bounds.min.distanceTo(rendered.min)<1e-6&&bounds.max.distanceTo(rendered.max)<1e-6);visual.dispose();
});
