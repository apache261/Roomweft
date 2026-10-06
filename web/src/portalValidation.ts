import {request,type Scene} from './api';
import {prepareModel} from './sceneSettings';
import {buildLayout} from './layoutGeometry';
import {WalkWorld} from './navigation';
import type {Portal} from './navigationSettings';
import type {WebGLRenderer} from 'three';
import {registerAsset, loadModel, disposeModel, type AssetResponse} from './runtimeAssetCache';
import {Vector3} from 'three';
// Load collision from the actual destination, through the same project/tour
// scoped asset endpoints as its viewer. No collision flags are ever bypassed.
export async function validatePortalArrival(scene:Scene,portal:Portal,source:string,renderer?:WebGLRenderer){
 const loaded:Awaited<ReturnType<typeof loadModel>>[]=[];
 const model=async(id:string)=>{const asset=await request<AssetResponse>(`${source}/assets/${id}`);const gltf=await loadModel(registerAsset(id,`${source}/assets/${id}`,asset,'low'),renderer);loaded.push(gltf);return gltf.scene;};
 let prepared:ReturnType<typeof prepareModel>|ReturnType<typeof buildLayout>|undefined;let world:WalkWorld|undefined;
 try{if(scene.type==='PANORAMA')throw new Error('An exit requires a 3D destination.');
  if(scene.type==='LAYOUT'){const ids=[...new Set(scene.layout.elements.filter(e=>e.kind==='INSTANCE').map(e=>e.asset_id!))];const sources=await Promise.all(ids.map(async id=>[id,await model(id)] as const));prepared=buildLayout(scene.layout,new Map(sources));}else prepared=prepareModel(await model(scene.asset_id!),scene.settings);
  world=new WalkWorld(prepared.root);const valid=world.validStart(new Vector3(...portal.arrival.position),portal.destination_region_id);if(!valid)throw new Error('Exit arrival has no approved floor or standing clearance. Edit the exit arrival before entering.');
  return {...portal.arrival,position:valid.toArray() as [number,number,number]};
 }finally{world?.dispose();prepared?.dispose();for(const gltf of loaded)disposeModel(gltf);}}
