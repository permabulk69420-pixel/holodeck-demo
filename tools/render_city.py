"""Night city backdrop for the holodeck 'high-rise window'.

Renders an equirectangular panorama with Cycles, as seen from ~40 floors up on a rainy night:
  - a procedural city (tens of thousands of boxes) with a downtown cluster, setback towers,
    lit crowns and procedurally lit windows (all in one shader, driven by per-building attributes)
  - wet streets with sodium / LED street lights and car head/tail lights
  - a river with reflections, distant hills, low cloud lit orange from below
  - distance haze so the far city melts into the rain

Also writes OUT.json with the directions of the red aviation beacons on the tallest towers,
so the three.js scene can blink live lights exactly on top of the static ones.

Blender axes: +Y is "out the window" (three.js -Z), Z is up (three.js +Y), X is right (three.js +X).
Usage: python3 render_city.py OUT.png WIDTH SAMPLES   (SAMPLES 0 = skip the render, just write the JSON)
"""
import sys
import json
import math
import random
import bpy
import bmesh

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/city.png"
W = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
SAMPLES = int(sys.argv[3]) if len(sys.argv) > 3 else 32

EYE = (0.0, 0.0, 150.0)          # ~40th floor
HAZE = (0.105, 0.066, 0.05)      # colour the city fades into (matches the sky at the horizon)
FOG_DIST = 2600.0                # metres for ~63% haze

random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 3
scene.cycles.diffuse_bounces = 1
scene.cycles.glossy_bounces = 2
scene.cycles.transparent_max_bounces = 2
scene.render.resolution_x = W
scene.render.resolution_y = W // 2
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "8"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = 0.0


# ---------------------------------------------------------------- tiny node-graph helper
class G:
    """Write node math like expressions instead of wiring nodes by hand."""

    def __init__(self, nt):
        self.nt = nt

    def _in(self, sock, v):
        if hasattr(v, "is_output"):
            self.nt.links.new(v, sock)
        else:
            if isinstance(v, tuple):
                n = len(sock.default_value)
                v = (tuple(v) + (1.0,))[:n] if len(v) < n else tuple(v)[:n]
            sock.default_value = v

    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.nt.nodes.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        self._in(n.inputs[0], a)
        self._in(n.inputs[1], b)
        self._in(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b): return self.math("ADD", a, b)
    def sub(self, a, b): return self.math("SUBTRACT", a, b)
    def mul(self, a, b): return self.math("MULTIPLY", a, b)
    def div(self, a, b): return self.math("DIVIDE", a, b)
    def gt(self, a, b): return self.math("GREATER_THAN", a, b)
    def lt(self, a, b): return self.math("LESS_THAN", a, b)
    def floor(self, a): return self.math("FLOOR", a)
    def fract(self, a): return self.math("FRACT", a)
    def abs(self, a): return self.math("ABSOLUTE", a)
    def sin(self, a): return self.math("SINE", a)
    def mx(self, a, b): return self.math("MAXIMUM", a, b)
    def mn(self, a, b): return self.math("MINIMUM", a, b)
    def clamp01(self, a): return self.math("ADD", a, 0.0, clamp=True)

    def lerp(self, a, b, t):  # scalar
        return self.add(a, self.mul(self.sub(b, a), t))

    def band(self, x, lo, hi):  # 1 where lo < x < hi
        return self.mul(self.gt(x, lo), self.lt(x, hi))

    def tri(self, x, period):  # distance to the nearest multiple of period
        return self.mul(self.abs(self.sub(self.fract(self.add(self.div(x, period), 0.5)), 0.5)), period)

    def xyz(self, v):
        n = self.nt.nodes.new("ShaderNodeSeparateXYZ")
        self.nt.links.new(v, n.inputs[0])
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def vec(self, x, y, z):
        n = self.nt.nodes.new("ShaderNodeCombineXYZ")
        self._in(n.inputs[0], x)
        self._in(n.inputs[1], y)
        self._in(n.inputs[2], z)
        return n.outputs[0]

    def hash(self, x, y, z):  # white noise 0..1 per integer cell
        n = self.nt.nodes.new("ShaderNodeTexWhiteNoise")
        n.noise_dimensions = "3D"
        self.nt.links.new(self.vec(x, y, z), n.inputs["Vector"])
        return n.outputs["Value"]

    def noise(self, v, scale, detail=4.0, rough=0.5):
        n = self.nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        self.nt.links.new(v, n.inputs["Vector"])
        return n.outputs["Fac"]

    def ramp(self, fac, stops, constant=False):
        r = self.nt.nodes.new("ShaderNodeValToRGB")
        if constant:
            r.color_ramp.interpolation = "CONSTANT"
        els = r.color_ramp.elements
        while len(els) > 1:
            els.remove(els[-1])
        els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
        for p, c in stops[1:]:
            e = els.new(p)
            e.color = (*c, 1)
        self._in(r.inputs["Fac"], fac)
        return r.outputs["Color"]

    def cmix(self, a, b, t):  # colour lerp
        n = self.nt.nodes.new("ShaderNodeMix")
        n.data_type = "RGBA"
        self._in(n.inputs["Factor"], t)
        self._in(n.inputs["A"], a)
        self._in(n.inputs["B"], b)
        return n.outputs["Result"]

    def cscale(self, c, s):  # colour * scalar
        n = self.nt.nodes.new("ShaderNodeVectorMath")
        n.operation = "SCALE"
        self._in(n.inputs[0], c)
        self._in(n.inputs["Scale"], s)
        return n.outputs[0]

    def cadd(self, a, b):
        n = self.nt.nodes.new("ShaderNodeVectorMath")
        n.operation = "ADD"
        self._in(n.inputs[0], a)
        self._in(n.inputs[1], b)
        return n.outputs[0]

    def attr(self, name):
        n = self.nt.nodes.new("ShaderNodeAttribute")
        n.attribute_name = name
        return n.outputs["Vector"]

    def geometry(self):
        n = self.nt.nodes.new("ShaderNodeNewGeometry")
        return n.outputs["Position"], n.outputs["Normal"]

    def shader(self, kind, **inputs):
        n = self.nt.nodes.new(kind)
        for k, v in inputs.items():
            self._in(n.inputs[k], v)
        return n.outputs[0]

    def mix_shader(self, a, b, t):
        n = self.nt.nodes.new("ShaderNodeMixShader")
        self._in(n.inputs[0], t)
        self.nt.links.new(a, n.inputs[1])
        self.nt.links.new(b, n.inputs[2])
        return n.outputs[0]

    def add_shader(self, a, b):
        n = self.nt.nodes.new("ShaderNodeAddShader")
        self.nt.links.new(a, n.inputs[0])
        self.nt.links.new(b, n.inputs[1])
        return n.outputs[0]

    def haze(self, surf, pos, strength=1.0):
        """Blend a surface into the rainy night haze by distance from the eye."""
        vm = self.nt.nodes.new("ShaderNodeVectorMath")
        vm.operation = "DISTANCE"
        self.nt.links.new(pos, vm.inputs[0])
        vm.inputs[1].default_value = EYE
        d = vm.outputs["Value"]
        f = self.sub(1.0, self.math("EXPONENT", self.div(self.mul(d, -1.0), FOG_DIST)))
        f = self.mul(f, strength)
        em = self.shader("ShaderNodeEmission", Color=(*HAZE, 1), Strength=1.0)
        return self.mix_shader(surf, em, f)


def material(name, build):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(build(G(nt)), o.inputs["Surface"])
    return m


def river_y(x):
    return 330.0 + 70.0 * math.sin(x / 640.0) + 45.0 * math.sin(x / 230.0 + 1.3)


RIVER_HALF = 60.0

# ---------------------------------------------------------------- camera
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "PANO"
cam_data.panorama_type = "EQUIRECTANGULAR"
cam_data.clip_end = 30000
cam = bpy.data.objects.new("cam", cam_data)
cam.location = EYE
cam.rotation_euler = (math.radians(90), 0, 0)  # look along +Y
scene.collection.objects.link(cam)
scene.camera = cam

# ---------------------------------------------------------------- sky: low cloud lit by the city
world = bpy.data.worlds.new("night")
scene.world = world
world.use_nodes = True
wt = world.node_tree
wt.nodes.clear()
g = G(wt)
tc = wt.nodes.new("ShaderNodeTexCoord")
d = tc.outputs["Generated"]
dx, dy, dz = g.xyz(d)
el = g.clamp01(dz)
grad = g.math("POWER", el, 0.45)
horizon = (0.12, 0.072, 0.055)
zenith = (0.006, 0.007, 0.016)
sky = g.cmix(horizon, zenith, grad)
# cloud deck: stretched noise, brighter underneath where the city lights it
stretch = g.vec(g.mul(dx, 1.0), g.mul(dy, 1.0), g.mul(dz, 3.0))
cl = g.noise(stretch, 2.2, 8.0, 0.62)
cl2 = g.noise(stretch, 7.0, 6.0, 0.55)
cloud = g.clamp01(g.add(g.mul(g.sub(cl, 0.47), 3.4), g.mul(g.sub(cl2, 0.5), 1.1)))
lit = g.sub(1.0, g.mul(grad, 0.8))
glow = g.mul(cloud, lit)
sky = g.cmix(sky, g.cscale((0.22, 0.12, 0.08), 1.0), g.mul(glow, 0.7))
# gaps in the cloud higher up read slightly cool/violet
sky = g.cadd(sky, g.cscale((0.006, 0.005, 0.014), g.mul(g.sub(1.0, cloud), grad)))
# a patch of brighter glow over downtown
dt = wt.nodes.new("ShaderNodeVectorMath")
dt.operation = "DOT_PRODUCT"
wt.links.new(d, dt.inputs[0])
dt.inputs[1].default_value = (0.12, 0.99, 0.05)
dglow = g.mul(g.math("POWER", g.clamp01(dt.outputs["Value"]), 18.0), g.sub(1.0, grad))
sky = g.cadd(sky, g.cscale((0.06, 0.03, 0.018), dglow))
bg = wt.nodes.new("ShaderNodeBackground")
wt.links.new(sky, bg.inputs["Color"])
bg.inputs["Strength"].default_value = 1.0
wo = wt.nodes.new("ShaderNodeOutputWorld")
wt.links.new(bg.outputs[0], wo.inputs["Surface"])


# ---------------------------------------------------------------- buildings
def building_shader(g):
    pos, nrm = g.geometry()
    px, py, pz = g.xyz(pos)
    nx, ny, nz = g.xyz(nrm)
    rnd, top, style = g.xyz(g.attr("bld"))
    colw, thresh, off = g.xyz(g.attr("bld2"))

    wall = g.lt(g.abs(nz), 0.5)
    facing_x = g.gt(g.abs(nx), 0.5)
    h = g.add(g.lerp(px, py, facing_x), off)

    floor_h = 3.6
    fh = g.div(h, colw)
    col = g.floor(fh)
    fx = g.fract(fh)
    fz_raw = g.div(pz, floor_h)
    flr = g.floor(fz_raw)
    fz = g.fract(fz_raw)

    glassy = g.gt(style, 0.55)  # curtain-wall towers: bigger windows
    mx_ = g.lerp(0.16, 0.05, glassy)
    mz_lo = g.lerp(0.26, 0.1, glassy)
    mz_hi = g.lerp(0.84, 0.95, glassy)
    win = g.mul(g.band(fx, mx_, g.sub(1.0, mx_)), g.band(fz, mz_lo, mz_hi))
    win = g.mul(win, wall)
    win = g.mul(win, g.lt(pz, g.sub(top, 2.0)))

    seed = g.mul(rnd, 997.0)
    n1 = g.hash(col, flr, seed)
    lit = g.gt(n1, thresh)
    whole_floor = g.gt(g.hash(0.0, flr, g.add(seed, 7.0)), 0.9)
    lit = g.mx(lit, g.mul(whole_floor, g.gt(n1, 0.15)))
    lobby = g.lt(pz, floor_h * 1.3)
    lit = g.mx(lit, lobby)
    lit = g.mul(lit, win)

    pick = g.hash(col, flr, g.add(seed, 3.0))
    wcol = g.ramp(pick, [
        (0.0, (1.0, 0.62, 0.3)),     # warm tungsten
        (0.5, (1.0, 0.78, 0.5)),     # warm white
        (0.78, (0.78, 0.88, 1.0)),   # cool office LED
        (0.93, (0.55, 0.9, 0.85)),   # teal TV glow
        (0.97, (1.0, 0.35, 0.65)),   # magenta
    ], constant=True)
    bright = g.add(0.35, g.mul(g.hash(col, flr, g.add(seed, 5.0)), 1.1))
    # blinds: some lit windows only glow in the lower part
    blinds = g.gt(g.hash(col, flr, g.add(seed, 9.0)), 0.7)
    part = g.lerp(1.0, g.lt(fz, 0.45), blinds)
    emit_s = g.mul(g.mul(g.mul(lit, bright), part), 1.8)

    # floodlit crowns on some towers
    crown_on = g.mul(g.gt(style, 0.8), g.gt(top, 150.0))
    near_top = g.clamp01(g.div(g.sub(pz, g.sub(top, 14.0)), 14.0))
    crown = g.mul(g.mul(crown_on, near_top), wall)
    ccol = g.ramp(g.fract(g.mul(rnd, 7.0)), [
        (0.0, (0.3, 0.75, 1.0)),
        (0.4, (1.0, 0.95, 0.85)),
        (0.7, (1.0, 0.3, 0.55)),
    ], constant=True)

    # vertical LED strips on the corners of a few glassy towers
    edge = g.lt(g.abs(g.sub(fx, 0.5)), 0.49)  # 0 at column seams
    strip_on = g.mul(g.gt(style, 0.93), wall)
    strip = g.mul(strip_on, g.sub(1.0, edge))

    facade = g.ramp(rnd, [(0.0, (0.05, 0.05, 0.055)), (0.5, (0.09, 0.085, 0.08)), (1.0, (0.06, 0.065, 0.075))])
    glass_dark = (0.012, 0.016, 0.024)
    base = g.cmix(facade, glass_dark, win)
    # warm light spill from the street on the lower floors
    spill = g.mul(g.clamp01(g.sub(1.0, g.div(pz, 45.0))), 0.25)

    e = g.cscale(wcol, emit_s)
    e = g.cadd(e, g.cscale(ccol, g.mul(crown, 2.2)))
    e = g.cadd(e, g.cscale((0.25, 0.85, 1.0), g.mul(strip, 3.0)))
    e = g.cadd(e, g.cscale((0.09, 0.05, 0.025), g.mul(spill, wall)))
    diff = g.shader("ShaderNodeBsdfDiffuse", Color=base)
    em = g.shader("ShaderNodeEmission", Color=e, Strength=1.0)
    return g.haze(g.add_shader(diff, em), pos)


def ground_shader(g):
    pos, _ = g.geometry()
    px, py, pz = g.xyz(pos)
    P = 100.0
    dxs = g.tri(px, P)  # distance to street centreline running along Y
    dys = g.tri(py, P)  # ... along X
    street_x = g.lt(dxs, 10.0)
    street_y = g.lt(dys, 10.0)
    street = g.mx(street_x, street_y)

    # river + bridges every 400 m
    ry = g.add(330.0, g.add(g.mul(70.0, g.sin(g.div(px, 640.0))), g.mul(45.0, g.sin(g.add(g.div(px, 230.0), 1.3)))))
    water = g.lt(g.abs(g.sub(py, ry)), RIVER_HALF)
    bridge = g.lt(g.tri(px, 400.0), 9.0)
    water = g.mul(water, g.sub(1.0, bridge))

    # street lamps: dots along both kerbs, every 26 m
    def lamps(d_across, along, lampcol):
        kerb = g.lt(g.abs(g.sub(d_across, 9.0)), 0.9)
        spot = g.lt(g.tri(along, 26.0), 0.9)
        return g.mul(kerb, spot)

    lamp = g.mx(g.mul(lamps(dxs, py, None), street_x), g.mul(lamps(dys, px, None), street_y))
    # avenues (every 3rd street) get cold white LEDs, the rest sodium orange
    ave = g.lt(g.tri(g.add(px, py), 300.0), 30.0)
    lamp_col = g.cmix((1.0, 0.5, 0.16), (0.85, 0.92, 1.0), g.gt(g.hash(g.floor(g.div(px, P)), g.floor(g.div(py, P)), 1.0), 0.66))

    # cars: headlights (white) in one lane, tail lights (red) in the other
    def cars(d_across, along, other, seedv):
        seg = g.floor(g.div(along, 9.0))
        occupied = g.gt(g.hash(seg, g.floor(g.div(g.add(other, 50.0), P)), seedv), 0.62)
        body = g.lt(g.fract(g.div(along, 9.0)), 0.3)
        return g.mul(occupied, body)

    # which side of the centreline we're on
    side_x = g.gt(g.fract(g.add(g.div(px, P), 0.5)), 0.5)
    side_y = g.gt(g.fract(g.add(g.div(py, P), 0.5)), 0.5)
    lane_x = g.band(dxs, 2.5, 5.5)
    lane_y = g.band(dys, 2.5, 5.5)
    cx_ = g.mul(g.mul(cars(dxs, py, px, 2.0), lane_x), street_x)
    cy_ = g.mul(g.mul(cars(dys, px, py, 3.0), lane_y), street_y)
    head = g.add(g.mul(cx_, side_x), g.mul(cy_, side_y))
    tail = g.add(g.mul(cx_, g.sub(1.0, side_x)), g.mul(cy_, g.sub(1.0, side_y)))

    dry = g.sub(1.0, water)
    e = g.cscale(lamp_col, g.mul(g.mul(lamp, 10.0), dry))
    e = g.cadd(e, g.cscale((1.0, 0.95, 0.85), g.mul(g.mul(head, 9.0), dry)))
    e = g.cadd(e, g.cscale((1.0, 0.05, 0.02), g.mul(g.mul(tail, 9.0), dry)))
    # soft pools of lamp light on the wet road
    pool = g.mul(g.clamp01(g.sub(1.0, g.div(g.abs(g.sub(g.mn(dxs, dys), 8.0)), 2.5))), street)
    e = g.cadd(e, g.cscale((0.035, 0.02, 0.01), g.mul(pool, dry)))

    asphalt = g.shader("ShaderNodeBsdfPrincipled", **{"Base Color": (0.018, 0.018, 0.02, 1), "Roughness": 0.32})
    block = g.shader("ShaderNodeBsdfDiffuse", Color=(0.03, 0.028, 0.026, 1))
    surf = g.mix_shader(block, asphalt, street)
    river = g.mix_shader(g.shader("ShaderNodeBsdfDiffuse", Color=(0.002, 0.002, 0.003, 1)),
                         g.shader("ShaderNodeBsdfGlossy", Color=(0.6, 0.62, 0.66, 1), Roughness=0.09), 0.55)
    surf = g.mix_shader(surf, river, water)
    surf = g.add_shader(surf, g.shader("ShaderNodeEmission", Color=e, Strength=1.0))
    return g.haze(surf, pos)


def hills_shader(g):
    pos, _ = g.geometry()
    px, py, pz = g.xyz(pos)
    # scattered house lights on the hillsides
    cell = 60.0
    h = g.hash(g.floor(g.div(px, cell)), g.floor(g.div(py, cell)), g.floor(g.div(pz, cell)))
    dot = g.mul(g.gt(h, 0.965), g.lt(g.fract(g.mul(h, 53.0)), 0.3))
    e = g.cscale((1.0, 0.7, 0.4), g.mul(dot, 3.0))
    surf = g.add_shader(g.shader("ShaderNodeBsdfDiffuse", Color=(0.01, 0.01, 0.012, 1)),
                        g.shader("ShaderNodeEmission", Color=e, Strength=1.0))
    return g.haze(surf, pos, 0.55)


def red_light(g):
    return g.shader("ShaderNodeEmission", Color=(1.0, 0.06, 0.03, 1), Strength=60.0)


def main_centres():
    return [((160.0, 1150.0), 330.0, 480.0), ((-1050.0, 2100.0), 220.0, 420.0), ((1500.0, 2600.0), 160.0, 380.0)]


def height_at(x, y, r):
    base = 12.0 + r * r * 34.0
    boost = 0.0
    for (cx, cy), amp, sig in main_centres():
        d2 = (x - cx) ** 2 + (y - cy) ** 2
        boost += amp * math.exp(-d2 / (2 * sig * sig))
    h = base + boost * (0.3 + 0.95 * random.random() ** 1.4)
    if random.random() < 0.025:
        h = max(h, 70.0 + random.random() * 90.0)
    return h


verts, faces, attr_bld, attr_bld2 = [], [], [], []
beacons = []


def box(x0, y0, x1, y1, z0, z1, rnd, top, style, colw, thresh, off):
    i = len(verts)
    verts.extend([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                  (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)])
    for f in [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]:
        faces.append(tuple(i + k for k in f))
        attr_bld.append((rnd, top, style))
        attr_bld2.append((colw, thresh, off))


def near_river(y0, y1, x0, x1):
    for x in (x0, (x0 + x1) / 2, x1):
        ry = river_y(x)
        if y1 > ry - RIVER_HALF - 6 and y0 < ry + RIVER_HALF + 6:
            return True
    return False


P = 100.0
R_MAX = 4600.0
count = 0
for bx in range(-48, 49):
    for by in range(-48, 49):
        bx0, by0 = bx * P + 10.0, by * P + 10.0
        cx, cy = bx0 + 40.0, by0 + 40.0
        dist = math.hypot(cx, cy)
        if dist < 45.0 or dist > R_MAX:
            continue
        if near_river(by0, by0 + 80.0, bx0, bx0 + 80.0):
            continue
        if random.random() < 0.06:   # the odd park / car park
            continue
        downtown = any(math.hypot(cx - c[0][0], cy - c[0][1]) < c[2] * 1.3 for c in main_centres())
        n = random.choice([1, 2] if downtown else [2, 2, 3, 3, 4])
        lot = 80.0 / n
        for i in range(n):
            for j in range(n):
                if random.random() < 0.08:
                    continue
                gap = 2.0 + random.random() * 4.0
                x0 = bx0 + i * lot + gap
                y0 = by0 + j * lot + gap
                x1 = bx0 + (i + 1) * lot - gap
                y1 = by0 + (j + 1) * lot - gap
                r = random.random()
                h = height_at(x0, y0, r)
                style = random.random()
                colw = random.choice([2.4, 2.8, 3.2, 3.6]) if style < 0.55 else random.choice([1.6, 2.0])
                thresh = 0.58 + random.random() ** 0.7 * 0.4
                off = random.random() * 10.0
                if h > 90 and random.random() < 0.7:
                    # setback tower: podium + shaft (+ maybe a slim top)
                    ph = 20.0 + random.random() * 25.0
                    box(x0, y0, x1, y1, 0, ph, r, ph, 0.3, 3.2, thresh, off)
                    ins = (x1 - x0) * (0.12 + random.random() * 0.12)
                    sx0, sy0, sx1, sy1 = x0 + ins, y0 + ins, x1 - ins, y1 - ins
                    top1 = h if random.random() < 0.6 else h * 0.82
                    box(sx0, sy0, sx1, sy1, ph, top1, r, top1, style, colw, thresh, off)
                    top = top1
                    if top1 < h:
                        ins2 = (sx1 - sx0) * 0.22
                        box(sx0 + ins2, sy0 + ins2, sx1 - ins2, sy1 - ins2, top1, h, r, h, style, colw, thresh, off)
                        top = h
                    cx2, cy2 = (sx0 + sx1) / 2, (sy0 + sy1) / 2
                else:
                    box(x0, y0, x1, y1, 0, h, r, h, style, colw, thresh, off)
                    top = h
                    cx2, cy2 = (x0 + x1) / 2, (y0 + y1) / 2
                if top > 150:
                    beacons.append((cx2, cy2, top + 1.5))
                count += 1

# rooftop neon signs / billboards on some of the nearer, lower buildings
signs = []
for f in range(0, len(faces), 5):
    rnd, top, style = attr_bld[f]
    if top > 70 or top < 18:
        continue
    v = verts[faces[f + 4][0]]  # a roof corner
    vv = verts[faces[f + 4][2]]
    cx_, cy_ = (v[0] + vv[0]) / 2, (v[1] + vv[1]) / 2
    dd = math.hypot(cx_, cy_)
    if dd > 900 or dd < 120 or random.random() > 0.05:
        continue
    signs.append((cx_, cy_, top, abs(vv[0] - v[0]), abs(vv[1] - v[1])))
print("signs", len(signs))

# the landmark: a tall spire tower downtown
lx, ly = 210.0, 1090.0
box(lx - 22, ly - 22, lx + 22, ly + 22, 0, 60, 0.4, 60, 0.3, 3.2, 0.5, 0)
box(lx - 16, ly - 16, lx + 16, ly + 16, 60, 430, 0.61, 430, 0.9, 1.6, 0.45, 0)
box(lx - 10, ly - 10, lx + 10, ly + 10, 430, 470, 0.61, 470, 0.9, 1.6, 0.45, 0)
box(lx - 1.2, ly - 1.2, lx + 1.2, ly + 1.2, 470, 540, 0.1, 540, 0.1, 9, 1.0, 0)
beacons.append((lx, ly, 541.5))
print("buildings", count, "boxes", len(faces) // 5, "beacons", len(beacons))

me = bpy.data.meshes.new("city")
me.from_pydata(verts, [], faces)
a1 = me.attributes.new("bld", "FLOAT_VECTOR", "FACE")
a2 = me.attributes.new("bld2", "FLOAT_VECTOR", "FACE")
a1.data.foreach_set("vector", [c for v in attr_bld for c in v])
a2.data.foreach_set("vector", [c for v in attr_bld2 for c in v])
city = bpy.data.objects.new("city", me)
scene.collection.objects.link(city)
city.data.materials.append(material("buildings", building_shader))

# ground
bpy.ops.mesh.primitive_plane_add(size=30000, location=(0, 0, 0))
ground = bpy.context.active_object
ground.data.materials.append(material("ground", ground_shader))

# hills: a ring of dark ridges well past the city
bm = bmesh.new()
ring = []
N = 720
for k in range(N):
    a = 2 * math.pi * k / N
    # ridge height from a few octaves of smooth sinusoids (seamless around the ring)
    hh = 0.0
    for f, amp, ph in [(3, 170, 0.3), (7, 90, 1.7), (13, 50, 2.2), (29, 25, 0.9), (61, 12, 4.1)]:
        hh += amp * (0.5 + 0.5 * math.sin(f * a + ph))
    hh = 60 + hh * (0.6 + 0.4 * math.sin(a * 2 + 1.0) ** 2)
    r0, r1 = 7600.0, 9400.0
    ring.append((bm.verts.new((r0 * math.cos(a), r0 * math.sin(a), 0)),
                 bm.verts.new((r1 * math.cos(a), r1 * math.sin(a), hh)),
                 bm.verts.new((12000 * math.cos(a), 12000 * math.sin(a), hh * 0.6))))
for k in range(N):
    a, b = ring[k], ring[(k + 1) % N]
    bm.faces.new((a[0], b[0], b[1], a[1]))
    bm.faces.new((a[1], b[1], b[2], a[2]))
hm = bpy.data.meshes.new("hills")
bm.to_mesh(hm)
hills = bpy.data.objects.new("hills", hm)
scene.collection.objects.link(hills)
hills.data.materials.append(material("hills", hills_shader))

# signs: a thin glowing panel facing roughly toward the viewer, on legs
for k, (sx, sy, sz, w_, d_) in enumerate(signs):
    colr = random.choice([(1.0, 0.15, 0.55), (0.1, 0.85, 1.0), (1.0, 0.55, 0.1), (0.6, 0.3, 1.0), (0.2, 1.0, 0.45)])
    m = bpy.data.materials.new("sign%d" % k)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    gg = G(nt)
    pos_, _ = gg.geometry()
    # horizontal scanline bands so they read as signage, not just blobs
    _, _, pz_ = gg.xyz(pos_)
    bands = gg.lerp(0.35, 1.0, gg.gt(gg.fract(gg.div(pz_, 1.4)), 0.3))
    em_ = gg.shader("ShaderNodeEmission", Color=(*colr, 1), Strength=gg.mul(bands, 5.0))
    o_ = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(gg.haze(em_, pos_), o_.inputs["Surface"])
    sw = min(max(w_, d_) * 0.7, 26.0)
    sh = 3.0 + random.random() * 4.0
    bpy.ops.mesh.primitive_cube_add(location=(sx, sy, sz + 2.0 + sh / 2))
    ob = bpy.context.active_object
    ob.scale = (sw / 2, 0.4, sh / 2)
    ob.rotation_euler = (0, 0, math.atan2(sx, -sy) + math.pi)  # face the eye
    ob.data.materials.append(m)

# aviation beacons (static, dim; the live layer blinks on top of these). Only the tallest towers.
all_towers = sorted(beacons, key=lambda b: -b[2])
beacons = all_towers[:48]
redm = material("beacon", red_light)
for bx_, by_, bz_ in beacons:
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.6, location=(bx_, by_, bz_), segments=12, ring_count=6)
    bpy.context.active_object.data.materials.append(redm)

scene.render.filepath = out
if SAMPLES > 0:
    bpy.ops.render.render(write_still=True)
    print("wrote", out)

# beacon directions in three.js "front" coords: x right, y up, -z = the front of the view
def to_dir(b):
    vx, vy, vz = b[0] - EYE[0], b[1] - EYE[1], b[2] - EYE[2]
    L = math.sqrt(vx * vx + vy * vy + vz * vz)
    return [round(vx / L, 5), round(vz / L, 5), round(-vy / L, 5), round(L)]


dirs = [to_dir(b) for b in beacons]  # these also exist (dim) in the render
# live-only beacons on the tallest towers in every other direction, spread out
extra = []
picked = [d[:3] for d in dirs]
for b in all_towers[48:]:
    d = to_dir(b)
    if all(sum(a * c for a, c in zip(d[:3], q)) < 0.9985 for q in picked):  # ~3 degrees apart
        extra.append(d)
        picked.append(d[:3])
    if len(extra) >= 90:
        break
with open(out.rsplit(".", 1)[0] + ".json", "w") as f:
    json.dump({"eye_height": EYE[2], "beacons": dirs, "beacons_extra": extra}, f)
print("beacons", len(dirs), "extra", len(extra))
