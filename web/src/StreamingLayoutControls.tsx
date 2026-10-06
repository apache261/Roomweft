import { applyBakedLighting } from './hqRendering';
import { currentRun } from './performanceMetrics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Vector3 } from 'three';
import { readModel, retainModels, retainAssetSource } from './runtimeAssetCache';
import { useAssetTextures } from './useAssetModels';
import { RoomChunkCache } from './roomStreaming';
import { layoutRoomMetadata, preloadRooms, visibleRooms } from './roomVisibility';
import { buildLayout } from './layoutGeometry';
import { ModelWalkControls, type WalkProps } from './WalkControls';
import type { LayoutDocument } from './layout';
import { useAnimationFrames, useViewerFrame } from './ViewerRuntime';

export function StreamingLayoutControls({document,urls,textureURLs,...props}:WalkProps & {document:LayoutDocument;urls:Record<string,string>;textureURLs:Record<string,string>}) {
 const {gl,invalidate}=useThree();const [revision,bump]=useState(0);
 const metadata=useMemo(()=>layoutRoomMetadata(document),[document]);
 const initial=props.arrival?.pose.position||props.saved.current?.position;
 const occupied=useRef<string|undefined>(undefined);
 const starting=occupied.current||metadata.rooms.find(r=>initial&&r.box.containsPoint(new Vector3(...initial)))?.id||document.elements.find(e=>e.kind==='LOBBY')?.id||metadata.rooms[0]?.id;
 const wanted=useRef(new Set(starting?[starting]:[])),fingerprint=useRef(''),started=useRef(false),planningReady=useRef(false);
 const cache=useMemo(()=>new RoomChunkCache<GLTF>(id=>{
  const entry=readModel(urls[id],gl);return {promise:entry.promise,release:retainModels([entry],gl)};
 },()=>{bump(n=>n+1);invalidate();}),[urls,gl,invalidate]);
 useEffect(()=>{const releases=Object.values(urls).map(retainAssetSource);return()=>{cache.dispose();releases.forEach(f=>f());};},[cache,urls]);
 const request=(rooms:Set<string>)=>{
  wanted.current=rooms;
  const ids=[...new Set(document.elements.filter(e=>e.kind==='INSTANCE'&&e.asset_id&&(!e.room_id||rooms.has(e.room_id))).sort((a,b)=>Number(!!a.room_id)-Number(!!b.room_id)||Number(b.room_id===starting)-Number(a.room_id===starting)).map(e=>e.asset_id!))];
  const key=JSON.stringify([...ids].sort());if(key!==fingerprint.current){fingerprint.current=key;cache.request(ids);bump(n=>n+1);invalidate();}
 };
 useEffect(()=>{fingerprint.current='';request(props.walking&&!metadata.conservative&&!gl.shadowMap.enabled?preloadRooms(new Set(starting?[starting]:[]),metadata.openings):new Set(metadata.rooms.map(r=>r.id)));},[cache,document,props.walking]);
 const keys=useMemo(()=>Object.keys(textureURLs).sort(),[textureURLs]);
 // Material images remain shared/global until the layout has per-room presets.
 const textures=useAssetTextures(keys.map(id=>textureURLs[id]));
 const models=useMemo(()=>new Map([...cache.entries].filter(([id,e])=>e.status==='ready'&&JSON.parse(fingerprint.current||'[]').includes(id)).map(([id,e])=>[id,e.value!])),[cache,revision]);
 const blocked=new Set(document.elements.filter(e=>e.room_id&&e.asset_id&&!models.has(e.asset_id)).map(e=>e.room_id!));
 const globalReady=document.elements.filter(e=>e.kind==='INSTANCE'&&!e.room_id).every(e=>!!e.asset_id&&models.has(e.asset_id));
 const initialReady=globalReady&&(!starting||!blocked.has(starting));
 const previous=useRef<{document:LayoutDocument;result:ReturnType<typeof buildLayout>;entries:ReturnType<typeof readModel>[]}|undefined>(undefined);
 const snapshot=useMemo(()=>{
  // Keep the supported scene alive while a quality tier replacement downloads.
  if(!initialReady&&previous.current?.document===document)return previous.current;

  const result=buildLayout(document,new Map([...models].map(([id,m])=>[id,m.scene])),new Map(keys.map((id,i)=>[id,textures[i]])),new Map([...models].map(([id,m])=>[id,m.animations])),blocked);
  let uncertain=false;
  for(const child of result.root.children)if(child.userData.layoutElement&&document.elements.some(e=>e.id===child.userData.layoutElement&&e.room_id)&&!child.userData.roomIds?.length)uncertain=true;
  result.root.userData.roomMetadata={...metadata,conservative:metadata.conservative||uncertain};
  const baked=applyBakedLighting(result.root,document.materials||[],new Map(keys.map((id,i)=>[id,textures[i]])),props.bakeRevision||'');const dispose=result.dispose;result.dispose=()=>{baked.dispose();dispose();};
  const value={document,result,entries:[...models.keys()].map(id=>readModel(urls[id],gl))};previous.current=value;return value;
 },[document,models,keys,textures,metadata,initialReady,urls,gl,props.bakeRevision]);
 const prepared=snapshot.result;
 useEffect(()=>retainModels(snapshot.entries,gl),[snapshot,gl]);
 const clock=useRef(0);
 useEffect(()=>{if(prepared.hasAnimations)prepared.updateAnimations(clock.current);},[prepared]);
 useAnimationFrames(seconds=>{clock.current+=seconds;prepared.updateAnimations(seconds);},prepared.hasAnimations);
 useEffect(()=>()=>prepared.dispose(),[prepared]);
 if(initialReady)started.current=true;
 const controlsReady=useCallback((actions:Parameters<WalkProps['ready']>[0])=>{planningReady.current=!!actions;props.ready(actions);},[props.ready]);
 useViewerFrame(({camera})=>{
  if(!planningReady.current)return;
  const visible=visibleRooms(camera,metadata.rooms,metadata.openings,!props.walking||prepared.root.userData.roomMetadata.conservative||gl.shadowMap.enabled);
  // Pin the occupied room plus a doorway ring, irrespective of camera direction.
  const eye=new Vector3().setFromMatrixPosition(camera.matrixWorld);
  for(const r of metadata.rooms)if(r.box.clone().expandByScalar(.5).containsPoint(eye))visible.add(r.id);
  occupied.current=metadata.rooms.find(r=>r.box.containsPoint(eye))?.id;
  request(preloadRooms(visible,metadata.openings));
 });
 const needed=document.elements.filter(e=>e.kind==='INSTANCE'&&e.asset_id&&(!e.room_id||wanted.current.has(e.room_id)));
 const failed=needed.some(e=>cache.entries.get(e.asset_id!)?.status==='failed');
 const pending=needed.some(e=>!models.has(e.asset_id!));
 if(currentRun)currentRun.metadata={...currentRun.metadata,roomStreaming:{wantedRooms:wanted.current.size,blockedRooms:blocked.size,readyChunks:models.size,failed,pending,states:[...cache.entries].map(([id,e])=>[id,e.status])}};
 useEffect(()=>{props.onStreamingState?.(failed?'failed':pending?'loading':'ready',()=>cache.retry());return()=>props.onStreamingState?.('ready');},[failed,pending,cache,props.onStreamingState]);
 // Initial collision preparation must finish before movement controls mount.
 return started.current?<ModelWalkControls {...props} ready={controlsReady} roomVisibility root={prepared.root} surfaces={prepared.surfaces} textures={[...models.values()].reduce((n,m)=>n+(m.parser.json.textures?.length||0),0)} />:null;
}
