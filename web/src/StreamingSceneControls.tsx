import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Matrix4, Vector3, type Object3D } from 'three';
import { resolveAssetSource } from './runtimeAssetCache';
import { sharedChunkImageStats } from './sharedChunkImages';
import { ChunkStreamSession } from './ChunkStreamSession';
import { admitsChunks, planChunks, startingChunks } from './chunkStreaming';
import { prepareModel, modelMatrix, type SceneSettings } from './sceneSettings';
import { buildLayout } from './layoutGeometry';
import { WalkWorld } from './navigation';
import { ModelWalkControls, WalkControls, type WalkProps } from './WalkControls';
import { LayoutControls } from './LayoutControls';
import { useAssetTextures } from './useAssetModels';
import { applyBakedLighting } from './hqRendering';
import { useAnimationFrames, useViewerFrame } from './ViewerRuntime';
import { currentRun } from './performanceMetrics';
import type { LayoutDocument } from './layout';

type Props=WalkProps & {url?:string;urls?:Record<string,string>;settings?:SceneSettings;document?:LayoutDocument;textureURLs:Record<string,string>};
type Prepared=ReturnType<typeof prepareModel>|ReturnType<typeof buildLayout>;
type Active={session:ChunkStreamSession;navigation:Prepared;occlusion:Prepared;placements:{parent:string;matrix:Matrix4}[];initial:string[]};
export function StreamingSceneControls({url,urls,settings,document,textureURLs,...props}:Props){
 const {gl,invalidate}=useThree();const [revision,bump]=useState(0),[attempt,retry]=useState(0),[fallback,setFallback]=useState(false),[active,setActive]=useState<Active|null>(null);
 const activeRef=useRef(active);activeRef.current=active;
 const currentActions=useRef<Parameters<WalkProps['ready']>[0]>(null);
 const sourceURLs=useMemo(()=>urls||{},[urls]);
 // Imported IDs come from the registered parent, never from derivative keys.
 const resolvedURLs=useMemo(()=>{if(url){const s=resolveAssetSource(url);return {[s!.id]:url};}return sourceURLs;},[url,sourceURLs]);
 const keys=useMemo(()=>Object.keys(textureURLs).sort(),[textureURLs]),textures=useAssetTextures(keys.map(id=>textureURLs[id]));
 const images=useMemo(()=>new Map(keys.map((id,i)=>[id,textures[i]])),[keys,textures]);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const changed=useCallback(()=>{if(timer.current===undefined)timer.current=setTimeout(()=>{timer.current=undefined;bump(n=>n+1);invalidate();},16);},[invalidate]);
 useEffect(()=>()=>{if(timer.current!==undefined)clearTimeout(timer.current);},[]);
 useEffect(()=>()=>props.onStreamingState?.('ready'),[props.onStreamingState]);
 useEffect(()=>{if(fallback)props.onStreamingState?.('ready');},[fallback,props.onStreamingState]);
 const animationTime=useRef(0);
 const prepare=useCallback((sources:Map<string,Object3D>,animations=new Map<string,import('three').AnimationClip[]>())=>document?buildLayout(document,sources,images,animations):prepareModel(sources.values().next().value!,settings!,images),[document,settings,images]);
 useEffect(()=>{
  let live=true,committed=false,cleaned=false;const session=new ChunkStreamSession(resolvedURLs,gl,changed);let navigation:Prepared|undefined,occlusion:Prepared|undefined;
  const cleanup=()=>{if(cleaned)return;cleaned=true;session.dispose();navigation?.dispose();occlusion?.dispose();};
  setFallback(false);props.onStreamingState?.('loading');
  void (async()=>{
   await session.initialize();if(!live)return;
   const nav=session.exactSources('navigation'),occ=session.exactSources('occlusion');
   const animations=new Map([...occ].map(([id,m])=>[id,m.animations]));
   navigation=prepare(new Map([...nav].map(([id,m])=>[id,m.scene])),animations);
   occlusion=prepare(new Map([...occ].map(([id,m])=>[id,m.scene])),animations);
   const world=new WalkWorld(navigation.root);
   const requested=(activeRef.current&&currentActions.current?.view() as import('./api').CameraView|undefined)?.position||props.arrival?.pose.position||props.saved.current?.position;
   const validated=requested&&world.validStart(new Vector3(...requested),props.arrival?.regionId);
   const start=validated||world.start()?.position;
   world.dispose();
   const position=start instanceof Vector3?start:Array.isArray(start)?new Vector3(...start):new Vector3();
   const placements=document?document.elements.filter(e=>e.kind==='INSTANCE'&&e.asset_id).map(e=>({parent:e.asset_id!,matrix:new Matrix4().makeTranslation(e.x,0,e.z).multiply(modelMatrix({scale:e.scale,rotation:e.rotation,up_axis:'Y'}))})):[{parent:Object.keys(resolvedURLs)[0],matrix:modelMatrix(settings!.model)}];
   let initial=[...new Set(placements.flatMap(p=>{const m=session.manifests.get(p.parent);return m?[...startingChunks(m,position,p.matrix,navigation!.root.userData.navigation.eye_height)].map(id=>`${p.parent}/${id}`):[`${p.parent}/complete`];}))];
   await session.requestAndWait(initial);if(!live)return;
   while(activeRef.current&&currentActions.current){
    const view=currentActions.current.view();if(!('position' in view))break;
    const latest=new Vector3(...view.position),needed=[...new Set(placements.flatMap(p=>{const m=session.manifests.get(p.parent);return m?[...startingChunks(m,latest,p.matrix,navigation!.root.userData.navigation.eye_height)].map(id=>`${p.parent}/${id}`):[`${p.parent}/complete`];}))];
    initial=needed;if(needed.every(id=>session.cache.entries.get(id)?.status==='ready'))break;
    await session.requestAndWait(needed);if(!live)return;
   }
   // Admission reads a mutable committed set, independently of floor indexes.
   navigation.root.userData.admitsMovement=(p:Vector3,radius:number,height:number)=>placements.every(placement=>{const m=session.manifests.get(placement.parent);return !m||admitsChunks(m,p,placement.matrix,session.ready(placement.parent),radius,height,!!document);});
   session.exactIDs().forEach(id=>session.events.get(id)?.('exact-navigation-occlusion-prepared'));
   committed=true;setActive({session,navigation,occlusion,placements,initial});invalidate();
  })().catch(error=>{
   if(!live)return;
   cleanup();
   if(!activeRef.current){setFallback(true);props.report('Chunk bootstrap unavailable. Loading the complete scene.');}else props.onStreamingState?.('failed',()=>retry(n=>n+1));
   if(currentRun)currentRun.metadata={...currentRun.metadata,chunkFallback:String(error)};
  });
  return()=>{live=false;if(!committed)cleanup();};
 },[resolvedURLs,gl,prepare,attempt,changed]);
 useEffect(()=>()=>{active?.session.dispose();active?.navigation.dispose();active?.occlusion.dispose();},[active]);
 const visual=useMemo(()=>{
  if(!active)return null;
  const animations=new Map([...active.session.exactSources('occlusion')].map(([id,m])=>[id,m.animations]));
  const prepared=prepare(active.session.visualSources(),animations);
  const baked=applyBakedLighting(prepared.root,document?.materials||settings?.materials||[],images,props.bakeRevision||'');
  prepared.root.userData.runtimeGeometryRevision=active.navigation.root.userData.runtimeGeometryRevision;
  prepared.root.userData.runtimeOcclusionRoot=active.occlusion.root;
  prepared.root.userData.streamingVisibility=active.session.visible;
  prepared.root.userData.streamingContributorsPending=[...active.session.manifests].some(([parent,m])=>m.chunks.some(c=>!active.session.cache.entries.get(`${parent}/${c.id}`)?.value));
  const dispose=prepared.dispose;prepared.dispose=()=>{baked.dispose();dispose();};return prepared;
 },[active,revision,prepare,images,document?.materials,settings?.materials,props.bakeRevision]);
 useLayoutEffect(()=>{if(active&&visual){active.session.commit();invalidate();return active.session.retainVisuals();}},[active,visual,invalidate]);
 useEffect(()=>()=>visual?.dispose(),[visual]);
 useEffect(()=>{if(visual?.hasAnimations)visual.updateAnimations(animationTime.current);},[visual]);
 useAnimationFrames(seconds=>{animationTime.current+=seconds;visual?.updateAnimations(seconds);active?.navigation.updateAnimations(seconds);active?.occlusion.updateAnimations(seconds);},!!visual?.hasAnimations);
 const previousEye=useRef<Vector3|undefined>(undefined),velocity=useRef(new Vector3()),fingerprint=useRef(''),plannedSession=useRef<ChunkStreamSession|undefined>(undefined);
 useViewerFrame(({camera},seconds)=>{
  if(!active||!visual)return;
  if(plannedSession.current!==active.session){plannedSession.current=active.session;fingerprint.current='';previousEye.current=undefined;}
  const eye=new Vector3().setFromMatrixPosition(camera.matrixWorld);
  if(previousEye.current&&seconds>0&&eye.distanceTo(previousEye.current)<1)velocity.current.copy(eye).sub(previousEye.current).divideScalar(seconds);else velocity.current.set(0,0,0);previousEye.current=eye;
  const wanted=new Set<string>(),priority=new Set<string>(),visible=new Set<string>(),movementRequired=new Set<string>(),prefetch=new Set<string>();
  const portals=active.navigation.root.userData.navigation.portals as import('./navigationSettings').Portal[];
  for(const portal of portals)if(currentActions.current?.canActivate?.(portal))for(const placement of active.placements){const m=active.session.manifests.get(placement.parent);if(m)startingChunks(m,new Vector3(...portal.arrival.position),placement.matrix,active.navigation.root.userData.navigation.eye_height).forEach(id=>{wanted.add(`${placement.parent}/${id}`);priority.add(`${placement.parent}/${id}`);});}
  for(const placement of active.placements){const m=active.session.manifests.get(placement.parent);if(!m)continue;const plan=planChunks(m,camera,placement.matrix,{inspection:!props.walking,shadows:gl.shadowMap.enabled,velocity:velocity.current,latency:active.session.latency});
   plan.movement.forEach(id=>movementRequired.add(`${placement.parent}/${id}`));plan.prefetch.forEach(id=>prefetch.add(`${placement.parent}/${id}`));
   plan.wanted.forEach(id=>wanted.add(`${placement.parent}/${id}`));plan.priority.forEach(id=>priority.add(`${placement.parent}/${id}`));[...plan.visible,...plan.pinned,...plan.movement].forEach(id=>visible.add(`${placement.parent}/${id}`));
  }
  // Template/legacy visuals remain conservative; chunk IDs are separately selected.
  document?.elements.forEach(e=>visible.add(e.id));
  active.session.visible.clear();visible.forEach(id=>active.session.visible.add(id));
  const next=JSON.stringify([[...wanted].sort(),[...priority]]);if(next!==fingerprint.current){fingerprint.current=next;active.session.request(wanted,priority);}
  const required=[...new Set([...active.session.exactIDs(),...wanted])],failed=required.filter(id=>active.session.cache.entries.get(id)?.status==='failed'),pending=required.some(id=>!active.session.committed.has(id));
  const fullReady=[...active.session.manifests].every(([parent,m])=>m.chunks.every(c=>active.session.committed.has(`${parent}/${c.id}`)));
  visual.root.userData.streamingContributorsPending=!fullReady;
  props.onStreamingState?.(failed.length?'failed':pending?'loading':'ready',()=>active.session.cache.retry(failed));
  if(currentRun)currentRun.metadata={...currentRun.metadata,chunkStreaming:{sharedImages:sharedChunkImageStats(),parents:active.session.manifests.size,resident:[...active.session.cache.entries.values()].filter(e=>e.status==='ready').length,visible:visible.size,movementRequired:movementRequired.size,prefetch:prefetch.size,pinned:active.session.exactIDs().length+[...active.session.manifests.values()].reduce((sum,m)=>sum+m.global_chunks.length,0),wanted:wanted.size,failed:failed.length,pending,latencySeconds:active.session.latency,sourceFallback:false,exactOcclusion:'complete-authored-source',requiredExactBytes:[...active.session.manifests.values()].reduce((sum,m)=>sum+m.navigation.payload.bytes+m.occlusion.payload.bytes,0),residentTextureRGBA8UpperEstimate:[...active.session.manifests].reduce((sum,[parent,m])=>sum+m.occlusion.payload.texture_rgba8_bytes+m.chunks.filter(c=>active.session.committed.has(`${parent}/${c.id}`)).reduce((n,c)=>n+Math.max(...Object.values(c.variants).map(v=>v.texture_rgba8_bytes)),0),0)}};
 });
 useEffect(()=>{if(active){active.navigation.updateAnimations(animationTime.current);active.occlusion.updateAnimations(animationTime.current);}},[active]);
 const ready=useCallback((actions:Parameters<WalkProps['ready']>[0])=>{currentActions.current=actions;if(!actions){props.ready(null);return;}
  props.ready({...actions,reset:()=>{const state=activeRef.current,target=props.saved.current?.position;if(!state||!target){actions.reset();return;}
   const ids=[...new Set(state.placements.flatMap(p=>{const m=state.session.manifests.get(p.parent);return m?[...startingChunks(m,new Vector3(...target),p.matrix,state.navigation.root.userData.navigation.eye_height)].map(id=>`${p.parent}/${id}`):[];}))];
   void state.session.ensureCommitted(ids).then(()=>{if(activeRef.current?.session===state.session)currentActions.current?.reset();}).catch(()=>{if(activeRef.current?.session===state.session)props.report('Start area could not load. Current supported view retained; retry Reset view.');});
  }});
 },[props.ready]);
 if(fallback){return document?<LayoutControls {...props} streaming={false} document={document} urls={resolvedURLs} textureURLs={textureURLs}/>:<WalkControls {...props} url={url!} settings={settings!} textureURLs={textureURLs}/>;}
 return active&&visual?<ModelWalkControls {...props} ready={ready} roomVisibility root={visual.root} navigationRoot={active.navigation.root} surfaces={visual.surfaces} textures={[...active.session.exactSources('occlusion').values()].reduce((sum,m)=>sum+(m.parser.json.textures?.length||0),0)}/>:null;
}
