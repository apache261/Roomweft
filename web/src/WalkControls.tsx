import { applyBakedLighting } from './hqRendering';
import { useAnimationFrames, useRenderActivity, useViewerFrame } from './ViewerRuntime';
import { prepareSpatialRendering, simplifierReady } from './spatialRendering';
import type { Surface } from './materials';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useAssetModels, useAssetTextures } from './useAssetModels';
import { prepareModel, type SceneSettings } from './sceneSettings';
import { Box3, Euler, Vector3, TextureLoader, type Object3D, type WebGLRenderer } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CameraView, StartView, HotspotPosition } from './api';
import { hotspotPoint } from './hotspotVisibility';
import { WalkWorld, WalkSimulation } from './navigation';
import { visibleRooms } from './roomVisibility';
import {WalkingEffects} from './walkingEffects';
import type { Arrival, Portal } from './navigationSettings';

export type ModelInfo = { dimensions: number[]; walkable: boolean; textures: number; surfaces:Surface[];navigationError:string };
export type ViewerActions = { renderer?: WebGLRenderer; view: () => StartView; reset: () => void; show: (position: HotspotPosition) => void;canSaveStart?:()=>boolean;enter?:(portal:Portal)=>boolean;canActivate?:(portal:Portal)=>boolean };
export type WalkProps = {
 bakeRevision?:string; streaming?:boolean;roomVisibility?:boolean;onStreamingState?:(status:'ready'|'loading'|'failed',retry?:()=>void)=>void;
 optimizeVisuals?:boolean;
 effects?:boolean;smoothMovement?:boolean;
 instant?:boolean;onSelectElement?:(id:string)=>void;
 arrival?:{pose:Arrival;regionId:string};onNearby:(ids:string[])=>void;walking: boolean; saved: MutableRefObject<CameraView | undefined>; movement: MutableRefObject<Set<string>>;
 ready: (actions: ViewerActions | null) => void; report: (message: string) => void; placing: boolean;
 onPlace: (event: ThreeEvent<MouseEvent>) => void; onHover: (event: ThreeEvent<PointerEvent> | null) => void; paused: MutableRefObject<boolean>; onInfo: (info: ModelInfo) => void;
};
export function WalkControls({url,settings,textureURLs,...props}:WalkProps & {url:string;settings:SceneSettings;textureURLs:Record<string,string>}) {
 const [gltf]=useAssetModels([url]);
 const animationTime=useRef(0);
 const textureKeys=useMemo(()=>Object.keys(textureURLs).sort(),[textureURLs]);
 const textures=useAssetTextures(textureKeys.map(id=>textureURLs[id]));
 const prepared=useMemo(()=>{const images=new Map(textureKeys.map((id,i)=>[id,textures[i]])),model=prepareModel(gltf.scene,settings,images,gltf.animations),baked=applyBakedLighting(model.root,settings.materials||[],images,props.bakeRevision||'');return {...model,dispose:()=>{baked.dispose();model.dispose();}};},[gltf,settings.model.scale,settings.model.up_axis,settings.model.rotation,settings.materials,settings.surface_materials,settings.navigation,textureKeys,textures,props.bakeRevision]);
 useEffect(()=>{if(prepared.hasAnimations)prepared.updateAnimations(animationTime.current);},[prepared]);
 useAnimationFrames(seconds=>{animationTime.current+=seconds;prepared.updateAnimations(seconds);}, prepared.hasAnimations);
 useEffect(()=>()=>prepared.dispose(),[prepared]);
 const invalidate = useThree(state=>state.invalidate);
 useEffect(()=>{prepared.applyAppearance(settings.appearance);invalidate();},[prepared,settings.appearance.tint,settings.appearance.roughness,invalidate]);
 return <ModelWalkControls {...props} root={prepared.root} surfaces={prepared.surfaces} textures={gltf.parser.json.textures?.length||0} />;
}
export function ModelWalkControls({root,textures,surfaces,walking,saved,movement,ready,report,placing,onPlace,onHover,paused,onInfo,arrival,onNearby,instant,onSelectElement,effects=false,smoothMovement,optimizeVisuals=false,roomVisibility=false}:WalkProps & {root:Object3D;textures:number;surfaces:Surface[]}) {
  const { camera, gl, invalidate, frameloop } = useThree();
  const [canSimplify,setCanSimplify]=useState(false);
  useEffect(()=>{let active=true;simplifierReady.then(()=>{if(active)setCanSimplify(true);}).catch(()=>{});return()=>{active=false;};},[]);
  const visual=useMemo(()=>(optimizeVisuals||roomVisibility)&&!placing?prepareSpatialRendering(root,optimizeVisuals&&canSimplify,optimizeVisuals):undefined,[root,optimizeVisuals,roomVisibility,placing,canSimplify]);
  useEffect(()=>{invalidate();return()=>visual?.dispose();},[visual,invalidate]);
  const heldKeys=useRef(new Set<string>());
  const setMoving = useRenderActivity(false);
  const setOrbiting = useRenderActivity(false);
  const beginOrbit = useCallback(() => setOrbiting(true), [setOrbiting]);
  const endOrbit = useCallback(() => setOrbiting(false), [setOrbiting]);
  useEffect(() => {heldKeys.current.clear();endOrbit(); return endOrbit; }, [walking, endOrbit]);
 const renderingRoot=visual?.root||root;renderingRoot.userData.viewerModelRoot=true;
 const world=useMemo(()=>new WalkWorld(root),[root]);
 useEffect(()=>()=>world.dispose(),[world]);
 useEffect(()=>()=>{heldKeys.current.clear();movement.current.clear();if(document.pointerLockElement===gl.domElement)document.exitPointerLock();},[gl,movement]);
 const previousNavigation=useRef<ReturnType<WalkWorld['snapshotNavigation']>|undefined>(undefined);
 const previousOrbit=useRef<{position:Vector3;quaternion:import('three').Quaternion;target:Vector3;revision:string;rootId:string}|undefined>(undefined);
 const previousStanding=useRef<Vector3|undefined>(undefined);
 const previousAngles=useRef({yaw:0,pitch:0});
 const arrivalConsumed=useRef(false);
  useEffect(()=>{const valid=!!world.start()||!!(arrival&&world.validStart(new Vector3(...arrival.pose.position),arrival.regionId));onInfo({dimensions:new Box3().setFromObject(root).getSize(new Vector3()).toArray(),walkable:valid,textures,surfaces,navigationError:valid?'':!world.regions.length?'Review and save walking regions before walking in this imported model.':'No valid standing floor in the approved regions. Check selected floors, floor heights and standing clearance.'});},[world,root,textures,surfaces,onInfo,arrival]);
  const state = useThree(state => state.controls);
  const ticker = useRef<((seconds: number) => void) | undefined>(undefined);
  useEffect(() => {
    world.restoreNavigation(previousNavigation.current);
    const smooth=smoothMovement??!instant;
    const simulation=new WalkSimulation(world,world.settings.speed,smooth),cameraEffects=new WalkingEffects();
 let nearbyKey='';
 let renderHeight:number|undefined;
 let physical:Vector3|undefined;
    const center = world.bounds.getCenter(new Vector3());
    const apply = (view: CameraView) => {
      camera.position.fromArray(view.position);physical=camera.position.clone();renderHeight=physical.y;previousStanding.current=physical.clone();previousAngles.current={yaw:view.yaw,pitch:view.pitch};simulation.clear();cameraEffects.reset();
      camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ'); camera.updateMatrixWorld(); invalidate();
    };
    const reset = () => {
      if(arrival&&!arrivalConsumed.current){arrivalConsumed.current=true;const entered=world.enter({id:'arrival',label:'Arrival',position:arrival.pose.position,axis:'x',width:1,destination_region_id:arrival.regionId,arrival:arrival.pose});if(entered){apply(entered);report('');return;}report('Exit arrival is no longer valid. Using a verified interior start.');}
      if(world.exteriorActive){const pose=world.recovery();if(pose){apply(pose);report('Reset within the approved exterior region. Use its return exit to go inside.');return;}}
      const stored = saved.current;
      const valid = stored && world.validStart(new Vector3(...stored.position));
      const view = stored && valid ? { ...stored, position: valid.toArray() as [number,number,number] } : world.start();
      if (view) { apply(view); if(stored&&!valid)report('Saved start is outside the approved walking area or has no standing clearance. Using a verified safe start.');else if(!arrival)report(''); }
      else report(world.regions.length?'No valid standing floor in the approved regions. Inspection remains available.':'Review and save walking regions before walking in this imported model.');
    };
    if (walking) {previousOrbit.current=undefined;const previous=previousStanding.current&&world.validStart(previousStanding.current);if(previous&&(!arrival||arrivalConsumed.current)){apply({...saved.current,position:previous.toArray() as [number,number,number],...previousAngles.current});}else {const displaced=!!previousStanding.current;reset();if(displaced&&physical)report('Standing position changed with the scene. Using a verified safe start.');}}
    else if(previousOrbit.current&&previousOrbit.current.revision===root.userData.runtimeGeometryRevision){
      camera.position.copy(previousOrbit.current.position);camera.quaternion.copy(previousOrbit.current.quaternion);
      if(state&&'target' in state){(state as OrbitControlsImpl).target.copy(previousOrbit.current.target);(state as OrbitControlsImpl).update();}
    } else {
      const distance = Math.max(world.bounds.getSize(new Vector3()).length(), 1);
      camera.position.copy(center).add(new Vector3(distance * 0.55, distance * 0.4, distance * 0.75));
      camera.lookAt(center);
      if (state && 'target' in state) { (state as OrbitControlsImpl).target.copy(center); (state as OrbitControlsImpl).update(); }
    }
    camera.near = 0.05; camera.far = Math.max(1000, world.bounds.getSize(new Vector3()).length() * 10); camera.updateProjectionMatrix(); invalidate();
    const view = (): CameraView => {
      const rotation = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      return { position: [camera.position.x, physical?.y??camera.position.y, camera.position.z], yaw: rotation.y, pitch: rotation.x };
    };
    const show = (position: HotspotPosition) => {
      const point = hotspotPoint(position);
      if (walking) {
        // Aim from the current supported location; never teleport through walls.
        if (!physical||!world.grounded(physical)) { report('Use Inspect model to find this hotspot; your current position has no valid floor.'); return; }
        camera.lookAt(point);
        report('Looking toward hotspot. If a wall hides it, use Inspect model or open it from the hotspot list.');
      } else {
        const distance = Math.max(world.bounds.getSize(new Vector3()).length() * 0.2, 1);
        const interior = world.start();
        const reference = interior ? new Vector3(...interior.position) : camera.position;
        const direction = reference.clone().sub(point).normalize();
        if (direction.lengthSq() === 0) direction.set(1, 0.6, 1).normalize();
        camera.position.copy(point).addScaledVector(direction, distance);
        camera.lookAt(point);
        if (state && 'target' in state) { (state as OrbitControlsImpl).target.copy(point); (state as OrbitControlsImpl).update(); }
      }
      camera.updateMatrixWorld(); invalidate();
    };
    ready({ renderer:gl, view, reset, show,canSaveStart:()=>!!physical&&!world.exteriorActive&&!!world.validStart(physical),canActivate:p=>!!physical&&world.canActivate(p,physical),enter:p=>{if(!physical||!world.canActivate(p,physical))return false;const entered=world.enter(p);if(!entered)return false;apply(entered);return true;} });
    const canvas = gl.domElement;
    canvas.tabIndex = 0; canvas.setAttribute('aria-label', walking ? '3D scene. WASD or arrows to walk. Click for mouse look, Escape to release.' : '3D scene. Click or focus, then WASD or arrows to move. Drag to orbit.');
    if(walking&&instant)canvas.focus({preventScroll:true});
    const keys = new Set(heldKeys.current);if(keys.size)setMoving(true);
    let capturePending = false;
    let firstCapturedMovement = true;
    let drag: { id: number; x: number; y: number } | undefined;
    const look = (x: number, y: number) => {
      if (document.hidden) return;
      const v = view();
      v.yaw = Math.atan2(Math.sin(v.yaw - x * 0.003), Math.cos(v.yaw - x * 0.003));
      v.pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, v.pitch - y * 0.003));
      camera.rotation.set(v.pitch,v.yaw,0,'YXZ');camera.updateMatrixWorld(); invalidate();
    };
    const clear = () => { setOrbiting(false); const changed = keys.size || movement.current.size || drag || simulation.velocity.lengthSq() || cameraEffects.active || physical && camera.position.y !== physical.y; setMoving(false); if(changed)invalidate(); keys.clear(); movement.current.clear(); drag = undefined;simulation.clear();cameraEffects.reset();if(physical){camera.position.y=physical.y;renderHeight=physical.y;} };
    const lockChanged = () => {heldKeys.current.clear(); capturePending = false; firstCapturedMovement = true; clear(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.pointerLockElement === canvas) { document.exitPointerLock(); clear(); return; }
      if (document.hidden || paused.current || document.pointerLockElement !== canvas && document.activeElement !== canvas) return;
      const key = event.key.toLowerCase();
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)) { event.preventDefault(); keys.add(key);heldKeys.current.add(key); setMoving(true); invalidate(); }
    };
    const keyup = (event: KeyboardEvent) => { keys.delete(event.key.toLowerCase());heldKeys.current.delete(event.key.toLowerCase()); invalidate(); };
    const down = (event: PointerEvent) => {
      if (document.hidden || paused.current || event.button !== 0 || document.pointerLockElement === canvas) return;
      canvas.focus({preventScroll:true});
      if(!walking)return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      if (event.pointerType === 'mouse' && canvas.requestPointerLock) {
        // Ignore cursor-reset events until capture is established. Some browsers
        // deliver a large relative movement before pointerlockchange.
        capturePending = true;
        const request = canvas.requestPointerLock();
        request?.catch(() => { capturePending = false; report('Mouse capture unavailable. Drag to look or use touch controls.'); });
      }
    };
    const move = (event: PointerEvent) => {
      if (paused.current || !walking || capturePending || document.pointerLockElement === canvas || drag?.id !== event.pointerId) return;
      look(event.clientX - drag.x, event.clientY - drag.y); drag.x = event.clientX; drag.y = event.clientY;
    };
    const mouse = (event: MouseEvent) => {
      if (!walking || paused.current || capturePending || document.pointerLockElement !== canvas) return;
      // Cursor recentering may arrive after pointerlockchange. It must not turn
      // the camera away from a hotspot just framed with Show hotspot.
      const amount = Math.hypot(event.movementX, event.movementY);
      if (!amount) return;
      if (firstCapturedMovement) {
        firstCapturedMovement = false;
        if (amount > 64) return;
      }
      look(event.movementX, event.movementY);
    };
    const up = () => { drag = undefined; };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('mousemove', mouse); const releaseHeld=()=>{heldKeys.current.clear();clear();};
    window.addEventListener('blur', releaseHeld);
    document.addEventListener('pointerlockchange', lockChanged); document.addEventListener('visibilitychange', releaseHeld);
    const tick = (seconds: number) => {
      if (paused.current || document.hidden || document.pointerLockElement !== canvas && document.activeElement !== canvas && keys.size) { heldKeys.current.clear();clear(); return; }
      if(!walking){
        const x=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));
        const z=Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'));
        if((x||z)&&seconds<=0.25){const delta=new Vector3(x,0,z).normalize().applyQuaternion(camera.quaternion).multiplyScalar(world.settings.speed*Math.min(seconds,0.1));camera.position.add(delta);if(state&&'target'in state){(state as OrbitControlsImpl).target.add(delta);(state as OrbitControlsImpl).update();}camera.updateMatrixWorld();}
        setMoving(!!(x || z));
        return;
      }
      const all = new Set([...keys, ...movement.current]);
      const x = Number(all.has('d') || all.has('arrowright')) - Number(all.has('a') || all.has('arrowleft'));
      const z = Number(all.has('s') || all.has('arrowdown')) - Number(all.has('w') || all.has('arrowup'));
      if(!physical)return;
      const yaw=view().yaw,input=new Vector3(x,0,z);if(input.lengthSq()>1)input.normalize();input.applyAxisAngle(new Vector3(0,1,0),yaw);
      const supported=world.grounded(physical);if(!supported)report('Standing position became invalid. Recovering to a verified safe location.');
      const before=physical.clone();physical=simulation.step(physical,input,seconds);previousStanding.current=physical.clone();previousAngles.current={yaw:view().yaw,pitch:view().pitch};
      renderHeight=!smooth?physical.y:renderHeight===undefined?physical.y:renderHeight+(physical.y-renderHeight)*(1-Math.exp(-18*Math.min(seconds,0.1)));
      const bob=cameraEffects.step(Math.hypot(physical.x-before.x,physical.z-before.z),seconds,effects);
      camera.position.set(physical.x,renderHeight+bob,physical.z);camera.updateMatrixWorld();
      setMoving(!!(x || z) || simulation.velocity.lengthSq() > 1e-8 || Math.abs(bob) > 1e-6 || cameraEffects.active || Math.abs(renderHeight - physical.y) > 1e-4);
      const nearby=world.settings.portals.filter(p=>world.canActivate(p,physical!)).map(p=>p.id),key=nearby.join(',');if(key!==nearbyKey){nearbyKey=key;onNearby(nearby);}

    };
    ticker.current = tick;
    return () => {
      previousNavigation.current=world.snapshotNavigation();
      if(!walking&&root.userData.runtimeGeometryRevision)previousOrbit.current={position:camera.position.clone(),quaternion:camera.quaternion.clone(),target:state&&'target' in state?(state as OrbitControlsImpl).target.clone():center.clone(),revision:root.userData.runtimeGeometryRevision,rootId:root.uuid};
      const heldTouch=new Set(movement.current);ready(null); clear();if(roomVisibility)heldTouch.forEach(key=>movement.current.add(key)); ticker.current = undefined;onNearby([]);
      if (!roomVisibility&&document.pointerLockElement === canvas) document.exitPointerLock();
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('mousemove', mouse); window.removeEventListener('blur', releaseHeld);
      document.removeEventListener('pointerlockchange', lockChanged); document.removeEventListener('visibilitychange', releaseHeld);
    };
  }, [world,root,walking,camera,gl,saved,movement,ready,report,state,paused,arrival,onNearby,instant,effects,smoothMovement,invalidate,setMoving,setOrbiting,roomVisibility]);
  useViewerFrame((state, delta) => { ticker.current?.(delta); visual?.update(state.camera,state.size.height);
    const metadata=root.userData.roomMetadata;if(visual&&roomVisibility&&metadata){
      // Off-screen shadow/reflective contributors require a full conservative set.
      const visible=visibleRooms(state.camera,metadata.rooms,metadata.openings,!walking||metadata.conservative||gl.shadowMap.enabled);
      for(const object of visual.root.children){const ids=object.userData.roomIds as string[]|undefined;object.visible=!ids?.length||ids.some(id=>visible.has(id));}
    } });
  return <><primitive object={visual?.root || root} onPointerMove={(event: ThreeEvent<PointerEvent>) => { if (placing) onHover(event); }} onPointerOut={() => onHover(null)} onClick={(event: ThreeEvent<MouseEvent>) => { if(event.delta>=5)return;if(placing)onPlace(event);else if(!walking&&onSelectElement){let object=event.object;while(object&&!object.userData.layoutElement&&object.parent)object=object.parent;const id=object.userData.layoutElement;if(id){event.stopPropagation();onSelectElement(id);}} }} />{!walking && <OrbitControls makeDefault onStart={beginOrbit} onEnd={endOrbit} enabled={frameloop !== 'never'} enableDamping={!instant} />}</>;
}
