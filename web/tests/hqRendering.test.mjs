import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClip,NumberKeyframeTrack,BoxGeometry,Group,Mesh,MeshStandardMaterial,SRGBColorSpace,NoColorSpace,Texture,Vector3} from 'three';
import {applyBakedLighting,bakeRevision,bakeContext,hqPolicy,hqBudget,selectShadowCasters} from '../src/hqRendering.ts';
import {newMaterial,tiledMaterial} from '../src/materials.ts';
import {prepareModel,defaultSettings} from '../src/sceneSettings.ts';
function fixture(){const geometry=new BoxGeometry(1,1,1);geometry.setAttribute('uv1',geometry.getAttribute('uv').clone());const preset={...newMaterial(),light_map:'light',ao_map:'ao'},textures=new Map([['light',new Texture()],['ao',new Texture()]]),material=tiledMaterial(preset,textures).material,root=new Group(),mesh=new Mesh(geometry,material);root.add(mesh);const revision=bakeRevision(bakeContext('asset',defaultSettings.model,[preset],{},defaultSettings.appearance));preset.bake_revision=revision;return {root,mesh,material,preset,textures,revision};}
test('bake revisions ignore key ordering, exposure and review stamps; geometry, material and light edits invalidate',()=>{
 const p=newMaterial(),context=bakeContext('asset',defaultSettings.model,[p],{},defaultSettings.appearance),key=bakeRevision(context);
 assert.equal(key,bakeRevision(Object.fromEntries(Object.entries(context).reverse())));
 assert.equal(key,bakeRevision(bakeContext('asset',defaultSettings.model,[{...p,bake_revision:'reviewed'}],{},{...defaultSettings.appearance,exposure:2})));
 for(const next of [bakeContext('asset',defaultSettings.model,[{...p,light_map:'different-atlas'}],{},defaultSettings.appearance),bakeContext('changed',defaultSettings.model,[p],{},defaultSettings.appearance),bakeContext('asset',{...defaultSettings.model,scale:2},[p],{},defaultSettings.appearance),bakeContext('asset',defaultSettings.model,[{...p,tint:'#222222'}],{},defaultSettings.appearance),bakeContext('asset',defaultSettings.model,[p],{surface:p.id},defaultSettings.appearance),bakeContext('asset',defaultSettings.model,[p],{},{...defaultSettings.appearance,light_intensity:2})])assert.notEqual(key,bakeRevision(next));
});
test('reviewed UV1 maps preserve reflection/direct light, replace indirect diffuse and leave shared samplers untouched',()=>{
 const f=fixture(),compile=f.material.onBeforeCompile,layers=f.mesh.layers.mask,baked=applyBakedLighting(f.root,[f.preset],f.textures,f.revision);
 assert.equal(baked.stats.lightMappedMeshes,1);assert.equal(baked.stats.aoMappedMeshes,1);assert.equal(f.material.lightMap.channel,1);assert.equal(f.material.lightMap.flipY,false);assert.equal(f.material.aoMap.flipY,false);assert.equal(f.textures.get('light').flipY,true);assert.equal(f.material.lightMap.colorSpace,SRGBColorSpace);assert.equal(f.material.aoMap.colorSpace,NoColorSpace);assert.equal(f.textures.get('light').channel,0);assert.equal(f.mesh.layers.mask,layers);assert.equal(f.material.envMapIntensity,1);
 const shader={fragmentShader:'#include <lights_fragment_maps>',uniforms:{}};f.material.onBeforeCompile(shader,{});assert.ok(shader.fragmentShader.includes('irradiance = vec3( 0.0 )'));assert.ok(shader.fragmentShader.includes('iblIrradiance = vec3( 0.0 )'));assert.ok(shader.fragmentShader.includes('#include <lights_fragment_maps>'));
 let disposed=0;f.material.lightMap.addEventListener('dispose',()=>disposed++);baked.dispose();assert.equal(disposed,1);assert.equal(f.material.lightMap,null);assert.equal(f.material.onBeforeCompile,compile);f.mesh.geometry.dispose();f.material.dispose();
});
test('stale, missing UV, missing maps and custom shaders retain safe original lighting',()=>{
 for(const kind of ['stale','empty','uv','missing','shader','moving']){const f=fixture();if(kind==='empty')f.preset.bake_revision='';if(kind==='uv')f.mesh.geometry.deleteAttribute('uv1');if(kind==='missing')f.textures.clear();if(kind==='shader')f.material.onBeforeCompile=()=>{};if(kind==='moving')f.mesh.userData.hqShadowDynamic=true;
  const baked=applyBakedLighting(f.root,[f.preset],f.textures,kind==='stale'?'different':kind==='empty'?'':f.revision);assert.equal(f.material.lightMap,null);assert.equal(baked.stats.lightMappedMeshes,0);baked.dispose();f.mesh.geometry.dispose();f.material.dispose();}
});
test('HQ shadows are explicit, capability limited, and bounded by distance, count and triangles',()=>{
 assert.equal(hqPolicy('balanced',true,8192,8,8).shadows,false);assert.equal(hqPolicy('hq',false,8192,8,8).shadows,false);assert.equal(hqPolicy('hq',true,2048,8,8).shadows,false);assert.equal(hqPolicy('hq',true,8192,4,8).shadows,false);assert.equal(hqPolicy('hq',true,8192,8,8).shadows,true);
 const root=new Group();root.userData.hqShadowDynamic=true;for(let i=0;i<50;i++){const m=new Mesh(new BoxGeometry(.2,.2,.2),new MeshStandardMaterial());m.position.x=i/10;root.add(m);}const distant=new Mesh(new BoxGeometry(1,1,1),new MeshStandardMaterial());distant.position.x=100;root.add(distant);root.updateMatrixWorld(true);
 const result=selectShadowCasters(root.children,new Vector3());assert.equal(result.selected.length,hqBudget.maxCasters);assert.ok(result.triangles<=hqBudget.maxCasterTriangles);assert.ok(!result.selected.includes(distant));root.children.forEach(m=>{m.geometry.dispose();m.material.dispose();});
});

test('only tracked moving subtrees become shadow casters and authored nodes remain unchanged',()=>{
 const source=new Group(),moving=new Mesh(new BoxGeometry(1,1,1),new MeshStandardMaterial()),fixed=new Mesh(moving.geometry,moving.material);moving.name='Actor';fixed.name='Static';source.add(moving,fixed);
 const prepared=prepareModel(source,defaultSettings,new Map(),[new AnimationClip('move',1,[new NumberKeyframeTrack('Actor.position[x]',[0,1],[0,1])])]);
 const meshes=[];prepared.root.traverse(o=>{if(o instanceof Mesh)meshes.push(o);});const casters=selectShadowCasters(meshes,new Vector3());assert.deepEqual(casters.selected.map(m=>m.name),['Actor']);assert.equal(moving.userData.hqShadowDynamic,undefined);prepared.dispose();moving.geometry.dispose();moving.material.dispose();
});
