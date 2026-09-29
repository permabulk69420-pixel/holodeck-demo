import * as THREE from 'three';

// "Sky islands": standing on a ledge above a sea of cloud at golden hour, all the way around you.
//   far:  a Blender-rendered 360 panorama (sun, cloud sea, floating islands + waterfalls),
//         sampled by view direction, so it behaves like something infinitely far away
//   mid:  live 3D that gets real parallax when you move your head:
//         - small floating rock chunks with grassy tops, bobbing and drifting past (4-18 m)
//         - a flock of birds wheeling around you (10-40 m)
//         - paper lanterns rising slowly out of the clouds, glowing warm
// Built from tools/render_sky.py (assets/sky.jpg, same sun direction as the lights below).
// frame: Matrix4 of the scene's "front" in the room (x right, y up, -z = front), at the viewer.

let skyTex = null;
function getSkyTexture() {
  if (!skyTex) {
    skyTex = new THREE.TextureLoader().load('./assets/sky.jpg');
    skyTex.colorSpace = THREE.SRGBColorSpace;
    skyTex.generateMipmaps = false;
    skyTex.minFilter = THREE.LinearFilter;
    skyTex.magFilter = THREE.LinearFilter;
  }
  return skyTex;
}

// Sun direction in the scene's front frame. Matches SUN_AZ / SUN_EL in render_sky.py
// (azimuth clockwise from the front, i.e. -z; positive = to the right).
const SUN_AZ = THREE.MathUtils.degToRad(-55);
const SUN_EL = THREE.MathUtils.degToRad(3.5);
const SUN_DIR = new THREE.Vector3(
  Math.sin(SUN_AZ) * Math.cos(SUN_EL),
  Math.sin(SUN_EL),
  -Math.cos(SUN_AZ) * Math.cos(SUN_EL),
);

function makeChunk(rnd, radius) {
  // a tiny sky island: flat grassy top, pointed rocky underside (vertex colours, flat shaded)
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const seed = rnd() * 50;
  const depth = 0.9 + rnd() * 0.9;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const ang = Math.atan2(n.z, n.x);
    const wob = 1 + 0.18 * Math.sin(ang * 3 + seed) + 0.08 * Math.sin(ang * 7 + seed * 2);
    if (n.y >= 0) {
      v.set(n.x * wob, n.y * 0.22, n.z * wob);
    } else {
      const t = -n.y;
      const shrink = Math.pow(1 - t, 0.85);
      const crag = 1 + 0.3 * Math.sin(ang * 5 + t * 6 + seed) * t;
      v.set(n.x * wob * shrink * crag, -depth * Math.pow(t, 1.15), n.z * wob * shrink * crag);
    }
    v.multiplyScalar(radius);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  // colour per triangle (flat): grass if it faces up, otherwise rock with a little variation
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i += 3) {
    const up = (nrm.getY(i) + nrm.getY(i + 1) + nrm.getY(i + 2)) / 3;
    const k = 0.85 + rnd() * 0.3;
    const c = up > 0.55 ? [0.2 * k, 0.42 * k, 0.09 * k] : [0.36 * k, 0.27 * k, 0.22 * k];
    for (let j = 0; j < 3; j++) col.set(c, (i + j) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  // a few dark fir trees on top
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x0d2a0d, roughness: 1, flatShading: true });
  const nTrees = Math.floor(radius * 2.5) + 1;
  for (let i = 0; i < nTrees; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * radius * 0.7;
    const h = radius * (0.18 + rnd() * 0.22);
    const tree = new THREE.Mesh(new THREE.ConeGeometry(h * 0.32, h, 6), treeMat);
    tree.position.set(Math.cos(a) * rr, radius * 0.2 + h * 0.4, Math.sin(a) * rr);
    mesh.add(tree);
  }
  return mesh;
}

function makeBird(mat) {
  const g = new THREE.Group();
  // built facing +z (so lookAt points it along its path); wings are flat triangles that flap
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, 0.7, 0, -0.1, 0, 0, -0.14], 3));
  wingGeo.computeVertexNormals();
  const l = new THREE.Group();
  const r = new THREE.Group();
  const wl = new THREE.Mesh(wingGeo, mat);
  const wr = new THREE.Mesh(wingGeo, mat);
  wr.scale.x = -1;
  l.add(wl);
  r.add(wr);
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 4), mat);
  body.rotation.x = Math.PI / 2;
  g.add(l, r, body);
  return { g, l, r };
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,190,90,0.9)');
  grd.addColorStop(0.35, 'rgba(255,140,50,0.35)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  x.fillStyle = grd;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSkyScene(frame, seed = 1) {
  let s = seed * 6271 + 101;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const content = new THREE.Group();

  // ---- far: panorama, following the head ----
  const far = new THREE.Mesh(
    new THREE.BoxGeometry(60, 60, 60),
    new THREE.ShaderMaterial({
      uniforms: { pano: { value: getSkyTexture() }, toLocal: { value: new THREE.Matrix3().setFromMatrix4(frame).transpose() } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDir = wp.xyz - cameraPosition;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D pano;
        uniform mat3 toLocal;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(toLocal * vDir);        // x right, y up, -z = the front of the view
          float u = 0.5 + atan(d.x, -d.z) / 6.2831853;
          float v = 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.1415927;
          gl_FragColor = texture2D(pano, vec2(u, v));
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  far.userData.followCamera = true;
  content.add(far);

  // ---- mid: everything live sits in the room frame around the viewer ----
  const mid = new THREE.Group();
  mid.matrixAutoUpdate = false;
  mid.matrix.copy(frame);
  mid.matrixWorldNeedsUpdate = true;
  content.add(mid);

  // warm low sun + cool sky fill, from the same direction as the panorama's sun
  const sun = new THREE.DirectionalLight(0xffc48a, 3.2);
  sun.position.copy(SUN_DIR).multiplyScalar(10);
  mid.add(sun, sun.target);
  mid.add(new THREE.HemisphereLight(0x8fb0e8, 0xd9906a, 0.9));

  // floating rock chunks: drift along x in their own lane, bob gently, turn slowly
  const chunks = [];
  const span = 44;
  for (let i = 0; i < 14; i++) {
    const rad = 0.35 + rnd() * rnd() * 2.2;
    const m = makeChunk(rnd, rad);
    const a = rnd() * Math.PI * 2; // lane heading around the viewer
    const r = 5 + rnd() * 14;
    const y = (rnd() - 0.4) * 10;
    m.rotation.y = rnd() * 6;
    mid.add(m);
    chunks.push({ m, x: (rnd() - 0.5) * span, y, a, r, vx: 0.08 + rnd() * 0.18, bob: rnd() * 6, bobSpeed: 0.3 + rnd() * 0.4, spin: (rnd() - 0.5) * 0.12 });
  }

  // birds: loose flocks circling at various radii and heights
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x241618, side: THREE.DoubleSide });
  const birds = [];
  const flocks = [
    { cx: -6, cz: -18, cy: 4, rad: 11, speed: 0.22, n: 9 },
    { cx: 10, cz: -30, cy: 9, rad: 16, speed: -0.16, n: 8 },
    { cx: -12, cz: 14, cy: -2, rad: 14, speed: 0.19, n: 7 },
  ];
  for (const fl of flocks) {
    for (let i = 0; i < fl.n; i++) {
      const b = makeBird(birdMat);
      const sc = 0.7 + rnd() * 0.6;
      b.g.scale.setScalar(sc);
      mid.add(b.g);
      birds.push({ ...b, fl, ph: rnd() * Math.PI * 2, dr: (rnd() - 0.5) * 4, dy: (rnd() - 0.5) * 3, flap: 5 + rnd() * 3, flapPh: rnd() * 6 });
    }
  }

  // lanterns: paper lanterns rising from below with a soft additive glow
  const glow = glowTexture();
  const lanternMat = new THREE.MeshBasicMaterial({ color: 0xffa04a });
  const lanternGeo = new THREE.SphereGeometry(0.16, 10, 8);
  lanternGeo.scale(1, 1.3, 1);
  const glowMat = new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const lanterns = [];
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(lanternGeo, lanternMat));
    const sp = new THREE.Sprite(glowMat);
    sp.scale.setScalar(1.6);
    g.add(sp);
    const a = rnd() * Math.PI * 2;
    const r = 3.5 + rnd() * 16;
    mid.add(g);
    lanterns.push({ g, a, r, k: rnd(), rise: 0.012 + rnd() * 0.012, sway: rnd() * 6 });
  }

  const v = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  let last = null;
  function update(t) {
    const dt = last === null ? 0 : Math.min(t - last, 0.1);
    last = t;

    for (const c of chunks) {
      c.x += c.vx * dt;
      if (c.x > span / 2) c.x -= span;
      v.set(c.x, c.y + Math.sin(t * c.bobSpeed + c.bob) * 0.25, -c.r).applyAxisAngle(THREE.Object3D.DEFAULT_UP, c.a);
      c.m.position.copy(v);
      c.m.rotation.y += c.spin * dt;
    }

    for (const b of birds) {
      const fl = b.fl;
      const ang = t * fl.speed + b.ph;
      const rad = fl.rad + b.dr;
      b.g.position.set(fl.cx + Math.cos(ang) * rad, fl.cy + b.dy + Math.sin(t * 0.6 + b.ph) * 0.8, fl.cz + Math.sin(ang) * rad);
      // look a little further along the circle; lookAt works in world space, so convert
      const ahead = ang + Math.sign(fl.speed) * 0.08;
      tgt.set(fl.cx + Math.cos(ahead) * rad, b.g.position.y, fl.cz + Math.sin(ahead) * rad);
      b.g.lookAt(mid.localToWorld(tgt));
      const f = Math.sin(t * b.flap + b.flapPh);
      b.l.rotation.z = f * 0.7;
      b.r.rotation.z = -f * 0.7;
    }

    for (const l of lanterns) {
      l.k += l.rise * dt;
      if (l.k > 1) l.k -= 1;
      const y = -12 + l.k * 34; // from well below the cloud tops to high overhead
      const sw = Math.sin(t * 0.5 + l.sway) * 0.5;
      v.set(sw, y, -l.r).applyAxisAngle(THREE.Object3D.DEFAULT_UP, l.a);
      l.g.position.copy(v);
    }
  }

  return { content, update };
}
