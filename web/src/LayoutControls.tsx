import { applyBakedLighting } from './hqRendering';
import { supportsChunkStreaming } from './chunkRollout';
import { StreamingSceneControls } from './StreamingSceneControls';
import { resolveAssetSource } from './runtimeAssetCache';
import { StreamingLayoutControls } from './StreamingLayoutControls';
import { useAnimationFrames } from './ViewerRuntime';
import { useEffect, useMemo, useRef } from 'react';
import { TextureLoader } from 'three';
import { useLoader } from '@react-three/fiber';
import { useAssetModels, useAssetTextures } from './useAssetModels';
import { ModelWalkControls, type WalkProps } from './WalkControls';
import { buildLayout } from './layoutGeometry';
import type { LayoutDocument } from './layout';
export function LayoutControls(props:WalkProps & {document:LayoutDocument;urls:Record<string,string>;textureURLs:Record<string,string>}) {
 if(props.streaming&&Object.values(props.urls).some(key=>supportsChunkStreaming(resolveAssetSource(key)?.response)))return <StreamingSceneControls {...props}/>;
 if(props.streaming)return <StreamingLayoutControls {...props}/>;
 return <CompleteLayoutControls {...props}/>;
}
function CompleteLayoutControls({document,urls,textureURLs,...props}:WalkProps & {document:LayoutDocument;urls:Record<string,string>;textureURLs:Record<string,string>}) {
 const animationTime=useRef(0);
 const ids=useMemo(()=>Object.keys(urls).sort(),[urls]);
 const models=useAssetModels(ids.map(id=>urls[id]));
 const textureKeys=useMemo(()=>Object.keys(textureURLs).sort(),[textureURLs]);
 const textures=useAssetTextures(textureKeys.map(id=>textureURLs[id]));
 const prepared=useMemo(()=>{const images=new Map(textureKeys.map((id,i)=>[id,textures[i]])),model=buildLayout(document,new Map(ids.map((id,i)=>[id,models[i].scene])),images,new Map(ids.map((id,i)=>[id,models[i].animations]))),baked=applyBakedLighting(model.root,document.materials||[],images,props.bakeRevision||'');return {...model,dispose:()=>{baked.dispose();model.dispose();}};},[document,ids,models,textureKeys,textures,props.bakeRevision]);
 useEffect(()=>{if(prepared.hasAnimations)prepared.updateAnimations(animationTime.current);},[prepared]);
 useAnimationFrames(seconds=>{animationTime.current+=seconds;prepared.updateAnimations(seconds);}, prepared.hasAnimations);
 useEffect(()=>()=>prepared.dispose(),[prepared]);
 return <ModelWalkControls {...props} root={prepared.root} surfaces={prepared.surfaces} textures={models.reduce((sum,m)=>sum+(m.parser.json.textures?.length||0),0)} />;
}
