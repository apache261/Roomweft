import { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { Hotspot, HotspotPosition } from './api';
import { hotspotPoint, HotspotVisibility, visibilityResult } from './hotspotVisibility';

function Marker({ hotspot, selected, placing, onActivate, register }: {
  hotspot: Hotspot; selected: boolean; placing: boolean; onActivate: (h: Hotspot) => void;
  register: (id: string, button: HTMLButtonElement | null) => void;
}) {
  const point = useMemo(() => hotspotPoint(hotspot.position), [hotspot.position]);
  // Remount the HTML anchor on selection so its depth stacking updates even
  // when Show hotspot leaves the camera at exactly the same angle.
  return <Html key={selected ? 'selected' : 'normal'} position={point.toArray()} center zIndexRange={selected ? [40, 30] : [20, 10]} style={{ pointerEvents: 'none' }}>
    <button ref={button => register(hotspot.id, button)} className={`navigation-marker ${selected ? 'selected-marker' : ''}`} disabled={placing} style={{ pointerEvents: placing ? 'none' : 'auto' }}
      aria-label={`${hotspot.type === 'INFO' ? 'Information: ' : 'Go to '}${hotspot.title}`}
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onActivate(hotspot); }}>
      {hotspot.type === 'INFO' ? 'ⓘ' : '↗'} {hotspot.title}
    </button>
  </Html>;
}

export function HotspotLayer({ hotspots, onActivate, placing, draft, selected, reveal, panorama, onTarget }: {
  hotspots: Hotspot[]; onActivate: (hotspot: Hotspot) => void; placing: boolean; draft: HotspotPosition | null;
  selected: string; reveal: boolean; panorama: boolean; onTarget: (hotspot: Hotspot | null) => void;
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
    if (entries.length) evaluator.begin(camera, scene.children, panorama);
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
    {draft && <Html position={hotspotPoint(draft).toArray()} center zIndexRange={[30, 25]} style={{ pointerEvents: 'none' }}>
      <span className="hotspot-ghost">＋ {placing ? 'Click to place' : 'Unsaved placement'}</span>
    </Html>}
  </>;
}
