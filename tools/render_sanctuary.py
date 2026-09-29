"""Sunken Sanctuary: a frameless, deterministic Cycles panorama.

Run with the Blender Python module:
  python tools/render_sanctuary.py assets/sanctuary.jpg 4096 32
Or with the Blender executable:
  blender -b -t 8 --python tools/render_sanctuary.py -- assets/sanctuary.jpg 4096 32
Blender +Y maps to the holodeck's forward (-Z). No window, railing or room frame.
"""
import math
import os
import random
import sys
import bpy
from mathutils import Vector, noise

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = args[0] if args else 'assets/sanctuary.jpg'
WIDTH = int(args[1]) if len(args) > 1 else 4096
SAMPLES = int(args[2]) if len(args) > 2 else 32
random.seed(7241)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.adaptive_threshold = 0.055
sc.cycles.adaptive_min_samples = 8
sc.cycles.max_bounces = 6
sc.cycles.diffuse_bounces = 3
sc.cycles.glossy_bounces = 3
sc.cycles.transmission_bounces = 3
sc.cycles.volume_bounces = 0
sc.render.threads_mode = 'FIXED'
sc.render.threads = 8
sc.render.resolution_x = WIDTH
sc.render.resolution_y = WIDTH // 2
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'JPEG' if OUT.lower().endswith('.jpg') else 'PNG'
sc.render.image_settings.quality = 94
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'
sc.view_settings.exposure = 0.1


def mat(name, color, rough=.75, metallic=0, emit=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metallic
    if emit:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emit
    return m


def stone(name, dark, light, scale=1.8):
    m = mat(name, dark)
    n = m.node_tree.nodes; l = m.node_tree.links
    p = n.get('Principled BSDF')
    tc = n.new('ShaderNodeTexCoord')
    tex = n.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = scale
    tex.inputs['Detail'].default_value = 5
    tex.inputs['Roughness'].default_value = .72
    l.new(tc.outputs['Object'], tex.inputs['Vector'])
    cr = n.new('ShaderNodeValToRGB')
    cr.color_ramp.elements[0].position = .2
    cr.color_ramp.elements[0].color = (*dark, 1)
    cr.color_ramp.elements[1].position = .8
    cr.color_ramp.elements[1].color = (*light, 1)
    l.new(tex.outputs['Fac'], cr.inputs['Fac'])
    l.new(cr.outputs['Color'], p.inputs['Base Color'])
    fine = n.new('ShaderNodeTexNoise')
    fine.inputs['Scale'].default_value = 18
    fine.inputs['Detail'].default_value = 3
    l.new(tc.outputs['Object'], fine.inputs['Vector'])
    bump = n.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .5
    bump.inputs['Distance'].default_value = .17
    l.new(fine.outputs['Fac'], bump.inputs['Height'])
    l.new(bump.outputs['Normal'], p.inputs['Normal'])
    return m

rockmat = stone('Wet layered limestone', (.018,.031,.037), (.11,.145,.135), .24)
sandstone = stone('Weathered ivory stone', (.17,.135,.078), (.62,.53,.33), 1.6)
darkstone = stone('Water stained foundation', (.028,.045,.041), (.14,.18,.135), 1.1)
moss = stone('Deep moss', (.008,.027,.012), (.10,.21,.058), 4)
gold = mat('Aged bronze', (.32,.18,.055), .36,.65)
cyan = mat('Cyan mineral', (.025,.72,.66), .3,.1, 3)
amber = mat('Amber lantern', (1,.31,.055), .3,0, 8)
black = mat('Unlit recess', (.005,.012,.012))


def mesh(name, vertices, faces, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata(vertices, [], faces); me.update()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    if material: me.materials.append(material)
    return ob


def box(name, loc, size, material, bevel=.07):
    x,y,z=[v/2 for v in size]
    vs=[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    o=mesh(name,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material)
    o.location=loc
    if bevel:
        b=o.modifiers.new('Worn edges','BEVEL'); b.width=bevel; b.segments=2
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o


def cyl(name, loc, r, depth, material, vertices=24, r2=None):
    upper=r if r2 is None else r2
    vs=[]
    for rr,z in [(r,-depth/2),(upper,depth/2)]:
        vs += [(rr*math.cos(i*math.tau/vertices),rr*math.sin(i*math.tau/vertices),z) for i in range(vertices)]
    fs=[tuple(range(vertices-1,-1,-1)),tuple(range(vertices,vertices*2))]
    fs += [(i,(i+1)%vertices,(i+1)%vertices+vertices,i+vertices) for i in range(vertices)]
    o=mesh(name,vs,fs,material); o.location=loc
    for p in o.data.polygons: p.use_smooth=len(p.vertices)==4
    return o


def rock(name, loc, size, seed=0, material=None):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=loc)
    o = bpy.context.object; o.name = name
    for v in o.data.vertices:
        p = v.co.copy()
        a = noise.fractal(p*2.6 + Vector((seed,3,9)), 1, 2, 4)
        v.co *= 1 + a*.25
        v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
    for p in o.data.polygons: p.use_smooth = True
    o.data.materials.append(material or rockmat)
    return o


def lamp(name, loc, color, energy, radius=1, target=None, size=15):
    d = bpy.data.lights.new(name, 'AREA' if target else 'POINT')
    d.energy = energy; d.color = color
    o = bpy.data.objects.new(name,d); sc.collection.objects.link(o); o.location=loc
    if target:
        d.shape='DISK'; d.size=size
        o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    else: d.shadow_soft_size=radius
    return o

# A real surrounding cave, with an irregular skylight opening overhead.
verts=[]; faces=[]; N=180; RINGS=24
for j in range(RINGS):
    t=j/(RINGS-1)
    z=-24 + 162*t
    r=175*(1-.78*t**3)
    for i in range(N):
        a=i*math.tau/N
        n=noise.fractal(Vector((math.cos(a)*3.1,math.sin(a)*3.1,t*5.2)),1,2,4)
        rr=r+14*n+9*math.sin(a*7+t*5)
        verts.append((rr*math.cos(a),rr*math.sin(a),z+7*n))
for j in range(RINGS-1):
    for i in range(N):
        ni=(i+1)%N; a=j*N+i; b=j*N+ni
        faces.append((a,b,b+N,a+N))
cave=mesh('Continuous sculpted cavern',verts,faces,rockmat)
for p in cave.data.polygons: p.use_smooth=True

# Buttresses and hanging mineral formations interrupt the huge roof silhouette.
for i in range(58):
    a=math.tau*i/58+random.uniform(-.04,.04)
    rad=random.uniform(118,155)
    h=random.uniform(30,72)
    rock('Limestone buttress', (math.cos(a)*rad,math.sin(a)*rad,h*.42-9), (random.uniform(10,23),random.uniform(13,25),h),i)
for i in range(72):
    a=random.uniform(0,math.tau); r=random.uniform(69,147)
    # Invert the dome radius equation to embed each root in the cave roof.
    roof=-24+162*((1-r/175)/.78)**(1/3)
    length=random.uniform(9,32)
    vertices=[]; faces=[]; sides=11; rings=9
    for j in range(rings):
        t=j/(rings-1); rr=(random.uniform(2.8,4.1)*(1-t)**1.4+.06)
        for k in range(sides):
            ang=k*math.tau/sides
            radius=rr*(1+.18*math.sin(k*3+i+j*.7))
            vertices.append((r*math.cos(a)+radius*math.cos(ang)+t*t*2*math.cos(a),r*math.sin(a)+radius*math.sin(ang),roof+9-t*(length+9)))
    for j in range(rings-1):
        for k in range(sides):
            q=j*sides+k; nq=j*sides+(k+1)%sides
            faces.append((q,nq,nq+sides,q+sides))
    o=mesh('Eroded hanging limestone',vertices,faces,rockmat)
    for p in o.data.polygons:p.use_smooth=True

# Water has actual reflected architecture and lights, plus physically small ripples.
water=mat('Deep turquoise water',(.008,.095,.072),.15,.3, .06)
p=water.node_tree.nodes.get('Principled BSDF')
p.inputs['IOR'].default_value=1.333
p.inputs['Transmission Weight'].default_value=.12
n=water.node_tree.nodes; l=water.node_tree.links
tex=n.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=1.3; tex.inputs['Detail'].default_value=3
coord=n.new('ShaderNodeTexCoord'); l.new(coord.outputs['Object'],tex.inputs['Vector'])
bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.27; bump.inputs['Distance'].default_value=.105
l.new(tex.outputs['Fac'],bump.inputs['Height']); l.new(bump.outputs['Normal'],p.inputs['Normal'])
box('Underground lake',(0,0,-7.3),(480,480,.3),water,0)

# Shore islands lie well beyond the real room, so the panorama has no close border.
for i in range(26):
    a=i*math.tau/26+.18
    r=random.uniform(48,112)
    if abs(a-math.pi/2)<.25: continue
    x,y=math.cos(a)*r,math.sin(a)*r
    rock('Shore island',(x,y,-7),(random.uniform(7,17),random.uniform(7,14),random.uniform(2.5,6)),i+70)
    rock('Moss cap',(x,y,-5.7),(random.uniform(5,10),random.uniform(4,8),1.6),i+70,moss)

# The main stepped sanctuary sits at the head of the lake. Every block is modelled.
TY=82
for i in range(9):
    box('Broad submerged stair',(0,TY-16+i*.95,-6.2+i*.43),(37-i*1.5,22-i*.9,.65),sandstone,.12)
box('Sanctuary podium',(0,TY+2,-2.6),(31,20,3.5),darkstone,.25)
box('Podium cornice',(0,TY+2,-.75),(33,22,.7),sandstone,.15)
for x in [-16.1,16.1]:
    box('Bronze foundation band',(x,TY+2,-2.3),(.12,20,.28),gold,.02)

# Giant open arch: stone voussoirs, layered trim, and a recessed sanctum.
def arch(name,cx,cy,bottom,rad,width,depth,material):
    spring=bottom+rad*.95
    for side in [-1,1]:
        for j in range(6):
            box(name+' pier',(cx+side*(rad+width/2),cy,bottom+(j+.5)*(spring-bottom)/6),(width,depth,(spring-bottom)/6-.08),material,.08)
    for j in range(25):
        a=j*math.pi/25+.007; b=(j+1)*math.pi/25-.007
        vs=[]
        for yy in [cy-depth/2,cy+depth/2]:
            for rr,ang in [(rad,a),(rad,b),(rad+width,b),(rad+width,a)]:
                vs.append((cx+rr*math.cos(ang),yy,spring+rr*math.sin(ang)))
        mesh(name+' arch block',vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material)
arch('Great gate',0,TY+4,-.35,10.5,2.1,4,sandstone)
arch('Inner carved arch',0,TY+1.65,-.35,10.15,.32,.35,gold)
arch('Distant sanctum',0,TY+18,-.35,7.8,1.5,3,darkstone)
# Central ceremonial disk hangs inside the opening.
bpy.ops.mesh.primitive_torus_add(major_radius=4.5,minor_radius=.20,major_segments=96,minor_segments=12,location=(0,TY+15,10.5),rotation=(math.pi/2,0,0))
bpy.context.object.name='Suspended bronze sun'; bpy.context.object.data.materials.append(gold)
for i in range(24):
    a=i*math.tau/24
    o=box('Sun rays',(math.cos(a)*5.2,TY+15,10.5+math.sin(a)*5.2),(.13,.3,1),gold,.02)
    o.rotation_euler.y=math.pi/2-a
cyl('Offering plinth',(0,TY+7,.6),2,1.8,darkstone)
cyl('Luminous offering',(0,TY+7,1.55),1.6,.12,cyan)

# Colonnades, side chapels, and a partly broken aqueduct extending across the lake.
def column(x,y,z,h):
    box('Column plinth',(x,y,z+.35),(2.5,2.5,.7),sandstone)
    for j in range(7):
        cyl('Column drum',(x,y,z+.7+(j+.5)*(h-1.5)/7),.76,(h-1.5)/7-.04,sandstone,20)
    for zz,rr in [(z+.9,.96),(z+h-1,.95),(z+h-.65,1.1)]:
        cyl('Column collar',(x,y,zz),rr,.22,sandstone)
    box('Carved capital',(x,y,z+h-.3),(2.3,2.3,.6),sandstone)
for side in [-1,1]:
    for row in range(4):
        x=side*(21+row*5.5); y=TY+6+row*1.7
        base=-4.8
        box('Colonnade island',(x,y,base-1),(6,10,2),darkstone,.15)
        column(x,y,base,12 if row<3 else 7)
        if row<3: box('Colonnade lintel',(x+side*2.7,y,7.65),(7,3,1.3),sandstone,.12)
    for j in range(4):
        x=side*(24+j*15)
        arch('Flooded aqueduct',x,TY+30,-10,5.5,1.15,3,darkstone)
        box('Aqueduct cap',(x,TY+30,2.45),(14,4,.8),sandstone,.1)

# A second ruin in the opposite direction keeps a full room interesting.
for i in range(7):
    a=3.7+i*.19; x=math.cos(a)*91; y=math.sin(a)*91
    rock('Rear ruin foundation',(x,y,-7),(7,6,3),140+i)
    column(x,y,-4,random.uniform(7,15))

# Tiny detailed lantern niches rhythmically light stone rather than flood the whole cave.
for side in [-1,1]:
    for y in [TY-17,TY-8,TY+1]:
        x=side*(13 if y<TY else 15)
        box('Lantern pedestal',(x,y,-1.5),(1.2,1.2,3),darkstone)
        cyl('Lantern bowl',(x,y,.1),.8,.3,gold)
        cyl('Lantern glow',(x,y,.35),.33,.65,amber,16,r2=.12)
        lamp('Warm sanctuary lantern',(x,y,.9),(1,.42,.13),750,1.5)
lamp('Golden gate wash',(0,TY-14,12),(1,.62,.28),19000,target=(0,TY+5,10),size=17)
lamp('Turquoise sanctum',(0,TY+15,6),(.04,1,.68),9500,4)

# Mineral clusters scattered around all shores. Small in the view, never a frame.
for i in range(125):
    a=random.uniform(0,math.tau); r=random.uniform(49,135)
    x,y=r*math.cos(a),r*math.sin(a)
    for j in range(random.randint(2,5)):
        h=random.uniform(.25,1.6)
        ob=cyl('Bioluminescent mineral',(x+random.uniform(-1,1),y+random.uniform(-1,1),-5+h/2),random.uniform(.08,.22),h,cyan,6,r2=.02)
        ob.rotation_euler=(random.uniform(-.3,.3),random.uniform(-.3,.3),random.random()*6)
    if i%10==0: lamp('Mineral shore glow',(x,y,-3),(.02,.78,.65),140,1.4)

# Sparse plants with curved blades on distant shore, silhouetted against the lake.
for i in range(80):
    a=random.uniform(0,math.tau); r=random.uniform(53,115)
    x,y=r*math.cos(a),r*math.sin(a)
    for j in range(5):
        ang=j*math.tau/5; h=random.uniform(1,2.5)
        v=[(x,y,-4.9),(x+.15,y,-4.9),(x+math.cos(ang)*h*.6,y+math.sin(ang)*h*.6,-4.9+h),(x+math.cos(ang)*h*.22,y+math.sin(ang)*h*.22,-4.9+h*.7)]
        mesh('Shore fern',v,[(0,1,2,3)],moss)

world=bpy.data.worlds.new('Blue daylight through the skylight'); world.use_nodes=True; sc.world=world
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.28,.48,.65,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.055
lamp('Great skylight',(-30,10,125),(.58,.76,1),85000,target=(0,40,-8),size=65)
lamp('Soft cool lake fill',(0,-20,48),(.19,.48,.58),12000,target=(0,35,-5),size=85)
# A thin atmosphere separates the roof and distant architecture.
fog=bpy.data.materials.new('Cave haze'); fog.use_nodes=True
nt=fog.node_tree; nt.nodes.clear()
o=nt.nodes.new('ShaderNodeOutputMaterial'); v=nt.nodes.new('ShaderNodeVolumePrincipled')
v.inputs['Density'].default_value=.0009
v.inputs['Color'].default_value=(.32,.53,.57,1)
v.inputs['Anisotropy'].default_value=.25
nt.links.new(v.outputs['Volume'],o.inputs['Volume'])
box('Atmosphere',(0,0,45),(420,420,210),fog,0)

# Match the exact orientation of the existing city / space panorama pipeline.
cd=bpy.data.cameras.new('Panorama camera'); cd.type='PANO'; cd.panorama_type='EQUIRECTANGULAR'
cam=bpy.data.objects.new('Panorama camera',cd); sc.collection.objects.link(cam)
cam.location=(0,30,1.5); cam.rotation_euler=(math.pi/2,0,0); sc.camera=cam
# Restrained photographic glow for the tiny mineral and lantern highlights.
sc.use_nodes=True
nt=sc.node_tree; nt.nodes.clear()
rl=nt.nodes.new('CompositorNodeRLayers')
gl=nt.nodes.new('CompositorNodeGlare'); gl.glare_type='FOG_GLOW'; gl.quality='HIGH'; gl.threshold=1.7
out=nt.nodes.new('CompositorNodeComposite')
nt.links.new(rl.outputs['Image'],gl.inputs['Image']); nt.links.new(gl.outputs['Image'],out.inputs['Image'])
os.makedirs(os.path.dirname(os.path.abspath(OUT)),exist_ok=True)
sc.render.filepath=os.path.abspath(OUT)
print('Sanctuary ready:',len(sc.objects),'objects;',WIDTH,'px;',SAMPLES,'samples',flush=True)
if os.environ.get('HOLODECK_BLEND'):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.environ['HOLODECK_BLEND']))
bpy.ops.render.render(write_still=True)
print('Rendered',OUT,flush=True)
