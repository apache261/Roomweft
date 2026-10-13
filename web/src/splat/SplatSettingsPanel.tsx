import {NumericInput} from '../NumericInput';
import {defaultSplatSettings,type SceneSettings} from '../sceneSettings';
export function SplatSettingsPanel({settings,onChange,onSave,busy,dirty}:{settings:SceneSettings;onChange:(s:SceneSettings)=>void;onSave:()=>void;busy:boolean;dirty:boolean}){
 const splat=settings.splat!;
 const sourceChange=(next:SceneSettings)=>onChange({...next,navigation:undefined,splat:{...next.splat!,proxy:next.splat?.proxy?{...next.splat.proxy,reviewed:false}:undefined}});
 const model=(patch:Partial<SceneSettings['model']>)=>sourceChange({...settings,model:{...settings.model,...patch}});
 const update=(patch:Partial<NonNullable<SceneSettings['splat']>>)=>(patch.position?sourceChange:onChange)({...settings,splat:{...splat,...patch}});
 return <section className="scene-settings"><h3>Capture preparation</h3><p>Raw source coordinates are corrected to (x, −y, −z), then prepared in metres. Transform edits move saved hotspots and clear the saved start view. Save settings, then save a new inspection view.</p><fieldset disabled={busy}>
 <NumericInput label="Capture scale (metres per source unit)" value={settings.model.scale} min={.000001} max={1000000} onChange={scale=>model({scale})}/>
 <label>Capture up axis<select aria-label="Capture up axis" value={settings.model.up_axis} onChange={e=>model({up_axis:e.target.value as 'Y'|'Z'})}><option value="Y">Y up after format correction</option><option value="Z">Z up after format correction</option></select></label>
 <NumericInput label="Capture yaw (degrees)" value={settings.model.rotation} min={-180} max={180} onChange={rotation=>model({rotation})}/>
 {(['X','Y','Z'] as const).map((axis,i)=><NumericInput key={axis} label={`Capture position ${axis} (m)`} value={splat.position[i]} min={-1e6} max={1e6} onChange={value=>{const position=[...splat.position] as [number,number,number];position[i]=value;update({position});}}/>)}
 <h3>Inspection appearance</h3><NumericInput label="Exposure" value={settings.appearance.exposure} min={.1} max={4} onChange={exposure=>onChange({...settings,appearance:{...settings.appearance,exposure}})}/>
 <label>Background<input aria-label="Background" type="color" value={settings.appearance.background} onChange={e=>onChange({...settings,appearance:{...settings.appearance,background:e.target.value}})}/></label>
 <NumericInput label="Minimum orbit distance (m)" value={splat.min_distance} min={.01} max={splat.max_distance} onChange={min_distance=>update({min_distance})}/>
 <NumericInput label="Maximum orbit distance (m)" value={splat.max_distance} min={splat.min_distance} max={1e6} onChange={max_distance=>update({max_distance})}/>
 <p>Drag to orbit, scroll or pinch to zoom. Walking requires separately reviewed proxy alignment and approved structural floors.</p>
 <button onClick={()=>onChange(structuredClone(defaultSplatSettings))}>Reset capture settings</button><button disabled={!dirty} onClick={onSave}>{busy?'Saving settings…':'Save settings'}</button>
 </fieldset><p role="status">{dirty?'Unsaved settings':'Settings saved'}</p></section>;
}
