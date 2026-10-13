import {useCallback,useEffect,useRef,useState,useMemo,type MutableRefObject} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import type {OrbitControls as OrbitControlsImpl} from 'three-stdlib';
import {Box3,Euler,Vector3,type Matrix4} from 'three';
import type {CameraView,HotspotPosition} from '../api';
import type {ViewerActions} from '../WalkControls';
import type {SceneSettings} from '../sceneSettings';
import {modelMatrix} from '../sceneSettings';
import {hotspotPoint} from '../hotspotVisibility';
import {currentRun} from '../performanceMetrics';
import {createSplatAsync,type createSplat} from './driver.js';
import {plannedSplatTiles,tileBounds,SplatTileSession} from './tiles';
import {SplatSceneControls} from './SplatSceneControls';
type Admission=(p:Vector3,radius:number,height:number)=>boolean;
type Props={endpoint:string;settings:SceneSettings;saved:MutableRefObject<CameraView|undefined>;ready:(a:ViewerActions|null)=>void;onError:(s:string)=>void;onProgress:(s:string)=>void;paused:MutableRefObject<boolean>;controlCamera?:boolean;onAdmission:(gate:Admission)=>void;onStreamingState?:(state:'ready'|'loading'|'failed',retry?:()=>void)=>void};
export function SplatStreamControls(props:Props){
 const {camera,gl,scene,invalidate}=useThree(),[fallback,setFallback]=useState(false);
 const orbit=useRef<OrbitControlsImpl>(null);
 const orbitTarget=useMemo(()=>camera.position.clone().addScaledVector(camera.getWorldDirection(new Vector3()),5),[props.controlCamera,camera]);
 const active=useRef<{session:SplatTileSession;matrix:Matrix4;driver?:ReturnType<typeof createSplat>;plan:()=>void;retry:()=>void}|null>(null);
 const latest=useRef(props);latest.current=props;
 useEffect(()=>{
  let live=true,preparing=false,preparationFailed=false,attempt:ReturnType<typeof createSplat>|undefined;
  let decoderAbort:AbortController|undefined;
  const matrix=modelMatrix(props.settings.model).setPosition(...props.settings.splat!.position);
  const changed=()=>invalidate();const session=new SplatTileSession(props.endpoint,changed);
  props.onAdmission(()=>false);props.ready(null);
  const fitCapture=()=>{if(!session.manifest)return;const bounds=new Box3();for(const tile of session.manifest.tiles)bounds.union(tileBounds(tile,matrix));const centre=bounds.getCenter(new Vector3()),settings=latest.current.settings.splat!,distance=Math.max(settings.min_distance,Math.min(settings.max_distance,Math.max(bounds.getSize(new Vector3()).length(),1)));camera.position.copy(centre).addScaledVector(new Vector3(.55,.4,.75).normalize(),distance);camera.lookAt(centre);orbit.current?.target.copy(centre);orbit.current?.update();camera.updateMatrixWorld();};
  const view=()=>{const r=new Euler().setFromQuaternion(camera.quaternion,'YXZ');return {position:camera.position.toArray() as [number,number,number],yaw:r.y,pitch:r.x};};
  const actions:ViewerActions={renderer:gl,view,reset:()=>{const saved=latest.current.saved.current;if(saved){camera.position.fromArray(saved.position);camera.rotation.set(saved.pitch,saved.yaw,0,'YXZ');camera.updateMatrixWorld();orbit.current?.target.copy(camera.position.clone().addScaledVector(camera.getWorldDirection(new Vector3()),5));orbit.current?.update();}else fitCapture();invalidate();},show:(p:HotspotPosition)=>{const point=hotspotPoint(p);camera.lookAt(point);orbit.current?.target.copy(point);orbit.current?.update();camera.updateMatrixWorld();invalidate();}};
  const state={session,matrix,driver:undefined as ReturnType<typeof createSplat>|undefined,retry:()=>{preparationFailed=false;attempt?.dispose();attempt=undefined;session.retry();session.invalidateCandidate();invalidate();},plan:()=>{}};
  state.plan=()=>{
   if(!live||!session.manifest)return;session.request(plannedSplatTiles(session.manifest,camera,state.matrix));
   latest.current.onStreamingState?.(session.failed()||preparationFailed?'failed':session.pending()||preparing?'loading':'ready',state.retry);
   if(preparing||preparationFailed)return;const candidate=session.candidate();if(!candidate)return;preparing=true;const candidateAbort=new AbortController();decoderAbort=candidateAbort;const deadline=setTimeout(()=>candidateAbort.abort(),60000);let candidateDriver:ReturnType<typeof createSplat>|undefined,committed=false;
   void createSplatAsync(candidate.bytes,gl,invalidate,()=>{
    if(!live||committed||!candidateDriver)return;committed=true;const next=candidateDriver;if(attempt===next)attempt=undefined;const old=state.driver;
    state.driver=next;scene.add(next.mesh);if(old){scene.remove(old.mesh);old.dispose();}session.commit(candidate);preparing=false;
    latest.current.onAdmission((p,r,h)=>session.admits(p,state.matrix,r,h));
    latest.current.ready(actions);latest.current.onProgress(`Gaussian splat tiles ready: ${next.count.toLocaleString()} resident splats.`);invalidate();
   },candidateAbort.signal,undefined,error=>{if(live){preparing=false;preparationFailed=true;latest.current.ready(null);latest.current.onAdmission(()=>false);latest.current.onStreamingState?.('failed',state.retry);latest.current.onProgress(error.message);}}).then(result=>{
    if(!live){result.dispose();return;}candidateDriver=result;attempt=result;result.mesh.matrixAutoUpdate=false;result.mesh.matrix.copy(state.matrix);result.mesh.updateMatrixWorld(true);result.update(camera);
   }).catch(()=>{preparing=false;preparationFailed=true;if(live){latest.current.onStreamingState?.('failed',state.retry);latest.current.onProgress('Capture tile preparation failed or timed out. Current view retained; retry capture loading.');}}).finally(()=>clearTimeout(deadline));
  };
  active.current=state;
  if(props.saved.current)actions.reset();
  camera.near=.01;camera.far=1e6;camera.updateProjectionMatrix();
  gl.domElement.setAttribute('aria-label','Gaussian splat tiles. Drag to orbit; walking requires loaded tiles and reviewed proxy floors.');
  session.initialize().then(()=>{if(live){if(!props.saved.current)fitCapture();state.plan();invalidate();}}).catch(()=>{if(live){session.dispose();active.current=null;props.onAdmission(()=>true);setFallback(true);props.onStreamingState?.('ready');}});
  return()=>{live=false;decoderAbort?.abort();session.dispose();if(state.driver){scene.remove(state.driver.mesh);state.driver.dispose();}attempt?.dispose();active.current=null;props.ready(null);props.onAdmission(()=>false);};
 },[props.endpoint,gl,scene,camera,invalidate]);
 useFrame(()=>{const state=active.current;if(!state)return;state.matrix.copy(modelMatrix(latest.current.settings.model)).setPosition(...latest.current.settings.splat!.position);if(state.driver){state.driver.mesh.matrix.copy(state.matrix);state.driver.mesh.updateMatrixWorld(true);state.driver.update(camera);}state.plan();if(currentRun)currentRun.resources.splatStreaming={sourceBytes:state.session.manifest?.source_bytes,sourceCount:state.session.manifest?.count,residentCount:state.driver?.count||0,fetchedBytes:state.session.fetchedBytes,requests:state.session.requests,committedTiles:state.session.committed.size,committedTileIds:[...state.session.committed],wantedTileIds:[...state.session.wanted],totalTiles:state.session.manifest?.tiles.length,sortBacklog:state.driver?.diagnostics().sortBacklog,sorting:'One global sort for all committed resident records',proxyBytesIncludedSeparately:true};});
 const rawReady=useCallback((a:ViewerActions|null)=>{props.onAdmission(()=>!!a);props.ready(a);},[props.ready,props.onAdmission]);
 if(fallback)return <SplatSceneControls {...props} ready={rawReady}/>;
 return props.controlCamera!==false?<OrbitControls ref={orbit} target={orbitTarget} makeDefault enableDamping={false} minDistance={props.settings.splat!.min_distance} maxDistance={props.settings.splat!.max_distance} minPolarAngle={.011} maxPolarAngle={Math.PI-.011}/>:null;
}
