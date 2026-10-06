import { Box3, ClampToEdgeWrapping, Material, Mesh, MeshStandardMaterial, NoColorSpace, SRGBColorSpace, Vector3, type Object3D, type Texture } from 'three';
import type { MaterialPreset } from './materials.ts';
import type { QualityTier } from './viewerQuality.ts';
// Soft limits for an explicitly enabled feature; physical budgets remain pending.
export const hqBudget={shadowSize:1024,shadowRadius:8,maxCasters:24,maxCasterTriangles:50000};
export function hqPolicy(tier:QualityTier,requested:boolean,maxTextureSize:number,cores?:number,memoryGB?:number){
 const capable=maxTextureSize>=4096&&(cores===undefined||cores>4)&&(memoryGB===undefined||memoryGB>4);
 return {shadows:requested&&tier==='hq'&&capable,shadowSize:hqBudget.shadowSize,screenSpaceAO:false,reason:!requested?'Shadows off':tier!=='hq'?'Shadows require HQ':!capable?'Device capability limit':'Provisional bounded HQ shadows'};
}
function stable(value:unknown):unknown{return Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;}
export function bakeRevision(value:unknown){
 // A revision key detects stale authoring, not a security/integrity signature.
 const json=JSON.stringify(stable(value)),seeds=[2166136261,2246822519,3266489917,668265263];
 return 'bake-v1:'+seeds.map(seed=>{let hash=seed;for(const c of json)hash=Math.imul(hash^c.charCodeAt(0),16777619);return (hash>>>0).toString(16).padStart(8,'0');}).join('');
}
export function bakeContext(asset:unknown,geometry:unknown,presets:MaterialPreset[],assignments:unknown,appearance:{environment_intensity:number;light_intensity:number;tint:string;roughness:number|null}){
 return {asset,geometry,materials:presets.map(({bake_revision,...p})=>p),assignments,lighting:{environment:appearance.environment_intensity,key:appearance.light_intensity,tint:appearance.tint,roughness:appearance.roughness},schema:1};
}
export function isMovingMesh(mesh:Mesh){if(mesh.type==='SkinnedMesh'||mesh.morphTargetInfluences?.length)return true;for(let p:Object3D|null=mesh;p;p=p.parent)if(p.userData.hqShadowDynamic)return true;return false;}
export function hasBakeUV(mesh:Mesh){const uv=mesh.geometry.getAttribute('uv1'),pos=mesh.geometry.getAttribute('position');if(!uv||!pos||uv.count!==pos.count||uv.itemSize!==2)return false;for(let i=0;i<uv.count;i++)if(!Number.isFinite(uv.getX(i))||!Number.isFinite(uv.getY(i)))return false;return true;}
export function applyBakedLighting(root:Object3D,presets:MaterialPreset[],textures:Map<string,Texture>,revision:string){
 const owned:Texture[]=[],restores:(()=>void)[]=[];const stats={lightMappedMeshes:0,aoMappedMeshes:0,staleMeshes:0,missingUV:0,dynamicMeshes:0};
 root.traverse(object=>{if(!(object instanceof Mesh))return;
  const materials=Array.isArray(object.material)?object.material:[object.material];
  const bindings=materials.map(m=>presets.find(p=>p.id===m.userData.presetId));
  if(!bindings.some(p=>p?.light_map||p?.ao_map))return;
  if(isMovingMesh(object)){stats.dynamicMeshes++;return;}
  if(!hasBakeUV(object)){stats.missingUV++;return;}
  const valid=bindings.map(p=>!!revision&&!!p&&p.bake_revision===revision);
  if(bindings.some((p,i)=>p&&(p.light_map||p.ao_map)&&!valid[i]))stats.staleMeshes++;
  const fullLightMap=materials.every((m,i)=>m instanceof MeshStandardMaterial&&m.onBeforeCompile===Material.prototype.onBeforeCompile&&valid[i]&&bindings[i]?.light_map&&textures.has(bindings[i]!.light_map!));
  let ao=false;
  materials.forEach((m,i)=>{if(!(m instanceof MeshStandardMaterial)||!valid[i])return;const p=bindings[i]!;
   const sampler=(id:string,color:boolean)=>{const t=textures.get(id)!.clone();t.colorSpace=color?SRGBColorSpace:NoColorSpace;t.channel=1;t.flipY=false;t.wrapS=t.wrapT=ClampToEdgeWrapping;t.repeat.set(1,1);t.offset.set(0,0);t.center.set(0,0);t.rotation=0;t.needsUpdate=true;owned.push(t);return t;};
   const old={lightMap:m.lightMap,aoMap:m.aoMap,compile:m.onBeforeCompile,cacheKey:m.customProgramCacheKey};
   if(fullLightMap){m.lightMap=sampler(p.light_map!,true);
    // Replace indirect diffuse illumination while retaining environment specular
    // reflections and the separate realtime direct light/shadow contribution.
    m.onBeforeCompile=(shader,renderer)=>{old.compile.call(m,shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>', '#if defined( RE_IndirectDiffuse )\nirradiance = vec3( 0.0 );\n#endif\n#include <lights_fragment_maps>\n#if defined( RE_IndirectDiffuse )\niblIrradiance = vec3( 0.0 );\n#endif');};
    m.customProgramCacheKey=()=>`reviewed-indirect-v1:${old.cacheKey.call(m)}`;
   }
   if(p.ao_map&&textures.has(p.ao_map)){m.aoMap=sampler(p.ao_map,false);ao=true;}
   m.needsUpdate=true;restores.push(()=>{m.lightMap=old.lightMap;m.aoMap=old.aoMap;m.onBeforeCompile=old.compile;m.customProgramCacheKey=old.cacheKey;m.needsUpdate=true;});
  });
  if(fullLightMap)stats.lightMappedMeshes++;
  if(ao)stats.aoMappedMeshes++;
 });
 root.userData.bakedLighting=stats;
 return {stats,dispose(){restores.forEach(f=>f());owned.forEach(t=>t.dispose());}};
}
export function selectShadowCasters(meshes:Mesh[],position:Vector3){
 let triangles=0;const selected:Mesh[]=[];
 const candidates=meshes.flatMap(mesh=>{const animated=isMovingMesh(mesh);
  const count=(mesh.geometry.index?.count||mesh.geometry.getAttribute('position')?.count||0)/3*(mesh.type==='InstancedMesh'?(mesh as import('three').InstancedMesh).count:1);if(!animated||count>hqBudget.maxCasterTriangles)return [];
  if('computeBoundingBox' in mesh&&mesh.type==='SkinnedMesh')(mesh as import('three').SkinnedMesh).computeBoundingBox();
  const distance=new Box3().setFromObject(mesh).distanceToPoint(position);return distance<=hqBudget.shadowRadius?[{mesh,distance,count}]:[];
 }).sort((a,b)=>a.distance-b.distance);
 for(const {mesh,count}of candidates)if(selected.length<hqBudget.maxCasters&&triangles+count<=hqBudget.maxCasterTriangles){selected.push(mesh);triangles+=count;}
 return {selected,triangles};
}
