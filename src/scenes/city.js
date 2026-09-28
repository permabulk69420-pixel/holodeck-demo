import * as THREE from 'three';

// "High-rise window": a rainy night city from ~40 floors up.
//   far:  a Blender-rendered equirect panorama (tools/render_city.py), sampled by view
//         direction, plus live blinking aviation beacons sitting exactly on the rendered
//         towers, and a couple of planes on approach far away
//   mid:  air taxis cruising past 15-45 m out and falling rain (live 3D, parallax when you lean)
//   near: a dark window surround with mullions, and glass with rain running down it.
//         The drops refract the panorama, so each one shows a tiny upside-down city.
// Frame: the surface is the XY plane at z = 0 (w x h), "outside" is -z.

// Directions of the red beacons baked into the panorama: [x, y, z] in the window frame
// (x right, y up, -z out), written by render_city.py next to the image.
const BEACONS = [
  [0.17841, 0.33261, -0.92604], [0.15755, 0.25291, -0.95458], [0.12169, 0.23565, -0.96419],
  [0.22594, 0.22008, -0.94895], [0.06601, 0.22849, -0.97131], [0.32047, 0.19604, -0.92675],
  [0.35899, 0.17164, -0.91742], [0.26287, 0.19765, -0.94437], [0.22292, 0.13107, -0.96599],
  [0.31341, 0.1332, -0.94023], [0.11702, 0.1315, -0.98438], [0.19677, 0.16324, -0.96676],
  [0.07358, 0.19747, -0.97754], [0.0217, 0.13205, -0.991], [0.04852, 0.12364, -0.99114],
  [-0.09643, 0.13193, -0.98656],
];

const PANO_GLSL = /* glsl */ `
  vec4 samplePano(sampler2D pano, vec3 d) {
    float u = 0.5 + atan(d.x, -d.z) / 6.2831853;
    float v = 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.1415927;
    return texture2D(pano, vec2(u, v));
  }`;

let panoTex = null;
function getPano() {
  if (!panoTex) {
    panoTex = new THREE.TextureLoader().load('./assets/city.jpg');
    panoTex.colorSpace = THREE.SRGBColorSpace;
    panoTex.generateMipmaps = false;
    panoTex.minFilter = THREE.LinearFilter;
    panoTex.magFilter = THREE.LinearFilter;
  }
  return panoTex;
}

// The panorama as an environment map (three turns it into prefiltered mips itself).
// Its centre has to line up with "out the window": three's equirect puts +X at the centre
// and +Z at u = 0.75, so rotate local (-z out, +x right) onto that.
let envTex = null;
function getEnv(surfaceMatrix) {
  if (!envTex) {
    envTex = new THREE.TextureLoader().load('./assets/city.jpg');
    envTex.colorSpace = THREE.SRGBColorSpace;
    envTex.mapping = THREE.EquirectangularReflectionMapping;
  }
  const S = new THREE.Matrix4().extractRotation(surfaceMatrix);
  const M = new THREE.Matrix4().makeRotationY(-Math.PI / 2); // local -> env
  const q = new THREE.Matrix4().multiplyMatrices(S, M.clone().transpose());
  return { tex: envTex, rot: new THREE.Euler().setFromRotationMatrix(q) };
}

let glowTexCache = null;
function plasterTexture() {
  if (glowTexCache) return glowTexCache;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#6d6862';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const v = 95 + Math.random() * 25;
    g.fillStyle = `rgba(${v},${v - 4},${v - 9},0.18)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  glowTexCache = new THREE.CanvasTexture(c);
  glowTexCache.colorSpace = THREE.SRGBColorSpace;
  glowTexCache.wrapS = glowTexCache.wrapT = THREE.RepeatWrapping;
  glowTexCache.repeat.set(1.5, 1.5);
  return glowTexCache;
}

// ---- soft glowing lights (beacons, nav lights, headlights) as one Points draw each ----
// mode: 0 steady, 1 aviation blink (1 s on / 1 s off), 2 strobe (double flash), 3 slow pulse
function makeGlows(count) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('info', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); // size m, mode, phase
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute vec3 info;
      uniform float time;
      varying vec3 vCol;
      varying float vI;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = info.x * projectionMatrix[1][1] * 900.0 / max(-mv.z, 0.05);
        gl_PointSize = clamp(px, 1.5, 96.0);
        float t = time + info.z;
        float i = 1.0;
        if (info.y > 0.5 && info.y < 1.5) i = mix(0.12, 1.0, step(fract(t * 0.5), 0.45));
        else if (info.y > 1.5 && info.y < 2.5) { float f = fract(t * 0.9); i = step(f, 0.04) + step(abs(f - 0.12), 0.03); }
        else if (info.y > 2.5) i = 0.55 + 0.45 * sin(t * 3.0);
        vI = i;
        vCol = color;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vI;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float core = exp(-r2 * 18.0);
        float halo = exp(-r2 * 4.0) * 0.35;
        gl_FragColor = vec4(vCol * (core * 1.6 + halo) * vI, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  let n = 0;
  return {
    points: pts,
    add(pos, col, size, mode = 0, phase = 0) {
      const i = n++;
      geo.attributes.position.setXYZ(i, pos.x, pos.y, pos.z);
      geo.attributes.color.setXYZ(i, col[0], col[1], col[2]);
      geo.attributes.info.setXYZ(i, size, mode, phase);
      return i;
    },
    set(i, pos) { geo.attributes.position.setXYZ(i, pos.x, pos.y, pos.z); },
    commit() { geo.attributes.position.needsUpdate = true; geo.setDrawRange(0, n); },
    material: mat,
  };
}

// ---- an air taxi: small dark body with lights (a handful of triangles) ----
function makeTaxi(glows, rnd) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x101217 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 1.6), bodyMat);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 1.3), new THREE.MeshBasicMaterial({ color: 0x1a1e27 }));
  cabin.position.set(0.2, 0.55, 0);
  const pods = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 3.2), bodyMat);
  pods.position.set(-0.3, 0.1, 0);
  g.add(body, cabin, pods);
  const lights = [];
  const L = (x, y, z, col, size, mode, phase) => lights.push({ off: new THREE.Vector3(x, y, z), i: glows.add(new THREE.Vector3(), col, size, mode, phase) });
  const ph = rnd() * 10;
  L(1.65, 0.05, 0.45, [1.0, 0.95, 0.85], 0.55, 0, 0); // headlights (front is +x)
  L(1.65, 0.05, -0.45, [1.0, 0.95, 0.85], 0.55, 0, 0);
  L(-1.65, 0.1, 0.5, [1.0, 0.08, 0.05], 0.4, 0, 0);    // tail
  L(-1.65, 0.1, -0.5, [1.0, 0.08, 0.05], 0.4, 0, 0);
  L(-0.3, 0.12, 1.65, [0.1, 1.0, 0.3], 0.3, 1, ph);    // nav lights
  L(-0.3, 0.12, -1.65, [1.0, 0.1, 0.1], 0.3, 1, ph);
  L(0.2, 0.9, 0, [1.0, 1.0, 1.0], 0.45, 2, ph);        // roof strobe
  const under = [[0.2, 0.9, 1.0], [1.0, 0.3, 0.8], [1.0, 0.7, 0.2]][Math.floor(rnd() * 3)];
  L(0, -0.45, 0, under, 1.6, 3, ph);                   // underglow
  return { group: g, lights };
}

function buildRain(span, count, rnd) {
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2 * 4);
  for (let i = 0; i < count; i++) {
    const x = (rnd() - 0.5) * span;
    const z = -(1.5 + Math.pow(rnd(), 0.7) * 26);
    const y = rnd();
    const k = rnd();
    for (let e = 0; e < 2; e++) {
      pos.set([x, e, z], (i * 2 + e) * 3);
      seed.set([x, y, z, k], (i * 2 + e) * 4);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float time;
      varying float vA;
      void main() {
        float speed = 8.0 + seed.w * 3.0;
        float H = 14.0;
        float y = mod(seed.y * H - time * speed, H) - 6.0;
        float len = 0.25 + seed.w * 0.2;
        vec3 p = vec3(seed.x + y * 0.08, y, seed.z);
        p += position.y * vec3(0.08 * len, len, 0.0); // end vertex sits above the start: a streak
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -seed.z;
        vA = 0.28 * smoothstep(1.5, 3.0, d) * (1.0 - smoothstep(12.0, 28.0, d)) * (0.5 + seed.w);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() { gl_FragColor = vec4(vec3(0.62, 0.64, 0.72) * vA, 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return { lines, mat };
}

// ---- the glass: rain drops that refract the city behind them ----
function makeGlass(ow, oh, toLocal) {
  return new THREE.ShaderMaterial({
    uniforms: { pano: { value: getPano() }, toLocal: { value: toLocal }, time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      varying vec2 vUv;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        vUv = position.xy;               // metres on the glass
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D pano;
      uniform mat3 toLocal;
      uniform float time;
      varying vec3 vDir;
      varying vec2 vUv;
      ${PANO_GLSL}
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

      // beads that land, sit and slowly evaporate
      vec3 beads(vec2 uv, float cell, float t, float seed, float keep) {
        vec2 g = uv / cell + seed;
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        float h = h21(id);
        vec2 o = (vec2(h21(id + 1.3), h21(id + 7.1)) - 0.5) * 0.6;
        vec2 d = (f - o) * cell;
        float r = cell * (0.1 + 0.18 * h);
        float life = fract(t * 0.04 + h * 13.0);
        float alive = smoothstep(0.0, 0.03, life) * smoothstep(1.0, 0.7, life) * step(keep, h);
        float l = length(d * vec2(1.0, 0.9));
        float m = smoothstep(r, r * 0.75, l) * alive;
        return vec3(d / r, m);
      }

      // drops that run down the glass, wobbling, leaving a wet trail of tiny beads
      vec3 runners(vec2 uv, float t) {
        float cw = 0.13, ch = 0.9;
        float col = floor(uv.x / cw);
        float hc = h21(vec2(col, 3.7));
        float y = uv.y / ch + t * (0.12 + 0.3 * hc) + hc * 40.0;
        vec2 id = vec2(col, floor(y));
        if (h21(id) < 0.7) return vec3(0.0);
        float fy = fract(y) - 0.5;
        float wob = sin(y * 7.0 + hc * 6.0) * 0.12 + sin(y * 17.0) * 0.04;
        float x0 = (h21(id + 2.0) - 0.5) * 0.4 + wob;
        vec2 d = vec2((fract(uv.x / cw) - 0.5 - x0) * cw, fy * ch);
        float r = 0.016 + 0.01 * h21(id + 5.0);
        float drop = smoothstep(r, r * 0.7, length(d * vec2(1.0, 0.8)));
        vec2 n = d / r * drop;
        // trail above the drop
        float above = step(0.0, d.y) * (1.0 - smoothstep(0.0, 0.32, d.y));
        float tw = r * 0.45 * above;
        float tb = fract(d.y / 0.03) - 0.5;
        vec2 td = vec2(d.x, tb * 0.03);
        float tr = tw * 0.7;
        float trail = smoothstep(tr, tr * 0.6, length(td)) * above;
        n += td / max(tr, 1e-4) * trail * 0.6;
        float wet = smoothstep(r * 0.9, 0.0, abs(d.x)) * above * 0.25;
        return vec3(n, max(max(drop, trail), wet));
      }

      void main() {
        vec3 dl = normalize(toLocal * vDir);
        vec3 b1 = beads(vUv, 0.035, time, 0.0, 0.9);
        vec3 b2 = beads(vUv, 0.08, time * 0.7, 17.0, 0.85);
        vec3 rr = runners(vUv, time);
        vec2 n = b1.xy * b1.z + b2.xy * b2.z + rr.xy;
        float m = clamp(b1.z + b2.z + rr.z, 0.0, 1.0);
        // a drop is a tiny lens: it flips and shrinks what's behind it
        vec3 rd = normalize(dl + vec3(-n * 0.35, 0.0));
        vec3 c = samplePano(pano, rd).rgb;
        float rim = dot(n, n);
        c *= mix(1.05, 0.7, clamp(rim, 0.0, 1.0));
        // faint glint on the top-left of each bead
        c += vec3(0.5, 0.45, 0.4) * smoothstep(0.55, 0.9, dot(normalize(n + 1e-4), vec2(-0.6, 0.8))) * rim * m * 0.25;
        float glass = 0.04;
        float a = m * 0.8;
        // normal alpha blending does the mix; a faint dark tint stands in for the glass itself
        gl_FragColor = vec4(c * a / max(a + glass, 1e-3), clamp(a + glass, 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}

export function buildCityWindow(w, h, seed = 1, surfaceMatrix = new THREE.Matrix4()) {
  let s = seed * 7919 + 17;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const toLocal = new THREE.Matrix3().setFromMatrix4(surfaceMatrix).transpose();
  const surfaceQuat = new THREE.Quaternion().setFromRotationMatrix(surfaceMatrix);

  // ---- far: panorama + things at "infinity" that live in the same view-direction frame ----
  const far = new THREE.Group();
  far.userData.followCamera = true;
  const pano = new THREE.Mesh(
    new THREE.BoxGeometry(60, 60, 60),
    new THREE.ShaderMaterial({
      uniforms: { pano: { value: getPano() }, toLocal: { value: toLocal } },
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
        ${PANO_GLSL}
        void main() {
          gl_FragColor = samplePano(pano, normalize(toLocal * vDir));
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  far.add(pano);

  // far lights are oriented with the window and follow the head, like the panorama
  const sky = new THREE.Group();
  sky.quaternion.copy(surfaceQuat);
  far.add(sky);
  const farGlows = makeGlows(BEACONS.length + 12);
  const R = 150;
  BEACONS.forEach((d, i) => {
    const mode = i % 5 === 0 ? 0 : 1;
    farGlows.add(new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(R), [1.0, 0.08, 0.04], 1.1, mode, rnd() * 2);
  });
  // two planes on a slow approach across the sky
  const planes = [0, 1].map((k) => {
    const idx = [
      farGlows.add(new THREE.Vector3(), [1.0, 0.97, 0.9], 2.4, 0, 0),     // landing light
      farGlows.add(new THREE.Vector3(), [1.0, 0.1, 0.08], 0.7, 0, 0),     // port
      farGlows.add(new THREE.Vector3(), [0.1, 1.0, 0.3], 0.7, 0, 0),      // starboard
      farGlows.add(new THREE.Vector3(), [1.0, 1.0, 1.0], 1.2, 2, k * 0.7), // strobe
      farGlows.add(new THREE.Vector3(), [1.0, 0.1, 0.08], 0.8, 1, k),     // belly beacon
    ];
    return { idx, a0: k === 0 ? -1.1 : 0.9, dir: k === 0 ? 1 : -1, el: k === 0 ? 0.2 : 0.3, speed: 0.012 + k * 0.004, t0: k * 40 };
  });
  farGlows.commit();
  sky.add(farGlows.points);

  // ---- near + mid live in the surface frame ----
  const group = new THREE.Group();
  const local = new THREE.Group();
  group.add(local);

  const margin = THREE.MathUtils.clamp(Math.min(w, h) * 0.1, 0.06, 0.25);
  const ow = w - margin * 2, oh = h - margin * 2;
  const depth = 0.22;

  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -h / 2);
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(w / 2, h / 2);
  shape.lineTo(-w / 2, h / 2);
  shape.lineTo(-w / 2, -h / 2);
  const hole = new THREE.Path();
  hole.moveTo(-ow / 2, -oh / 2);
  hole.lineTo(-ow / 2, oh / 2);
  hole.lineTo(ow / 2, oh / 2);
  hole.lineTo(ow / 2, -oh / 2);
  hole.lineTo(-ow / 2, -oh / 2);
  shape.holes.push(hole);
  const surroundGeo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  surroundGeo.translate(0, 0, -depth);
  // Everything near reflects the city: the panorama doubles as the environment map,
  // rotated so "out the window" in the reflections matches the view.
  const env = getEnv(surfaceMatrix);
  const std = (o) => {
    const m = new THREE.MeshStandardMaterial(o);
    m.envMap = env.tex;
    m.envMapRotation.copy(env.rot);
    return m;
  };
  const plaster = std({ map: plasterTexture(), color: 0x6a645e, roughness: 0.92, metalness: 0, envMapIntensity: 0.5 });
  const reveal = std({ map: plasterTexture(), color: 0x8a7a6e, roughness: 0.85, metalness: 0, envMapIntensity: 1.3 });
  const surround = new THREE.Mesh(surroundGeo, [plaster, reveal]);
  local.add(surround);

  // frame: dark bronze aluminium with rounded profiles, catching the city lights
  const metal = std({ color: 0x7a6a5a, metalness: 1.0, roughness: 0.24, envMapIntensity: 1.5 });
  const bar = (len, pw, pd) => {
    const r = Math.min(pw, pd) * 0.28;
    const sh = new THREE.Shape();
    const x = -pw / 2, y = -pd / 2;
    sh.moveTo(x + r, y); sh.lineTo(x + pw - r, y); sh.quadraticCurveTo(x + pw, y, x + pw, y + r);
    sh.lineTo(x + pw, y + pd - r); sh.quadraticCurveTo(x + pw, y + pd, x + pw - r, y + pd);
    sh.lineTo(x + r, y + pd); sh.quadraticCurveTo(x, y + pd, x, y + pd - r);
    sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, -len / 2);
    return g;
  };
  const vbar = (x, y, len, pw, pd, z) => {
    const m = new THREE.Mesh(bar(len, pw, pd), metal);
    m.rotation.x = Math.PI / 2; // extrusion along y
    m.position.set(x, y, z);
    local.add(m);
  };
  const hbar = (x, y, len, pw, pd, z) => {
    const m = new THREE.Mesh(bar(len, pd, pw), metal); // after the turn: profile x -> depth, y -> height
    m.rotation.y = Math.PI / 2; // extrusion along x
    m.position.set(x, y, z);
    local.add(m);
  };
  const mz = -depth + 0.06;
  const panes = Math.max(1, Math.round(ow / 1.15));
  for (let i = 1; i < panes; i++) vbar(-ow / 2 + (ow * i) / panes, 0, oh, 0.055, 0.09, mz);
  const t = 0.05;
  hbar(0, oh / 2 - t / 2, ow, t, 0.1, mz);
  hbar(0, -oh / 2 + t / 2, ow, t, 0.1, mz);
  vbar(-ow / 2 + t / 2, 0, oh, t, 0.1, mz);
  vbar(ow / 2 - t / 2, 0, oh, t, 0.1, mz);
  if (oh > 1.6) hbar(0, -oh / 2 + Math.min(0.5, oh * 0.22), ow, 0.04, 0.08, mz);

  // interior trim around the opening, flush with the room
  const trimW = 0.05;
  hbar(0, oh / 2 + trimW / 2, ow + trimW * 2, trimW, 0.025, 0.012);
  vbar(-ow / 2 - trimW / 2, 0, oh, trimW, 0.025, 0.012);
  vbar(ow / 2 + trimW / 2, 0, oh, trimW, 0.025, 0.012);

  // stone sill that picks up reflections of the skyline
  const stone = std({ color: 0x2e2a27, roughness: 0.16, metalness: 0, envMapIntensity: 1.4 });
  const sill = new THREE.Mesh(new THREE.BoxGeometry(ow + 0.14, 0.035, depth + 0.12), stone);
  sill.position.set(0, -oh / 2 + 0.0175, -depth / 2 + 0.06);
  local.add(sill);

  // glass (drawn last, over the mid layer)
  const glassMat = makeGlass(ow, oh, toLocal);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(ow, oh), glassMat);
  glass.position.z = -depth + 0.02;
  local.add(glass);

  // ---- mid: rain + air taxis ----
  const span = Math.max(w, 3) * 4;
  const rain = buildRain(span * 0.6, 900, rnd);
  local.add(rain.lines);

  const glows = makeGlows(40);
  local.add(glows.points);
  const taxis = [];
  for (let i = 0; i < 3; i++) {
    const tx = makeTaxi(glows, rnd);
    const z = -(16 + i * 12 + rnd() * 6);
    const lane = { z, y: 1 + (rnd() - 0.4) * 9, speed: (5 + rnd() * 6) * (i % 2 ? -1 : 1), len: Math.abs(z) * 3.2 };
    tx.group.rotation.y = lane.speed > 0 ? 0 : Math.PI;
    tx.x = (rnd() - 0.5) * lane.len;
    tx.lane = lane;
    local.add(tx.group);
    taxis.push(tx);
  }
  glows.commit();

  const tmp = new THREE.Vector3();
  let last = null;
  function update(time) {
    const dt = last === null ? 0 : Math.min(time - last, 0.1);
    last = time;
    rain.mat.uniforms.time.value = time;
    glassMat.uniforms.time.value = time;
    glows.material.uniforms.time.value = time;
    farGlows.material.uniforms.time.value = time;

    for (const tx of taxis) {
      const L = tx.lane;
      tx.x += L.speed * dt;
      if (tx.x > L.len / 2) tx.x -= L.len;
      if (tx.x < -L.len / 2) tx.x += L.len;
      tx.group.position.set(tx.x, L.y + Math.sin(time * 0.7 + L.z) * 0.25, L.z);
      tx.group.rotation.z = Math.sin(time * 0.9 + L.z) * 0.03;
      tx.group.updateMatrix();
      for (const l of tx.lights) {
        tmp.copy(l.off).applyMatrix4(tx.group.matrix);
        glows.set(l.i, tmp);
      }
    }
    glows.commit();

    for (const p of planes) {
      // drift across the sky, slowly descending, looping every few minutes
      const u = ((time + p.t0) * p.speed) % 2.4;
      const a = p.a0 + p.dir * u;
      const el = p.el - u * 0.05;
      const c = new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el)).multiplyScalar(R);
      const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.9 * p.dir);
      farGlows.set(p.idx[0], c.clone().addScaledVector(side, 0.3));
      farGlows.set(p.idx[1], c.clone().sub(side));
      farGlows.set(p.idx[2], c.clone().add(side));
      farGlows.set(p.idx[3], c.clone().add(new THREE.Vector3(0, 0.15, 0)));
      farGlows.set(p.idx[4], c.clone().add(new THREE.Vector3(0, -0.12, 0)));
    }
    farGlows.commit();
  }

  return { group, local, far, update };
}
