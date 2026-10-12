import {currentRun,summarize,performanceStage} from '../performanceMetrics';
import {splatRendererStats} from './budget.js';
import {splatCacheStats} from './splatAssetCache';
import {useEffect,useRef,useState, type MutableRefObject} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import {Box3,Euler,Vector3} from 'three';
import type {OrbitControls as OrbitControlsImpl} from 'three-stdlib';
import {modelMatrix, type SceneSettings} from '../sceneSettings';
import type {CameraView, HotspotPosition} from '../api';
import type {ViewerActions} from '../WalkControls';
import {hotspotPoint} from '../hotspotVisibility';
import {acquireSplat} from './splatAssetCache';
import {createSplatAsync, type createSplat} from './driver.js';

type Driver=ReturnType<typeof createSplat>;
export function SplatSceneControls({endpoint,settings,saved,ready,onError,onProgress,paused}:{
 endpoint:string;settings:SceneSettings;saved:MutableRefObject<CameraView|undefined>;ready:(actions:ViewerActions|null)=>void;onError:(error:string)=>void;onProgress:(message:string)=>void;paused:MutableRefObject<boolean>;
}) {
 const {gl,scene,camera,invalidate}=useThree();
 const controls=useRef<OrbitControlsImpl>(null),resource=useRef<Driver>(undefined);
 const latest=useRef({settings,saved,ready,onError,onProgress});latest.current={settings,saved,ready,onError,onProgress};
 const [loaded,setLoaded]=useState(false);
 useEffect(()=>{
  let active=true,driver:Driver|undefined,announced=false;
  const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),60_000);
  const lease=acquireSplat(endpoint,p=>{if(active)latest.current.onProgress(`${p.stage==='download'?'Downloading':'Validating'} splat… ${p.total?Math.round(p.bytes/p.total*100)+'%':p.bytes+' bytes'}`);});
  const fail=(error:unknown)=>{if(active){latest.current.ready(null);latest.current.onError(error instanceof Error?error.message:'Could not prepare splat.');}};
  lease.promise.then(bytes=>{const finish=performanceStage('splat-decode',bytes.byteLength);return createSplatAsync(bytes,gl,invalidate,()=>{
   if(!active||announced||!driver)return;announced=true;setLoaded(true);
   latest.current.onProgress(`Gaussian splat ready: ${driver.count.toLocaleString()} splats. Inspection only.`);latest.current.ready(actions);
  },abort.signal,f=>{if(active)latest.current.onProgress(`Preparing splat… ${Math.round(f*100)}%`);},fail).then(result=>{finish();return result;},error=>{finish('failed');throw error;});}).then(result=>{
   clearTimeout(timeout);if(!active){result.dispose();return;}
   driver=result;resource.current=result;scene.add(result.mesh);applyTransform();reset();invalidate();
  }).catch(fail);
  function applyTransform(){if(!driver)return;driver.mesh.matrixAutoUpdate=false;driver.mesh.matrix.copy(modelMatrix(latest.current.settings.model));driver.mesh.matrix.setPosition(...latest.current.settings.splat!.position);driver.mesh.updateMatrixWorld(true);}
  function bounds(){return driver?driver.bounds.clone().applyMatrix4(driver.mesh.matrixWorld):new Box3(new Vector3(-1,-1,-1),new Vector3(1,1,1));}
  function distance(){const s=latest.current.settings.splat!;return Math.max(s.min_distance,Math.min(s.max_distance,Math.max(bounds().getSize(new Vector3()).length(),1)));}
  function updateTarget(point:Vector3){controls.current?.target.copy(point);controls.current?.update();camera.updateMatrixWorld();invalidate();}
  function reset(){
   const s=latest.current.settings,view=latest.current.saved.current,d=distance();
   camera.near=.01;camera.far=Math.max(1000,bounds().getSize(new Vector3()).length()*10,s.splat!.max_distance*2);camera.updateProjectionMatrix();
   if(view){camera.position.fromArray(view.position);camera.rotation.set(view.pitch,view.yaw,0,'YXZ');camera.updateMatrixWorld();updateTarget(camera.position.clone().addScaledVector(camera.getWorldDirection(new Vector3()),d));}
   else{const center=bounds().getCenter(new Vector3());camera.position.copy(center).addScaledVector(new Vector3(.55,.4,.75).normalize(),d);camera.lookAt(center);updateTarget(center);}
  }
  const actions:ViewerActions={renderer:gl,view:()=>{const rotation=new Euler().setFromQuaternion(camera.quaternion,'YXZ');return {position:camera.position.toArray() as [number,number,number],yaw:rotation.y,pitch:Math.max(-Math.PI/2+.01,Math.min(Math.PI/2-.01,rotation.x))};},reset,show:(position:HotspotPosition)=>{const point=hotspotPoint(position),direction=camera.position.clone().sub(point).normalize();if(!direction.lengthSq())direction.set(0,0,1);camera.position.copy(point).addScaledVector(direction,distance());camera.lookAt(point);updateTarget(point);}};
  gl.domElement.setAttribute('aria-label','Gaussian splat scene. Drag to orbit, scroll or pinch to zoom.');
  return()=>{active=false;clearTimeout(timeout);abort.abort();lease.release();latest.current.ready(null);if(driver){scene.remove(driver.mesh);driver.dispose();}resource.current=undefined;};
 },[endpoint,gl,scene,camera,invalidate]);
 useEffect(()=>{const driver=resource.current;if(!driver)return;driver.mesh.matrix.copy(modelMatrix(settings.model));driver.mesh.matrix.setPosition(...settings.splat!.position);driver.mesh.updateMatrixWorld(true);camera.far=Math.max(1000,driver.bounds.clone().applyMatrix4(driver.mesh.matrixWorld).getSize(new Vector3()).length()*10,settings.splat!.max_distance*2);camera.updateProjectionMatrix();invalidate();},[settings.model.scale,settings.model.rotation,settings.model.up_axis,settings.splat?.position.join(','),settings.splat?.max_distance,loaded,camera,invalidate]);
 useFrame(()=>{resource.current?.update(camera);if(currentRun&&resource.current){const {sortMs,...metrics}=resource.current.diagnostics();currentRun.resources.splat={...metrics,sortMs:summarize(sortMs),cache:splatCacheStats(),resident:splatRendererStats(),qualityPolicy:'DPR only; full capture retained'};}if(controls.current)controls.current.enabled=!paused.current;});
 return <OrbitControls ref={controls} makeDefault enableDamping={false} minDistance={settings.splat!.min_distance} maxDistance={settings.splat!.max_distance} minPolarAngle={.011} maxPolarAngle={Math.PI-.011}/>;
}
