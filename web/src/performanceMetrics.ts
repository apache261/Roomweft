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
  timings: { stage: string; ms: number; bytes?: number; status: string }[] = [];
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
    return { schema: 1, date: this.date, elapsedMs: performance.now() - this.started, sampleElapsedMs: performance.now() - this.sampleStarted, metadata: this.metadata,
      totalFrames: this.totalFrames, renderedFrames: this.renderedFrames, idleWakeFrames: this.idleWakeFrames, retainedFrameLimit: 36000, hiddenFrames: this.hiddenFrames, firstUsableViewMs: this.usableMs,
      frameMs: summarize(this.frames.flatMap(f => f.interval === null ? [] : [f.interval])), cpuSubmissionMs: summarize(this.frames.map(f => f.cpu)),
      drawCalls: summarize(this.frames.map(f => f.calls)), triangles: summarize(this.frames.map(f => f.triangles)),
      timings: [...this.timings], resources: this.resources,
      limitations: ['CPU submission time is not GPU time.', 'Texture bytes and resource counts are proxies, not exact VRAM.', 'Frame-time samples exclude demand-rendering idle gaps; renderedFrames includes idle wakes.', 'Frame distributions retain at most the last 36000 visible rendered frames.', 'Decode includes GLTF parsing and embedded image decoding, not network fetch.'] };
  }
}
let enabled = false;
export let currentRun: PerformanceRun | undefined;
export function enablePerformanceDiagnostics(value: boolean) { enabled = value; }
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
    run.timings.push({ stage, ms: performance.now() - started, bytes, status });
    if (run.timings.length > 500) run.timings.shift();
  };
}
export function sceneFingerprint(value: unknown) {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
