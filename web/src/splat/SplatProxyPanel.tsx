import type {Asset} from '../api';
import type {SceneSettings} from '../sceneSettings';
import {NumericInput} from '../NumericInput';
export function SplatProxyPanel({settings,assets,onChange,overlay,onOverlay,busy,dirty}:{settings:SceneSettings;assets:Asset[];onChange:(s:SceneSettings)=>void;overlay:boolean;onOverlay:(b:boolean)=>void;busy:boolean;dirty:boolean}) {
 const proxy=settings.splat!.proxy;
 const set=(value:typeof proxy)=>onChange({...settings,splat:{...settings.splat!,proxy:value},navigation:undefined});
 const patch=(value:Partial<NonNullable<typeof proxy>>)=>proxy&&set({...proxy,...value,reviewed:false});
 return <section className="scene-settings"><h3>Walking proxy alignment</h3><p>The capture provides visuals. A separately reviewed GLB supplies floors, walls and clearance. Match the cyan wireframe to the capture before approving alignment. Transform changes clear floor and exit approvals.</p><fieldset disabled={busy}>
 <label>Collision proxy<select aria-label="Collision proxy" value={proxy?.asset_id||''} onChange={e=>set(e.target.value?{asset_id:e.target.value,model:{scale:1,up_axis:'Y',rotation:0},position:[0,0,0],reviewed:false,occlusion:false}:undefined)}><option value="">No proxy (inspection only)</option>{assets.filter(a=>a.file_type==='GLB'&&a.upload_status==='ready').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
 {proxy&&<><label><input type="checkbox" checked={overlay} onChange={e=>onOverlay(e.target.checked)}/> Show proxy wireframe</label>
 <NumericInput label="Proxy scale" value={proxy.model.scale} min={.000001} max={1e6} onChange={scale=>patch({model:{...proxy.model,scale}})}/>
 <label>Proxy up axis<select aria-label="Proxy up axis" value={proxy.model.up_axis} onChange={e=>patch({model:{...proxy.model,up_axis:e.target.value as 'Y'|'Z'}})}><option value="Y">Y up</option><option value="Z">Z up</option></select></label>
 <NumericInput label="Proxy yaw (degrees)" value={proxy.model.rotation} min={-180} max={180} onChange={rotation=>patch({model:{...proxy.model,rotation}})}/>
 {proxy.position.map((n,i)=><NumericInput key={i} label={`Proxy position ${['X','Y','Z'][i]} (m)`} value={n} min={-1000} max={1000} onChange={value=>{const position=[...proxy.position] as [number,number,number];position[i]=value;patch({position});}}/>)}
 <label><input type="checkbox" disabled={dirty&&!proxy.reviewed} checked={proxy.reviewed} onChange={e=>onChange({...settings,splat:{...settings.splat!,proxy:{...proxy,reviewed:e.target.checked}},navigation:e.target.checked?settings.navigation:undefined})}/> I reviewed proxy alignment against the capture</label><p>Save the proxy transform before approving alignment. Then select structural floors in Walking areas and exits and save changes.</p>
 <label><input type="checkbox" disabled={!proxy.reviewed} checked={proxy.occlusion} onChange={e=>onChange({...settings,splat:{...settings.splat!,proxy:{...proxy,occlusion:e.target.checked}}})}/> Use reviewed proxy walls to hide hotspot markers</label><p>Proxy occlusion is an approximation; openings and walls must match the capture.</p></>}
 </fieldset></section>;
}
