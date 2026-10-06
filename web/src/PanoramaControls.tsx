import { useRenderActivity } from './ViewerRuntime';
import { useEffect, useMemo, type MutableRefObject } from 'react';
import { useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { Euler, PerspectiveCamera, SRGBColorSpace, TextureLoader, SphereGeometry } from 'three';
import type { PanoramaView } from './api';
import type { ViewerActions } from './WalkControls';

export function PanoramaControls({ url, saved, ready, placing, onPlace, onHover }: {
  url: string; saved: MutableRefObject<PanoramaView | undefined>; ready: (actions: ViewerActions | null) => void;
  placing: boolean; onPlace: (event: ThreeEvent<MouseEvent>) => void; onHover: (event: ThreeEvent<PointerEvent> | null) => void;
}) {
  const setInteracting = useRenderActivity(false);
  const texture = useLoader(TextureLoader, url);
  texture.colorSpace = SRGBColorSpace;
  // Invert the geometry itself so rendering and raycast placement both see inward faces.
  const geometry = useMemo(()=>new SphereGeometry(50,64,32).scale(-1,1,1),[]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  const { camera, gl, invalidate } = useThree();
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const canvas = gl.domElement;
    const apply = (view: PanoramaView) => { camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ'); camera.updateMatrixWorld(); invalidate(); };
    const reset = () => { camera.position.set(0,0,0); apply(saved.current || { yaw: 0, pitch: 0 }); camera.fov=75; camera.updateProjectionMatrix(); invalidate(); };
    const view = (): PanoramaView => { const r=new Euler().setFromQuaternion(camera.quaternion,'YXZ'); return { yaw:r.y,pitch:r.x }; };
    reset(); ready({ view,reset,show: position => { if ('yaw' in position) apply(position); } }); canvas.tabIndex=0; canvas.setAttribute('aria-label','360 panorama. Drag to look; scroll or pinch to zoom.');
    const pointers = new Map<number,{x:number;y:number}>();
    const distance = () => { const [a,b]=Array.from(pointers.values()); return a && b ? Math.hypot(a.x-b.x,a.y-b.y) : 0; };
    const down = (e: PointerEvent) => { if (document.hidden || e.button!==0) return; canvas.focus(); canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); setInteracting(true); };
    const move = (e: PointerEvent) => {
      if (document.hidden) return;
      const previous=pointers.get(e.pointerId); if (!previous) return;
      const before=distance(); pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if (pointers.size===2) {
        const after=distance(); if (before>0 && after>0) { camera.fov=Math.max(35,Math.min(90,camera.fov*before/after)); camera.updateProjectionMatrix(); invalidate(); }
      } else if (pointers.size===1) {
        const v=view(); const yaw=v.yaw-(e.clientX-previous.x)*0.004;
        apply({yaw:Math.atan2(Math.sin(yaw),Math.cos(yaw)),pitch:Math.max(-Math.PI/2+0.02,Math.min(Math.PI/2-0.02,v.pitch-(e.clientY-previous.y)*0.004))});
      }
    };
    const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (!pointers.size) setInteracting(false); };
    const clear = () => { pointers.clear(); setInteracting(false); };
    const wheel = (e: WheelEvent) => { if (document.hidden) return; e.preventDefault(); camera.fov=Math.max(35,Math.min(90,camera.fov+e.deltaY*0.05)); camera.updateProjectionMatrix(); invalidate(); };
    canvas.addEventListener('pointerdown',down); canvas.addEventListener('pointermove',move); canvas.addEventListener('pointerup',up); canvas.addEventListener('pointercancel',up); canvas.addEventListener('lostpointercapture',up); canvas.addEventListener('wheel',wheel,{passive:false}); window.addEventListener('blur',clear); document.addEventListener('visibilitychange',clear);
    return () => { ready(null); clear(); canvas.removeEventListener('pointerdown',down); canvas.removeEventListener('pointermove',move); canvas.removeEventListener('pointerup',up); canvas.removeEventListener('pointercancel',up); canvas.removeEventListener('lostpointercapture',up); canvas.removeEventListener('wheel',wheel); window.removeEventListener('blur',clear); document.removeEventListener('visibilitychange',clear); };
  },[camera,gl,saved,ready,invalidate,setInteracting]);
  return <mesh geometry={geometry} onPointerMove={event => { if (placing) onHover(event); }} onPointerOut={() => onHover(null)} onClick={event => { if (placing && event.delta < 5) onPlace(event); }}>
    <meshBasicMaterial map={texture} toneMapped={false} />
  </mesh>;
}
