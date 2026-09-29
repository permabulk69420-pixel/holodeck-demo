"""Sky-islands backdrop for the holodeck 'window in the clouds'.

Renders an equirectangular panorama with Cycles, as seen from a ledge above a sea of cloud at golden hour:
  - physically based sky with a low, warm sun
  - a rolling cloud sea below (displaced sheet + hundreds of billowing cumulus puffs)
  - a ring of floating rock islands at different distances: grassy tops with trees,
    craggy underbellies, hanging roots and waterfalls that fall away into the mist
  - distance haze so the far islands melt into the sky

The islands' positions are also written to OUT.json so the three.js scene can put live
drifting rocks / birds / lanterns in the gaps between the static ones.

Blender axes: +Y is "out the window" (three.js -Z), Z is up (three.js +Y), X is right (three.js +X).
Usage: python3 render_sky.py OUT.png WIDTH SAMPLES   (SAMPLES 0 = skip the render, just write the JSON)
"""
import sys
import json
import math
import random
import bpy
import bmesh
from mathutils import Vector, Euler

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sky.png"
W = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
SAMPLES = int(sys.argv[3]) if len(sys.argv) > 3 else 32

rng = random.Random(7)

CLOUD_Z = -70.0                   # top of the cloud sea, metres below the eye
HAZE = (0.85, 0.42, 0.26)         # colour far things fade into (warm horizon glow)
FOG_DIST = 1500.0                  # metres for ~63% haze

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = max(SAMPLES, 1)
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 4
scene.render.resolution_x = W
scene.render.resolution_y = W // 2
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "8"
scene.view_settings.view_transform = "AgX"
for look in ("AgX - Medium High Contrast", "Medium High Contrast"):
    try:
        scene.view_settings.look = look
        break
    except TypeError:
        pass
scene.render.film_transparent = False
scene.view_settings.exposure = -0.8


# ---------------- helpers ----------------
def link(nt, a, b):
    nt.links.new(a, b)


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    return m, nt


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


def finish_with_haze(nt, shader_out, surface_input, base=(900, 0)):
    """Mix a surface shader toward the horizon colour with distance (fake aerial perspective)."""
    lp = nt.nodes.new("ShaderNodeLightPath")
    lp.location = (base[0] - 700, base[1] - 400)
    # 1 - exp(-d / FOG_DIST)
    div = nt.nodes.new("ShaderNodeMath"); div.operation = "DIVIDE"; div.location = (base[0] - 500, base[1] - 400)
    div.inputs[1].default_value = FOG_DIST
    link(nt, lp.outputs["Ray Length"], div.inputs[0])
    neg = nt.nodes.new("ShaderNodeMath"); neg.operation = "MULTIPLY"; neg.location = (base[0] - 350, base[1] - 400)
    neg.inputs[1].default_value = -1.0
    link(nt, div.outputs[0], neg.inputs[0])
    ex = nt.nodes.new("ShaderNodeMath"); ex.operation = "EXPONENT"; ex.location = (base[0] - 200, base[1] - 400)
    link(nt, neg.outputs[0], ex.inputs[0])
    inv = nt.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.location = (base[0] - 50, base[1] - 400)
    inv.inputs[0].default_value = 1.0
    link(nt, ex.outputs[0], inv.inputs[1])
    em = nt.nodes.new("ShaderNodeEmission"); em.location = (base[0] - 50, base[1] - 250)
    em.inputs["Color"].default_value = (*HAZE, 1.0)
    em.inputs["Strength"].default_value = 0.9
    mix = nt.nodes.new("ShaderNodeMixShader"); mix.location = (base[0] + 150, base[1])
    link(nt, inv.outputs[0], mix.inputs["Fac"])
    link(nt, shader_out, mix.inputs[1])
    link(nt, em.outputs["Emission"], mix.inputs[2])
    o = nt.nodes.new("ShaderNodeOutputMaterial"); o.location = (base[0] + 350, base[1])
    link(nt, mix.outputs["Shader"], o.inputs["Surface"])


def shade_smooth(o):
    for p in o.data.polygons:
        p.use_smooth = True


# ---------------- camera ----------------
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "PANO"
try:
    cam_data.panorama_type = "EQUIRECTANGULAR"
except Exception:
    cam_data.cycles.panorama_type = "EQUIRECTANGULAR"
cam = bpy.data.objects.new("cam", cam_data)
cam.rotation_euler = (math.radians(90), 0, 0)  # look along +Y
scene.collection.objects.link(cam)
scene.camera = cam

# ---------------- world: golden-hour sky ----------------
SUN_AZ = math.radians(-55)     # sun sits front-left of "out the window"
SUN_EL = math.radians(3.5)
world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
wt = world.node_tree
wt.nodes.clear()
wout = wt.nodes.new("ShaderNodeOutputWorld"); wout.location = (600, 0)
bg = wt.nodes.new("ShaderNodeBackground"); bg.location = (350, 0)
sky = wt.nodes.new("ShaderNodeTexSky"); sky.location = (0, 0)
for st in ("MULTIPLE_SCATTERING", "SINGLE_SCATTERING", "NISHITA"):
    try:
        sky.sky_type = st
        break
    except TypeError:
        pass
sky.sun_elevation = SUN_EL
sky.sun_rotation = SUN_AZ  # calibrated: 0 = straight ahead (+Y), positive = clockwise / right
sky.altitude = 3000.0
try:
    sky.dust_density = 9.0
    sky.air_density = 2.6
    sky.ozone_density = 1.0
    sky.sun_size = math.radians(4.0)
    sky.sun_intensity = 1.6
except Exception:
    pass
link(wt, sky.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 1.0
link(wt, bg.outputs["Background"], wout.inputs["Surface"])

# ---------------- cloud sea ----------------
bpy.ops.mesh.primitive_grid_add(x_subdivisions=260, y_subdivisions=260, size=6000, location=(0, 0, CLOUD_Z))
sea = bpy.context.active_object
sea.name = "cloud_sea"
tex = bpy.data.textures.new("sea_disp", "CLOUDS")
tex.noise_scale = 0.35
tex.noise_depth = 4
disp = sea.modifiers.new("disp", "DISPLACE")
disp.texture = tex
disp.strength = 12.0
disp.mid_level = 0.45
shade_smooth(sea)

cm, ct = new_mat("cloud")
tc = ct.nodes.new("ShaderNodeTexCoord"); tc.location = (-900, 0)
cn = ct.nodes.new("ShaderNodeTexNoise"); cn.location = (-700, 0)
cn.inputs["Scale"].default_value = 0.012
cn.inputs["Detail"].default_value = 8
link(ct, tc.outputs["Object"], cn.inputs["Vector"])
cr = ramp(ct, [(0.3, (0.62, 0.5, 0.62, 1)), (0.55, (1.0, 0.8, 0.66, 1)), (0.8, (1.0, 0.96, 0.88, 1))], (-450, 0))
link(ct, cn.outputs["Fac"], cr.inputs["Fac"])
cd = ct.nodes.new("ShaderNodeBsdfDiffuse"); cd.location = (0, 100)
link(ct, cr.outputs["Color"], cd.inputs["Color"])
ctl = ct.nodes.new("ShaderNodeBsdfTranslucent"); ctl.location = (0, -100)
link(ct, cr.outputs["Color"], ctl.inputs["Color"])
cmix = ct.nodes.new("ShaderNodeMixShader"); cmix.location = (250, 0)
cmix.inputs["Fac"].default_value = 0.7
link(ct, cd.outputs["BSDF"], cmix.inputs[1])
link(ct, ctl.outputs["BSDF"], cmix.inputs[2])
finish_with_haze(ct, cmix.outputs["Shader"], None, base=(650, 0))
sea.data.materials.append(cm)

# billowing puffs on the sea: lumpy spheres with the same material
puff_tex = bpy.data.textures.new("puff", "CLOUDS")
puff_tex.noise_scale = 0.6
puff_tex.noise_depth = 3
puffs = []
for cl in range(70):
    ang = rng.uniform(0, math.tau)
    dist = 90 + (rng.random() ** 0.75) * 1700
    cx, cy = math.cos(ang) * dist, math.sin(ang) * dist
    base_r = rng.uniform(16, 34) * (0.7 + dist / 1100.0)
    for k in range(rng.randint(5, 9)):
        r = base_r * rng.uniform(0.5, 1.1)
        x = cx + rng.uniform(-1.4, 1.4) * base_r
        y = cy + rng.uniform(-1.4, 1.4) * base_r
        z = CLOUD_Z + rng.uniform(-2, 1.2) * base_r * 0.4 + r * 0.3
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=(x, y, z))
        p = bpy.context.active_object
        p.scale = (rng.uniform(1.0, 1.5), rng.uniform(1.0, 1.5), rng.uniform(0.6, 1.0))
        d = p.modifiers.new("d", "DISPLACE")
        d.texture = puff_tex
        d.strength = r * 0.9
        d.mid_level = 0.4
        shade_smooth(p)
        p.data.materials.append(cm)
        puffs.append(p)

# ---------------- islands ----------------
grass_m, gt = new_mat("island")
gtc = gt.nodes.new("ShaderNodeTexCoord"); gtc.location = (-1100, 0)
geo = gt.nodes.new("ShaderNodeNewGeometry"); geo.location = (-1100, -300)
nz = gt.nodes.new("ShaderNodeSeparateXYZ"); nz.location = (-900, -300)
link(gt, geo.outputs["Normal"], nz.inputs["Vector"])
gnoise = gt.nodes.new("ShaderNodeTexNoise"); gnoise.location = (-900, 100)
gnoise.inputs["Scale"].default_value = 0.35
gnoise.inputs["Detail"].default_value = 10
link(gt, gtc.outputs["Object"], gnoise.inputs["Vector"])
# grass where the surface faces up (with noisy edge), rock elsewhere
gadd = gt.nodes.new("ShaderNodeMath"); gadd.operation = "MULTIPLY_ADD"; gadd.location = (-650, -200)
gadd.inputs[1].default_value = 0.35
link(gt, gnoise.outputs["Fac"], gadd.inputs[0])
link(gt, nz.outputs["Z"], gadd.inputs[2])
gmask = gt.nodes.new("ShaderNodeMath"); gmask.operation = "SMOOTH_MAX" if False else "GREATER_THAN"; gmask.location = (-450, -200)
gmask.inputs[1].default_value = 0.55
link(gt, gadd.outputs[0], gmask.inputs[0])
grass_c = ramp(gt, [(0.0, (0.07, 0.22, 0.05, 1)), (0.5, (0.22, 0.42, 0.09, 1)), (1.0, (0.55, 0.6, 0.2, 1))], (-650, 100))
link(gt, gnoise.outputs["Fac"], grass_c.inputs["Fac"])
rock_c = ramp(gt, [(0.0, (0.16, 0.12, 0.11, 1)), (0.6, (0.4, 0.31, 0.26, 1)), (1.0, (0.6, 0.48, 0.38, 1))], (-650, 350))
rn2 = gt.nodes.new("ShaderNodeTexNoise"); rn2.location = (-900, 400)
rn2.inputs["Scale"].default_value = 1.5
rn2.inputs["Detail"].default_value = 12
link(gt, gtc.outputs["Object"], rn2.inputs["Vector"])
link(gt, rn2.outputs["Fac"], rock_c.inputs["Fac"])
cmixc = gt.nodes.new("ShaderNodeMix"); cmixc.data_type = "RGBA"; cmixc.location = (-200, 100)
link(gt, gmask.outputs[0], cmixc.inputs["Factor"])
link(gt, rock_c.outputs["Color"], cmixc.inputs["A"])
link(gt, grass_c.outputs["Color"], cmixc.inputs["B"])
gb = gt.nodes.new("ShaderNodeBsdfDiffuse"); gb.location = (100, 100)
link(gt, cmixc.outputs["Result"], gb.inputs["Color"])
bump = gt.nodes.new("ShaderNodeBump"); bump.location = (-200, -100)
bump.inputs["Strength"].default_value = 0.6
link(gt, rn2.outputs["Fac"], bump.inputs["Height"])
link(gt, bump.outputs["Normal"], gb.inputs["Normal"])
finish_with_haze(gt, gb.outputs["BSDF"], None, base=(400, 100))

falls_m, ft = new_mat("waterfall")
fb = ft.nodes.new("ShaderNodeBsdfDiffuse"); fb.inputs["Color"].default_value = (0.85, 0.95, 1.0, 1)
fe = ft.nodes.new("ShaderNodeEmission"); fe.inputs["Color"].default_value = (0.8, 0.92, 1.0, 1); fe.inputs["Strength"].default_value = 0.6
fadd = ft.nodes.new("ShaderNodeAddShader")
link(ft, fb.outputs["BSDF"], fadd.inputs[0])
link(ft, fe.outputs["Emission"], fadd.inputs[1])
ftr = ft.nodes.new("ShaderNodeBsdfTransparent")
# fade the fall out towards its bottom using the object-space Z of the strip
ftc = ft.nodes.new("ShaderNodeTexCoord")
ftz = ft.nodes.new("ShaderNodeSeparateXYZ")
link(ft, ftc.outputs["Generated"], ftz.inputs["Vector"])
ffade = ramp(ft, [(0.0, (0, 0, 0, 1)), (0.35, (0.5, 0.5, 0.5, 1)), (1.0, (0.9, 0.9, 0.9, 1))])
link(ft, ftz.outputs["Z"], ffade.inputs["Fac"])
fmix = ft.nodes.new("ShaderNodeMixShader")
link(ft, ffade.outputs["Color"], fmix.inputs["Fac"])
link(ft, ftr.outputs["BSDF"], fmix.inputs[1])
link(ft, fadd.outputs["Shader"], fmix.inputs[2])
finish_with_haze(ft, fmix.outputs["Shader"], None, base=(500, 0))

tree_m, tt = new_mat("tree")
tb = tt.nodes.new("ShaderNodeBsdfDiffuse"); tb.inputs["Color"].default_value = (0.05, 0.16, 0.05, 1)
finish_with_haze(tt, tb.outputs["BSDF"], None, base=(300, 0))

island_info = []


def make_island(name, loc, radius, depth, top_h, tilt=0.0):
    seed = rng.random() * 100
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=1.0, location=loc)
    o = bpy.context.active_object
    o.name = name
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in bm.verts:
        n = v.co.normalized()
        ang = math.atan2(n.y, n.x)
        # wobbly outline
        wob = 1 + 0.16 * math.sin(ang * 3 + seed) + 0.09 * math.sin(ang * 7 + seed * 2) + 0.05 * math.sin(ang * 13 + seed * 3)
        if n.z >= 0:
            # plateau: flatten the top, slight dome
            v.co.x = n.x * radius * wob
            v.co.y = n.y * radius * wob
            v.co.z = n.z * top_h * (1 + 0.15 * math.sin(n.x * 5 + seed))
        else:
            t = -n.z  # 0 at the rim, 1 at the tip
            shrink = (1 - t) ** 0.85
            crag = 1 + 0.35 * math.sin(ang * 5 + t * 6 + seed) * t + 0.2 * math.sin(ang * 11 + t * 13 + seed * 2) * t
            v.co.x = n.x * radius * wob * shrink * crag
            v.co.y = n.y * radius * wob * shrink * crag
            v.co.z = -depth * (t ** 1.15) * (1 + 0.12 * math.sin(ang * 4 + seed))
    bm.to_mesh(me)
    bm.free()
    me.update()
    shade_smooth(o)
    o.rotation_euler = Euler((tilt * rng.uniform(-1, 1), tilt * rng.uniform(-1, 1), rng.uniform(0, math.tau)))
    o.data.materials.append(grass_m)
    # small displacement for rocky roughness
    t2 = bpy.data.textures.new(name + "_d", "CLOUDS")
    t2.noise_scale = 0.28
    t2.noise_depth = 4
    d = o.modifiers.new("d", "DISPLACE")
    d.texture = t2
    d.strength = radius * 0.16
    d.mid_level = 0.5

    # trees: dark cones scattered on the top
    trees = []
    for i in range(int(radius * 1.6)):
        a = rng.uniform(0, math.tau)
        rr = radius * math.sqrt(rng.random()) * 0.78
        h = rng.uniform(radius * 0.09, radius * 0.2)
        bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=h * 0.32, depth=h, location=(0, 0, 0))
        c = bpy.context.active_object
        c.location = (loc[0] + math.cos(a) * rr, loc[1] + math.sin(a) * rr, loc[2] + top_h * 0.72 + h * 0.4)
        c.data.materials.append(tree_m)
        trees.append(c)

    # waterfall: a thin tapered ribbon dropping from the rim into the mist
    a = rng.uniform(0, math.tau)
    rim = radius * 0.86
    fx, fy = loc[0] + math.cos(a) * rim, loc[1] + math.sin(a) * rim
    fall_len = depth * rng.uniform(1.5, 2.6)
    wd = radius * 0.05
    bpy.ops.mesh.primitive_plane_add(size=1, location=(fx, fy, loc[2] + top_h * 0.4 - fall_len / 2))
    f = bpy.context.active_object
    f.name = name + "_fall"
    f.scale = (wd, 1, fall_len)
    f.rotation_euler = (math.radians(90), 0, a + math.pi / 2)
    bpy.ops.object.transform_apply(scale=True, rotation=False)
    bm = bmesh.new()
    bm.from_mesh(f.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=12, use_grid_fill=True)
    bm.to_mesh(f.data)
    bm.free()
    f.data.materials.append(falls_m)

    island_info.append({
        "name": name,
        "x": loc[0], "y": loc[1], "z": loc[2],
        "radius": radius, "depth": depth,
    })
    return o


# a ring of islands: near ones are small and detailed, far ones large and hazy.
# Blender +Y is the front. Positions chosen so the view has a good composition in every direction.
SPEC = [
    # az(deg from +Y, clockwise), distance, radius, depth, height above eye
    (22, 150, 34, 60, 8),        # front-right hero island, big waterfall
    (-28, 330, 85, 130, 30),     # big island under the sun
    (68, 250, 42, 75, -10),
    (118, 210, 30, 55, 55),      # above-right-behind: underbelly visible overhead
    (165, 380, 80, 120, 25),
    (-160, 260, 45, 80, 70),     # overhead behind-left
    (-110, 300, 60, 100, -5),
    (-72, 170, 26, 45, -18),
    (-8, 620, 140, 190, 55),
    (100, 560, 110, 160, 20),
    (-135, 700, 130, 170, 45),
]
for i, (az, dist, rad, dep, hz) in enumerate(SPEC):
    a = math.radians(az)
    x, y = math.sin(a) * dist, math.cos(a) * dist
    make_island(f"island{i}", (x, y, hz), rad, dep, rad * 0.26, tilt=0.06)

with open(out.rsplit(".", 1)[0] + ".json", "w") as fh:
    json.dump({"islands": island_info, "sun": {"az_from_y_cw_deg": math.degrees(SUN_AZ), "el_deg": math.degrees(SUN_EL)}}, fh, indent=1)
print("wrote", out.rsplit(".", 1)[0] + ".json", len(island_info), "islands")

if SAMPLES > 0:
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("wrote", out)
