import {readTexture,retainTextures} from './runtimeTextureCache';
import { use, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { readModel, retainModels } from './runtimeAssetCache';
export function useAssetModels(keys: string[]) {
 const renderer = useThree(state => state.gl), fingerprint = JSON.stringify(keys);
 const entries = keys.map(key => readModel(key, renderer));
 const models = entries.map(entry => use(entry.promise));
 useEffect(() => retainModels(entries, renderer), [fingerprint, renderer]);
 return useMemo(() => models, [fingerprint, renderer]);
}

export function useAssetTextures(keys:string[]){
 const renderer=useThree(state=>state.gl),fingerprint=JSON.stringify(keys);
 const entries=keys.map(key=>readTexture(key,renderer)),textures=entries.map(entry=>use(entry.promise));
 useEffect(()=>retainTextures(entries),[fingerprint,renderer]);
 return useMemo(()=>textures,[fingerprint,renderer]);
}
