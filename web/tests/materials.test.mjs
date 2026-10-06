import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Texture,SRGBColorSpace,NoColorSpace,Mesh,Group,BoxGeometry,MeshStandardMaterial,Vector3} from 'three';
import {newMaterial,tiledMaterial,meshSurfaces,applySurfaceMaterials} from '../src/materials.ts';
import {buildLayout} from '../src/layoutGeometry.ts';
import {starterLayout,template} from '../src/layout.ts';
import {WalkWorld} from '../src/navigation.ts';
test('map roles have independent sampler transforms and correct color spaces without changing shared sources',()=>{
 const p={...newMaterial(),base_color:'color',normal:'normal',roughness_map:'rough',repeat:[2,3],offset:[0.2,0.4],rotation:90};
 const source=new Texture(),textures=new Map(['color','normal','rough'].map(id=>[id,source]));
 const a=tiledMaterial(p,textures),b=tiledMaterial({...p,tile_size:2},textures);
 assert.equal(a.material.map.colorSpace,SRGBColorSpace);assert.equal(a.material.normalMap.colorSpace,NoColorSpace);assert.equal(a.material.roughnessMap.colorSpace,NoColorSpace);
 assert.deepEqual(a.material.map.repeat.toArray(),[4,6]);assert.deepEqual(b.material.map.repeat.toArray(),[1,1.5]);assert.deepEqual(source.repeat.toArray(),[1,1]);assert.deepEqual(a.material.map.offset.toArray(),[0.2,0.4]);assert.equal(a.material.map.rotation,Math.PI/2);assert.equal(a.material.map.source,source.source);a.dispose();b.dispose();
});
test('metre UVs survive room resizing, shared walls have independent sides, and repeated modules have continuous support',()=>{
 const doc=starterLayout(),a=newMaterial(),b={...newMaterial('Wood'),tint:'#885522'},textures=new Map();doc.materials=[a,b];doc.elements[0].floor_material=a.id;doc.elements[1].wall_material=a.id;doc.elements[2].wall_material=b.id;
 const model=buildLayout(doc,new Map(),textures),floor=model.root.children.find(m=>m instanceof Mesh&&m.userData.surfaceKind==='floor');
 const uv=floor.geometry.getAttribute('uv');const width=Math.max(...Array.from({length:uv.count},(_,i)=>uv.getX(i)))-Math.min(...Array.from({length:uv.count},(_,i)=>uv.getX(i)));assert.equal(width,6);
 const shared=model.root.children.filter(m=>m instanceof Mesh&&m.position.x===-1&&Array.isArray(m.material));assert.ok(shared.some(m=>m.material[0].color.getHexString()==='ffffff'&&m.material[1].color.getHexString()==='885522'));
 const floorDoc={version:1,doors:[],materials:[a],elements:[{...template('FLOOR'),floor_material:a.id},{...template('FLOOR',4,0),floor_material:a.id}]};const repeated=buildLayout(floorDoc),world=new WalkWorld(repeated.root);assert.ok(world.move(new Vector3(0,1.65,0),new Vector3(4,0,0)).x>3.9);assert.ok(world.grounded(new Vector3(2,1.65,0)));world.dispose();repeated.dispose();
 doc.elements[0].width=8;const resized=buildLayout(doc);const large=resized.root.children.find(m=>m instanceof Mesh&&m.userData.surfaceKind==='floor');const resizedUV=large.geometry.getAttribute('uv');assert.equal(Math.max(...Array.from({length:resizedUV.count},(_,i)=>resizedUV.getX(i))),4);assert.equal(large.material.color.getHexString(),'ffffff');resized.dispose();model.dispose();
});
test('imported mesh paths distinguish duplicate names and missing UVs preserve original materials',()=>{
 const source=new Group();for(let i=0;i<2;i++){const m=new Mesh(new BoxGeometry(2,1,1),new MeshStandardMaterial());m.name='Same name';if(i)m.geometry.deleteAttribute('uv');source.add(m);}
 const surfaces=meshSurfaces(source);assert.deepEqual(surfaces.map(s=>[s.path,s.uv]),[['0/0',true],['0/1',false]]);
 const p=newMaterial(),original=source.children[1].material;const dispose=applySurfaceMaterials(source,[p],{'0/0':p.id,'0/1':p.id},new Map());assert.equal(source.children[1].material,original);assert.notEqual(source.children[0].material,original);dispose();
});
test('repeated room modules have one shared wall and walk continuously through the aligned doorway',()=>{
 const a=template('ROOM'),b={...structuredClone(a),id:crypto.randomUUID(),x:4,name:'Repeated room'};
 const doc={version:1,elements:[a,b],doors:[{id:crypto.randomUUID(),a:a.id,b:b.id,at:0,width:1.2,height:2.2}]},model=buildLayout(doc),world=new WalkWorld(model.root);
 assert.ok(world.move(new Vector3(0,1.65,0),new Vector3(4,0,0)).x>3.9);assert.ok(world.grounded(new Vector3(2,1.65,0)));
 const signatures=new Set();for(const mesh of model.root.children){const key=JSON.stringify([mesh.position.toArray(),mesh.geometry.parameters]);assert.ok(!signatures.has(key),'duplicate collision mesh');signatures.add(key);}
 assert.ok(world.move(new Vector3(0,1.65,1.5),new Vector3(4,0,0)).x<1.8);world.dispose();model.dispose();
});
