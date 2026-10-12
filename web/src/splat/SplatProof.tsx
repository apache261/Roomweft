import {useEffect,useState,useRef} from 'react';
import {Canvas,useFrame,useThree} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import {createSplat} from './driver.js';
import {validateSplatBytes} from './profile';
function Capture({bytes,report}:{bytes:ArrayBuffer;report:(value:Record<string,number>)=>void}) {
  const {gl,scene,camera,invalidate}=useThree();
  const driver=useRef<ReturnType<typeof createSplat>>(undefined);
  useEffect(()=>{
    const start=performance.now();let first=true;
    const resource=createSplat(bytes,gl,invalidate,()=>{if(first){first=false;report({count:resource.count,sourceBytes:bytes.byteLength,firstSortMs:performance.now()-start,cpuEstimate:resource.cpuBytes,gpuEstimate:resource.gpuBytes});}});
    scene.add(resource.mesh);driver.current=resource;invalidate();
    return ()=>{scene.remove(resource.mesh);resource.dispose();driver.current=undefined;};
  },[bytes,gl,scene,invalidate,report]);
  useFrame(()=>driver.current?.update(camera));
  return null;
}
const report=(value:Record<string,number>)=>{(window as unknown as {splatBaseline:unknown}).splatBaseline=value;};
export default function SplatProof(){
  const [bytes,setBytes]=useState<ArrayBuffer>(),[error,setError]=useState(''),[fixture,setFixture]=useState('small'),[mounted,setMounted]=useState(true),[epoch,setEpoch]=useState(0);
  useEffect(()=>{const abort=new AbortController();setBytes(undefined);setError('');fetch(`/splat-fixtures/${fixture}.splat`,{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error('Fixture unavailable');return r.arrayBuffer();}).then(b=>{validateSplatBytes(b);setBytes(b);}).catch(e=>{if(!abort.signal.aborted)setError(String(e));});return()=>abort.abort();},[fixture]);
  return <main><h1>Gaussian splat feasibility</h1><p>Generated fixtures; orbit to inspect sorting and opaque depth composition. Context restoration rebuilds owned resources.</p><select aria-label="Fixture" value={fixture} onChange={e=>setFixture(e.target.value)}><option value="small">Small capture</option><option value="indoor">Generated indoor room</option></select><button onClick={()=>setMounted(v=>!v)}>Toggle capture</button><button onClick={()=>setEpoch(v=>v+1)}>Rebuild renderer</button>{error&&<p role="alert">{error}</p>}<div style={{height:600}}><Canvas key={epoch} frameloop="demand" camera={{position:[4,3,6]}} gl={{antialias:false}} onCreated={({gl})=>{gl.domElement.addEventListener('webglcontextrestored',()=>setEpoch(v=>v+1),{once:true});}}><color attach="background" args={['#202838']}/><OrbitControls makeDefault enableDamping={false}/>{mounted&&bytes&&<Capture bytes={bytes} report={report}/>}<mesh position={[0,0,0]}><boxGeometry args={[.6,.6,.6]}/><meshBasicMaterial color="#ffcc00"/></mesh></Canvas></div></main>;
}
