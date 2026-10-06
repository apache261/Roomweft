// Opt-in development instrumentation. No retained assets or signed URLs.
export function summarize(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (p: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
  return { samples: sorted.length, median: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null, p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1) ?? null };
}
export function textureBytes(width: number, height: number, mipmaps = true, faces = 1) {
  // RGBA8 equivalent, with exact mip dimensions. Not measured VRAM.
  let bytes = 0;
  do { bytes += width * height * 4 * faces; if (!mipmaps || width === 1 && height === 1) break; width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)); } while (true);
  return bytes;
}
export class PerformanceRun {
  readonly started = performance.now();
  sampleStarted = performance.now();
  readonly date = new Date().toISOString();
  frames: { interval: number | null; cpu: number; calls: number; triangles: number }[] = [];
  timings: { stage: string; startMs: number; endMs: number; ms: number; bytes?: number; status: string }[] = [];
  assetLoads: { id: number; kind: string; events: { stage: string; atMs: number; bytes?: number }[] }[] = [];
  firstRenderedMs: number | null = null;
  walkingUsableMs: number | null = null;
  resources: Record<string, unknown> = {};
  usableMs: number | null = null;
  hiddenFrames = 0;
  totalFrames = 0;
  renderedFrames = 0;
  idleWakeFrames = 0;
  private frameCursor = 0;
  metadata: Record<string, unknown>;
  constructor(metadata: Record<string, unknown>) { this.metadata = metadata; }
  frame(interval: number | null, cpu: number, calls: number, triangles: number) {
    this.renderedFrames++;
    if (interval === null) this.idleWakeFrames++; else this.totalFrames++;
    if (this.frames.length < 36000) this.frames.push({ interval, cpu, calls, triangles });
    else { this.frames[this.frameCursor] = { interval, cpu, calls, triangles }; this.frameCursor = (this.frameCursor + 1) % 36000; }
  }
  resetFrames() {
    this.frames = []; this.frameCursor = 0; this.totalFrames = 0; this.renderedFrames = 0; this.idleWakeFrames = 0; this.hiddenFrames = 0; this.sampleStarted = performance.now();
  }
  snapshot() {
    const downloads = typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('resource').filter(e => e.startTime >= this.started).map(entry => {
      const e = entry as PerformanceResourceTiming;
      return { startMs: e.startTime - this.started, endMs: e.responseEnd - this.started, durationMs: e.duration, kind: e.initiatorType, transferBytes: e.transferSize, encodedBytes: e.encodedBodySize, decodedBytes: e.decodedBodySize, timingAvailable: e.responseStart > 0 };
    }) : [];
    const before = (milestone: number | null) => milestone === null ? null : downloads.filter(e => e.endMs <= milestone).reduce((sum, e) => sum + e.transferBytes, 0);
    return { schema: 2, date: this.date, elapsedMs: performance.now() - this.started, sampleElapsedMs: performance.now() - this.sampleStarted, metadata: this.metadata,
      totalFrames: this.totalFrames, renderedFrames: this.renderedFrames, idleWakeFrames: this.idleWakeFrames, retainedFrameLimit: 36000, hiddenFrames: this.hiddenFrames, firstUsableViewMs: this.usableMs, firstRenderedViewMs: this.firstRenderedMs, firstSafelyUsableWalkingViewMs: this.walkingUsableMs,
      downloads, network: { bytesBeforeUsableView: before(this.usableMs), bytesBeforeWalkingView: before(this.walkingUsableMs), totalTransferBytes: downloads.reduce((sum, e) => sum + e.transferBytes, 0), unknownSizeRequests: downloads.filter(e => !e.timingAvailable || e.encodedBytes === 0).length },
      assetLoads: this.assetLoads.map(load => ({ ...load, events: [...load.events] })),
      frameMs: summarize(this.frames.flatMap(f => f.interval === null ? [] : [f.interval])), cpuSubmissionMs: summarize(this.frames.map(f => f.cpu)),
      drawCalls: summarize(this.frames.map(f => f.calls)), triangles: summarize(this.frames.map(f => f.triangles)),
      timings: [...this.timings], resources: this.resources,
      limitations: ['CPU submission time is not GPU time; shader compilation/upload stalls require a separate browser trace.', 'Network zero sizes may mean cached responses or missing Timing-Allow-Origin; totals are observed lower bounds. In-flight requests are not included in milestone totals.', 'Texture bytes and resource counts are proxies, not exact VRAM.', 'Frame-time samples exclude demand-rendering idle gaps; renderedFrames includes idle wakes.', 'Frame distributions retain at most the last 36000 visible rendered frames.', 'Decode includes GLTF parsing and embedded image decoding, not network fetch.'] };
  }
}
let enabled = false;
export let currentRun: PerformanceRun | undefined;
export function enablePerformanceDiagnostics(value: boolean) { enabled = value; if (value) performance.setResourceTimingBufferSize?.(10000); }
export function beginPerformanceRun(metadata: Record<string, unknown>) {
  if (!enabled) return undefined;
  currentRun = new PerformanceRun(metadata);
  // Stable development access also survives Vite's module timestamp URLs.
  if (typeof window !== 'undefined') Object.defineProperty(window, '__tourPerformance', { configurable: true, get: () => currentRun?.snapshot() });
  return currentRun;
}
export function performanceStage(stage: string, bytes?: number) {
  const run = currentRun;
  if (!run) return (_status = 'ok') => {};
  const started = performance.now();
  let finished = false;
  return (status = 'ok') => {
    if (finished) return;
    finished = true;
    const ended = performance.now();
    run.timings.push({ stage, startMs: started - run.started, endMs: ended - run.started, ms: ended - started, bytes, status });
    if (run.timings.length > 500) run.timings.shift();
  };
}
export function sceneFingerprint(value: unknown) {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

// Anonymous per-attempt IDs deliberately omit private endpoints and signed URLs.
export function assetLoadMeasurement(kind: 'original' | 'variant' | 'collision' | 'room-asset' | 'chunk' | 'navigation-index' | 'occlusion-index') {
  const run = currentRun;
  if (!run) return (_stage: string, _bytes?: number) => {};
  const load = { id: (run.assetLoads.at(-1)?.id ?? 0) + 1, kind, events: [] as { stage: string; atMs: number; bytes?: number }[] };
  run.assetLoads.push(load);
  if (run.assetLoads.length > 500) run.assetLoads.shift();
  return (stage: string, bytes?: number) => { if (load.events.length < 32) load.events.push({ stage, atMs: performance.now() - run.started, bytes }); };
}
