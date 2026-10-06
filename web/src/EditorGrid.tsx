import {useEffect,useMemo} from 'react';
import {GridHelper} from 'three';
import type {ModelInfo} from './WalkControls';

export function EditorGrid({dark,info}:{dark:boolean;info:ModelInfo|null}){
 const boxes=info?.surfaces.flatMap(s=>s.bounds?[s.bounds]:[])||[];
 const left=boxes.length?Math.min(...boxes.map(b=>b.min[0])):0,right=boxes.length?Math.max(...boxes.map(b=>b.max[0])):0;
 const top=boxes.length?Math.min(...boxes.map(b=>b.min[2])):0,bottom=boxes.length?Math.max(...boxes.map(b=>b.max[2])):0;
 const y=boxes.length?Math.min(...boxes.map(b=>b.min[1]))-.02:-.22;
 const size=Math.max(20,Math.min(2000,Math.ceil(Math.max(right-left,bottom-top)*2/10)*10));
 const grids=useMemo(()=>{
  const minor=new GridHelper(size,size,dark?'#526c82':'#a0b1bf',dark?'#2e4254':'#d1dbe3');
  const major=new GridHelper(size,size/5,dark?'#89a4bb':'#71899d',dark?'#496176':'#acbdcb');
  for(const grid of [minor,major]){grid.raycast=()=>{};grid.material.transparent=true;grid.material.opacity=.7;grid.material.depthWrite=false;grid.material.toneMapped=false;}
  return [minor,major];
 },[size,dark]);
 useEffect(()=>()=>{grids.forEach(g=>{g.geometry.dispose();g.material.dispose();});},[grids]);
 return <group name="Editor reference grid" position={[Math.round((left+right)/10)*5,y,Math.round((top+bottom)/10)*5]}><primitive object={grids[0]}/><primitive object={grids[1]} position={[0,.002,0]}/></group>;
}
