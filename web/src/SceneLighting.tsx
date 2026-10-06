import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { ACESFilmicToneMapping, DirectionalLight, Mesh, Object3D, PCFShadowMap, PMREMGenerator, SRGBColorSpace, Vector3 } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SceneSettings } from './sceneSettings';
import type { QualityTier } from './viewerQuality';
import { hqBudget, hqPolicy, selectShadowCasters } from './hqRendering';
import { useViewerFrame } from './ViewerRuntime';
import { currentRun } from './performanceMetrics';

export function SceneLighting({appearance,background,tier='balanced',enabled=true}:{appearance:SceneSettings['appearance'];background?:string;tier?:QualityTier;enabled?:boolean}) {
 const {gl,scene,camera,invalidate}=useThree(),key=useRef<DirectionalLight>(null);
 const policy=hqPolicy(tier,enabled&&!!appearance.hq_shadows,gl.capabilities.maxTextureSize,navigator.hardwareConcurrency,(navigator as Navigator&{deviceMemory?:number}).deviceMemory);
 const target=useMemo(()=>new Object3D(),[]),eye=useMemo(()=>new Vector3(),[]);
 const originals=useRef(new Map<Mesh,{cast:boolean;receive:boolean}>());
 const environment=useMemo(()=>{const room=new RoomEnvironment(),generator=new PMREMGenerator(gl),result=generator.fromScene(room,.04,.1,100,{size:256});room.dispose();generator.dispose();return result;},[gl]);
 useEffect(()=>{scene.environment=environment.texture;scene.add(target);invalidate();return()=>{scene.remove(target);scene.environment=null;environment.dispose();};},[scene,camera,environment,target,invalidate]);
 useEffect(()=>{gl.outputColorSpace=SRGBColorSpace;gl.toneMapping=ACESFilmicToneMapping;gl.toneMappingExposure=appearance.exposure;scene.environmentIntensity=appearance.environment_intensity;invalidate();},[gl,scene,appearance,invalidate]);
 useEffect(()=>{
  const previous={enabled:gl.shadowMap.enabled,type:gl.shadowMap.type};gl.shadowMap.enabled=policy.shadows;gl.shadowMap.type=PCFShadowMap;gl.shadowMap.needsUpdate=true;invalidate();
  return()=>{gl.shadowMap.enabled=previous.enabled;gl.shadowMap.type=previous.type;originals.current.forEach((flags,mesh)=>{mesh.castShadow=flags.cast;mesh.receiveShadow=flags.receive;});originals.current.clear();const shadow=key.current?.shadow;shadow?.map?.dispose();if(shadow)shadow.map=null;};
 },[gl,policy.shadows,invalidate]);
 useViewerFrame(()=>{
  const light=key.current;if(!light)return;if(!policy.shadows&&!currentRun){light.castShadow=false;return;}
  const meshes:Mesh[]=[],roots:Object3D[]=[];
  scene.traverse(o=>{if(o.userData.viewerModelRoot)roots.push(o);});
  const baked={lightMappedMeshes:0,aoMappedMeshes:0,staleMeshes:0,missingUV:0,dynamicMeshes:0};
  let pending=false;for(const root of roots){const authored=root.userData.runtimeAuthoredRoot||root;pending||=!!authored.userData.blockedRooms?.length||!!authored.userData.streamingContributorsPending;for(const name of Object.keys(baked) as (keyof typeof baked)[])baked[name]+=authored.userData.bakedLighting?.[name]||0;root.traverse(o=>{if(o instanceof Mesh)meshes.push(o);});}
  const resident=new Set(meshes);for(const [mesh,flags]of originals.current)if(!resident.has(mesh)){mesh.castShadow=flags.cast;mesh.receiveShadow=flags.receive;originals.current.delete(mesh);}
  eye.setFromMatrixPosition(camera.matrixWorld);const selected=policy.shadows&&!pending?selectShadowCasters(meshes,eye):{selected:[],triangles:0},casters=new Set(selected.selected);
  light.castShadow=policy.shadows&&!pending&&casters.size>0;
  if(!light.castShadow&&light.shadow.map){light.shadow.dispose();light.shadow.map=null;light.shadow.mapPass=null;}
  if(policy.shadows){for(const mesh of meshes){if(!originals.current.has(mesh))originals.current.set(mesh,{cast:mesh.castShadow,receive:mesh.receiveShadow});mesh.castShadow=casters.has(mesh);mesh.receiveShadow=true;}}
  // The fixed direction follows the camera; the footprint and depth are bounded.
  if(light.castShadow){target.position.set(eye.x,0,eye.z);target.updateMatrixWorld();light.position.set(eye.x+5,10,eye.z+5);light.updateMatrixWorld();}
  if(currentRun)currentRun.metadata={...currentRun.metadata,hqRendering:{...policy,bakedLighting:baked,activeShadowCasters:casters.size,casterTriangles:selected.triangles,waitingForContributors:pending,shadowTextureBytes:light.castShadow?policy.shadowSize**2*8:0,screenSpaceAO:false}};
 });
 return <>
  <color attach="background" args={[background||appearance.background]}/>
  <ambientLight intensity={.25*appearance.light_intensity}/>
  <hemisphereLight args={['#ffffff','#ffffff',.5*appearance.light_intensity]}/>
  <directionalLight ref={key} target={target} position={[5,10,5]} intensity={appearance.light_intensity} shadow-mapSize-width={policy.shadowSize} shadow-mapSize-height={policy.shadowSize} shadow-camera-left={-hqBudget.shadowRadius} shadow-camera-right={hqBudget.shadowRadius} shadow-camera-top={hqBudget.shadowRadius} shadow-camera-bottom={-hqBudget.shadowRadius} shadow-camera-near={.1} shadow-camera-far={40} shadow-bias={-.0001} shadow-normalBias={.02}/>
 </>;
}
