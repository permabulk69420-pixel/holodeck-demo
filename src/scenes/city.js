import * as THREE from 'three';
import { STATIC, EXTRA } from './city_beacons.js';

// "Night city": a rainy night city from ~40 floors up, all the way around you.
// One shared scene per room: every surface showing it looks into the same world, so
// each wall shows its own direction and the whole room can be opened up.
//   far:  a Blender-rendered 360 panorama (tools/render_city.py) sampled by view direction,
//         plus live blinking aviation beacons on the towers and planes on approach
//   mid:  air taxis cruising past 15-45 m out and falling rain (live 3D, parallax when you move)
// frame: Matrix4 of the scene's "front" in the room (x right, y up, -z = front of the view),
//        positioned at the viewer. Built by main.js from the first surface it's put on.

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

function buildRain(count, rnd) {
  // streaks in a ring around the viewer, 6-30 m out, so they're outside any real room
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2 * 4);
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 6 + Math.pow(rnd(), 0.8) * 24;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
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
        float H = 16.0;
        float y = mod(seed.y * H - time * speed, H) - 8.0;
        float len = 0.25 + seed.w * 0.2;
        vec3 p = vec3(seed.x + y * 0.08, y, seed.z);
        p += position.y * vec3(0.08 * len, len, 0.0); // end vertex sits above the start: a streak
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = length(seed.xz);
        vA = 0.3 * (1.0 - smoothstep(14.0, 30.0, d)) * (0.5 + seed.w);
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

export function buildCityScene(frame, seed = 1) {
  let s = seed * 7919 + 17;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const toLocal = new THREE.Matrix3().setFromMatrix4(frame).transpose();
  const frameQuat = new THREE.Quaternion().setFromRotationMatrix(frame);
  const content = new THREE.Group();

  // ---- far: panorama + things at "infinity", following the head ----
  const far = new THREE.Group();
  far.userData.followCamera = true;
  content.add(far);
  far.add(new THREE.Mesh(
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
  ));

  const sky = new THREE.Group();
  sky.quaternion.copy(frameQuat);
  far.add(sky);
  const farGlows = makeGlows(STATIC.length + EXTRA.length + 12);
  const R = 150;
  [...STATIC, ...EXTRA].forEach((d, i) => {
    const mode = i % 5 === 0 ? 0 : 1; // most blink, a few burn steady
    farGlows.add(new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(R), [1.0, 0.08, 0.04], 1.1, mode, rnd() * 2);
  });
  // two planes on a slow approach, crossing the sky in opposite directions
  const planes = [0, 1].map((k) => ({
    idx: [
      farGlows.add(new THREE.Vector3(), [1.0, 0.97, 0.9], 2.4, 0, 0),     // landing light
      farGlows.add(new THREE.Vector3(), [1.0, 0.1, 0.08], 0.7, 0, 0),     // port
      farGlows.add(new THREE.Vector3(), [0.1, 1.0, 0.3], 0.7, 0, 0),      // starboard
      farGlows.add(new THREE.Vector3(), [1.0, 1.0, 1.0], 1.2, 2, k * 0.7), // strobe
      farGlows.add(new THREE.Vector3(), [1.0, 0.1, 0.08], 0.8, 1, k),     // belly beacon
    ],
    a0: k === 0 ? -1.1 : 2.4, dir: k === 0 ? 1 : -1, el: k === 0 ? 0.2 : 0.28, speed: 0.012 + k * 0.004, t0: k * 40,
  }));
  farGlows.commit();
  sky.add(farGlows.points);

  // ---- mid: rain + air taxis, in the room at the scene's origin ----
  const mid = new THREE.Group();
  mid.matrixAutoUpdate = false;
  mid.matrix.copy(frame);
  mid.matrixWorldNeedsUpdate = true;
  content.add(mid);

  const rain = buildRain(1400, rnd);
  mid.add(rain.lines);

  const glows = makeGlows(80);
  mid.add(glows.points);
  // straight lanes past the building at different headings, heights and distances
  const taxis = [];
  for (let i = 0; i < 7; i++) {
    const tx = makeTaxi(glows, rnd);
    const heading = (i / 7) * Math.PI * 2 + rnd() * 0.6;
    const dist = 15 + rnd() * 30;
    const lane = { heading, dist, y: (rnd() - 0.45) * 12, speed: (5 + rnd() * 6) * (rnd() < 0.5 ? -1 : 1), len: dist * 3.5 };
    tx.x = (rnd() - 0.5) * lane.len;
    tx.lane = lane;
    mid.add(tx.group);
    taxis.push(tx);
  }
  glows.commit();

  const tmp = new THREE.Vector3();
  const laneRot = new THREE.Matrix4();
  const taxiRot = new THREE.Matrix4();
  let last = null;
  function update(time) {
    const dt = last === null ? 0 : Math.min(time - last, 0.1);
    last = time;
    rain.mat.uniforms.time.value = time;
    glows.material.uniforms.time.value = time;
    farGlows.material.uniforms.time.value = time;

    for (const tx of taxis) {
      const L = tx.lane;
      tx.x += L.speed * dt;
      if (tx.x > L.len / 2) tx.x -= L.len;
      if (tx.x < -L.len / 2) tx.x += L.len;
      // lane frame: runs along x at distance dist in front (-z), turned by heading
      laneRot.makeRotationY(L.heading);
      tx.group.position.set(tx.x, L.y + Math.sin(time * 0.7 + L.dist) * 0.25, -L.dist).applyMatrix4(laneRot);
      taxiRot.makeRotationY(L.heading + (L.speed > 0 ? 0 : Math.PI));
      tx.group.quaternion.setFromRotationMatrix(taxiRot);
      tx.group.rotateX(Math.sin(time * 0.9 + L.dist) * 0.03);
      tx.group.updateMatrix();
      for (const l of tx.lights) {
        tmp.copy(l.off).applyMatrix4(tx.group.matrix);
        glows.set(l.i, tmp);
      }
    }
    glows.commit();

    for (const p of planes) {
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

  return { content, update };
}
