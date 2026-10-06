"""Deterministic, self-contained Phase 0 references. No chunk products are generated."""
import argparse, hashlib, json, struct, zlib, binascii
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'testdata' / 'chunking'
ROOT.mkdir(exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--oversized', action='store_true', help='Generate a valid 256 MiB + 4 byte admission fixture (not checked in)')
args = parser.parse_args()
binary = bytearray()
views, accessors = [], []
def data(raw):
    binary.extend(b'\0' * (-len(binary) % 4))
    views.append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(raw)})
    binary.extend(raw)
    return len(views)-1

def accessor(values, kind, component=5126):
    width = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}[kind]
    fmt = {5126:'f',5123:'H',5121:'B'}[component]
    value = {'bufferView':data(struct.pack('<'+fmt*len(values), *values)), 'componentType':component, 'count':len(values)//width, 'type':kind}
    if kind == 'VEC3':
        value.update(min=[min(values[i::3]) for i in range(3)], max=[max(values[i::3]) for i in range(3)])
    accessors.append(value)
    return len(accessors)-1

positions, normals, uv, indices = [], [], [], []
for normal, corners in [((0,0,1),[(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]),((0,0,-1),[(1,-1,-1),(-1,-1,-1),(-1,1,-1),(1,1,-1)]),((1,0,0),[(1,-1,1),(1,-1,-1),(1,1,-1),(1,1,1)]),((-1,0,0),[(-1,-1,-1),(-1,-1,1),(-1,1,1),(-1,1,-1)]),((0,1,0),[(-1,1,1),(1,1,1),(1,1,-1),(-1,1,-1)]),((0,-1,0),[(-1,-1,-1),(1,-1,-1),(1,-1,1),(-1,-1,1)])]:
    offset = len(positions)//3
    for p, t in zip(corners,[(0,0),(1,0),(1,1),(0,1)]):
        positions.extend(p); normals.extend(normal); uv.extend(t)
    indices.extend(offset+i for i in [0,1,2,0,2,3])
attrs = {'POSITION':accessor(positions,'VEC3'),'NORMAL':accessor(normals,'VEC3'),'TEXCOORD_0':accessor(uv,'VEC2'), 'TEXCOORD_1':accessor(uv,'VEC2')}
idx = accessor(indices,'SCALAR',5123)
def png_chunk(kind, value):
    return struct.pack('>I',len(value))+kind+value+struct.pack('>I',binascii.crc32(kind+value)&0xffffffff)
png = b'\x89PNG\r\n\x1a\n'+png_chunk(b'IHDR',struct.pack('>IIBBBBB',2,2,8,6,0,0,0))+png_chunk(b'IDAT',zlib.compress(b'\0'+bytes([180,150,100,255])*2+b'\0'+bytes([100,150,180,255])*2))+png_chunk(b'IEND',b'')
image = data(png)
nodes = [{'name':'Building','children':[1,2,3,4,5]}, {'name':'Room A','children':[]}, {'name':'Room B','children':[]}, {'name':'Global crossing contributors','children':[]}, {'name':'Animated dependency group','children':[]}, {'name':'Open plan and window view','children':[]}]
def box(parent, name, center, half, material=0):
    n = len(nodes); nodes.append({'name':name,'mesh':material,'translation':center,'scale':half}); nodes[parent]['children'].append(n); return n
floors = []
for parent, z in [(1,0),(2,-6)]:
    floors.append(box(parent,'Reviewed floor',[0,-.1,z],[3,.1,3]))
    box(parent,'Left wall',[-3,1.5,z],[.1,1.5,3])
    box(parent,'Right wall',[3,1.5,z],[.1,1.5,3],1)
box(3,'Door left',[-2,1.5,-3],[1,1.5,.1])
box(3,'Door right',[2,1.5,-3],[1,1.5,.1])
box(3,'Door lintel',[0,2.7,-3],[1,.3,.1])
box(3,'Cross-room beam',[0,2.9,-3],[.2,.1,6])
box(2,'Back wall',[0,1.5,-9],[3,1.5,.1])
# Opening above a sill: visible but not an approved walking exit.
box(5,'Window sill',[0,.4,3],[3,.4,.1])
box(5,'Window left',[-2.5,1.9,3],[.5,1.1,.1])
box(5,'Window right',[2.5,1.9,3],[.5,1.1,.1])
box(5,'Exterior view contributor',[0,1,7],[1,1,1],1)
joint = len(nodes); nodes.append({'name':'Shared animated joint','translation':[0,2.4,-3]}); nodes[4]['children'].append(joint)
skin_node = box(4,'Skinned banner',[0,2,-3],[.5,.2,.05]); nodes[skin_node]['mesh']=2; nodes[skin_node]['skin']=0
skin_positions=[v * [.5,.2,.05][i%3] for i,v in enumerate(positions)]
nodes[skin_node]['translation']=[0,2.4,-3]; nodes[skin_node]['scale']=[1,1,1]
skin_attrs = dict(attrs, POSITION=accessor(skin_positions,'VEC3'), JOINTS_0=accessor([0,0,0,0]*24,'VEC4',5121), WEIGHTS_0=accessor([1,0,0,0]*24,'VEC4'))
times = accessor([0,1,2],'SCALAR'); accessors[times].update(min=[0],max=[2])
translations = accessor([0,2.4,-3, .1,2.4,-3, 0,2.4,-3],'VEC3')
materials = [{'name':name,'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'roughnessFactor':r,'metallicFactor':0}} for name,r in [('Shared warm texture',.8),('Shared texture alternate sampler role',.4)]]
doc = {'asset':{'version':'2.0','generator':'chunking-phase0-v1'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':nodes,'meshes':[{'primitives':[{'attributes':attrs,'indices':idx,'material':i}]} for i in range(2)]+[{'primitives':[{'attributes':skin_attrs,'indices':idx,'material':0}]}],'materials':materials,'textures':[{'source':0}],'images':[{'bufferView':image,'mimeType':'image/png'}],'skins':[{'joints':[joint]}],'animations':[{'name':'Cross-room dependency motion','samplers':[{'input':times,'output':translations,'interpolation':'LINEAR'}],'channels':[{'sampler':0,'target':{'node':joint,'path':'translation'}}]}]}
def encode(document, payload, target=None):
    document = dict(document, bufferViews=views, accessors=accessors, buffers=[{'byteLength':len(payload)}])
    metadata=json.dumps(document,separators=(',',':')).encode(); metadata+=b' '*(-len(metadata)%4)
    payload = payload+b'\0'*(-len(payload)%4)
    size=28+len(metadata)+len(payload)
    if target:
        # Sparse trailing BIN padding avoids allocating 256 MiB during generation.
        extra=target-size; document['buffers'][0]['byteLength']=len(payload)+extra
        metadata=json.dumps(document,separators=(',',':')).encode(); metadata+=b' '*(-len(metadata)%4)
        extra=target-(28+len(metadata)+len(payload))
        document['buffers'][0]['byteLength']=len(payload)+extra
        metadata=json.dumps(document,separators=(',',':')).encode(); metadata+=b' '*(-len(metadata)%4)
        return struct.pack('<III',0x46546c67,2,target)+struct.pack('<II',len(metadata),0x4e4f534a)+metadata+struct.pack('<II',target-28-len(metadata),0x004e4942)+payload
    return struct.pack('<III',0x46546c67,2,size)+struct.pack('<II',len(metadata),0x4e4f534a)+metadata+struct.pack('<II',len(payload),0x004e4942)+payload
room_bytes=encode(doc,bytes(binary)); (ROOT/'authored-rooms.glb').write_bytes(room_bytes)
# Flatten static source boxes into a single mesh. Animation stays in the room fixture.
giant_pos, giant_normal, giant_uv, giant_idx = [],[],[],[]
for n in nodes:
    if 'mesh' not in n or 'skin' in n: continue
    offset=len(giant_pos)//3
    for i in range(24):
        giant_pos.extend(positions[i*3+j]*n['scale'][j]+n['translation'][j] for j in range(3))
    giant_normal.extend(normals); giant_uv.extend(uv); giant_idx.extend(offset+i for i in indices)
gi_attrs={'POSITION':accessor(giant_pos,'VEC3'),'NORMAL':accessor(giant_normal,'VEC3'),'TEXCOORD_0':accessor(giant_uv,'VEC2'),'TEXCOORD_1':accessor(giant_uv,'VEC2')}
gi_idx=accessor(giant_idx,'SCALAR',5123)
giant = {k:v for k,v in doc.items() if k not in ['nodes','meshes','skins','animations']}
giant.update(nodes=[{'name':'One giant static mesh','mesh':0}],meshes=[{'primitives':[{'attributes':gi_attrs,'indices':gi_idx,'material':0}]}])
giant_bytes=encode(giant,bytes(binary)); (ROOT/'giant-static.glb').write_bytes(giant_bytes)
if args.oversized:
    target=256*1024*1024+4
    with (ROOT/'over-admission.glb').open('wb') as f:
        f.write(encode(giant,bytes(binary),target)); f.truncate(target)
manifest={'version':1,'coordinates':'source-space','fixtures':[{'file':name,'bytes':len(value),'sha256':hashlib.sha256(value).hexdigest()} for name,value in [('authored-rooms.glb',room_bytes),('giant-static.glb',giant_bytes)]], 'reviewedFloorPaths':['0/0/0/0','0/0/1/0'], 'giantReviewedFloorPaths':['0/0'], 'start':{'position':[0,1.65,0],'yaw':0,'pitch':0}, 'tourRoute':[[0,1.65,0],[0,1.65,-2],[0,1.65,-4],[0,1.65,-6],[0,1.65,-4],[0,1.65,-2],[0,1.65,0]], 'visibilityOpening':{'center':[0,1.9,3],'walkingExit':False}, 'explicitExit':{'from':'room-a','to':'room-b','center':[0,0,-3],'width':2}, 'oversized':{'file':'over-admission.glb','bytes':256*1024*1024+4,'generatedOnDemand':True,'expected':'processor rejects before download; original descriptor remains usable'}}
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Generated Phase 0 reference GLBs and manifest in',ROOT)
