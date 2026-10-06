// Opt-in intact-triangle partitioning. No cutting, interpolation or centroid-
// based bounds: actual vertices define each output's conservative bounds.
export function triangleCells(tagged,nodes,owners,groups,size,tagKey){
 if(!Number.isFinite(size)||size<.5||size>64)throw Error('Spatial cell size must be 0.5–64 source units');
 const result=[];
 for(const group of groups){
  const cells=new Map();
  for(const source of nodes.filter(n=>owners.get(n.path)===group.id)){
   const node=tagged.getRoot().listNodes().find(n=>n.getExtras()[tagKey]===source.source_node),primitive=node.getMesh().listPrimitives()[source.source_primitive??0];
   if(primitive.getMode()!==4||primitive.listTargets().length||primitive.listExtensions().length)throw Error('Spatial splitting requires static core triangle primitives');
   const position=primitive.getAttribute('POSITION'),indices=primitive.getIndices(),world=node.getWorldMatrix();
   for(let triangle=0;triangle<source.triangles;triangle++){
    const points=[0,1,2].map(corner=>{const p=position.getElement(indices?indices.getScalar(triangle*3+corner):triangle*3+corner,[]);return [0,1,2].map(axis=>world[axis]*p[0]+world[axis+4]*p[1]+world[axis+8]*p[2]+world[axis+12]);});
    const key=[0,1,2].map(axis=>Math.floor((Math.min(...points.map(p=>p[axis]))+Math.max(...points.map(p=>p[axis])))/2/size)).join(',');
    if(!cells.has(key))cells.set(key,new Map());const cell=cells.get(key);if(!cell.has(source.path))cell.set(source.path,[]);cell.get(source.path).push(triangle);
   }
  }
  for(const cell of cells.values())result.push({...group,id:`${group.id}-cell-${result.length}`,paths:[...cell.keys()],triangles:cell});
 }
 if(result.length>128)throw Error('Spatial split exceeds 128 cells; increase cell size');
 return result;
}
export function subsetPrimitive(doc,primitive,triangles){
 const copy=primitive.clone(),indices=primitive.getIndices(),vertices=[],remap=new Map(),local=[];
 for(const triangle of triangles)for(let corner=0;corner<3;corner++){const index=indices?indices.getScalar(triangle*3+corner):triangle*3+corner;if(!remap.has(index)){remap.set(index,vertices.length);vertices.push(index);}local.push(remap.get(index));}
 for(const semantic of primitive.listSemantics()){
  const a=primitive.getAttribute(semantic),array=a.getArray(),width=a.getElementSize(),result=new array.constructor(vertices.length*width);
  vertices.forEach((index,i)=>result.set(array.subarray(index*width,(index+1)*width),i*width));
  copy.setAttribute(semantic,a.clone().setArray(result));
 }
 copy.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(local)).setBuffer(doc.getRoot().listBuffers()[0]));return copy;
}
export function triangleRuns(triangles){const result=[];for(const triangle of triangles){const last=result.at(-1);if(last&&last.start+last.count===triangle)last.count++;else result.push({start:triangle,count:1});}return result;}
