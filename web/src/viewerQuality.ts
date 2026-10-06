export type QualityPreference = 'auto' | 'low' | 'balanced' | 'hq';
export type QualityTier = Exclude<QualityPreference, 'auto'>;
export const qualityCaps: Record<QualityTier, number> = { low: 1, balanced: 1.5, hq: 2 };
export const qualityStorageKey = 'tour-render-quality';
let sessionPreference: QualityPreference = 'auto';
const tiers: QualityTier[] = ['low', 'balanced', 'hq'];
export function readQualityPreference(): QualityPreference {
  try { const value = localStorage.getItem(qualityStorageKey); sessionPreference = value && ['auto', ...tiers].includes(value) ? value as QualityPreference : 'auto'; } catch { /* Retain this session's selection when storage is blocked. */ }
  return sessionPreference;
}
export function saveQualityPreference(value: QualityPreference) {
  sessionPreference = value;
  try { localStorage.setItem(qualityStorageKey, value); } catch { /* Storage is optional. */ }
}
export function qualityCapabilities(maxTextureSize: number, cores?: number, memoryGB?: number) {
  const constrained = (cores !== undefined && cores <= 4) || (memoryGB !== undefined && memoryGB <= 4);
  return { maximum: (maxTextureSize < 4096 ? 'low' : constrained ? 'balanced' : 'hq') as QualityTier, targetMs: constrained ? 1000 / 30 : 1000 / 60 };
}
// Frame-time evidence is only taken during consecutive rendered frames. CPU
// submission is a proxy; a bounded DPR trial checks pixel sensitivity without requiring GPU
// timer-query support. A failed trial restores the previous tier.
export class AutoQualityController {
  tier: QualityTier;
  assetTier: QualityTier;
  reason = 'Collecting sustained frame samples';
  private average = 0;
  private cpuAverage = 0;
  private slowMs = 0;
  private fastMs = 0;
  private cooldownUntil: number;
  private probe?: { original: QualityTier; baseline: number; elapsed: number; total: number; samples: number };
  private maximum: QualityTier;
  private targetMs: number;
  constructor(maximum: QualityTier = 'hq', targetMs = 1000 / 60, now = 0) {
    this.maximum = maximum; this.targetMs = targetMs; this.tier = maximum === 'low' ? 'low' : 'balanced'; this.assetTier=this.tier; this.cooldownUntil = now + 8000;
  }
  resetSampling() { this.average = 0; this.cpuAverage = 0; this.fastMs = 0; this.slowMs = 0; }
  interrupt(now: number) {
    if (this.probe) { this.tier = this.probe.original; this.probe = undefined; this.reason = 'Resolution trial interrupted; previous quality restored'; this.cooldownUntil = now + 30000; }
    this.resetSampling();
  }
  sample(intervalMs: number, cpuMs: number, now: number, nativeDpr: number): QualityTier {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 2000 || !Number.isFinite(cpuMs)) return this.tier;
    const weight = 1 - Math.exp(-intervalMs / 1000);
    this.average = this.average ? this.average + (intervalMs - this.average) * weight : intervalMs;
    this.cpuAverage = this.cpuAverage ? this.cpuAverage + (cpuMs - this.cpuAverage) * weight : cpuMs;
    if (this.probe) {
      const p = this.probe; p.elapsed += intervalMs; p.total += intervalMs; p.samples++;
      if (p.elapsed >= 4000) {
        const improved = p.total / p.samples < p.baseline * .85;
        if (!improved) this.tier = p.original; else this.assetTier=this.tier;
        this.reason = improved ? 'Lower pixel ratio improved sustained frame time' : 'Resolution trial did not help; profile CPU, geometry or other costs';
        this.probe = undefined; this.cooldownUntil = now + 30000; this.resetSampling();
      }
      return this.tier;
    }
    if (now < this.cooldownUntil) return this.tier;
    this.slowMs = this.average > this.targetMs * 1.35 ? this.slowMs + intervalMs : 0;
    this.fastMs = this.average < this.targetMs * 1.1 && this.cpuAverage < this.targetMs * .5 ? this.fastMs + intervalMs : 0;
    const index = tiers.indexOf(this.tier);
    if (this.slowMs >= 4000 && index > 0) {
      if (this.cpuAverage >= Math.max(8, this.average * .6)) {
        this.reason = 'CPU submission is high; resolution changes deferred'; this.cooldownUntil = now + 15000; this.resetSampling();
      } else if (Math.min(nativeDpr, qualityCaps[this.tier]) <= Math.min(nativeDpr, qualityCaps[tiers[index - 1]])) {
        this.reason = 'Native pixel ratio is already below the next cap'; this.cooldownUntil = now + 30000; this.resetSampling();
      } else {
        this.probe = { original: this.tier, baseline: this.average, elapsed: 0, total: 0, samples: 0 };
        this.tier = tiers[index - 1]; this.reason = 'Testing whether lower resolution improves frame time'; this.resetSampling();
      }
    } else if (this.fastMs >= 10000 && index < tiers.indexOf(this.maximum)) {
      this.tier = tiers[index + 1]; this.assetTier=this.tier; this.reason = 'Sustained frame times have quality headroom'; this.cooldownUntil = now + 20000; this.resetSampling();
    }
    return this.tier;
  }
}
export class ViewerFrameClock {
  seconds = 0;
  animationSeconds = 0;
  intervalMs: number | null = null;
  private previous = 0;
  private continuing = false;
  reset() { this.previous = 0; this.continuing = false; this.seconds = 0; this.animationSeconds = 0; this.intervalMs = null; }
  begin(now: number, deltaSeconds: number) {
    this.intervalMs = this.previous && this.continuing ? now - this.previous : null;
    this.animationSeconds = this.intervalMs === null || !Number.isFinite(deltaSeconds) ? 0 : Math.max(0, deltaSeconds);
    this.seconds = this.intervalMs === null || this.intervalMs > 250 || !Number.isFinite(deltaSeconds) ? 0 : Math.max(0, Math.min(deltaSeconds, .1));
    this.previous = now;
  }
  end(continuing: boolean) { this.continuing = continuing; }
}
