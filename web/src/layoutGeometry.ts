import { navigationSettings } from './navigationSettings.ts';
import { tiledMaterial, type Surface } from './materials.ts';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, type AnimationClip, type Texture, type Object3D } from 'three';
import { bounds, isRoom, sharedEdge, type LayoutDocument } from './layout.ts';
import { defaultSettings, prepareModel } from './sceneSettings.ts';

// Wall intervals are unioned before meshing; shared room edges never produce duplicate walls.
export function buildLayout(doc:LayoutDocument,sources:Map<string,Object3D>=new Map(),textures:Map<string,Texture>=new Map(),animations:Map<string,AnimationClip[]>=new Map(),blockedRooms:Set<string>=new Set()) {
  const importedRegions:import('./navigationSettings').WalkRegion[]=[];
  const root=new Group(), geometries:BoxGeometry[]=[],materials:MeshStandardMaterial[]=[],instances:ReturnType<typeof prepareModel>[]=[];
  const tiled:ReturnType<typeof tiledMaterial>[]=[],surfaces:Surface[]=[];
 const preset=(id?:string)=>doc.materials?.find(p=>p.id===id);
 const box=(id:string,position:number[],size:number[],color:string,roughness=0.85,materialId?:string,wallAxis?:string)=>{
    const geometry=new BoxGeometry(size[0],size[1],size[2]),material=new MeshStandardMaterial({color,roughness});geometries.push(geometry);materials.push(material);
    // Template UV coordinates are measured in metres, anchored in world space.
    // Each box face gets a planar mapping; wall faces share height and seam origin.
    const uv=geometry.getAttribute('uv'),pos=geometry.getAttribute('position'),normal=geometry.getAttribute('normal');
    for(let i=0;i<uv.count;i++){const x=pos.getX(i)+position[0],y=pos.getY(i)+position[1],z=pos.getZ(i)+position[2];if(Math.abs(normal.getY(i))>0.5)uv.setXY(i,x,z);else uv.setXY(i,Math.abs(normal.getX(i))>0.5?z:x,y);}
    const p=preset(materialId),result=p?tiledMaterial(p,textures):null;if(result)tiled.push(result);
    const mesh=new Mesh<BoxGeometry,MeshStandardMaterial|MeshStandardMaterial[]>(geometry,result?.material||material);mesh.userData.surfaceKind=wallAxis?'wall':'floor';mesh.userData.walkFloor=!wallAxis;mesh.position.set(position[0],position[1],position[2]);mesh.userData.layoutElement=id;mesh.userData.roomIds=isRoom(doc.elements.find(e=>e.id===id)!)?[id]:[];root.add(mesh);return mesh;
  };
  type Edge={axis:'x'|'z';line:number;start:number;end:number;height:number;id:string;color:string;roughness:number;materialId?:string};
  const groups=new Map<string,Edge[]>();
  const add=(edge:Edge)=>{const key=`${edge.axis}:${Math.round(edge.line*1e5)}`;groups.set(key,[...(groups.get(key)||[]),edge]);};
  for(const e of doc.elements) {
    if(e.kind==='INSTANCE') {
      const source=e.asset_id && sources.get(e.asset_id);if(!source)continue;
      const prepared=prepareModel(source,{...defaultSettings,model:{scale:e.scale,rotation:e.rotation,up_axis:'Y'},appearance:{...defaultSettings.appearance,tint:e.tint,roughness:e.roughness},materials:doc.materials,surface_materials:e.mesh_materials},textures,animations.get(e.asset_id!));
      const group=new Group();group.position.set(e.x,0,e.z);group.userData.layoutElement=e.id;group.userData.roomIds=e.room_id?[e.room_id]:[];group.userData.collidable=e.collidable;group.add(prepared.root);root.add(group);root.updateMatrixWorld(true);
      const room=doc.elements.find(r=>r.id===e.room_id);
      if(prepared.hasAnimations)group.userData.roomIds=[];
      if(room){const b=bounds(room),actual=new Box3().setFromObject(group);if(actual.min.x<b.left||actual.max.x>b.right||actual.min.z<b.top||actual.max.z>b.bottom||actual.min.y<-.01||actual.max.y>room.height)group.userData.roomIds=[];}
      const approved=new Set(e.floor_meshes||[]),floorBoxes:Box3[]=[];
      prepared.root.traverse(o=>{if(!(o instanceof Mesh))return;const box=new Box3().setFromObject(o),surface=prepared.surfaces.find(s=>s.path===o.userData.materialPath);if(surface)surfaces.push({...surface,elementId:e.id,bounds:{min:box.min.toArray(),max:box.max.toArray()}});if(e.collidable&&approved.has(o.userData.materialPath)){o.userData.walkFloor=true;floorBoxes.push(box);}});
      if(floorBoxes.length){const area=new Box3();floorBoxes.forEach(b=>area.union(b));importedRegions.push({id:e.id,name:e.name,left:area.min.x,right:area.max.x,top:area.min.z,bottom:area.max.z,min_y:Math.min(...floorBoxes.map(b=>b.max.y))-.01,max_y:Math.max(...floorBoxes.map(b=>b.max.y))+.01});}
      instances.push(prepared);continue;
    }
    const b=bounds(e);
    if(e.kind==='FLOOR'||isRoom(e)) {const thickness=e.kind==='FLOOR'?e.height:0.2;box(e.id,[e.x,-thickness/2,e.z],[b.right-b.left,thickness,b.bottom-b.top],e.tint || (e.kind==='LOBBY'?'#bcb4a3':e.kind==='CORRIDOR'?'#b7c2cb':'#c6af90'),e.roughness??0.85,e.floor_material);}
    if(e.kind==='WALL') {const axis=Math.abs(e.rotation)%180===90?'z':'x';add({axis,line:axis==='x'?e.z:e.x,start:axis==='x'?b.left:b.top,end:axis==='x'?b.right:b.bottom,height:e.height,id:e.id,color:e.tint||'#ede9df',roughness:e.roughness??0.85,materialId:e.wall_material});}
    if(isRoom(e)) {
      const color='#ede9df';for(const line of [b.top,b.bottom])add({axis:'x',line,start:b.left,end:b.right,height:e.height,id:e.id,color,roughness:0.85,materialId:e.wall_material});for(const line of [b.left,b.right])add({axis:'z',line,start:b.top,end:b.bottom,height:e.height,id:e.id,color,roughness:0.85,materialId:e.wall_material});
    }
  }
  for(const edges of groups.values()) {
    const reference=edges[0];
    const openings=doc.doors.flatMap(d=>{const a=doc.elements.find(e=>e.id===d.a),b=doc.elements.find(e=>e.id===d.b),edge=a&&b?sharedEdge(a,b):null;return edge && edge.axis===reference.axis && Math.abs(edge.line-reference.line)<1e-5?[d]:[];});
    const points=[...new Set([...edges.flatMap(e=>[e.start,e.end]),...openings.flatMap(d=>[d.at-d.width/2,d.at+d.width/2])])].sort((a,b)=>a-b);
    for(let i=1;i<points.length;i++) {
      const start=points[i-1],end=points[i],mid=(start+end)/2,cover=edges.filter(e=>mid>e.start-1e-5&&mid<e.end+1e-5);if(!cover.length || end-start<1e-5)continue;
      const height=Math.max(...cover.map(e=>e.height)),opening=openings.find(d=>mid>d.at-d.width/2&&mid<d.at+d.width/2),bottom=opening?.height||0;if(height-bottom<1e-5)continue;
      const e=cover[0];
      const wall=box(e.id,reference.axis==='x'?[mid,(height+bottom)/2,reference.line]:[reference.line,(height+bottom)/2,mid],reference.axis==='x'?[end-start,height-bottom,0.12]:[0.12,height-bottom,end-start],e.color,e.roughness,e.materialId,reference.axis);
      wall.userData.roomIds=cover.filter(e=>isRoom(doc.elements.find(r=>r.id===e.id)!)).map(e=>e.id);
      // A unioned wall has one collision mesh but independently finished room sides.
      const faceMaterials=Array<MeshStandardMaterial>(6).fill(wall.material as MeshStandardMaterial);
      for(const side of cover){const room=doc.elements.find(r=>r.id===side.id);if(!room||!isRoom(room))continue;const p=preset(side.materialId);const result=p?tiledMaterial(p,textures):{material:new MeshStandardMaterial({color:side.color,roughness:side.roughness}),dispose(){this.material.dispose();}};tiled.push(result);const positive=reference.axis==='x'?room.z>reference.line:room.x>reference.line;faceMaterials[reference.axis==='x'?(positive?4:5):(positive?0:1)]=result.material;}
      wall.material=faceMaterials;
    }
  }
  // Collision derives from these exact visual meshes. Template floors and explicitly approved module floors define standing regions.
  root.userData.walkRegions=[...importedRegions,...doc.elements.filter(e=>isRoom(e)||e.kind==='FLOOR').map(e=>({...bounds(e),id:e.id,name:e.name,min_y:-0.01,max_y:0.01,exterior:!!e.exterior}))];
 root.userData.blockedRooms=doc.elements.filter(e=>blockedRooms.has(e.id)).map(e=>({...bounds(e),id:e.id}));
 root.userData.navigation=navigationSettings(doc.navigation);
  root.userData.walkStarts=doc.elements.filter(e=>(isRoom(e)||e.kind==='FLOOR')&&!e.exterior).sort((a,b)=>Number(b.kind==='LOBBY')-Number(a.kind==='LOBBY')).map(e=>[e.x,1.65,e.z]);
  root.userData.runtimeGeometryRevision=JSON.stringify(doc);
  root.updateMatrixWorld(true);
  return {root,surfaces,hasAnimations:instances.some(i=>i.hasAnimations),updateAnimations:(seconds:number)=>instances.forEach(i=>i.updateAnimations(seconds)),dispose:()=>{geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());instances.forEach(i=>i.dispose());tiled.forEach(m=>m.dispose());}};
}
