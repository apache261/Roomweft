import {useEffect} from 'react';
import {useThree} from '@react-three/fiber';
import type {SceneSettings} from '../sceneSettings';
export function SplatAppearance({appearance}:{appearance:SceneSettings['appearance']}){
 const {gl,invalidate}=useThree();
 useEffect(()=>{const previous=gl.toneMappingExposure;gl.toneMappingExposure=appearance.exposure;invalidate();return()=>{gl.toneMappingExposure=previous;};},[appearance.exposure,gl,invalidate]);
 return <color attach="background" args={[appearance.background]}/>;
}
