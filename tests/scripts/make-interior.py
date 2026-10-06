"""Generate small, self-contained textured fixtures; no external asset downloads."""
import json, struct, zlib, binascii
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'testdata'
def png_texture():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', binascii.crc32(kind + data) & 0xffffffff)
    pixels = bytearray()
    for y in range(64):
        pixels.append(0)
        for x in range(64):
            grout = x % 16 < 1 or y % 16 < 1
            c = (88, 91, 94) if grout else ((183, 169, 145) if (x // 16 + y // 16) % 2 else (210, 200, 178))
            pixels.extend(c)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 64, 64, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')

# Six box faces have independent normals and UV coordinates.
positions, normals, uvs, indices = [], [], [], []
for normal, corners in [
    ((0,0,1), [(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]),
    ((0,0,-1), [(1,-1,-1),(-1,-1,-1),(-1,1,-1),(1,1,-1)]),
    ((1,0,0), [(1,-1,1),(1,-1,-1),(1,1,-1),(1,1,1)]),
    ((-1,0,0), [(-1,-1,-1),(-1,-1,1),(-1,1,1),(-1,1,-1)]),
    ((0,1,0), [(-1,1,1),(1,1,1),(1,1,-1),(-1,1,-1)]),
    ((0,-1,0), [(-1,-1,-1),(1,-1,-1),(1,-1,1),(-1,-1,1)]),
]:
    offset = len(positions) // 3
    for p, uv in zip(corners, [(0,0),(1,0),(1,1),(0,1)]):
        positions.extend(p); normals.extend(normal); uvs.extend(uv)
    indices.extend(offset+i for i in [0,1,2,0,2,3])

binary = bytearray(); views = []
def buffer(data, target=None):
    while len(binary) % 4: binary.append(0)
    view = {'buffer':0, 'byteOffset':len(binary), 'byteLength':len(data)}
    if target: view['target'] = target
    views.append(view); binary.extend(data); return len(views)-1
vp = buffer(struct.pack('<'+'f'*len(positions), *positions), 34962)
vn = buffer(struct.pack('<'+'f'*len(normals), *normals), 34962)
vu = buffer(struct.pack('<'+'f'*len(uvs), *uvs), 34962)
vi = buffer(struct.pack('<'+'H'*len(indices), *indices), 34963)
image_view = buffer(png_texture())
materials = [
    {'name':'Warm tiled floor', 'pbrMetallicRoughness':{'baseColorTexture':{'index':0}, 'metallicFactor':0, 'roughnessFactor':0.8}},
    {'name':'Neutral wall', 'pbrMetallicRoughness':{'baseColorFactor':[0.75,0.79,0.81,1], 'metallicFactor':0, 'roughnessFactor':0.9}},
    {'name':'Red artwork', 'pbrMetallicRoughness':{'baseColorFactor':[0.8,0.03,0.03,1], 'metallicFactor':0, 'roughnessFactor':0.6}},
    {'name':'Blue artwork', 'pbrMetallicRoughness':{'baseColorFactor':[0.02,0.12,0.8,1], 'metallicFactor':0, 'roughnessFactor':0.6}},
]
nodes = []
def box(name, center, half, material=1):
    nodes.append({'name':name, 'mesh':material, 'translation':center, 'scale':half})
box('Lobby and rooms floor', [0,0,0], [4,0.1,5], 0)
box('Back wall', [0,1.5,-4.9], [4,1.5,0.1])
box('Left wall', [-3.9,1.5,0], [0.1,1.5,5])
box('Right wall', [3.9,1.5,0], [0.1,1.5,5])
box('Front left', [-2.6,1.5,4.9], [1.4,1.5,0.1])
box('Front right', [2.6,1.5,4.9], [1.4,1.5,0.1])
box('Entrance lintel', [0,2.7,4.9], [1.2,0.3,0.1])
# Two open doorways from the lobby into rooms at the rear.
for x, width in [(-3.6,0.4),(0,1.2),(3.6,0.4)]: box('Room wall', [x,1.5,-1], [width,1.5,0.1])
box('Door lintels', [0,2.7,-1], [4,0.3,0.1])
box('Room divider', [0,1.5,-3], [0.1,1.5,2])
box('Red lobby artwork', [-0.6,1.75,-0.86], [0.45,0.5,0.04], 2)
box('Blue lobby artwork', [0.6,1.75,-0.86], [0.45,0.5,0.04], 3)
box('Roof', [0,3.15,0], [4.1,0.15,5.1])
model = {
 'asset':{'version':'2.0','generator':'Virtual Tour Studio procedural fixture'},
 'scene':0, 'scenes':[{'nodes':list(range(len(nodes)))}], 'nodes':nodes,
 'meshes':[{'primitives':[{'attributes':{'POSITION':0,'NORMAL':1,'TEXCOORD_0':2},'indices':3,'material':i}]} for i in range(len(materials))],
 'materials':materials, 'textures':[{'source':0,'sampler':0}], 'samplers':[{'wrapS':10497,'wrapT':10497}],
 'images':[{'bufferView':image_view,'mimeType':'image/png'}],
 'accessors':[{'bufferView':vp,'componentType':5126,'count':24,'type':'VEC3','min':[-1,-1,-1],'max':[1,1,1]},
              {'bufferView':vn,'componentType':5126,'count':24,'type':'VEC3'},
              {'bufferView':vu,'componentType':5126,'count':24,'type':'VEC2'},
              {'bufferView':vi,'componentType':5123,'count':36,'type':'SCALAR'}],
 'bufferViews':views, 'buffers':[{'byteLength':len(binary)}],
}
def write(name, document):
    data=json.dumps(document,separators=(',',':')).encode(); data+=b' ' * (-len(data)%4)
    body=bytes(binary)+b'\0'*(-len(binary)%4)
    glb=struct.pack('<III',0x46546c67,2,28+len(data)+len(body))+struct.pack('<II',len(data),0x4e4f534a)+data+struct.pack('<II',len(body),0x004e4942)+body
    (root/name).write_bytes(glb)
write('textured-interior.glb', model)
# A reusable furniture fixture: tabletop and four legs share the same box geometry and embedded texture.
import copy
furniture = copy.deepcopy(model)
furniture['nodes'] = [
    {'name':'Tabletop','mesh':0,'translation':[0,0.8,0],'scale':[0.8,0.06,0.4]},
    *[{'name':'Table leg','mesh':0,'translation':[x,0.37,z],'scale':[0.06,0.37,0.06]} for x in [-0.65,0.65] for z in [-0.25,0.25]],
]
furniture['scenes'][0]['nodes'] = list(range(5))
write('layout-table.glb', furniture)
# A deliberately nonstandard centimetre/Z-up export for preparation checks.
model['nodes'].append({'name':'Centimetres Z up', 'children':list(range(len(nodes))), 'scale':[100,100,100], 'rotation':[0.7071067811865476,0,0,0.7071067811865476]})
model['scenes'][0]['nodes']=[len(model['nodes'])-1]
write('textured-interior-cm-z.glb', model)
