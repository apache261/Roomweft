import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {Vector3} from 'three';
import type { Hotspot, HotspotPosition } from './api';
import { hotspotPoint, HotspotVisibility, visibilityResult } from './hotspotVisibility';

// Own a DOM anchor per marker. Nested React roots in Drei Html can race during
// Canvas/scene teardown; explicit nodes also keep camera projection in demand frames.
function Anchor({point,selected=false,label,button,placing=false,onActivate,register,text}:{point:Vector3;selected?:boolean;label:string;text?:string;button:boolean;placing?:boolean;onActivate?:()=>void;register?:(element:HTMLButtonElement|null)=>void}){
 const {gl}=useThree(),anchor=useRef<HTMLDivElement>(null),node=useRef<HTMLElement>(null);
 const latest=useRef({point,selected,label,placing,onActivate,register});latest.current={point,selected,label,placing,onActivate,register};
 useEffect(()=>{
  const outer=document.createElement('div'),element=document.createElement(button?'button':'span');
  Object.assign(outer.style,{position:'absolute',transform:'translate(-50%, -50%)',pointerEvents:'none'});outer.appendChild(element);gl.domElement.parentElement?.appendChild(outer);anchor.current=outer;node.current=element;
  const stop=(event:Event)=>event.stopPropagation(),click=(event:Event)=>{stop(event);latest.current.onActivate?.();};
  element.addEventListener('pointerdown',stop);element.addEventListener('click',click);latest.current.register?.(element as HTMLButtonElement);
  return()=>{latest.current.register?.(null);element.removeEventListener('pointerdown',stop);element.removeEventListener('click',click);outer.remove();anchor.current=null;node.current=null;};
 },[gl,button]);
 useEffect(()=>{const element=node.current;if(!element)return;element.textContent=text??label;element.className=button?`navigation-marker ${selected?'selected-marker':''}`:'hotspot-ghost';if(button){(element as HTMLButtonElement).type='button';element.setAttribute('aria-label',label);(element as HTMLButtonElement).disabled=placing;element.style.pointerEvents=placing?'none':'auto';}},[label,text,selected,placing,button]);
 const projected=useMemo(()=>new Vector3(),[]);
 useFrame(({camera,size})=>{const outer=anchor.current;if(!outer)return;projected.copy(latest.current.point).project(camera);outer.style.left=`${(projected.x*.5+.5)*size.width}px`;outer.style.top=`${(-projected.y*.5+.5)*size.height}px`;outer.style.zIndex=latest.current.selected?'40':'20';outer.style.display=Number.isFinite(projected.x+projected.y+projected.z)&&Math.abs(projected.z)<=1?'block':'none';});
 return null;
}
function Marker({hotspot,selected,placing,onActivate,register}:{hotspot:Hotspot;selected:boolean;placing:boolean;onActivate:(h:Hotspot)=>void;register:(id:string,button:HTMLButtonElement|null)=>void}){
 const point=useMemo(()=>hotspotPoint(hotspot.position),[hotspot.position]);
 const label=`${hotspot.type==='INFO'?'Information: ':'Go to '}${hotspot.title}`;
 return <Anchor point={point} selected={selected} label={label} text={`${hotspot.type==='INFO'?'ⓘ':'↗'} ${hotspot.title}`} button placing={placing} onActivate={()=>onActivate(hotspot)} register={button=>register(hotspot.id,button)}/>;
}

export function HotspotLayer({ hotspots, onActivate, placing, draft, selected, reveal, panorama, screenOnly=false, onTarget }: {
  hotspots: Hotspot[]; onActivate: (hotspot: Hotspot) => void; placing: boolean; draft: HotspotPosition | null;
  selected: string; reveal: boolean; panorama: boolean; screenOnly?:boolean; onTarget: (hotspot: Hotspot | null) => void;
}) {
  const { gl } = useThree();
  const evaluator = useMemo(() => new HotspotVisibility(), []);
  const entries = useMemo(() => hotspots.map(hotspot => ({ hotspot, result: visibilityResult(hotspotPoint(hotspot.position)) })), [hotspots]);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const register = useMemo(() => (id: string, button: HTMLButtonElement | null) => {
    if (button) buttons.current.set(id, button); else buttons.current.delete(id);
  }, []);
  const target = useRef<Hotspot | null>(null);
  const activate = useRef(onActivate); activate.current = onActivate;
  useEffect(() => {
    const click = (event: PointerEvent) => {
      if (event.button === 0 && document.pointerLockElement === gl.domElement && target.current) {
        event.preventDefault(); event.stopPropagation(); activate.current(target.current);
      }
    };
    document.addEventListener('pointerdown', click, true);
    return () => document.removeEventListener('pointerdown', click, true);
  }, [gl]);
  useFrame(({ camera, scene, size }) => {
    let nearest: Hotspot | null = null;
    let distance = 44;
    if (entries.length) evaluator.begin(camera, screenOnly?[]:scene.children, panorama);
    const targeting = !placing && document.pointerLockElement === gl.domElement;
    for (const { hotspot: h, result } of entries) {
      evaluator.evaluate(result);
      const button = buttons.current.get(h.id);
      if (button) {
        const visibility = reveal || result.visible ? 'visible' : 'hidden';
        const occluded = result.visible ? 'false' : 'true';
        if (button.style.visibility !== visibility) button.style.visibility = visibility;
        if (button.dataset.occluded !== occluded) button.dataset.occluded = occluded;
      }
      if (targeting && result.visible) {
        const pixels = Math.hypot(result.screen.x * size.width / 2, result.screen.y * size.height / 2);
        if (pixels < 44 && (h.id === selected || nearest?.id !== selected && pixels < distance)) { nearest = h; distance = pixels; }
      }
    }
    if (target.current !== nearest) { target.current = nearest; onTarget(nearest); }
  });
  return <>
    {hotspots.map(h => <Marker key={h.id} hotspot={h} selected={selected === h.id} register={register} placing={placing} onActivate={onActivate} />)}
    {draft && <Anchor point={hotspotPoint(draft)} selected label={placing?'＋ Click to place':'＋ Unsaved placement'} button={false}/>}
  </>;
}
