import { NumericInput } from './NumericInput';
import { useState } from 'react';
import type { Asset } from './api';
import { newMaterial, type MaterialPreset } from './materials';
export type MaterialTarget={key:string;label:string;material:string;uv:boolean;bakeUV?:boolean};
export function MaterialEditor({presets,assets,targets,onChange,onAssign,busy,bakeRevision='' }: {bakeRevision?:string;presets:MaterialPreset[];assets:Asset[];targets:MaterialTarget[];onChange:(p:MaterialPreset[])=>void;onAssign:(key:string,id:string)=>void;busy:boolean}) {
 const [selected,setSelected]=useState(''),[target,setTarget]=useState('');
 const p=presets.find(p=>p.id===selected),t=targets.find(t=>t.key===target);
 const patch=(values:Partial<MaterialPreset>)=>p&&onChange(presets.map(m=>m.id===p.id?{...m,...values}:m));
 const number=(label:string,value:number,min:number,max:number,update:(n:number)=>void)=><NumericInput key={`${selected}:${label}`} label={label} value={value} min={min} max={max} onChange={update} />;
 const maps=(label:string,key:'base_color'|'normal'|'roughness_map'|'light_map'|'ao_map',role:Asset['file_type'])=><label>{label}<select aria-label={label} value={p?.[key]||''} onChange={e=>patch({[key]:e.target.value})}><option value="">None</option>{assets.filter(a=>a.file_type===role&&a.upload_status==='ready').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>;
 return <details className="scene-settings material-settings" open><summary>Tiled materials</summary><p>Presets can be reused across surfaces in this scene. Editing a preset updates every surface using it. Duplicate a preset for an independent finish. Save the layout or scene settings to keep changes.</p>
 <fieldset disabled={busy}>
 <button onClick={()=>{const p=newMaterial();onChange([...presets,p]);setSelected(p.id);}}>Add material preset</button>
 <label>Material preset<select aria-label="Material preset" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a preset</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 {p&&<><label>Preset name<input aria-label="Preset name" maxLength={120} value={p.name} onChange={e=>patch({name:e.target.value})} /></label>
 {maps('Base-color map','base_color','TEXTURE_BASE_COLOR')}{maps('Normal map','normal','TEXTURE_NORMAL')}{maps('Roughness map','roughness_map','TEXTURE_ROUGHNESS')}{maps('Baked AO map','ao_map','TEXTURE_AO')}{maps('Baked indirect lightmap','light_map','TEXTURE_LIGHTMAP')}
 {(p.ao_map||p.light_map)&&<><p>Assign this preset to a static mesh with a separate UV atlas (UV1), then review the maps. Lightmaps must contain indirect light only; the realtime key light stays separate. Lightmaps replace ambient/environment diffuse lighting; specular reflections stay active.</p><button disabled={!bakeRevision||!targets.some(t=>t.material===p.id&&t.bakeUV)} onClick={()=>patch({bake_revision:bakeRevision})}>Review baked maps for current scene</button><p role="status">{p.bake_revision===bakeRevision?'Baked maps reviewed for this scene':'Baked maps inactive: review after geometry, lighting or material edits.'}</p></>}
 <p>Upload each map with its role in Assets. Base-color maps use sRGB; normal and roughness maps use linear data. Roughness uses the green channel.</p>
 {number('Tile size (m)',p.tile_size,0.01,100,n=>patch({tile_size:n}))}
 {number('U repeat',p.repeat[0],0.01,100,n=>patch({repeat:[n,p.repeat[1]]}))}{number('V repeat',p.repeat[1],0.01,100,n=>patch({repeat:[p.repeat[0],n]}))}
 {number('U offset',p.offset[0],-1000,1000,n=>patch({offset:[n,p.offset[1]]}))}{number('V offset',p.offset[1],-1000,1000,n=>patch({offset:[p.offset[0],n]}))}
 {number('Texture rotation (degrees)',p.rotation,-360,360,n=>patch({rotation:n}))}
 <label>Material tint<input aria-label="Material tint" type="color" value={p.tint} onChange={e=>patch({tint:e.target.value})} /></label>
 {number('Preset roughness',p.roughness,0,1,n=>patch({roughness:n}))}
 <button onClick={()=>{const copy={...structuredClone(p),id:crypto.randomUUID(),name:`${p.name.slice(0,110)} copy`};onChange([...presets,copy]);setSelected(copy.id);}}>Duplicate material preset</button>
 <button disabled={targets.some(t=>t.material===p.id)} onClick={()=>{onChange(presets.filter(m=>m.id!==p.id));setSelected('');}}>Delete material preset</button>
 </>}
 <label>Material surface<select aria-label="Material surface" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose a surface</option>{targets.map(t=><option key={t.key} value={t.key}>{t.label}{t.uv?'':' — missing UVs'}</option>)}</select></label>
 {t&&<><label>Surface material<select aria-label="Surface material" disabled={!t.uv} value={t.material} onChange={e=>onAssign(t.key,e.target.value)}><option value="">Original / default</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{!t.uv&&<p role="status">This mesh has no UV coordinates. Add UVs in a modelling tool and re-export the GLB before applying tiled maps.</p>}</>}
 <p>Template tile sizes stay constant when resized. Imported meshes keep their UV islands; metre repeats estimate scale from mesh dimensions. Distorted or rotated UV islands may need U/V adjustment in your modelling tool.</p>
 </fieldset></details>;
}
