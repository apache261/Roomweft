import { NumericInput } from './NumericInput';
import {useState} from 'react';
import type {Scene,CameraView} from './api';
import type {ModelInfo} from './WalkControls';
import {bounds,isRoom} from './layout';
import {navigationSettings,type NavigationSettings,type Portal,type WalkRegion} from './navigationSettings';
import {WalkingRegionMap} from './WalkingRegionMap';
import {FloorMeshPicker} from './FloorMeshPicker';
export function sceneRegions(scene:Scene):WalkRegion[]{return scene.type==='LAYOUT'?scene.layout.elements.filter(e=>isRoom(e)||e.kind==='FLOOR').map(e=>({...bounds(e),id:e.id,name:e.name,min_y:-0.01,max_y:0.01,exterior:!!e.exterior})):navigationSettings(scene.settings.navigation).regions;}
export function WalkingPanel({scene,scenes,config,onChange,info,current,busy}:{scene:Scene;scenes:Scene[];config:NavigationSettings;onChange:(c:NavigationSettings)=>void;info:ModelInfo|null;current:()=>CameraView|undefined;busy:boolean}) {
 const [selected,setSelected]=useState(config.regions[0]?.id||''),[portalId,setPortalId]=useState('');const region=config.regions.find(r=>r.id===selected),portal=config.portals.find(p=>p.id===portalId);
 const number=(label:string,value:number,min:number,max:number,change:(n:number)=>void)=><NumericInput key={`${selected}:${portalId}:${label}`} label={label} value={value} min={min} max={max} onChange={change} />;
 const patchRegion=(v:Partial<WalkRegion>)=>region&&onChange({...config,regions:config.regions.map(r=>r.id===region.id?{...r,...v}:r)});
 const patchPortal=(v:Partial<Portal>)=>portal&&onChange({...config,portals:config.portals.map(p=>p.id===portal.id?{...p,...v}:p)});
 const targetScene=portal?(scenes.find(s=>s.id===(portal.destination_scene_id||scene.id))||scene):scene;
 const regions=sceneRegions(targetScene);
 const setDestination=(destination:Scene,regionId?:string)=>{const r=sceneRegions(destination).find(r=>r.id===regionId)||sceneRegions(destination)[0];if(!r)return;const c=navigationSettings(destination.type==='LAYOUT'?destination.layout.navigation:destination.settings.navigation),start='position'in destination.start_camera?destination.start_camera as CameraView:undefined;patchPortal({destination_scene_id:destination.id===scene.id?'':destination.id,destination_region_id:r.id,arrival:{position:start&&start.position[0]>=r.left&&start.position[0]<=r.right&&start.position[2]>=r.top&&start.position[2]<=r.bottom?start.position:[(r.left+r.right)/2,r.max_y+c.eye_height,(r.top+r.bottom)/2],yaw:start?.yaw||0,pitch:start?.pitch||0}});};
 return <details className="scene-settings walking-settings" open><summary>Walking areas and exits</summary><p>Use Save changes above to keep walking settings. Visitors walk only on approved floors. An exit stays locked until an explicit click; its arrival is checked against the destination geometry before moving.</p><fieldset disabled={busy}>

 {scene.type==='LAYOUT'?<p>Walking areas follow room and floor geometry. Mark a standalone floor as exterior in the floor plan to require an exit.</p>:<>
 <p>Review rectangular areas and select their structural floor meshes. Keep roofs, furniture and outdoor floors out of interior regions. Orange exterior regions require an exit. The height range describes floor elevations, not camera height.</p>
 <button onClick={()=>{const r:WalkRegion={id:crypto.randomUUID(),name:'Reviewed interior',left:-2,right:2,top:-2,bottom:2,min_y:0,max_y:0.2,floor_meshes:[]};onChange({...config,regions:[...config.regions,r]});setSelected(r.id);}}>Add walking region</button>
 <label>Walking region<select aria-label="Walking region" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a region</option>{config.regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
 {region&&<><label>Region name<input aria-label="Region name" maxLength={120} value={region.name} onChange={e=>patchRegion({name:e.target.value})}/></label>
 <WalkingRegionMap key={`map-${region.id}`} surfaces={info?.surfaces||[]} regions={config.regions} region={region} busy={busy} onChange={patchRegion}/>
 {(['left','right','top','bottom','min_y','max_y'] as const).map(key=>number(`Region ${key} (m)`,region[key],-1000,1000,n=>patchRegion({[key]:n})))}
 <FloorMeshPicker key={`floors-${region.id}`} surfaces={info?.surfaces||[]} value={region.floor_meshes||[]} busy={busy} onChange={floor_meshes=>patchRegion({floor_meshes})}/>
 {!region.floor_meshes?.length&&<p className="error">Choose at least one structural floor mesh before saving.</p>}
 <label><input type="checkbox" checked={!!region.exterior} onChange={e=>patchRegion({exterior:e.target.checked})}/> Exterior region (requires an exit)</label>
 <button onClick={()=>{onChange({...config,regions:config.regions.filter(r=>r.id!==region.id)});setSelected('');}}>Delete walking region</button></>}
 </>}
 <details className="advanced-controls"><summary>Movement settings</summary><div className="advanced-fields"> {number('Walking speed (m/s)',config.speed,0.25,6,n=>onChange({...config,speed:n}))}{number('Eye height (m)',config.eye_height,1,2.2,n=>onChange({...config,eye_height:n}))}{number('Step height (m)',config.step_height,0.01,0.4,n=>onChange({...config,step_height:n}))}{number('Maximum slope (degrees)',config.max_slope,0,50,n=>onChange({...config,max_slope:n}))}</div></details>
 <details className="advanced-controls"><summary>Exits and courtyards ({config.portals.length})</summary><p>Optional: add an explicit exit and a return path after the interior is ready.</p>
 <button disabled={!current()} onClick={()=>{const pose=current();if(!pose)return;const r=sceneRegions(scene).find(r=>!r.exterior);if(!r)return;const p:Portal={id:crypto.randomUUID(),label:'Enter courtyard',position:[...pose.position],axis:'z',width:1.2,destination_region_id:r.id,arrival:{position:[(r.left+r.right)/2,config.eye_height+r.max_y,(r.top+r.bottom)/2],yaw:0,pitch:0}};onChange({...config,portals:[...config.portals,p]});setPortalId(p.id);}}>Add exit at current walking position</button>
 <label>Configured exit<select aria-label="Configured exit" value={portalId} onChange={e=>setPortalId(e.target.value)}><option value="">Choose an exit</option>{config.portals.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
 {portal&&<><label>Exit label<input aria-label="Exit label" value={portal.label} maxLength={120} onChange={e=>patchPortal({label:e.target.value})}/></label>
 {portal.position.map((v,i)=>number(`Exit ${['X','Y','Z'][i]} (m)`,v,-1000,1000,n=>{const position=[...portal.position] as [number,number,number];position[i]=n;patchPortal({position});}))}
 <label>Exit threshold axis<select aria-label="Exit threshold axis" value={portal.axis} onChange={e=>patchPortal({axis:e.target.value as 'x'|'z'})}><option value="x">X crossing</option><option value="z">Z crossing</option></select></label>
 {number('Exit width (m)',portal.width,0.8,10,n=>patchPortal({width:n}))}
 <label>Exit destination scene<select aria-label="Exit destination scene" value={targetScene.id} onChange={e=>{const s=scenes.find(s=>s.id===e.target.value);if(s)setDestination(s);}}>{scenes.filter(s=>(s.type==='3D'||s.type==='LAYOUT'||s.type==='SPLAT'&&s.settings.splat?.proxy?.reviewed)&&sceneRegions(s).length).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
 <label>Exit destination region<select aria-label="Exit destination region" value={portal.destination_region_id} onChange={e=>setDestination(targetScene,e.target.value)}>{regions.map(r=><option key={r.id} value={r.id}>{r.name}{r.exterior?' (exterior)':''}</option>)}</select></label>
 {portal.arrival.position.map((v,i)=>number(`Arrival ${['X','Y','Z'][i]} (m)`,v,-1000,1000,n=>{const position=[...portal.arrival.position] as [number,number,number];position[i]=n;patchPortal({arrival:{...portal.arrival,position}});}))}
 {number('Arrival yaw (radians)',portal.arrival.yaw,-Math.PI,Math.PI,n=>patchPortal({arrival:{...portal.arrival,yaw:n}}))}{number('Arrival pitch (radians)',portal.arrival.pitch,-1.55,1.55,n=>patchPortal({arrival:{...portal.arrival,pitch:n}}))}
 <p>Place the threshold across the opening and the arrival clear of walls. Add a return exit in the destination region. Exit activation requires standing nearby with a clear line of sight.</p>
 <button onClick={()=>{onChange({...config,portals:config.portals.filter(p=>p.id!==portal.id)});setPortalId('');}}>Delete exit</button></>}
 </details>
 </fieldset></details>;
}
