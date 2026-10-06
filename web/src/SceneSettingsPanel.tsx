import { NumericInput } from './NumericInput';
import { useState } from 'react';
import type { ModelInfo } from './WalkControls';
import { defaultSettings, type SceneSettings } from './sceneSettings';

export function SceneSettingsPanel({ settings, onChange, onSave, busy, dirty, info, layout = false }: {
  layout?: boolean; settings: SceneSettings; onChange: (s: SceneSettings) => void; onSave: () => void; busy: boolean; dirty: boolean; info: ModelInfo | null;
}) {
  const [resetVersion,setResetVersion]=useState(0);
  const a = settings.appearance, m = settings.model;
  const appearance = (patch: Partial<SceneSettings['appearance']>) => onChange({ ...settings, appearance: { ...a, ...patch } });
  const model = (patch: Partial<SceneSettings['model']>) => onChange({ ...settings, model: { ...m, ...patch },navigation:undefined });
  const number = (label: string, value: number, min: number, max: number, _step: number | string, update: (n: number) => void) =>
    <NumericInput key={`${resetVersion}:${label}`} label={label} value={value} min={min} max={max} onChange={update} />;
  return <details className="scene-settings appearance-settings" open><summary>{layout?'Layout lighting':'Appearance and model preparation'}</summary>
    <p>Preview changes here, then Save settings to use them throughout the tour.</p>

    <fieldset disabled={busy}>
      <label><input type="checkbox" checked={!!a.hq_shadows} onChange={e=>appearance({hq_shadows:e.target.checked})}/> Moving-object shadows in HQ</label><p>One bounded shadow light. Lower quality settings keep the normal lighting.</p>
      {number('Exposure', a.exposure, 0.1, 4, 0.1, n => appearance({ exposure: n }))}
      {number('Environment lighting', a.environment_intensity, 0, 3, 0.1, n => appearance({ environment_intensity: n }))}
      {number('Light intensity', a.light_intensity, 0, 5, 0.1, n => appearance({ light_intensity: n }))}
      <label>Background<input aria-label="Background" type="color" value={a.background} onChange={e => appearance({ background: e.target.value })} /></label>
      {!layout && <>
      <label><input type="checkbox" checked={!!a.tint} onChange={e => appearance({ tint: e.target.checked ? '#ffffff' : '' })} /> Override material color</label>
      {a.tint && <label>Material color<input aria-label="Material color" type="color" value={a.tint} onChange={e => appearance({ tint: e.target.value })} /></label>}
      <label><input type="checkbox" checked={a.roughness !== null} onChange={e => appearance({ roughness: e.target.checked ? 0.6 : null })} /> Override material roughness</label>
      {a.roughness !== null && number('Material roughness', a.roughness, 0, 1, 0.05, n => appearance({ roughness: n }))}
      <p>Uploaded materials and textures are preserved by default. Color overrides change the material factor; textures remain applied.</p>
      {number('Model scale (metres per source unit)', m.scale, 0.000001, 1000000, 'any', n => model({ scale: n }))}
      <p>Assume metre units initially. For centimetres use 0.01; for millimetres use 0.001.</p>
      <label>Source up axis<select aria-label="Source up axis" value={m.up_axis} onChange={e => model({ up_axis: e.target.value as 'Y' | 'Z' })}><option value="Y">Y up (glTF default)</option><option value="Z">Z up (apply correction)</option></select></label>
      {number('Model rotation (degrees)', m.rotation, -180, 180, 1, n => model({ rotation: n }))}
      <p>Changing scale, up axis or rotation moves existing hotspots with the model and clears the saved start view. Walk inside and save a new start view afterward.</p>
      </>}
      <button onClick={() => {setResetVersion(n=>n+1);onChange({...structuredClone(defaultSettings),navigation:settings.navigation});}}>Reset settings</button>
      <button disabled={!dirty} onClick={onSave}>{busy ? 'Saving settings…' : 'Save settings'}</button>
    </fieldset>
    <p role="status">{dirty ? 'Unsaved settings' : 'Settings saved'}</p>
  </details>;
}
