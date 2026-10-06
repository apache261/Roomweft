import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { addAfterEffect, useFrame, useThree, type RootState } from '@react-three/fiber';
import { AutoQualityController, ViewerFrameClock, qualityCapabilities, type QualityPreference, type QualityTier } from './viewerQuality';
import { currentRun } from './performanceMetrics';

type Runtime = { clock: ViewerFrameClock; active: Set<symbol>; invalidate: () => void };
const Context = createContext<Runtime | null>(null);
export function ViewerRuntime({ preference, onAutoTier, onAssetTier, children }: { preference: QualityPreference; onAutoTier: (tier: QualityTier) => void; onAssetTier?: (tier: QualityTier) => void; children: ReactNode }) {
  const { gl, invalidate, setFrameloop, get } = useThree();
  const runtime = useMemo<Runtime>(() => ({ clock: new ViewerFrameClock(), active: new Set(), invalidate }), [invalidate]);
  const controller = useMemo(() => {
    const capabilities = qualityCapabilities(gl.capabilities.maxTextureSize, navigator.hardwareConcurrency, (navigator as Navigator & { deviceMemory?: number }).deviceMemory);
    return new AutoQualityController(capabilities.maximum, capabilities.targetMs, performance.now());
  }, [gl, preference]);
  const cpuStart = useRef(0), rendered = useRef(false);
  useLayoutEffect(() => { invalidate(); }); // Edits, overlays and async readiness.
  useEffect(() => {
    if (preference === 'auto') {onAutoTier(controller.tier);onAssetTier?.(controller.assetTier);}
    const visibility = () => {
      runtime.clock.reset();
      const previousTier = controller.tier; controller.interrupt(performance.now());
      if (preference === 'auto' && controller.tier !== previousTier) onAutoTier(controller.tier);
      setFrameloop(document.hidden ? 'never' : 'demand');
      if (currentRun) currentRun.metadata = { ...currentRun.metadata, frameloop: document.hidden ? 'never' : 'demand', pageVisible: !document.hidden };
      if (!document.hidden) invalidate();
    };
    visibility(); document.addEventListener('visibilitychange', visibility);
    const remove = addAfterEffect(() => {
      if (!rendered.current) return;
      rendered.current = false;
      const cpuMs = performance.now() - cpuStart.current;
      const continuing = !document.hidden && get().internal.frames > 0;
      runtime.clock.end(continuing);
      if (preference === 'auto' && !document.hidden && runtime.clock.intervalMs !== null) {
        const previousTier = controller.tier,previousAssetTier=controller.assetTier;
        const tier = controller.sample(runtime.clock.intervalMs, cpuMs, performance.now(), devicePixelRatio || 1);
        if (tier !== previousTier) onAutoTier(tier);
        if(controller.assetTier!==previousAssetTier)onAssetTier?.(controller.assetTier);
      }
      if (!continuing && preference === 'auto') { const previousTier = controller.tier; controller.interrupt(performance.now()); if (controller.tier !== previousTier) onAutoTier(controller.tier); }
      if (currentRun) currentRun.metadata = { ...currentRun.metadata, activeRenderTasks: runtime.active.size, quality: preference, qualityTier: preference === 'auto' ? controller.tier : preference, cameraPosition: get().camera.position.toArray(), cameraQuaternion: get().camera.quaternion.toArray(), autoTier: controller.tier, autoReason: controller.reason, frameloop: get().frameloop };
    });
    return () => { remove(); document.removeEventListener('visibilitychange', visibility); runtime.clock.reset(); };
  }, [runtime, controller, preference, onAutoTier, onAssetTier, setFrameloop, invalidate, get]);
  useFrame((_, delta) => {
    cpuStart.current = performance.now(); rendered.current = true;
    runtime.clock.begin(cpuStart.current, delta);
    if (!document.hidden && runtime.active.size) invalidate();
  }, -20000);
  return <Context.Provider value={runtime}>{children}</Context.Provider>;
}
export function useRenderActivity(initialActive: boolean) {
  const runtime = useContext(Context);
  const token = useMemo(() => Symbol('render activity'), []);
  const setActive = useCallback((active: boolean) => {
    if (!runtime) return;
    const changed = runtime.active.has(token) !== active;
    if (active) runtime.active.add(token); else runtime.active.delete(token);
    if (changed) runtime.invalidate();
  }, [runtime, token]);
  useEffect(() => { setActive(initialActive); return () => { runtime?.active.delete(token); runtime?.invalidate(); }; }, [runtime, token, initialActive, setActive]);
  return setActive;
}
export function useViewerFrame(callback: (state: RootState, seconds: number) => void) {
  const runtime = useContext(Context);
  useFrame((state, delta) => { if (!document.hidden) callback(state, runtime?.clock.seconds ?? Math.min(delta, .1)); });
}
export function useAnimationFrames(update: (seconds: number) => void, active: boolean) {
  const runtime = useContext(Context);
  useRenderActivity(active);
  useFrame((_, delta) => { const seconds = runtime?.clock.animationSeconds ?? delta; if (!document.hidden && active && seconds > 0) update(seconds); });
}
export function useFrameClock() { return useContext(Context)?.clock; }
