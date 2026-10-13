import {SplatProxyPanel} from './splat/SplatProxyPanel';
import {proxyReady} from './splat/proxy';
import {useSplatSupport} from './splat/rollout';
import { chunkStreamingEnabled, supportsChunkStreaming } from './chunkRollout';
import { bakeAssetIdentity } from './bakeAssetIdentity';
import { PartitionInspector } from './PartitionInspector';
import { ViewerRuntime } from './ViewerRuntime';
import { qualityCaps, qualityStorageKey, readQualityPreference, saveQualityPreference, type QualityPreference, type QualityTier } from './viewerQuality';
import { PerformancePanel, PerformanceSampler } from './PerformanceDiagnostics';
import { beginPerformanceRun, currentRun, sceneFingerprint } from './performanceMetrics';
import {WalkingPanel,sceneRegions} from './WalkingPanel';
import {NavigationOverlay} from './NavigationOverlay';
import {navigationSettings,type Arrival,type Portal} from './navigationSettings';
import { sceneAssetTier } from './assetPolicy';
import { resolveAssetSource, registerAsset, type AssetResponse } from './runtimeAssetCache';
import {validatePortalArrival} from './portalValidation';
import { MaterialEditor, type MaterialTarget } from './MaterialEditor';
import { textureIds } from './materials';
import { Component, Suspense, lazy, useEffect, startTransition, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import { Matrix3, Matrix4 } from 'three';
import { request, type Asset, type Scene, type CameraView, type PanoramaView, type Hotspot, type HotspotPosition } from './api';
import { LayoutEditor } from './LayoutEditor';
import { LayoutControls } from './LayoutControls';
import { attachPoint, layoutHotspots, layoutIssues, canonicalLayout, type LayoutDocument } from './layout';
import { StreamingSceneControls } from './StreamingSceneControls';
import { WalkControls, type ViewerActions, type ModelInfo } from './WalkControls';
import { PanoramaControls } from './PanoramaControls';
import { HotspotLayer } from './HotspotLayer';
import { defaultSettings, modelMatrix, moveHotspotsForSettings, sameSourceTransform, sameSettings, type SceneSettings } from './sceneSettings';
import { bakeContext, bakeRevision } from './hqRendering';
import { SceneLighting } from './SceneLighting';
import {EditorGrid} from './EditorGrid';
import {useTheme} from './Theme';
import { SceneSettingsPanel } from './SceneSettingsPanel';
import { SplatSettingsPanel } from './splat/SplatSettingsPanel';
import { NumericInput } from './NumericInput';
import { firstInvalidNumericInput } from './NumericInput';
import {readWalkingPreference,saveWalkingPreference} from './walkingEffects';
import { SplatAppearance } from './splat/SplatAppearance';
import { panoramaAngles } from './panorama';

const SplatSceneControls=lazy(()=>import('./splat/SplatExperience').then(m=>({default:m.SplatExperience})));
class ViewerError extends Component<{ children: ReactNode; panorama: boolean }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { const detail = this.state.error.includes('Model import:') ? this.state.error.slice(this.state.error.indexOf('Model import:')) : ''; return this.state.error ? <p className="error" role="alert">Could not render this {this.props.panorama ? 'panorama' : 'GLB'}. {detail || 'The asset may be invalid or its URL expired. Reload scene to retry; otherwise re-export a self-contained GLB with valid geometry and embedded PNG/JPG textures.'}</p> : this.props.children; }
}
function ModelProgress() {
  const { active, progress } = useProgress();
  return active ? <div className="model-progress" role="status">Loading scene… {Math.round(progress)}%</div> : null;
}
export function SceneViewer({ scene, scenes, onSaved, onNavigate, preview = false, assets = [], publicSlug,arrival }: {arrival?:{pose:Arrival;regionId:string}; publicSlug?: string; preview?: boolean; assets?: Asset[]; scene: Scene; scenes: Scene[]; onSaved: (scene: Scene) => void; onNavigate: (id: string,arrival?:{pose:Arrival;regionId:string}) => void }) {
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  useEffect(() => { const change = () => setPageVisible(!document.hidden); document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change); }, []);
  const [quality, setQuality] = useState<QualityPreference>(readQualityPreference);
  const [autoTier, setAutoTier] = useState<QualityTier>('balanced');
  const tier = quality === 'auto' ? autoTier : quality;
  const [autoAssetTier,setAutoAssetTier]=useState<QualityTier>('balanced');
  const requestedAssetTier=quality==='auto'?autoAssetTier:quality;
  const invalidateViewer = useRef<(() => void) | undefined>(undefined);
  const wakeViewer = useCallback(() => invalidateViewer.current?.(), []);
  useEffect(() => { const changed = (event: StorageEvent) => { if (event.key === qualityStorageKey || event.key === null) setQuality(readQualityPreference()); }; window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed); }, []);
  const diagnostics = import.meta.env.DEV && new URLSearchParams(location.search).get('perf') === '1';
  const performanceRevision = diagnostics ? sceneFingerprint(scene) : '';
  // Start before the Canvas loads/prepares assets so startup stages are included.
  useMemo(() => diagnostics ? beginPerformanceRun({ sceneId: scene.id, sceneName: scene.name, sceneRevision: performanceRevision, layoutRevision: scene.layout_revision, quality, qualityTier: tier, mode: publicSlug ? (location.pathname.startsWith('/embed/') ? 'embed' : 'public') : preview ? 'preview' : 'builder', browser: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, device: new URLSearchParams(location.search).get('device') || 'unspecified', physicalDevice: 'unverified', chunkStreamingGate:chunkStreamingEnabled(import.meta.env.VITE_CHUNK_STREAMING,location.search)?'enabled':'complete', execution: 'browser-unverified' }) : undefined, [diagnostics, scene.id, performanceRevision, preview, publicSlug]);
  const panel=useRef<HTMLElement>(null);
  const {resolved}=useTheme();
  const [showGrid,setShowGrid]=useState(true);
  const [walkingEffects,setWalkingEffects]=useState(()=>readWalkingPreference('effects')??false);
  const [smoothMovement,setSmoothMovement]=useState(()=>readWalkingPreference('smooth'));
  const [reducedMotion,setReducedMotion]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{const query=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReducedMotion(query.matches);query.addEventListener('change',change);return()=>query.removeEventListener('change',change);},[]);
  const [directoryOpen,setDirectoryOpen]=useState(false);
  const [tool,setTool]=useState(scene.type==='LAYOUT'?'plan':'hotspots');
  const [selectedElement,setSelectedElement]=useState('');
  const [partitionAsset,setPartitionAsset]=useState('');
  useEffect(()=>{panel.current?.querySelector('.editor-inspector')?.scrollTo(0,0);},[tool]);
  const quickRoom=useRef<(()=>void)|null>(null);
  const bindQuickRoom=useCallback((add:(()=>void)|null)=>{quickRoom.current=add;},[]);
  const selectElement=useCallback((id:string)=>{setSelectedElement(id);setTool('plan');},[]);
  function chooseTool(next:string){stop();setTool(next);}

  const source=publicSlug ? `/public/tours/${encodeURIComponent(publicSlug)}` : '';
  const [url, setURL] = useState('');
  const [runtimeResponse,setRuntimeResponse]=useState<AssetResponse|null>(null);
  const [textureResponses,setTextureResponses]=useState<Record<string,AssetResponse>>({});
  const [instanceResponses,setInstanceResponses]=useState<Record<string,AssetResponse>>({});
  const assetPolicy=useMemo(()=>sceneAssetTier([...runtimeResponse?[runtimeResponse]:[],...Object.values(instanceResponses),...Object.values(textureResponses)],requestedAssetTier),[runtimeResponse,instanceResponses,textureResponses,requestedAssetTier]);
  const assetTier=assetPolicy.tier;
  useEffect(()=>{if(currentRun&&diagnostics)currentRun.metadata={...currentRun.metadata,assetTier,textureVariantBudget:assetPolicy};},[assetTier,assetPolicy,diagnostics]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const splat=scene.type==='SPLAT';
  const splatSupport=useSplatSupport(attempt);
  const [proxyOverlay,setProxyOverlay]=useState(false);
  const [contextEpoch,setContextEpoch]=useState(0);
  const [walking, setWalking] = useState((preview||!!arrival) && (scene.type==='3D'||scene.type==='LAYOUT'||scene.type==='SPLAT'&&proxyReady(scene.settings)));
  useEffect(()=>{if(splat&&!splatSupport.loading&&!splatSupport.walking)setWalking(false);},[splat,splatSupport.loading,splatSupport.walking]);
  const [actions, setActions] = useState<ViewerActions | null>(null);
  const [layoutDocument,setLayoutDocument]=useState<LayoutDocument>(scene.type==='LAYOUT'?scene.layout:{version:1,elements:[],doors:[]});
  const layoutDirty=scene.type==='LAYOUT' && canonicalLayout(layoutDocument)!==canonicalLayout(scene.layout);
  const lastValidLayout=useRef(layoutDocument);
  if(!layoutIssues(layoutDocument).errors.length)lastValidLayout.current=layoutDocument;
  const [instanceURLs,setInstanceURLs]=useState<Record<string,string>>({});
  const [layoutLoading,setLayoutLoading]=useState(false);
  const instanceKey=scene.type==='LAYOUT'?[...new Set(layoutDocument.elements.filter(e=>e.kind==='INSTANCE').map(e=>e.asset_id!))].sort().join(','):'';
  const [settings, setSettings] = useState<SceneSettings>(scene.settings || structuredClone(defaultSettings));
  const [exitTarget,setExitTarget]=useState<Portal|null>(null);
 const [nearby,setNearby]=useState<string[]>([]);
 const [exitBusy,setExitBusy]=useState(false);
 const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [textureURLs,setTextureURLs]=useState<Record<string,string>>({});
 const [textureLoading,setTextureLoading]=useState(false);
 const [textureError,setTextureError]=useState('');
 const presets=scene.type==='LAYOUT'?layoutDocument.materials||[]:settings.materials||[];
  const bakeKey=new URLSearchParams(location.search).get('hq')==='0'?'':bakeRevision(bakeContext(scene.type==='LAYOUT'?Object.entries(instanceResponses).map(([id,a])=>[id,bakeAssetIdentity(id,a)]).sort():bakeAssetIdentity(scene.asset_id,runtimeResponse),scene.type==='LAYOUT'?{...layoutDocument,materials:undefined,navigation:undefined}:settings.model,presets,scene.type==='LAYOUT'?layoutDocument.elements.map(e=>[e.id,e.floor_material,e.wall_material,e.mesh_materials]):settings.surface_materials,settings.appearance));
 const textureKey=textureIds(presets.map(p=>bakeKey&&p.bake_revision===bakeKey?p:{...p,light_map:undefined,ao_map:undefined})).join(',');
 const autoSplatStarted=useRef(false);
 const reportModelInfo=useCallback((info:ModelInfo)=>{setModelInfo(info);if(!info.walkable)setWalking(false);else if(splat&&splatSupport.walking&&(preview||arrival)&&!autoSplatStarted.current){autoSplatStarted.current=true;setWalking(true);}},[splat,splatSupport.walking,preview,arrival]);
  const settingsDirty = !sameSettings(settings, scene.settings || defaultSettings);
  const [notice, setNotice] = useState('');
  const [roomLoading,setRoomLoading]=useState<'ready'|'loading'|'failed'>('ready');
  const retryRooms=useRef<(()=>void)|undefined>(undefined);
  const roomStatus=useCallback((status:'ready'|'loading'|'failed',retry?:()=>void)=>{setRoomLoading(status);retryRooms.current=retry;},[]);
  const [saving, setSaving] = useState(false);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const displayHotspots = useMemo(() => scene.type==='LAYOUT'?layoutHotspots(hotspots,layoutDocument):moveHotspotsForSettings(hotspots, scene.settings || defaultSettings, settings), [hotspots, scene.settings, settings,scene.type,layoutDocument]);
  const attached=useMemo(()=>new Set(hotspots.flatMap(h=>'x' in h.position && h.position.attachment?[h.position.attachment.element_id]:[])),[hotspots]);
  const [hotspotError, setHotspotError] = useState('');
  const [hotspotsReady, setHotspotsReady] = useState(false);
  const [destination, setDestination] = useState('');
  const [title, setTitle] = useState('');
  const [kind,setKind]=useState<'NAVIGATION'|'INFO'>('INFO');
  const [description,setDescription]=useState('');
  const [externalLink,setExternalLink]=useState('');
  const [image,setImage]=useState('');
  const [position,setPosition]=useState<HotspotPosition|null>(null);
  const [editing,setEditing]=useState('');
  const [hover, setHover] = useState<HotspotPosition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [target, setTarget] = useState<Hotspot | null>(null);
  const [locked, setLocked] = useState(false);
  const [hotspotAttempt, setHotspotAttempt] = useState(0);
  const paused = useRef(false);
  const [popup,setPopup]=useState<Hotspot|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(popup && dialog.current && !dialog.current.open) dialog.current.showModal();},[popup]);
  const [imageURL,setImageURL]=useState('');
  const [imageError,setImageError]=useState('');
  useEffect(()=>{
    let active=true; setImageURL(''); setImageError('');
    if(popup?.image_asset_id) request<Asset & {url:string}>(`${source}/assets/${popup.image_asset_id}`).then(a=>{if(active)setImageURL(a.url);}).catch(e=>{if(active)setImageError(e.message);});
    return ()=>{active=false;};
  },[popup,source]);
  useEffect(()=>{if(!popup)return; const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setPopup(null);}; window.addEventListener('keydown',close); return ()=>window.removeEventListener('keydown',close);},[popup]);
  function edit(h:Hotspot) { if(!preview)setTool('hotspots');stop();setDirty(false);setHover(null); setEditing(h.id);setKind(h.type);setTitle(h.title);setDescription(h.description);setExternalLink(h.external_link);setImage(h.image_asset_id||'');setDestination(h.destination_scene_id||'');setPosition(h.position);setPlacing(false); }
  function newHotspot() { stop();setDirty(false);setHover(null); setEditing('');setTitle('');setDescription('');setExternalLink('');setImage('');setDestination('');setPosition(null);setPlacing(false); }
  function stop() { movement.current.clear(); wakeViewer(); if (document.pointerLockElement) document.exitPointerLock(); }
  function testHotspot(h:Hotspot) { stop(); if(h.type==='NAVIGATION' && h.destination_scene_id) onNavigate(h.destination_scene_id); else setPopup(h); }
  function activate(h:Hotspot) { if(!preview) edit(h); else testHotspot(h); }
  function showHotspot(h:Hotspot) { stop(); if (!preview) edit(h); else {setEditing(h.id);setDirectoryOpen(false);} actions?.show(h.position); }
  paused.current = !!popup || exitBusy;
  useEffect(() => {
    const change = () => setLocked(!!panel.current?.contains(document.pointerLockElement));
    document.addEventListener('pointerlockchange', change);
    return () => document.removeEventListener('pointerlockchange', change);
  }, []);

  const [placing, setPlacing] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const panorama = scene.type === 'PANORAMA';
  const savedWalk = useRef<CameraView | undefined>('position' in scene.start_camera ? scene.start_camera as CameraView : undefined);
  const savedPanorama = useRef<PanoramaView | undefined>('yaw' in scene.start_camera ? scene.start_camera as PanoramaView : undefined);
  const movement = useRef(new Set<string>());
  useEffect(() => {
    let active = true; setRuntimeResponse(null); setURL(''); setError(''); setActions(null); setNotice(''); setHotspotError(''); setHotspotsReady(false);
    if(scene.type==='LAYOUT'||splat){setURL(splat?'splat':'layout');return ()=>{active=false;};}
    request<Asset & AssetResponse>(`${source}/assets/${scene.asset_id}`).then(asset => {
      if (active) { if (!asset.url) setError('This asset is not ready.'); else {setRuntimeResponse(asset);setURL(panorama ? asset.url : registerAsset(scene.asset_id!, `${source}/assets/${scene.asset_id}`, asset, assetTier));} }
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [scene.id, scene.asset_id, attempt, source]);
  useEffect(()=>{if(runtimeResponse&&!panorama&&!splat)startTransition(()=>setURL(registerAsset(scene.asset_id!,`${source}/assets/${scene.asset_id}`,runtimeResponse,assetTier)));},[runtimeResponse,assetTier,panorama,scene.asset_id,source]);
  useEffect(()=>{
    if(scene.type!=='LAYOUT')return;
    let active=true;setLayoutLoading(true);setError('');
    Promise.all(instanceKey?instanceKey.split(',').map(async id=>{const asset=await request<AssetResponse>(`${source}/assets/${id}`);if(!asset.url)throw new Error('An instance asset is not ready.');return [id,asset] as const;}):[])
      .then(items=>{if(active){setInstanceResponses(Object.fromEntries(items));setInstanceURLs(Object.fromEntries(items.map(([id,asset])=>[id,registerAsset(id,`${source}/assets/${id}`,asset,assetTier)])));}}).catch(err=>{if(active)setError(err.message);}).finally(()=>{if(active)setLayoutLoading(false);});
    return ()=>{active=false;};
  },[instanceKey,source,attempt,scene.type]);
  useEffect(()=>{startTransition(()=>setInstanceURLs(Object.fromEntries(Object.entries(instanceResponses).map(([id,asset])=>[id,registerAsset(id,`${source}/assets/${id}`,asset,assetTier)]))));},[instanceResponses,assetTier,source]);
  useEffect(()=>{
    let active=true;setTextureLoading(true);setTextureError('');
    Promise.all(textureKey?textureKey.split(',').map(async id=>{const a=await request<AssetResponse>(`${source}/assets/${id}`);if(!a.url)throw new Error('A texture is not ready.');return [id,a] as const;}):[])
      .then(items=>{if(active){setTextureResponses(Object.fromEntries(items));setTextureURLs(Object.fromEntries(items.map(([id,asset])=>[id,registerAsset(id,`${source}/assets/${id}`,asset,assetTier)])));}}).catch(e=>{if(active)setTextureError(e.message);}).finally(()=>{if(active)setTextureLoading(false);});
    return ()=>{active=false;};
  },[textureKey,source,attempt]);
  useEffect(()=>{startTransition(()=>setTextureURLs(Object.fromEntries(Object.entries(textureResponses).map(([id,asset])=>[id,registerAsset(id,`${source}/assets/${id}`,asset,assetTier)]))));},[textureResponses,assetTier,source]);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(!preview && (layoutDirty||settingsDirty||dirty)){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return ()=>window.removeEventListener('beforeunload',warn);},[layoutDirty,settingsDirty,dirty,preview]);
  async function reloadScene() {
    if(scene.type!=='LAYOUT'){setAttempt(n=>n+1);return;}
    stop();setSaving(true);setNotice('');
    try {
      const {document,revision}=await request<{document:LayoutDocument;revision:number}>(`${source}/scenes/${scene.id}/layout`);
      const updated=publicSlug?{...scene,layout:document,layout_revision:revision}:await request<Scene>(`/scenes/${scene.id}`);
      setLayoutDocument(updated.layout);setSettings(updated.settings);savedWalk.current='position' in updated.start_camera?updated.start_camera as CameraView:undefined;
      onSaved(updated);newHotspot();setAttempt(n=>n+1);
    }catch(err){setNotice(err instanceof Error?err.message:'Could not reload layout.');}finally{setSaving(false);}
  }
  function validNumericInputs() {
    const invalid=firstInvalidNumericInput(panel.current);
    if(!invalid)return true;
    const section=invalid.closest('[role="tabpanel"]');
    if(section)setTool(section.id.replace('panel-',''));
    for(let parent=invalid.parentElement;parent&&parent!==panel.current;parent=parent.parentElement){
      if(parent instanceof HTMLDetailsElement)parent.open=true;
    }
    setNotice(`Cannot save yet: correct ${invalid.getAttribute('aria-label')}.`);
    requestAnimationFrame(()=>{invalid.focus();invalid.scrollIntoView({block:'nearest'});});
    return false;
  }
  async function saveLayout() {
    if(!validNumericInputs())return false;
    stop();setSaving(true);setNotice('');
    try {
      const updated=await request<Scene>(`/scenes/${scene.id}/layout`,{method:'PUT',body:JSON.stringify({revision:scene.layout_revision,document:layoutDocument})});
      setLayoutDocument(updated.layout);savedWalk.current=undefined;setHotspots(items=>layoutHotspots(items,updated.layout));onSaved(updated);setWalking(false);newHotspot();setHotspotAttempt(n=>n+1);setNotice('Layout saved. Walk inside and save a new start view.');return true;
    }catch(err){setNotice(err instanceof Error?err.message:'Could not save layout.');return false;}finally{setSaving(false);}
  }
  useEffect(() => {
    let active = true; setHotspotsReady(false); setHotspotError('');
    request<Hotspot[]>(`${source}/scenes/${scene.id}/hotspots`).then(items => { if (active) { setHotspots(items); setHotspotsReady(true); } })
      .catch(err => { if (active) setHotspotError(err.message); });
    return () => { active = false; };
  }, [scene.id, attempt, hotspotAttempt, source]);
  useEffect(() => { if (destination && !scenes.some(item => item.id === destination)) { setDestination(''); setPlacing(false); } }, [scenes, destination]);
  async function saveSettings() {
    if(!validNumericInputs())return false;
    stop(); setSaving(true); setNotice('');
    try {
      const updated = await request<Scene>(`/scenes/${scene.id}`, { method: 'PATCH', body: JSON.stringify({ settings }) });
      const transformed = !sameSourceTransform(settings, scene.settings || defaultSettings);
      savedWalk.current = 'position' in updated.start_camera ? updated.start_camera as CameraView : undefined;
      if (transformed) setHotspots(items => moveHotspotsForSettings(items, scene.settings || defaultSettings, updated.settings));
      setSettings(updated.settings); onSaved(updated);
      if (transformed) { setWalking(false); newHotspot(); setHotspotAttempt(n => n + 1); }
      setNotice(transformed ? splat?'Settings saved. Hotspots moved with the capture. Save a new inspection start view.':'Settings saved. Hotspots moved with the model. Walk inside and save a new start view.' : 'Settings saved.');return true;
    } catch (err) { setNotice(err instanceof Error ? err.message : 'Could not save settings.');return false; }
    finally { setSaving(false); }
  }
  async function save() {
    if (!actions) return;
    if (actions.canSaveStart && !actions.canSaveStart()) { setNotice('Walk onto an approved interior floor with standing clearance before saving the start view.'); return; }
    const view = actions.view(); setSaving(true); setNotice('');
    try {
      const updated = await request<Scene>(`/scenes/${scene.id}`, { method: 'PATCH', body: JSON.stringify({ start_camera: view }) });
      if ('position' in view) savedWalk.current = view; else savedPanorama.current = view;
      onSaved(updated); setNotice('Start view saved.');
    } catch (err) { setNotice(err instanceof Error ? err.message : 'Could not save start view.'); }
    finally { setSaving(false); }
  }
  const walkingConfig=navigationSettings(scene.type==='LAYOUT'?layoutDocument.navigation:settings.navigation);
  const draftScene={...scene,layout:layoutDocument,settings};
  const draftScenes=scenes.map(s=>s.id===scene.id?draftScene:s);
  async function activatePortal(portal:Portal) {
    if(exitBusy||!actions?.canActivate?.(portal))return;
    stop();setExitBusy(true);setNotice('Checking exit arrival…');
    try{if(layoutDirty||settingsDirty)throw new Error('Save walking areas and exits before testing an exit.');
      const destination=draftScenes.find(s=>s.id===(portal.destination_scene_id||scene.id));if(!destination)throw new Error('Exit destination is unavailable.');
      if(destination.id===scene.id){if(!actions.enter?.(portal))throw new Error('Exit arrival has no approved floor or standing clearance. Edit the exit arrival before entering.');setNotice('Entered '+portal.label+'.');}
      else{const pose=await validatePortalArrival(destination,portal,source,actions?.renderer);onNavigate(destination.id,{pose,regionId:portal.destination_region_id});}
    }catch(e){setNotice(e instanceof Error?e.message:'Could not enter exit.');}finally{setExitBusy(false);}
  }
  function materialTargets():MaterialTarget[] {
    if(scene.type!=='LAYOUT')return (modelInfo?.surfaces||[]).map(s=>({key:s.path,label:s.label,uv:s.uv,bakeUV:s.bakeUV,material:settings.surface_materials?.[s.path]||''}));
    return layoutDocument.elements.flatMap(e=>e.kind==='INSTANCE'?(modelInfo?.surfaces||[]).filter(s=>s.elementId===e.id).map(s=>({key:`${e.id}|${s.path}`,label:`${e.name}: ${s.label}`,uv:s.uv,bakeUV:s.bakeUV,material:e.mesh_materials?.[s.path]||''})):
      (e.kind==='WALL'?['wall']:e.kind==='FLOOR'?['floor']:['floor','wall']).map(kind=>({key:`${e.id}|${kind}`,label:`${e.name}: ${kind}`,uv:true,bakeUV:false,material:(kind==='floor'?e.floor_material:e.wall_material)||''})));
  }
  function assignMaterial(key:string,id:string) {
    if(scene.type!=='LAYOUT'){const next={...settings.surface_materials};if(id)next[key]=id;else delete next[key];setSettings({...settings,surface_materials:next});return;}
    const [elementId,surface]=key.split('|');
    setLayoutDocument({...layoutDocument,elements:layoutDocument.elements.map(e=>{if(e.id!==elementId)return e;if(surface==='floor')return {...e,floor_material:id};if(surface==='wall')return {...e,wall_material:id};const next={...e.mesh_materials};if(id)next[surface]=id;else delete next[surface];return {...e,mesh_materials:next};})});
  }
  function placement(event: ThreeEvent<MouseEvent> | ThreeEvent<PointerEvent>): HotspotPosition {
    if (panorama) {
      const p = panoramaAngles(event.point);
      return { ...p, pitch: Math.max(-Math.PI/2+0.02, Math.min(Math.PI/2-0.02,p.pitch)) };
    }
    const point = event.point.clone();
    if (event.face) {
      const normal = event.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(event.object.matrixWorld)).normalize();
      if (normal.dot(event.ray.direction) > 0) normal.negate();
      point.addScaledVector(normal, 0.04);
    }
    const p={x:point.x,y:point.y,z:point.z};
    if(scene.type==='LAYOUT') {
      let object: typeof event.object | null=event.object;
      while(object && !object.userData.layoutElement)object=object.parent;
      const e=layoutDocument.elements.find(e=>e.id===object?.userData.layoutElement);
      if(e)return {...p,attachment:attachPoint(e,p)};
    }
    return p;
  }
  function place(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation(); setPosition(placement(event)); setDirty(true); setHover(null); setPlacing(false);
  }
  function hoverPlace(event: ThreeEvent<PointerEvent> | null) { setHover(event ? placement(event) : null); }
  async function saveHotspot() {
    if(!position||!validNumericInputs())return;
    setLinkBusy(true);setHotspotError('');
    try {
      const h=await request<Hotspot>(editing ? `/hotspots/${editing}` : `/scenes/${scene.id}/hotspots`,{method:editing?'PATCH':'POST',body:JSON.stringify({type:kind,title:title.trim(),position,destination_scene_id:kind==='NAVIGATION'?destination:null,description:kind==='INFO'?description:'',external_link:kind==='INFO'?externalLink:'',image_asset_id:kind==='INFO'?(image||null):null})});
      setHotspots(items=>editing?items.map(item=>item.id===h.id?h:item):[...items,h]);edit(h);setNotice('Hotspot saved.');
    } catch(err) {setHotspotError(err instanceof Error?err.message:'Could not save hotspot.');}
    finally {setLinkBusy(false);}
  }
  async function removeHotspot(id: string) {
    setLinkBusy(true); setHotspotError('');
    try { await request(`/hotspots/${id}`,{method:'DELETE'}); setHotspots(items=>items.filter(h=>h.id!==id)); newHotspot(); }
    catch (err) { setHotspotError(err instanceof Error ? err.message : 'Could not delete hotspot.'); }
    finally { setLinkBusy(false); }
  }
  async function saveChanges(){
    if(saving||linkBusy)return false;
    if(!validNumericInputs())return false;
    if(layoutDirty){const issues=layoutIssues(layoutDocument);if(issues.errors.length){setTool('plan');setNotice(`Cannot save yet: ${issues.errors.join(' ')}`);return false;}if(!(await saveLayout()))return false;}
    if(settingsDirty&&!(await saveSettings()))return false;
    if(!layoutDirty&&!settingsDirty)setNotice('All changes are saved.');
    return true;
  }
  async function toggleWalking(){
    stop();if(walking){setWalking(false);setNotice('');return;}
    if(!validNumericInputs())return;
    if(!modelInfo?.walkable){setTool('walking');setNotice('Review a walking region and its floor meshes, then save to enable walking.');return;}
    if(layoutDirty&&!(await saveLayout())){setTool('plan');return;}
    if(settingsDirty&&!(await saveSettings())){setTool('walking');return;}
    setWalking(true);setNotice(preview?'':'Walking test: use WASD now. Save start view to choose where visitors begin.');
  }
  useEffect(() => {
    if (diagnostics && currentRun?.metadata.sceneId === scene.id) currentRun.metadata = { ...currentRun.metadata, hotspotRevision: sceneFingerprint(displayHotspots), hotspotCount: displayHotspots.length, runtimeRevision: sceneFingerprint({ settings, layout: lastValidLayout.current }), walking, revealHiddenHotspots: reveal };
  }, [diagnostics, scene.id, displayHotspots, settings, layoutDocument, walking, reveal]);

  return <section ref={panel} className={`viewer-panel ${preview ? 'visitor-scene' : 'editor-scene'}`} aria-label="Scene viewer">
    <div className="viewport-column">
    {!preview&&<div className="viewer-toolbar"><div className="viewport-title"><span className="viewport-kind">{panorama?'360°':splat?'Gaussian splat':'3D'}</span><h2>{scene.name}</h2><span className="viewport-state">{preview?'Preview':layoutDirty||settingsDirty?'Unsaved changes':'Saved'}</span></div><button onClick={reloadScene} disabled={saving || linkBusy}>Reload scene</button></div>}
    {!preview&&<div className="editor-quick-tools" aria-label="Scene actions">
      {scene.type==='LAYOUT'&&<button disabled={saving||linkBusy||walking} onClick={()=>{setTool('plan');quickRoom.current?.();}}>+ Add room</button>}
      <button disabled={linkBusy||settingsDirty||layoutDirty} onClick={()=>{setTool('hotspots');setWalking(false);newHotspot();}}>+ Add hotspot</button>
      <button className="secondary" disabled={saving||linkBusy} onClick={()=>void saveChanges()}>Save changes</button>

    </div>}
    <div className="walk-toolbar">
      <label className="quality-control"><span className="sr-only">Rendering quality</span><select aria-label="Rendering quality" value={quality} onChange={event => { const next = event.target.value as QualityPreference; setQuality(next); saveQualityPreference(next); }}><option value="auto">Auto ({autoTier === 'hq' ? 'HQ' : autoTier === 'low' ? 'Low' : 'Balanced'})</option><option value="low">Low</option><option value="balanced">Balanced</option><option value="hq">HQ</option></select></label>
      {!preview&&!panorama&&!splat&&<button aria-pressed={showGrid} onClick={()=>setShowGrid(!showGrid)}>Grid</button>}
      {preview&&<button aria-expanded={directoryOpen} aria-controls="visitor-hotspots" onClick={()=>{stop();setDirectoryOpen(!directoryOpen);}}>{directoryOpen?'Hide hotspots':'Hotspots'}</button>}
      {document.fullscreenEnabled && <button onClick={()=>{const task=document.fullscreenElement?document.exitFullscreen():panel.current?.requestFullscreen();task?.catch(()=>setNotice('Fullscreen unavailable in this browser.'));}}>Fullscreen</button>}
      {!panorama && (!splat||splatSupport.walking&&!!settings.splat?.proxy) && <button disabled={!actions || saving || placing || preview&&!!modelInfo&&!modelInfo.walkable&&!walking} onClick={()=>void toggleWalking()}>{walking ? 'Inspect model' : !preview&&modelInfo&&!modelInfo.walkable?'Set up walking':layoutDirty||settingsDirty?'Save & walk':'Walk inside'}</button>}
      {!panorama&&walking&&<div className="walking-effects" role="group" aria-label="Walking effects">
        <button aria-pressed={walkingEffects&&!reducedMotion} disabled={reducedMotion} title={reducedMotion?'Head bob is disabled by your reduced-motion preference.':'Gentle camera bob while moving. This preference is saved in your browser.'} onClick={()=>{const next=!walkingEffects;setWalkingEffects(next);saveWalkingPreference('effects',next);}}>Head bob</button>
        <button aria-pressed={smoothMovement??preview} title="Smooth acceleration and braking. Wall and floor collisions always stay enabled." onClick={()=>{const next=!(smoothMovement??preview);setSmoothMovement(next);saveWalkingPreference('smooth',next);}}>Smooth movement</button>
      </div>}
      {!preview && <button disabled={!actions || (!panorama && !splat && !walking) || saving || settingsDirty || layoutDirty} onClick={save}>{saving ? 'Saving…' : 'Save start view'}</button>}
      <button disabled={!actions || (!panorama && !splat && !walking) || saving} onClick={() => { actions?.reset(); movement.current.clear(); wakeViewer(); }}>Reset view</button>
      {preview&&<button onClick={reloadScene} disabled={saving||linkBusy}>Reload scene</button>}
    </div>
    <div className={`viewer ${walking ? 'walking' : ''} ${panorama ? 'panorama' : ''} ${placing ? 'placing' : ''}`} key={`${scene.id}-${attempt}`}>
      {splat && !splatSupport.viewer ? <p role={splatSupport.loading?"status":"alert"}>{splatSupport.loading?"Checking Gaussian splat availability…":"Gaussian splat support is unavailable. Choose another scene or retry later."} {!splatSupport.loading&&<button onClick={reloadScene}>Retry scene</button>}</p> : error || textureError ? <p className="error" role="alert">{error || textureError} <button onClick={reloadScene}>Retry scene</button></p> : !url || layoutLoading || textureLoading ? <p role="status">Loading scene…</p> :
        <ViewerError panorama={panorama}><ModelProgress /><Canvas key={contextEpoch} frameloop={pageVisible ? 'demand' : 'never'} dpr={[.5, qualityCaps[tier]]} onCreated={state => { invalidateViewer.current = state.invalidate;
            if(splat){state.gl.domElement.addEventListener('webglcontextlost',()=>{setActions(null);setNotice('Graphics context lost. Waiting for restoration…');},{once:true});state.gl.domElement.addEventListener('webglcontextrestored',()=>setContextEpoch(n=>n+1),{once:true});}
          }} camera={{ position: panorama ? [0,0,0] : [4,3,6], fov: panorama ? 75 : 60 }} gl={{ antialias: !splat }} fallback={<p role="alert">WebGL is unavailable in this browser.</p>}>
          <ViewerRuntime preference={quality} onAutoTier={setAutoTier} onAssetTier={setAutoAssetTier}>
          {panorama ? <color attach="background" args={['#edf1e8']} /> : splat ? <SplatAppearance appearance={settings.appearance}/> : <SceneLighting tier={requestedAssetTier} enabled={new URLSearchParams(location.search).get('hq')!=='0'} appearance={settings.appearance} background={!preview?(resolved==='dark'?'#18232f':'#eaf0f5'):undefined} />}
          {!preview&&!panorama&&!splat&&showGrid&&<EditorGrid dark={resolved==='dark'} info={modelInfo}/>}
          {diagnostics && <PerformanceSampler walkingUsable={!panorama && walking && !!modelInfo?.walkable && !!actions && hotspotsReady && !layoutLoading && !textureLoading} usable={!!actions && hotspotsReady && !layoutLoading && !textureLoading} />}
          <Suspense fallback={null}>
            {panorama ? <PanoramaControls url={url} saved={savedPanorama} ready={setActions} placing={placing && !linkBusy} onPlace={place} onHover={hoverPlace} /> :
              splat?<SplatSceneControls source={source} overlay={!preview&&proxyOverlay} streamingAllowed={splatSupport.streaming&&new URLSearchParams(location.search).get('splat_streaming')!=='0'} onStreamingState={roomStatus} walkingAllowed={splatSupport.walking} walking={walking} onNearby={setNearby} movement={movement} placing={false} onPlace={place} onHover={hoverPlace} onInfo={reportModelInfo} report={setNotice} instant={!preview} arrival={arrival} effects={walkingEffects&&!reducedMotion} smoothMovement={smoothMovement??preview} endpoint={`${source}/assets/${scene.asset_id}`} settings={settings} saved={savedWalk} ready={setActions} onError={setError} paused={paused}/> :
              scene.type==='LAYOUT'?<LayoutControls bakeRevision={bakeKey} streaming={preview && chunkStreamingEnabled(import.meta.env.VITE_CHUNK_STREAMING,location.search)} onStreamingState={roomStatus} optimizeVisuals={preview && new URLSearchParams(location.search).get('spatial') !== '0'} document={lastValidLayout.current} urls={instanceURLs} textureURLs={textureURLs} walking={walking} effects={walkingEffects&&!reducedMotion} smoothMovement={smoothMovement??preview} instant={!preview} onSelectElement={selectElement} arrival={arrival} onNearby={setNearby} saved={savedWalk} movement={movement} ready={setActions} report={setNotice} placing={placing && !linkBusy} onPlace={place} onHover={hoverPlace} paused={paused} onInfo={reportModelInfo} /> :
              <ImportedControls streaming={preview && chunkStreamingEnabled(import.meta.env.VITE_CHUNK_STREAMING,location.search)} onStreamingState={roomStatus} bakeRevision={bakeKey} optimizeVisuals={preview && new URLSearchParams(location.search).get('spatial') !== '0'} url={url} walking={walking} effects={walkingEffects&&!reducedMotion} smoothMovement={smoothMovement??preview} instant={!preview} onSelectElement={selectElement} arrival={arrival} onNearby={setNearby} saved={savedWalk} movement={movement} ready={setActions} report={setNotice} placing={placing && !linkBusy} onPlace={place} onHover={hoverPlace} paused={paused} settings={settings} textureURLs={textureURLs} onInfo={reportModelInfo} />}
            {!panorama&&(!splat||splatSupport.walking&&proxyReady(settings))&&<NavigationOverlay regions={sceneRegions(draftScene)} portals={walkingConfig.portals} builder={!preview} nearby={nearby} onActivate={activatePortal} onTarget={setExitTarget}/>}
            <HotspotLayer hotspots={displayHotspots} onActivate={activate} placing={placing} draft={placing ? hover : dirty ? position : null} selected={editing} reveal={!preview && reveal} panorama={panorama} screenOnly={splat&&(!settings.splat?.proxy?.reviewed||!settings.splat.proxy.occlusion)} onTarget={setTarget} />
          </Suspense>
          </ViewerRuntime>
        </Canvas></ViewerError>}
      {locked && <div className="walk-reticle" aria-live="polite"><span>＋</span><small>{exitTarget?`Click: ${exitTarget.label}`:target ? `Click: ${target.title}` : 'Aim at a hotspot or exit · Escape for controls'}</small></div>}
    </div>
    {!preview&&!panorama&&modelInfo&&(!splat||settings.splat?.proxy)&&<p className="model-readiness" role="status">Prepared dimensions: {modelInfo.dimensions.map(n=>n.toFixed(2)).join(' × ')} m · {modelInfo.textures} embedded textures · {modelInfo.walkable?'Standing floor found':'No standing floor found'}</p>}
    {diagnostics && <PerformancePanel />}
    {!panorama&&modelInfo?.navigationError&&<p role="status">{modelInfo.navigationError} Inspection remains available.</p>}
    {walking && <div className="movement-pad" aria-label="Movement controls">{[['w','Forward'],['a','Left'],['s','Backward'],['d','Right']].map(([key, label]) =>
      <button key={key} aria-label={`Move ${label.toLowerCase()}`} disabled={!actions || !!popup} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); movement.current.add(key); wakeViewer(); }}
        onPointerUp={() => (movement.current.delete(key), wakeViewer())} onPointerCancel={() => (movement.current.delete(key), wakeViewer())} onLostPointerCapture={() => (movement.current.delete(key), wakeViewer())} onBlur={() => (movement.current.delete(key), wakeViewer())}
        onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); movement.current.add(key); wakeViewer(); } }}
        onKeyUp={() => (movement.current.delete(key), wakeViewer())}>{preview?<><span aria-hidden="true">{{w:'↑',a:'←',s:'↓',d:'→'}[key]}</span><span className="sr-only">{label}</span></>:label}</button>)}</div>}
    {roomLoading!=='ready'&&<p className="viewer-notice" role="status">{roomLoading==='failed'?<>Visuals could not load. Entry remains blocked. <button onClick={()=>retryRooms.current?.()}>{splat?'Retry capture loading':'Retry room loading'}</button></>:splat?'Loading capture tiles… Walking waits for committed visuals.':'Loading nearby rooms… Entry opens when ready.'}</p>}
    {notice && <p className="viewer-notice" role="status">{notice}</p>}
    <p className="viewer-help">{splat&&!walking?'Drag to orbit · Scroll or pinch to zoom · Inspection viewing':preview?(panorama?'Drag to look · Pinch to zoom':walking?'WASD to move · Drag to look · Escape for controls':'Drag to orbit · Scroll to zoom'):panorama ? 'Drag to look · Scroll or pinch to zoom' : walking ? 'WASD or arrow keys to walk · Click scene for mouse look · Aim at a hotspot and click · Escape releases mouse for controls · Drag to look on touch · Hold buttons to move' : 'Click viewport, then WASD / arrows to move · Drag to orbit · Scroll to zoom · Right-drag to pan'}</p>
    {popup && <dialog ref={dialog} className="info-popup" aria-label={popup.title} onCancel={()=>setPopup(null)}>
      <button autoFocus className="secondary" onClick={()=>setPopup(null)}>Close information</button><h3>{popup.title}</h3>
      <p className="plain-description">{popup.description}</p>
      {popup.image_asset_id && !imageURL && !imageError && <p role="status">Loading image…</p>}
      {imageURL && <img src={imageURL} alt={popup.title} onError={()=>setImageError('Image unavailable. Close and reopen to retry.')} />}
      {imageError && <p role="alert">{imageError}</p>}
      {popup.external_link && <a href={popup.external_link} target="_blank" rel="noopener noreferrer">Open external link</a>}
    </dialog>}
    {hotspotError && <p className="error" role="alert">Hotspots: {hotspotError} <button onClick={() => setHotspotAttempt(n => n + 1)}>Retry hotspots</button></p>}
    {!panorama&&walkingConfig.portals.length>0&&<section aria-label="Exits"><p>Exits require a click. Walk near the exit; Escape releases mouse capture to use its button.</p>{walkingConfig.portals.map(p=><button key={p.id} disabled={!walking||!nearby.includes(p.id)||exitBusy||!!popup||layoutDirty||settingsDirty} onClick={()=>void activatePortal(p)}>Click to {p.label}</button>)}</section>}
    </div>
    <aside id={preview?'visitor-hotspots':undefined} hidden={preview&&!directoryOpen} className={preview?'visitor-directory':'editor-inspector'} aria-label={preview?'Explore scene':'Scene inspector'} onKeyDown={event=>{if(preview&&event.key==='Escape'){setDirectoryOpen(false);panel.current?.querySelector<HTMLButtonElement>('[aria-controls="visitor-hotspots"]')?.focus();}}}>
    {preview&&<div className="visitor-directory-heading"><span>Explore this space</span><button className="secondary" aria-label="Close hotspot list" onClick={()=>{setDirectoryOpen(false);panel.current?.querySelector<HTMLButtonElement>('[aria-controls="visitor-hotspots"]')?.focus();}}>✕</button></div>}
    {!preview && <div className="inspector-heading"><h2>Inspector</h2><span>{scene.type==='LAYOUT'?'Layout':panorama?'Panorama':splat?'Gaussian splat':'Model'}</span></div>}
    {!preview && <nav className="inspector-sections" role="tablist" aria-label="Inspector sections">{[...(scene.type==='LAYOUT'?[['plan','Plan']]:[]),['hotspots','Hotspots'],...(!panorama?splat?[['appearance','Capture'],...(splatSupport.walking?[['walking','Walking']]:[])]:[['walking','Walking'],['materials','Materials'],['partition','Partition'],['appearance','Appearance']]:[])].map(([id,label])=><button key={id} id={`tab-${id}`} role="tab" aria-selected={tool===id} tabIndex={tool===id?0:-1} onKeyDown={e=>{const tabs=Array.from(e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));const index=tabs.indexOf(e.currentTarget);const next=e.key==='ArrowRight'?(index+1)%tabs.length:e.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:-1;if(next>=0){e.preventDefault();tabs[next].click();tabs[next].focus();}}} aria-controls={`panel-${id}`} className="secondary" onClick={()=>chooseTool(id)}>{label}</button>)}</nav>}
    <div id="panel-plan" role="tabpanel" aria-labelledby="tab-plan" hidden={preview||tool!=='plan'}>

    {!preview && scene.type==='LAYOUT' && <LayoutEditor key={scene.layout_revision} document={layoutDocument} onChange={setLayoutDocument} onSave={saveLayout} dirty={layoutDirty} busy={saving||linkBusy} assets={assets} attached={attached} surfaces={modelInfo?.surfaces||[]} selection={selectedElement} onSelection={setSelectedElement} onQuickAdd={bindQuickRoom} />}
    </div>
    <div id="panel-hotspots" role={preview?undefined:'tabpanel'} aria-labelledby={preview?undefined:'tab-hotspots'} hidden={!preview&&tool!=='hotspots'}>
    {!preview && <section className="navigation-panel properties-panel"><h3>Hotspot properties</h3>
      <p>Save appearance/model settings before editing hotspots. Builder markers select a hotspot for editing. Test hotspot opens the visitor action.</p>
      <label><input type="checkbox" checked={reveal} onChange={event => setReveal(event.target.checked)} /> Reveal hidden hotspots (builder only)</label>
      <button disabled={linkBusy} onClick={newHotspot}>New hotspot</button>
      <fieldset disabled={linkBusy || settingsDirty || layoutDirty}><label>Hotspot type<select aria-label="Hotspot type" value={kind} onChange={e=>{setKind(e.target.value as 'INFO'|'NAVIGATION');setPlacing(false);}}><option value="INFO">Information / artwork</option><option value="NAVIGATION">Navigation</option></select></label>
      <label>Title<input value={title} maxLength={120} onChange={e=>setTitle(e.target.value)} /></label>
      {kind==='NAVIGATION' ? <label>Destination scene<select aria-label="Destination scene" value={destination} onChange={e=>setDestination(e.target.value)}><option value="">Choose a destination</option>{scenes.filter(s=>s.id!==scene.id).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : <>
        <label>Description<textarea value={description} maxLength={5000} onChange={e=>setDescription(e.target.value)} /></label>
        <label>Image (optional)<select aria-label="Image (optional)" value={image} onChange={e=>setImage(e.target.value)}><option value="">No image</option>{assets.filter(a=>a.file_type==='IMAGE' && a.upload_status==='ready').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>External link (optional)<input type="url" value={externalLink} maxLength={2048} placeholder="https://…" onChange={e=>setExternalLink(e.target.value)} /></label>
      </>}
      {scene.type==='LAYOUT' && position && 'x' in position && <label>Hotspot attachment<select aria-label="Hotspot attachment" value={position.attachment?.element_id||''} onChange={event=>{const {attachment,...p}=position;const e=layoutDocument.elements.find(e=>e.id===event.target.value);setPosition(e?{...p,attachment:attachPoint(e,p)}:p);setDirty(true);}}><option value="">Keep at world position</option>{layoutDocument.elements.map(e=><option key={e.id} value={e.id}>Move with {e.name}</option>)}</select></label>}
      {layoutDirty && <p>Save the layout before editing hotspots or saving a start view.</p>}
      {splat && <><p>Markers appear when inside the camera view. Capture walls do not hide them. Set explicit world coordinates; splats do not provide a mesh surface for placement.</p>
        {(['X','Y','Z'] as const).map((axis,i)=><NumericInput key={axis} label={`Hotspot position ${axis} (m)`} value={position&&'x'in position?[position.x,position.y,position.z][i]:0} min={-1e6} max={1e6} onChange={value=>{const p=position&&'x'in position?{x:position.x,y:position.y,z:position.z}:{x:0,y:0,z:0};p[(['x','y','z'] as const)[i]]=value;setPosition(p);setDirty(true);}}/>)}
        <button disabled={!actions||!hotspotsReady} onClick={()=>{const view=actions?.view();if(!view||!('position'in view))return;const {yaw,pitch}=view;setPosition({x:view.position[0]-Math.sin(yaw)*Math.cos(pitch)*2,y:view.position[1]+Math.sin(pitch)*2,z:view.position[2]-Math.cos(yaw)*Math.cos(pitch)*2});setDirty(true);}}>Place 2 m in front of camera</button>
      </>}
      {!splat && <button disabled={!actions || !hotspotsReady} onClick={()=>{stop();setWalking(false);setHover(null);setPlacing(p=>!p);}}>{placing?'Cancel placement':position?'Reposition hotspot':'Place hotspot'}</button>}
      {placing && <p role="status">Click a {panorama?'point in the panorama':'model surface'} to set the position, then Save hotspot. Drag to inspect without placing.</p>}
      {position && <p role="status">{dirty ? 'Unsaved placement — click Save hotspot.' : 'Saved hotspot selected.'}</p>}
      <button disabled={!position || !title.trim() || (kind==='NAVIGATION' && !destination) || placing} onClick={saveHotspot}>{linkBusy?'Saving…':'Save hotspot'}</button>
      {editing && <button className="secondary" onClick={()=>removeHotspot(editing)}>Delete hotspot</button>}
      </fieldset>
    </section>}
    <div className="hotspot-directory" aria-label="Hotspot list"><h3>{preview ? 'Explore hotspots' : 'Saved hotspots'}</h3>
      {!hotspotsReady && !hotspotError && <p role="status">Loading hotspots…</p>}
      {hotspotsReady && !hotspots.length && <p>No hotspots yet.{!preview && ' Try an Information hotspot titled “Lobby artwork”: place it on a wall, Save hotspot, then Test hotspot.'}</p>}
      <ul className="navigation-links">{displayHotspots.map(h => <li key={h.id}><strong>{h.type === 'INFO' ? 'ⓘ' : '↗'} {h.title}</strong>
        {!preview && <button disabled={linkBusy} onClick={() => edit(h)} aria-pressed={editing === h.id}>Edit</button>}
        <button disabled={!actions || linkBusy} onClick={() => showHotspot(h)}>Show hotspot</button>
        <button disabled={linkBusy} onClick={() => testHotspot(h)}>{preview ? h.type === 'INFO' ? 'Open information' : 'Go to scene' : 'Test hotspot'}</button>
      </li>)}</ul>
    </div>
    </div>
    <div id="panel-walking" role="tabpanel" aria-labelledby="tab-walking" hidden={preview||tool!=='walking'}>
    {!preview&&!panorama&&!splat&&<div className="walking-guide"><h3>{modelInfo?.walkable?'Ready to walk':'Set up a walking area'}</h3><p>{scene.type==='LAYOUT'?'Generated room floors are approved automatically. For imported rooms, select each module in Plan and choose its floor meshes. Save, walk with WASD, then save the starting view.':'1. Add a region. 2. Select its structural floor meshes and check the height range. 3. Save changes, then Walk inside.'}</p><button disabled={!actions||saving} onClick={()=>void toggleWalking()}>{walking?'Stop walking test':modelInfo?.walkable?'Test walking':'Check walking setup'}</button></div>}
    {!preview&&splat&&splatSupport.walking&&tool==='walking'&&<SplatProxyPanel settings={settings} assets={assets} onChange={setSettings} overlay={proxyOverlay} onOverlay={setProxyOverlay} busy={saving||linkBusy} dirty={settingsDirty}/>}
    {!preview&&!panorama&&(!splat||splatSupport.walking)&&<WalkingPanel scene={draftScene} scenes={draftScenes} config={walkingConfig} onChange={navigation=>scene.type==='LAYOUT'?setLayoutDocument({...layoutDocument,navigation}):setSettings({...settings,navigation})} info={modelInfo} busy={saving||linkBusy||exitBusy} current={()=>{const v=walking&&actions?.view();return v&&'position'in v?v:undefined;}}/>}
    </div>
    <div id="panel-materials" role="tabpanel" aria-labelledby="tab-materials" hidden={preview||tool!=='materials'}>
    {!preview && !panorama && !splat && <MaterialEditor bakeRevision={bakeKey} presets={presets} assets={assets} busy={saving||linkBusy} targets={materialTargets()} onChange={materials=>scene.type==='LAYOUT'?setLayoutDocument({...layoutDocument,materials}):setSettings({...settings,materials})} onAssign={assignMaterial} />}
    </div>
    <div id="panel-partition" role="tabpanel" aria-labelledby="tab-partition" hidden={preview||tool!=='partition'}>
    {!preview&&!panorama&&!splat&&tool==='partition'&&(scene.type==='3D'&&scene.asset_id?<PartitionInspector key={scene.asset_id} assetId={scene.asset_id} transform={modelMatrix(settings.model)}/>:<>
     <label>Imported parent asset<select aria-label="Partition parent asset" value={partitionAsset} onChange={e=>setPartitionAsset(e.target.value)}><option value="">Choose an imported asset</option>{[...new Set(layoutDocument.elements.filter(e=>e.kind==='INSTANCE'&&e.asset_id).map(e=>e.asset_id!))].map(id=><option key={id} value={id}>{assets.find(a=>a.id===id)?.name||id}</option>)}</select></label>
     <p>Generated rooms retain their existing template ownership. A parent partition applies to every placement of that asset; it does not change instance room assignments.</p>
     {partitionAsset&&(()=>{const e=layoutDocument.elements.find(e=>e.asset_id===partitionAsset);return e?<PartitionInspector key={partitionAsset} assetId={partitionAsset} transform={new Matrix4().makeTranslation(e.x,0,e.z).multiply(modelMatrix({scale:e.scale,rotation:e.rotation,up_axis:'Y'}))}/>:null;})()}
    </>)}
    </div>
    <div id="panel-appearance" role="tabpanel" aria-labelledby="tab-appearance" hidden={preview||tool!=='appearance'}>

    {!preview && splat && <SplatSettingsPanel settings={settings} onChange={setSettings} onSave={saveSettings} busy={saving||linkBusy} dirty={settingsDirty}/>}
    {!preview && !panorama && !splat && <SceneSettingsPanel layout={scene.type==='LAYOUT'} settings={settings} onChange={setSettings} onSave={saveSettings} busy={saving || linkBusy} dirty={settingsDirty} info={modelInfo} />}


    </div>
    </aside>
  </section>;
}

function ImportedControls(props:React.ComponentProps<typeof WalkControls>){
 return props.streaming&&supportsChunkStreaming(resolveAssetSource(props.url)?.response)?<StreamingSceneControls {...props}/>:<WalkControls {...props}/>;
}
