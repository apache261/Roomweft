import {SplatStreamControls} from './SplatStreamControls';
import {Vector3} from 'three';
import {useRef} from 'react';
import {useEffect,useState,useCallback,useMemo} from 'react';
import {useThree} from '@react-three/fiber';
import {WalkWorld} from '../navigation';
import {request} from '../api';
import type {SceneSettings} from '../sceneSettings';
import {loadModel,disposeModel,registerAsset,type AssetResponse} from '../runtimeAssetCache';
import {ModelWalkControls,type WalkProps,type ViewerActions,type ModelInfo} from '../WalkControls';
import {prepareSplatProxy,proxyReady} from './proxy';
import {SplatSceneControls} from './SplatSceneControls';

export function SplatExperience({endpoint,source,settings,overlay,walkingAllowed,streamingAllowed,onError,...props}:WalkProps & {endpoint:string;source:string;settings:SceneSettings;overlay:boolean;walkingAllowed:boolean;streamingAllowed:boolean;onError:(error:string)=>void}) {
 const {gl,invalidate}=useThree();
 const [inspection,setInspection]=useState<ViewerActions|null>(null),[walkingActions,setWalkingActions]=useState<ViewerActions|null>(null);
 const [model,setModel]=useState<Awaited<ReturnType<typeof loadModel>>|null>(null),[proxyError,setProxyError]=useState('');
 const admission=useRef<(p:Vector3,r:number,h:number)=>boolean>(()=>!streamingAllowed);
 const onAdmission=useCallback((gate:(p:Vector3,r:number,h:number)=>boolean)=>{admission.current=gate;},[]);
 const sourceView=useRef(props.saved.current);sourceView.current=props.arrival?.pose||props.saved.current;
 const proxy=settings.splat?.proxy;
 useEffect(()=>{
  let active=true,owned:Awaited<ReturnType<typeof loadModel>>|undefined;
  setModel(null);setProxyError('');
  if(proxy)request<AssetResponse>(`${source}/assets/${proxy.asset_id}`).then(response=>loadModel(registerAsset(proxy.asset_id,`${source}/assets/${proxy.asset_id}`,{...response,runtime:undefined,streaming:undefined},'low'),gl)).then(result=>{owned=result;if(active)setModel(result);else disposeModel(result);}).catch(()=>{if(active)setProxyError('Proxy unavailable. Inspection remains available; walking is disabled.');});
  return()=>{active=false;if(owned)disposeModel(owned);};
 },[proxy?.asset_id,source,gl]);
 const preparedResult=useMemo(()=>{try{if(!model||!proxy)return {model:null,error:''};const result=prepareSplatProxy(model.scene,settings,overlay&&!props.walking);result.root.userData.admitsMovement=(p:Vector3,r:number,h:number)=>admission.current(p,r,h);return {model:result,error:''};}catch{return {model:null,error:'Proxy preparation failed. Inspection remains available.'};}},[model,proxy,settings.navigation,overlay,props.walking]);
 const prepared=preparedResult.model;
 useEffect(()=>()=>prepared?.dispose(),[prepared]);
 const verified=useMemo(()=>{if(!prepared)return false;try{const world=new WalkWorld(prepared.root);try{return !!world.start()||!!(props.arrival&&world.validStart(new Vector3(...props.arrival.pose.position),props.arrival.regionId));}finally{world.dispose();}}catch{return false;}},[prepared,inspection,props.arrival]);
 const walking=props.walking&&walkingAllowed&&proxyReady(settings)&&verified&&!!prepared&&!!inspection;
 const ready=props.ready;
 const receiveInspection=useCallback((a:ViewerActions|null)=>setInspection(a),[]);
 const receiveWalking=useCallback((a:ViewerActions|null)=>setWalkingActions(a),[]);
 useEffect(()=>{ready(inspection?(walking?walkingActions:props.walking?null:inspection):null);return()=>ready(null);},[ready,inspection,walking,walkingActions,props.walking]);
 const info=props.onInfo;
 useEffect(()=>{if(!walking)info({dimensions:prepared?.dimensions||[0,0,0],walkable:walkingAllowed&&proxyReady(settings)&&verified&&!!prepared&&!!inspection,textures:0,surfaces:prepared?.surfaces||[],navigationError:!walkingAllowed?'':proxyError||preparedResult.error||(!proxy?.reviewed?'Attach a proxy, review alignment and approve floor regions to enable walking.':'')});invalidate();},[walking,walkingAllowed,prepared,inspection,settings,proxyError,preparedResult.error,info,invalidate,verified]);
 const reportInfo=useCallback((value:ModelInfo)=>info({...value,walkable:value.walkable&&!!inspection&&walkingAllowed}),[info,inspection,walkingAllowed]);
 return <>
 {streamingAllowed?<SplatStreamControls onAdmission={onAdmission} onStreamingState={props.onStreamingState} endpoint={endpoint} settings={settings} saved={sourceView} ready={receiveInspection} onError={onError} onProgress={props.report} paused={props.paused} controlCamera={!walking}/>:<SplatSceneControls endpoint={endpoint} settings={settings} saved={sourceView} ready={receiveInspection} onError={onError} onProgress={props.report} paused={props.paused} controlCamera={!walking}/>}
 {walking&&prepared?<ModelWalkControls {...props} walking root={prepared.root} textures={0} surfaces={prepared.surfaces} ready={receiveWalking} onInfo={reportInfo}/>:
 prepared?<primitive object={prepared.root}/>:null}
 </>;
}
