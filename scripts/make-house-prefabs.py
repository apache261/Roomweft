"""Generate original, low-poly practice GLBs using only Python's standard library."""
import copy
import json
import math
import struct
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'assets/prefabs/practice-house'
OUT.mkdir(parents=True, exist_ok=True)

# A UV-mapped unit cube; shared geometry keeps every file small.
positions, normals, uvs, indices = [], [], [], []
for normal, corners in [
    ((0, 0, 1), [(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]),
    ((0, 0,-1), [(1,-1,-1),(-1,-1,-1),(-1,1,-1),(1,1,-1)]),
    ((1, 0, 0), [(1,-1,1),(1,-1,-1),(1,1,-1),(1,1,1)]),
    ((-1,0, 0), [(-1,-1,-1),(-1,-1,1),(-1,1,1),(-1,1,-1)]),
    ((0, 1, 0), [(-1,1,1),(1,1,1),(1,1,-1),(-1,1,-1)]),
    ((0,-1, 0), [(-1,-1,-1),(1,-1,-1),(1,-1,1),(-1,-1,1)]),
]:
    offset = len(positions) // 3
    for point, uv in zip(corners, [(0,0),(1,0),(1,1),(0,1)]):
        positions.extend(point)
        normals.extend(normal)
        uvs.extend(uv)
    indices.extend(offset + i for i in [0,1,2,0,2,3])

binary, views = bytearray(), []
def buffer(values, fmt, target):
    binary.extend(b'\0' * (-len(binary) % 4))
    data = struct.pack('<' + fmt * len(values), *values)
    views.append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data),'target':target})
    binary.extend(data)
    return len(views) - 1

vp, vn, vu, vi = (buffer(positions,'f',34962), buffer(normals,'f',34962),
                  buffer(uvs,'f',34962), buffer(indices,'H',34963))
def linear_color(hex_color):
    # glTF factors are linear, while these design colors are sRGB. Converting
    # avoids the washed-out appearance of putting display colors in glTF directly.
    channels = [int(hex_color[i:i+2],16)/255 for i in (1,3,5)]
    return [c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4 for c in channels] + [1]

palette = [
    ('Warm neutral walls','#b8ad9c'), ('Lobby oak floor','#94704e'),
    ('Room 1 slate floor','#607586'), ('Room 2 sage floor','#6e8065'),
    ('Kitchen clay floor','#ac805d'), ('CR teal floor','#598583'),
    ('Walnut furniture','#654632'), ('Warm ceramic','#d7d1c5'),
    ('Room 1 blue bedding','#59768a'), ('Graphite appliances','#424c53'),
    ('Lobby warm sand walls','#b8a38a'), ('Room 1 dusty blue walls','#8da5b3'),
    ('Room 2 sage walls','#9eaf94'), ('Kitchen muted olive walls','#a4ae93'),
    ('CR mist teal walls','#8eb1ab'), ('Room 2 sage bedding','#70876a'),
    ('Kitchen sage cabinets','#61765e'), ('Charcoal countertop','#555c5b'),
]
base = {
    'asset':{'version':'2.0','generator':'Original practice house prefab generator'},
    'scene':0, 'scenes':[{'nodes':[]}], 'nodes':[],
    'meshes':[{'name':name,'primitives':[{'attributes':{'POSITION':0,'NORMAL':1,'TEXCOORD_0':2},'indices':3,'material':i}]} for i,(name,_) in enumerate(palette)],
    'materials':[{'name':name,'pbrMetallicRoughness':{'baseColorFactor':linear_color(color),'metallicFactor':0,'roughnessFactor':.85}} for name,color in palette],
    'accessors':[
        {'bufferView':vp,'componentType':5126,'count':24,'type':'VEC3','min':[-1,-1,-1],'max':[1,1,1]},
        {'bufferView':vn,'componentType':5126,'count':24,'type':'VEC3'},
        {'bufferView':vu,'componentType':5126,'count':24,'type':'VEC2'},
        {'bufferView':vi,'componentType':5123,'count':36,'type':'SCALAR'},
    ], 'bufferViews':views,'buffers':[{'byteLength':len(binary)}],
}

# Doors specify a wall and an offset along that wall. Matching openings face each other.
rooms = [
    {'id':'lobby','name':'Lobby','size':[4,6],'at':[0,0],'floor':1,'wall':10,
     'doors':{'west':[-1.5,1.5],'east':[-1,2],'south':[0]}},
    {'id':'room-1','name':'Room 1','size':[4,3],'at':[-4,-1.5],'floor':2,'wall':11,'doors':{'east':[0]}},
    {'id':'room-2','name':'Room 2','size':[4,3],'at':[-4,1.5],'floor':3,'wall':12,'doors':{'east':[0]}},
    {'id':'kitchen','name':'Kitchen','size':[4,4],'at':[4,-1],'floor':4,'wall':13,'doors':{'west':[0]}},
    {'id':'cr','name':'CR (bathroom)','size':[3,2],'at':[3.5,2],'floor':5,'wall':14,'doors':{'west':[0]}},
]
HEIGHT, WALL, DOOR_WIDTH, DOOR_HEIGHT = 2.8, .12, 1.4, 2.2

def add_room(document, room, assembled=False):
    nodes = document['nodes']
    children = []
    def box(name, center, size, material=0):
        children.append(len(nodes))
        nodes.append({'name':f"{room['name']} {name}",'mesh':material,
                      'translation':center,'scale':[v/2 for v in size]})
    width, depth = room['size']
    box('Floor',[0,-.1,0],[width,.2,depth],room['floor'])
    for side in ['north','south','west','east']:
        horizontal = side in ['north','south']
        length = width if horizontal else depth
        fixed = (-1 if side in ['north','west'] else 1) * ((depth if horizontal else width)/2-WALL/2)
        def wall(start,end,y,height,label):
            if end-start <= .00001:
                return
            mid = (start+end)/2
            box(f'{side} wall {label}',[mid,y,fixed] if horizontal else [fixed,y,mid],
                [end-start,height,WALL] if horizontal else [WALL,height,end-start],room['wall'])
        cursor = -length/2
        for i, offset in enumerate(sorted(room['doors'].get(side,[]))):
            lo, hi = offset-DOOR_WIDTH/2, offset+DOOR_WIDTH/2
            assert cursor <= lo < hi <= length/2, (room['id'], side)
            wall(cursor,lo,HEIGHT/2,HEIGHT,f'segment {i+1}')
            wall(lo,hi,(HEIGHT+DOOR_HEIGHT)/2,HEIGHT-DOOR_HEIGHT,f'door {i+1} lintel')
            cursor = hi
        wall(cursor,length/2,HEIGHT/2,HEIGHT,'end')
    if room['id'] == 'room-stairs':
        # Three wide, shallow treads connect the entrance to a raised landing.
        # Each solid is separately named for explicit floor approval in the app.
        for i in range(3):
            rise = .15 * (i+1)
            box(f'Step {i+1} Floor',[.25-i*.5,rise/2,0],[.5,rise,depth],
                4 if i % 2 == 0 else 1)
        box('Raised Floor',[-1.5,.225,0],[1,.45,depth],3)
    elif room['id'].startswith('room-'):
        box('Bed frame',[-.95,.2,-.55],[1.2,.4,1.8],6)
        box('Mattress',[-.95,.48,-.55],[1.15,.16,1.75],8 if room['id']=='room-1' else 15)
        box('Pillow',[-.95,.61,-1.12],[.85,.1,.35],7)
        box('Wardrobe',[-1.6,.9,.9],[.55,1.8,.8],6)
    elif room['id']=='lobby':
        box('Bench',[1.5,.3,-2.3],[.65,.6,1],6)
        box('Welcome console',[-1.45,.4,-2.5],[.75,.8,.5],6)
    elif room['id']=='kitchen':
        box('Counter',[1.6,.45,.35],[.65,.9,2.1],16)
        box('Countertop',[1.6,.94,.35],[.7,.08,2.15],17)
        box('Sink',[1.6,1.0,-.1],[.45,.04,.55],9)
        box('Cooker',[.7,.48,-1.55],[.65,.96,.65],9)
        box('Fridge',[-.7,.95,-1.55],[.75,1.9,.7],7)
    else:
        box('Toilet base',[.65,.22,.45],[.45,.44,.55],7)
        box('Toilet seat',[.65,.48,.4],[.5,.08,.6],7)
        box('Toilet cistern',[.65,.65,.73],[.5,.55,.18],7)
        box('Sink pedestal',[.9,.4,-.55],[.23,.8,.23],7)
        box('Wash basin',[.9,.84,-.55],[.65,.12,.48],7)
    root = len(nodes)
    x,z = room['at'] if assembled else [0,0]
    nodes.append({'name':room['name'],'children':children,'translation':[x,0,z],
                  'extras':{'prefab':room['id'],'units':'metres','floorElevation':0}})
    document['scenes'][0]['nodes'].append(root)
    return root

def write_glb(filename, document):
    payload = json.dumps(document,separators=(',',':')).encode()
    payload += b' ' * (-len(payload)%4)
    body = bytes(binary) + b'\0' * (-len(binary)%4)
    data = (struct.pack('<III',0x46546c67,2,28+len(payload)+len(body))
            + struct.pack('<II',len(payload),0x4e4f534a) + payload
            + struct.pack('<II',len(body),0x004e4942) + body)
    (OUT/filename).write_bytes(data)

for room in rooms:
    doc = copy.deepcopy(base)
    add_room(doc,room)
    write_glb(room['id']+'.glb',doc)
house = copy.deepcopy(base)
for room in rooms:
    add_room(house,room,True)
write_glb('house-assembled.glb',house)

# Optional stepped room, matching the bedroom footprint and east doorway.
stairs_room = {**rooms[1],'id':'room-stairs','name':'Stairs room'}
stairs_doc = copy.deepcopy(base)
add_room(stairs_doc,stairs_room)
write_glb('room-stairs.glb',stairs_doc)

# Optional bedroom module with an embedded, looping ceiling-fan animation.
# It has the same footprint and east doorway as either original bedroom.
fan_room = {**rooms[1],'id':'room-fan','name':'Fan room'}
fan_doc = copy.deepcopy(base)
fan_root = add_room(fan_doc,fan_room)
def fan_box(name,center,size,material,parent,rotation=None):
    index = len(fan_doc['nodes'])
    node = {'name':f'Fan room {name}','mesh':material,
            'translation':center,'scale':[v/2 for v in size]}
    if rotation is not None:
        node['rotation'] = [0,math.sin(rotation/2),0,math.cos(rotation/2)]
    fan_doc['nodes'].append(node)
    fan_doc['nodes'][parent].setdefault('children',[]).append(index)
    return index
fan_box('Fan canopy',[0,2.76,0],[.24,.08,.24],9,fan_root)
fan_box('Fan downrod',[0,2.60,0],[.06,.24,.06],9,fan_root)
fan_box('Fan motor',[0,2.43,0],[.26,.14,.26],9,fan_root)
rotor = len(fan_doc['nodes'])
fan_doc['nodes'].append({'name':'Fan room Fan rotor','translation':[0,2.34,0],'children':[]})
fan_doc['nodes'][fan_root]['children'].append(rotor)
fan_box('Fan hub',[0,0,0],[.22,.09,.22],9,rotor)
for i in range(4):
    angle = i*math.pi/2
    fan_box(f'Fan blade {i+1}',[.52*math.cos(angle),0,-.52*math.sin(angle)],
            [.78,.035,.18],6,rotor,angle)
times = [0,.4,.8,1.2,1.6]
quaternions = [v for i in range(5) for v in [0,math.sin(i*math.pi/4),0,math.cos(i*math.pi/4)]]
vt,vr = buffer(times,'f',None),buffer(quaternions,'f',None)
fan_doc['bufferViews'] = [{k:v for k,v in view.items() if v is not None} for view in views]
fan_doc['buffers'][0]['byteLength'] = len(binary)
time_accessor = len(fan_doc['accessors'])
fan_doc['accessors'].extend([
    {'bufferView':vt,'componentType':5126,'count':5,'type':'SCALAR','min':[0],'max':[1.6]},
    {'bufferView':vr,'componentType':5126,'count':5,'type':'VEC4'},
])
fan_doc['animations'] = [{'name':'Ceiling fan spin','samplers':[{'input':time_accessor,'output':time_accessor+1,'interpolation':'LINEAR'}],
                          'channels':[{'sampler':0,'target':{'node':rotor,'path':'rotation'}}]}]
write_glb('room-fan.glb',fan_doc)
manifest = {'units':'metres','upAxis':'Y','floorElevation':0,'wallHeight':HEIGHT,
            'doorWidth':DOOR_WIDTH,'doorHeight':DOOR_HEIGHT,
            'parts':[{**room,'file':room['id']+'.glb','position':[room['at'][0],0,room['at'][1]],'rotationDegrees':0,'scale':1} for room in rooms]}
(OUT/'placement.json').write_text(json.dumps(manifest,indent=2)+'\n')

# A code-native floor-plan preview; north is negative Z.
svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 570">',
       '<rect width="900" height="570" fill="#f7f8fa"/>',
       '<g font-family="sans-serif" fill="#243345"><text x="40" y="40" font-size="24">Practice house prefabs</text>',
       '<text x="40" y="65" font-size="14">Top view · metres · floor Y = 0 · north = −Z</text>']
for room in rooms:
    w,d=room['size'];x,z=room['at'];left,top=450+(x-w/2)*55,290+(z-d/2)*55
    color=palette[room['floor']][1]
    svg.append(f'<rect x="{left}" y="{top}" width="{w*55}" height="{d*55}" fill="{color}" stroke="#243345" stroke-width="3"/>')
    for side,offsets in room['doors'].items():
        for offset in offsets:
            horizontal=side in ['north','south'];fixed=(top if side=='north' else top+d*55) if horizontal else (left if side=='west' else left+w*55)
            middle=(450+x*55 if horizontal else 290+z*55)+offset*55
            endpoints=(middle-DOOR_WIDTH*27.5,fixed,middle+DOOR_WIDTH*27.5,fixed) if horizontal else (fixed,middle-DOOR_WIDTH*27.5,fixed,middle+DOOR_WIDTH*27.5)
            svg.append(f'<line x1="{endpoints[0]}" y1="{endpoints[1]}" x2="{endpoints[2]}" y2="{endpoints[3]}" stroke="#f7f8fa" stroke-width="7"/>')
    svg.append(f'<text x="{450+x*55}" y="{290+z*55-5}" text-anchor="middle" font-size="18">{room["name"]}</text>')
    svg.append(f'<text x="{450+x*55}" y="{290+z*55+18}" text-anchor="middle" font-size="14">{w} × {d} m</text>')
svg.extend(['<text x="450" y="490" text-anchor="middle" font-size="16">Entrance → lobby → room doorways</text>',
            '<text x="40" y="535" font-size="14">Simple box furniture · open doorways · no roof for easier editing</text></g></svg>'])
(OUT/'floor-plan.svg').write_text('\n'.join(svg)+'\n')

with zipfile.ZipFile(OUT/'practice-house.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(OUT.iterdir()):
        if file.suffix in ['.glb','.json','.svg','.md','.png']:
            archive.write(file,arcname='practice-house/'+file.name)
print(f'Created 5 room prefabs, fan and stairs variants, an assembled house, placement guide and ZIP in {OUT}')
