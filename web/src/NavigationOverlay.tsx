import {useEffect,useRef} from 'react';
import {Html,Line} from '@react-three/drei';
import {useFrame,useThree} from '@react-three/fiber';
import {Vector3} from 'three';
import {hotspotVisible} from './hotspotVisibility';
import type {Portal,WalkRegion} from './navigationSettings';
export function NavigationOverlay({regions,portals,builder,nearby,onActivate,onTarget}:{regions:WalkRegion[];portals:Portal[];builder:boolean;nearby:string[];onActivate:(p:Portal)=>void;onTarget:(p:Portal|null)=>void}) {
 const {gl}=useThree(),target=useRef<Portal|null>(null),activate=useRef(onActivate);activate.current=onActivate;
 useEffect(()=>{const click=(e:PointerEvent)=>{if(e.button===0&&document.pointerLockElement===gl.domElement&&target.current){e.preventDefault();e.stopImmediatePropagation();activate.current(target.current);}};document.addEventListener('pointerdown',click,true);return()=>document.removeEventListener('pointerdown',click,true);},[gl]);
 useFrame(({camera,scene,size})=>{let selected:Portal|null=null,distance=44;if(document.pointerLockElement===gl.domElement)for(const p of portals){if(!nearby.includes(p.id))continue;const point=new Vector3(...p.position),screen=point.clone().project(camera),pixels=Math.hypot(screen.x*size.width/2,screen.y*size.height/2);if(pixels<distance&&hotspotVisible(point,camera,scene.children,false)){selected=p;distance=pixels;}}if(selected?.id!==target.current?.id){target.current=selected;onTarget(selected);}});
 return <>{builder&&regions.map(r=><Line key={r.id} raycast={()=>null} points={[[r.left,r.max_y+0.04,r.top],[r.right,r.max_y+0.04,r.top],[r.right,r.max_y+0.04,r.bottom],[r.left,r.max_y+0.04,r.bottom],[r.left,r.max_y+0.04,r.top]]} color={r.exterior?'#eb7d21':'#269b6f'} lineWidth={2}/>)}{portals.map(p=><Html key={p.id} position={p.position} center occlude><button style={{minWidth:44,minHeight:44}} disabled={!nearby.includes(p.id)} onClick={e=>{e.stopPropagation();onActivate(p);}}>Exit: {p.label}</button></Html>)}</>;
}
