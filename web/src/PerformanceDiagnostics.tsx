import { useFrameClock } from './ViewerRuntime';
import { useEffect, useRef, useState } from 'react';
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber';
import { Mesh, Texture } from 'three';
import { currentRun, textureBytes } from './performanceMetrics';

// Runs after R3F's render, so transmission, shadows and extra passes accumulate.
export function PerformanceSampler({ usable }: { usable: boolean }) {
  const clock = useFrameClock();
  const { gl, scene, size } = useThree();
  const usableRef = useRef(usable); usableRef.current = usable;
  const startFrame = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    const autoReset = gl.info.autoReset;
    gl.info.autoReset = false; gl.info.reset();
    let previous = 0, cpuStart = 0, rendered = false, lastInventory = 0;
    const remove = addAfterEffect(() => {
      if (!rendered) return;
      rendered = false;
      const now = performance.now(), run = currentRun;
      if (run) {
        if (document.hidden) { run.hiddenFrames++; previous = 0; }
        else {
          if (usableRef.current && run.usableMs === null) run.usableMs = now - run.started;
          run.frame(clock ? clock.intervalMs : previous ? now - previous : null, now - cpuStart, gl.info.render.calls, gl.info.render.triangles);
          previous = now;
          if (now - lastInventory > 1000 || clock?.intervalMs === null || usableRef.current && !run.resources.geometries) {
            lastInventory = now;
            const textures = new Map<string, Texture>();
            scene.traverse(object => {
              if (!(object instanceof Mesh)) return;
              for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
                for (const value of Object.values(material)) if (value instanceof Texture) textures.set(value.uuid, value);
                for (const uniform of Object.values((material as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms || {})) if (uniform.value instanceof Texture) textures.set(uniform.value.uuid, uniform.value);
              }
            });
            for (const value of [scene.environment, scene.background]) if (value instanceof Texture) textures.set(value.uuid, value);
            const inventory = [...textures.values()].map(texture => {
              const images = Array.isArray(texture.image) ? texture.image : [texture.image];
              const image = images[0]?.image || images[0];
              const width = Number(image?.width) || 0, height = Number(image?.height) || 0;
              return { name: texture.name, width, height, faces: images.length, rgba8EquivalentBytes: width && height ? textureBytes(width, height, texture.generateMipmaps || texture.mipmaps.length > 1, images.length) : null };
            });
            const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
            run.resources = { geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0,
              textureInventory: inventory, textureRgba8EquivalentBytes: inventory.reduce((sum, t) => sum + (t.rgba8EquivalentBytes || 0), 0),
              inventoryScope: 'Textures referenced by scene materials/background/environment; renderer-internal targets and cached loader assets excluded.',
              jsHeapBytes: memory?.usedJSHeapSize ?? null };
            run.metadata = { ...run.metadata, canvas: size, pixelRatio: gl.getPixelRatio(), renderer: gl.getContext().getParameter(gl.getContext().RENDERER) };
          }
        }
      }
      gl.info.reset();
    });
    const start = () => { cpuStart = performance.now(); rendered = true; };
    startFrame.current = start;
    const visibility = () => { previous = 0; };
    document.addEventListener('visibilitychange', visibility);
    return () => { remove(); startFrame.current = undefined; document.removeEventListener('visibilitychange', visibility); gl.info.autoReset = autoReset; gl.info.reset(); };
  }, [gl, scene, size, clock]);
  useFrame(() => startFrame.current?.(), -10000);

  return null;
}
export function PerformancePanel() {
  const [snapshot, setSnapshot] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSnapshot(JSON.stringify(currentRun?.snapshot(), null, 2));
    const timer = setInterval(() => setSnapshot(JSON.stringify(currentRun?.snapshot(), null, 2)), 2000);
    return () => clearInterval(timer);
  }, [open]);
  function download() {
    const run = currentRun;
    if (!run) return;
    const entries = performance.getEntriesByType('resource').filter(e => e.startTime >= run.started).map(entry => {
      const e = entry as PerformanceResourceTiming;
      return { kind: e.initiatorType, durationMs: e.duration, transferBytes: e.transferSize, encodedBytes: e.encodedBodySize, decodedBytes: e.decodedBodySize, timingAvailable: e.responseStart > 0 };
    });
    const data = { ...run.snapshot(), downloads: entries, downloadNote: 'Zero sizes can mean cache hits or missing Timing-Allow-Origin. Decoded body size is HTTP payload, not decoded geometry/texture memory. Includes API and ancillary requests; URLs omitted.' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `performance-${run.metadata.sceneId}-${Date.now()}.json`; link.click(); URL.revokeObjectURL(url);
  }
  return <details onToggle={event => setOpen(event.currentTarget.open)} style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 100, background: '#fff', color: '#111', padding: 8, maxWidth: 'min(600px, 90vw)', maxHeight: '60vh', overflow: 'auto' }}><summary>Performance diagnostics (development)</summary><button onClick={() => { currentRun?.resetFrames(); setSnapshot(JSON.stringify(currentRun?.snapshot(), null, 2)); }}>Start new frame sample</button><button onClick={download}>Export performance run</button><pre style={{ fontSize: 11 }}>{snapshot}</pre></details>;
}
