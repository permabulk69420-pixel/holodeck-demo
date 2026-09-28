"""Space backdrop for the holodeck 'spaceship window'.

Renders an equirectangular panorama with Cycles:
  - ringed gas giant (banded, lit from the side so it has a terminator) + atmosphere rim
  - small cratered moon
  - vivid nebula + starfield (world shader, so it's cheap)

Blender axes: +Y is "out the window" (three.js -Z), Z is up.
Usage: python3 render_space.py OUT.png WIDTH SAMPLES
"""
import sys
import math
import bpy

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/space.png"
W = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
SAMPLES = int(sys.argv[3]) if len(sys.argv) > 3 else 32

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 4
scene.render.resolution_x = W
scene.render.resolution_y = W // 2
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "8"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.film_transparent = False


def node(nt, kind, loc=(0, 0), **inputs):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def link(nt, a, b):
    nt.links.new(a, b)


def ramp(nt, stops, loc=(0, 0)):
    r = nt.nodes.new("ShaderNodeValToRGB")
    r.location = loc
    els = r.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    els[0].position, els[0].color = stops[0]
    for pos, col in stops[1:]:
        e = els.new(pos)
        e.color = col
    return r


# ---------------- camera ----------------
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "PANO"
cam_data.panorama_type = "EQUIRECTANGULAR"
cam = bpy.data.objects.new("cam", cam_data)
cam.rotation_euler = (math.radians(90), 0, 0)  # look along +Y
scene.collection.objects.link(cam)
scene.camera = cam

# ---------------- world: stars + nebula ----------------
world = bpy.data.worlds.new("space")
scene.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
outn = node(nt, "ShaderNodeOutputWorld", (1400, 0))
tex = node(nt, "ShaderNodeTexCoord", (-1400, 0))
dirv = tex.outputs["Generated"]

# stars: voronoi cells, tiny bright cores
def star_layer(scale, size, bright, loc):
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.location = loc
    vor.inputs["Scale"].default_value = scale
    vor.inputs["Randomness"].default_value = 1.0
    link(nt, dirv, vor.inputs["Vector"])
    # intensity = (1 - smoothstep(0, size, dist)) ^ 3 * brightness(random per cell)
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.location = (loc[0] + 200, loc[1])
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = size
    mr.inputs["To Min"].default_value = 1.0
    mr.inputs["To Max"].default_value = 0.0
    link(nt, vor.outputs["Distance"], mr.inputs["Value"])
    p = node(nt, "ShaderNodeMath", (loc[0] + 400, loc[1]))
    p.operation = "POWER"
    p.inputs[1].default_value = 3.0
    link(nt, mr.outputs["Result"], p.inputs[0])
    # per-star brightness variation from the cell colour
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.location = (loc[0] + 200, loc[1] - 200)
    link(nt, vor.outputs["Color"], sep.inputs["Color"])
    pw = node(nt, "ShaderNodeMath", (loc[0] + 400, loc[1] - 200))
    pw.operation = "POWER"
    pw.inputs[1].default_value = 6.0
    link(nt, sep.outputs["Red"], pw.inputs[0])
    m = node(nt, "ShaderNodeMath", (loc[0] + 600, loc[1]))
    m.operation = "MULTIPLY"
    link(nt, p.outputs[0], m.inputs[0])
    link(nt, pw.outputs[0], m.inputs[1])
    m2 = node(nt, "ShaderNodeMath", (loc[0] + 800, loc[1]))
    m2.operation = "MULTIPLY"
    m2.inputs[1].default_value = bright
    link(nt, m.outputs[0], m2.inputs[0])
    # slight colour tint per star (blue-white to warm)
    tint = ramp(nt, [(0.0, (1.0, 0.75, 0.55, 1)), (0.5, (1.0, 0.97, 0.92, 1)), (1.0, (0.7, 0.8, 1.0, 1))], (loc[0] + 600, loc[1] - 250))
    link(nt, sep.outputs["Green"], tint.inputs["Fac"])
    col = node(nt, "ShaderNodeMix", (loc[0] + 1000, loc[1]))
    col.data_type = "RGBA"
    col.blend_type = "MULTIPLY"
    col.inputs["Factor"].default_value = 1.0
    link(nt, tint.outputs["Color"], col.inputs["A"])
    link(nt, m2.outputs[0], col.inputs["B"])
    return col.outputs["Result"]

s1 = star_layer(900, 0.12, 90.0, (-1100, 600))
s2 = star_layer(300, 0.07, 140.0, (-1100, 1100))
s3 = star_layer(90, 0.04, 300.0, (-1100, 1600))

# nebula: layered noise on the view direction, two colour families, dark dust lanes
def noise(scale, detail, rough, loc, dist=0.0, w=None):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = loc
    n.noise_dimensions = "3D"
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    n.inputs["Distortion"].default_value = dist
    link(nt, dirv, n.inputs["Vector"])
    return n

# offset the direction so the nebula sits off to one side of "out the window"
mapn = nt.nodes.new("ShaderNodeMapping")
mapn.location = (-1250, -400)
mapn.inputs["Location"].default_value = (0.35, 0.1, 0.2)
link(nt, dirv, mapn.inputs["Vector"])
dirv2 = mapn.outputs["Vector"]

def noise2(scale, detail, rough, loc, dist=0.0):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = loc
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    n.inputs["Distortion"].default_value = dist
    link(nt, dirv2, n.inputs["Vector"])
    return n

shape = noise2(1.2, 6, 0.55, (-1000, -300), dist=0.6)
shape_r = ramp(nt, [(0.0, (0, 0, 0, 1)), (0.42, (0, 0, 0, 1)), (0.66, (1, 1, 1, 1)), (1.0, (1, 1, 1, 1))], (-750, -300))
link(nt, shape.outputs["Fac"], shape_r.inputs["Fac"])

wisps = noise2(6.0, 15, 0.64, (-1000, -650), dist=0.7)
wisps_r = ramp(nt, [(0.0, (0, 0, 0, 1)), (0.45, (0.04, 0.04, 0.04, 1)), (0.68, (0.6, 0.6, 0.6, 1)), (0.8, (1, 1, 1, 1))], (-750, -650))
link(nt, wisps.outputs["Fac"], wisps_r.inputs["Fac"])

hue = noise2(0.9, 3, 0.5, (-1000, -1000))
palette = ramp(nt, [
    (0.25, (0.95, 0.12, 0.45, 1)),   # magenta
    (0.45, (0.55, 0.1, 0.85, 1)),    # violet
    (0.6, (0.05, 0.55, 0.85, 1)),    # teal-blue
    (0.78, (1.0, 0.45, 0.12, 1)),    # hot orange core
], (-750, -1000))
link(nt, hue.outputs["Fac"], palette.inputs["Fac"])

dust = noise2(7.0, 10, 0.6, (-1000, -1350), dist=0.8)
dust_r = ramp(nt, [(0.0, (1, 1, 1, 1)), (0.55, (1, 1, 1, 1)), (0.7, (0.15, 0.15, 0.15, 1))], (-750, -1350))
link(nt, dust.outputs["Fac"], dust_r.inputs["Fac"])

def mul(a, b, loc):
    m = node(nt, "ShaderNodeMix", loc)
    m.data_type = "RGBA"
    m.blend_type = "MULTIPLY"
    m.inputs["Factor"].default_value = 1.0
    link(nt, a, m.inputs["A"])
    link(nt, b, m.inputs["B"])
    return m.outputs["Result"]

# band: brightest where the view direction is perpendicular to 'axis'
bdot = nt.nodes.new("ShaderNodeVectorMath"); bdot.location = (-1000, 250)
bdot.operation = "DOT_PRODUCT"
bdot.inputs[1].default_value = (0.35, -0.25, 0.9)
link(nt, dirv2, bdot.inputs[0])
bsq = node(nt, "ShaderNodeMath", (-850, 250)); bsq.operation = "ABSOLUTE"
link(nt, bdot.outputs["Value"], bsq.inputs[0])
bnoise = noise2(2.0, 4, 0.5, (-1000, 450))
bwarp = node(nt, "ShaderNodeMath", (-700, 350)); bwarp.operation = "MULTIPLY_ADD"
bwarp.inputs[1].default_value = 0.35
link(nt, bnoise.outputs["Fac"], bwarp.inputs[0])
link(nt, bsq.outputs[0], bwarp.inputs[2])
band_r = ramp(nt, [(0.0, (0, 0, 0, 1)), (0.12, (0.2, 0.2, 0.2, 1)), (0.28, (1, 1, 1, 1)), (0.5, (0.35, 0.35, 0.35, 1)), (0.7, (0, 0, 0, 1))], (-550, 350))
link(nt, bwarp.outputs[0], band_r.inputs["Fac"])
neb = mul(shape_r.outputs["Color"], wisps_r.outputs["Color"], (-450, -450))
neb = mul(neb, band_r.outputs["Color"], (-350, -500))
neb = mul(neb, dust_r.outputs["Color"], (-250, -600))
neb_col = mul(neb, palette.outputs["Color"], (-50, -700))
neb_strength = node(nt, "ShaderNodeMix", (150, -700))
neb_strength.data_type = "RGBA"
neb_strength.blend_type = "MULTIPLY"
neb_strength.inputs["Factor"].default_value = 1.0
neb_strength.inputs["B"].default_value = (2.2, 2.2, 2.2, 1)
link(nt, neb_col, neb_strength.inputs["A"])

def add(a, b, loc):
    m = node(nt, "ShaderNodeMix", loc)
    m.data_type = "RGBA"
    m.blend_type = "ADD"
    m.inputs["Factor"].default_value = 1.0
    link(nt, a, m.inputs["A"])
    link(nt, b, m.inputs["B"])
    return m.outputs["Result"]

stars = add(add(s1, s2, (0, 800)), s3, (200, 900))
total = add(stars, neb_strength.outputs["Result"], (500, 200))
bg = node(nt, "ShaderNodeBackground", (1100, 0))
bg.inputs["Strength"].default_value = 1.0
link(nt, total, bg.inputs["Color"])
link(nt, bg.outputs["Background"], outn.inputs["Surface"])

# ---------------- sun ----------------
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 6.5
sun_data.angle = math.radians(0.5)
sun_data.color = (1.0, 0.96, 0.9)
sun = bpy.data.objects.new("sun", sun_data)
# light coming from the left, slightly behind the planet: a fat crescent/half-lit look
from mathutils import Vector
sun.rotation_mode = "QUATERNION"
sun.rotation_quaternion = Vector((0.85, -0.45, -0.25)).normalized().to_track_quat("-Z", "Y")
scene.collection.objects.link(sun)

# ---------------- planet ----------------
PR = 10.0
PLOC = (6.0, 27.0, -3.5)

def uv_sphere(name, r, loc, seg=128, rings=64):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.shade_smooth()
    return o

planet = uv_sphere("planet", PR, PLOC)
planet.rotation_euler = (math.radians(-22), math.radians(14), 0)
mat = bpy.data.materials.new("planet")
mat.use_nodes = True
pt = mat.node_tree
pt.nodes.clear()
po = pt.nodes.new("ShaderNodeOutputMaterial"); po.location = (900, 0)
bsdf = pt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (600, 0)
bsdf.inputs["Roughness"].default_value = 0.85
tc = pt.nodes.new("ShaderNodeTexCoord"); tc.location = (-900, 0)
turb = pt.nodes.new("ShaderNodeTexNoise"); turb.location = (-700, -200)
turb.inputs["Scale"].default_value = 3.0
turb.inputs["Detail"].default_value = 8
turb.inputs["Distortion"].default_value = 1.5
pt.links.new(tc.outputs["Object"], turb.inputs["Vector"])
vmix = pt.nodes.new("ShaderNodeMix"); vmix.location = (-500, 0)
vmix.data_type = "VECTOR"
vmix.inputs["Factor"].default_value = 0.08
pt.links.new(tc.outputs["Object"], vmix.inputs["A"])
pt.links.new(turb.outputs["Color"], vmix.inputs["B"])
wave = pt.nodes.new("ShaderNodeTexWave"); wave.location = (-300, 0)
wave.wave_type = "BANDS"
wave.bands_direction = "Z"
wave.inputs["Scale"].default_value = 1.6
wave.inputs["Distortion"].default_value = 6.0
wave.inputs["Detail"].default_value = 6.0
wave.inputs["Detail Scale"].default_value = 1.5
pt.links.new(vmix.outputs["Result"], wave.inputs["Vector"])
pr = pt.nodes.new("ShaderNodeValToRGB"); pr.location = (0, 0)
els = pr.color_ramp.elements
els[0].position, els[0].color = 0.0, (0.42, 0.24, 0.12, 1)
els[1].position, els[1].color = 1.0, (0.95, 0.88, 0.74, 1)
e = els.new(0.22); e.color = (0.8, 0.55, 0.3, 1)
e = els.new(0.4); e.color = (0.95, 0.85, 0.66, 1)
e = els.new(0.55); e.color = (0.35, 0.2, 0.11, 1)
e = els.new(0.7); e.color = (0.88, 0.7, 0.48, 1)
e = els.new(0.85); e.color = (0.6, 0.42, 0.28, 1)
pt.links.new(wave.outputs["Fac"], pr.inputs["Fac"])
pt.links.new(pr.outputs["Color"], bsdf.inputs["Base Color"])
pt.links.new(bsdf.outputs["BSDF"], po.inputs["Surface"])
planet.data.materials.append(mat)

# atmosphere: thin shell, diffuse-lit, visible mostly at the rim (so only the sunlit limb glows)
atmo = uv_sphere("atmo", PR * 1.035, PLOC, 96, 48)
am = bpy.data.materials.new("atmo")
am.use_nodes = True
at = am.node_tree
at.nodes.clear()
ao = at.nodes.new("ShaderNodeOutputMaterial"); ao.location = (800, 0)
lw = at.nodes.new("ShaderNodeLayerWeight"); lw.location = (-400, 200)
lw.inputs["Blend"].default_value = 0.35
powr = at.nodes.new("ShaderNodeMath"); powr.location = (-200, 200)
powr.operation = "POWER"
powr.inputs[1].default_value = 2.2
at.links.new(lw.outputs["Facing"], powr.inputs[0])
diff = at.nodes.new("ShaderNodeBsdfDiffuse"); diff.location = (0, 0)
diff.inputs["Color"].default_value = (0.55, 0.75, 1.0, 1)
emit_boost = at.nodes.new("ShaderNodeAddShader"); emit_boost.location = (200, 0)
em = at.nodes.new("ShaderNodeEmission"); em.location = (0, -150)
em.inputs["Color"].default_value = (0.3, 0.5, 1.0, 1)
em.inputs["Strength"].default_value = 0.0
at.links.new(diff.outputs["BSDF"], emit_boost.inputs[0])
at.links.new(em.outputs["Emission"], emit_boost.inputs[1])
tr = at.nodes.new("ShaderNodeBsdfTransparent"); tr.location = (200, 200)
mixs = at.nodes.new("ShaderNodeMixShader"); mixs.location = (500, 0)
at.links.new(powr.outputs[0], mixs.inputs["Fac"])
at.links.new(tr.outputs["BSDF"], mixs.inputs[1])
at.links.new(emit_boost.outputs[0], mixs.inputs[2])
at.links.new(mixs.outputs["Shader"], ao.inputs["Surface"])
atmo.data.materials.append(am)

# rings: flat annulus with banded alpha, tilted with the planet
bpy.ops.mesh.primitive_circle_add(vertices=256, radius=PR * 2.35, fill_type="NGON", location=PLOC)
rings = bpy.context.active_object
rings.name = "rings"
rings.rotation_euler = (math.radians(-22), math.radians(14), 0)
rm = bpy.data.materials.new("rings")
rm.use_nodes = True
rt = rm.node_tree
rt.nodes.clear()
ro = rt.nodes.new("ShaderNodeOutputMaterial"); ro.location = (900, 0)
rtc = rt.nodes.new("ShaderNodeTexCoord"); rtc.location = (-900, 0)
rlen = rt.nodes.new("ShaderNodeVectorMath"); rlen.location = (-700, 0)
rlen.operation = "LENGTH"
rt.links.new(rtc.outputs["Object"], rlen.inputs[0])
rnorm = rt.nodes.new("ShaderNodeMath"); rnorm.location = (-500, 0)
rnorm.operation = "DIVIDE"
rnorm.inputs[1].default_value = PR
rt.links.new(rlen.outputs["Value"], rnorm.inputs[0])
# fine banding: 1D noise along radius
comb = rt.nodes.new("ShaderNodeCombineXYZ"); comb.location = (-350, -150)
rt.links.new(rnorm.outputs[0], comb.inputs["X"])
rn = rt.nodes.new("ShaderNodeTexNoise"); rn.location = (-200, -150)
rn.noise_dimensions = "1D"
rn.inputs["Scale"].default_value = 18.0
rn.inputs["Detail"].default_value = 10
rt.links.new(rnorm.outputs[0], rn.inputs["W"])
band = rt.nodes.new("ShaderNodeValToRGB"); band.location = (0, -150)
be = band.color_ramp.elements
be[0].position, be[0].color = 0.3, (0.05, 0.05, 0.05, 1)
be[1].position, be[1].color = 0.7, (1, 1, 1, 1)
rt.links.new(rn.outputs["Fac"], band.inputs["Fac"])
# envelope: only between 1.35R and 2.3R, with a gap
env = rt.nodes.new("ShaderNodeValToRGB"); env.location = (0, 150)
ee = env.color_ramp.elements
ee[0].position, ee[0].color = 0.0, (0, 0, 0, 1)
ee[1].position, ee[1].color = 1.0, (0, 0, 0, 1)
for pos, v in [(0.3, 0.0), (0.34, 0.2), (0.42, 0.5), (0.55, 0.75), (0.6, 0.05), (0.63, 0.65), (0.88, 0.5), (0.97, 0.0)]:
    x = ee.new(pos); x.color = (v, v, v, 1)
envmap = rt.nodes.new("ShaderNodeMapRange"); envmap.location = (-200, 150)
envmap.inputs["From Min"].default_value = 1.0
envmap.inputs["From Max"].default_value = 2.35
rt.links.new(rnorm.outputs[0], envmap.inputs["Value"])
rt.links.new(envmap.outputs["Result"], env.inputs["Fac"])
alpha = rt.nodes.new("ShaderNodeMath"); alpha.location = (250, 50)
alpha.operation = "MULTIPLY"
rt.links.new(env.outputs["Color"], alpha.inputs[0])
rt.links.new(band.outputs["Color"], alpha.inputs[1])
rcol = rt.nodes.new("ShaderNodeValToRGB"); rcol.location = (250, -250)
rc = rcol.color_ramp.elements
rc[0].position, rc[0].color = 0.0, (0.45, 0.36, 0.27, 1)
rc[1].position, rc[1].color = 1.0, (0.82, 0.72, 0.58, 1)
rt.links.new(rn.outputs["Fac"], rcol.inputs["Fac"])
rdd = rt.nodes.new("ShaderNodeBsdfDiffuse"); rdd.location = (400, -100)
rtl = rt.nodes.new("ShaderNodeBsdfTranslucent"); rtl.location = (400, -250)
rt.links.new(rcol.outputs["Color"], rdd.inputs["Color"])
rdim = rt.nodes.new("ShaderNodeMix"); rdim.data_type = "RGBA"; rdim.blend_type = "MULTIPLY"
rdim.inputs["Factor"].default_value = 1.0
rdim.inputs["B"].default_value = (0.3, 0.27, 0.22, 1)
rt.links.new(rcol.outputs["Color"], rdim.inputs["A"])
rt.links.new(rdim.outputs["Result"], rtl.inputs["Color"])
rd = rt.nodes.new("ShaderNodeAddShader"); rd.location = (550, -150)
rt.links.new(rdd.outputs["BSDF"], rd.inputs[0])
rt.links.new(rtl.outputs["BSDF"], rd.inputs[1])
rtr = rt.nodes.new("ShaderNodeBsdfTransparent"); rtr.location = (500, 150)
rmix = rt.nodes.new("ShaderNodeMixShader"); rmix.location = (700, 0)
rt.links.new(alpha.outputs[0], rmix.inputs["Fac"])
rt.links.new(rtr.outputs["BSDF"], rmix.inputs[1])
rt.links.new(rd.outputs["Shader"], rmix.inputs[2])
rt.links.new(rmix.outputs["Shader"], ro.inputs["Surface"])
rings.data.materials.append(rm)

# ---------------- moon ----------------
moon = uv_sphere("moon", 1.1, (-7.5, 22.0, 4.0), 64, 32)
mm = bpy.data.materials.new("moon")
mm.use_nodes = True
mt = mm.node_tree
mb = mt.nodes["Principled BSDF"]
mb.inputs["Roughness"].default_value = 0.95
mn = mt.nodes.new("ShaderNodeTexNoise"); mn.inputs["Scale"].default_value = 4.0; mn.inputs["Detail"].default_value = 12
mcr = mt.nodes.new("ShaderNodeValToRGB")
mcr.color_ramp.elements[0].color = (0.25, 0.24, 0.23, 1)
mcr.color_ramp.elements[1].color = (0.62, 0.6, 0.58, 1)
mt.links.new(mn.outputs["Fac"], mcr.inputs["Fac"])
mt.links.new(mcr.outputs["Color"], mb.inputs["Base Color"])
mv = mt.nodes.new("ShaderNodeTexVoronoi"); mv.inputs["Scale"].default_value = 9.0
mbump = mt.nodes.new("ShaderNodeBump"); mbump.inputs["Strength"].default_value = 0.35
mt.links.new(mv.outputs["Distance"], mbump.inputs["Height"])
mt.links.new(mbump.outputs["Normal"], mb.inputs["Normal"])
moon.data.materials.append(mm)

scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("wrote", out)
