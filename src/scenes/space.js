import * as THREE from 'three';

// "Spaceship window": the whole surface becomes hull plating with a window cut in it.
//   far:  a Blender-rendered equirect panorama (planet, rings, nebula, stars), sampled by
//         view direction, so it behaves like something infinitely far away
//   mid:  asteroids drifting past a few metres out (live 3D, gives parallax when you lean)
//   near: the hull panel + window reveal, sized to the surface
// Frame: the surface is the XY plane at z = 0 (w x h), "outside" is -z.

let spaceTex = null;
function getSpaceTexture() {
  if (!spaceTex) {
    spaceTex = new THREE.TextureLoader().load('./assets/space.jpg');
    spaceTex.colorSpace = THREE.SRGBColorSpace;
    spaceTex.generateMipmaps = false;
    spaceTex.minFilter = THREE.LinearFilter;
    spaceTex.magFilter = THREE.LinearFilter;
  }
  return spaceTex;
}

let hullTex = null;
function getHullTexture() {
  if (hullTex) return hullTex;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3d42';
  g.fillRect(0, 0, 512, 512);
  // subtle grime
  for (let i = 0; i < 4000; i++) {
    const v = 50 + Math.random() * 20;
    g.fillStyle = `rgba(${v},${v + 2},${v + 5},0.25)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // panel seams: one big panel split into a few plates
  g.strokeStyle = 'rgba(15,16,18,0.9)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 508, 508);
  g.beginPath();
  g.moveTo(0, 300); g.lineTo(512, 300);
  g.moveTo(200, 0); g.lineTo(200, 300);
  g.stroke();
  g.strokeStyle = 'rgba(120,125,132,0.35)';
  g.lineWidth = 1;
  g.strokeRect(5, 5, 502, 502);
  // bolts
  g.fillStyle = '#2a2c30';
  for (const [x, y] of [[14, 14], [498, 14], [14, 498], [498, 498], [14, 286], [498, 286], [186, 14], [214, 14]]) {
    g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
  }
  hullTex = new THREE.CanvasTexture(c);
  hullTex.colorSpace = THREE.SRGBColorSpace;
  hullTex.wrapS = hullTex.wrapT = THREE.RepeatWrapping;
  hullTex.repeat.set(1 / 1.2, 1 / 1.2); // one plate per 1.2 m
  hullTex.anisotropy = 4;
  return hullTex;
}

function roundedRect(shape, x, y, w, h, r) {
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

function makeAsteroid(rnd, radius) {
  const geo = new THREE.IcosahedronGeometry(radius, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  // lumpy shape + a few craters
  const craters = Array.from({ length: 5 }, () => new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize());
  const stretch = new THREE.Vector3(1 + rnd() * 0.6, 0.7 + rnd() * 0.3, 0.8 + rnd() * 0.4);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    let d = 1 + 0.18 * Math.sin(n.x * 5 + n.y * 3) * Math.cos(n.z * 4) + 0.08 * Math.sin(n.x * 13 + n.z * 11);
    for (const c of craters) {
      const t = n.dot(c);
      if (t > 0.9) d -= (t - 0.9) * 1.2;
    }
    v.copy(n).multiplyScalar(radius * d).multiply(stretch);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const tone = 0.32 + rnd() * 0.12;
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(tone, tone * 0.95, tone * 0.9), roughness: 0.95, metalness: 0.0 });
  return new THREE.Mesh(geo, mat);
}

export function buildSpaceWindow(w, h, seed = 1) {
  let s = seed * 7919 + 17;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  const group = new THREE.Group();

  // ---- far: panorama ----
  const far = new THREE.Mesh(
    new THREE.BoxGeometry(60, 60, 60),
    new THREE.ShaderMaterial({
      uniforms: { pano: { value: getSpaceTexture() }, toLocal: { value: new THREE.Matrix3() } },
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
          vec3 d = normalize(toLocal * vDir);        // x right, y up, -z out the window
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
  far.renderOrder = 2;

  // ---- near + mid live in the surface frame ----
  const local = new THREE.Group();
  group.add(local);

  const margin = THREE.MathUtils.clamp(Math.min(w, h) * 0.14, 0.08, 0.35);
  const ow = w - margin * 2, oh = h - margin * 2;
  const r = Math.min(ow, oh) * 0.12;
  const depth = 0.32;

  const hullShape = new THREE.Shape();
  hullShape.moveTo(-w / 2, -h / 2);
  hullShape.lineTo(w / 2, -h / 2);
  hullShape.lineTo(w / 2, h / 2);
  hullShape.lineTo(-w / 2, h / 2);
  hullShape.lineTo(-w / 2, -h / 2);
  hullShape.holes.push(roundedRect(new THREE.Path(), -ow / 2, -oh / 2, ow, oh, r));
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth, bevelEnabled: false, curveSegments: 10 });
  hullGeo.translate(0, 0, -depth); // front face at the wall, reveal goes outward
  const hullMat = new THREE.MeshStandardMaterial({
    map: getHullTexture(),
    color: 0xb8bcc4,
    metalness: 0.55,
    roughness: 0.55,
  });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  local.add(hull);

  // centre mullion on wide windows
  if (ow > 1.6) {
    const mull = new THREE.Mesh(new THREE.BoxGeometry(0.07, oh, 0.08), hullMat);
    mull.position.set(0, 0, -depth + 0.06);
    local.add(mull);
  }

  // ---- mid: asteroids ----
  const rocks = [];
  const span = Math.max(w, 3) * 2.5;
  for (let i = 0; i < 9; i++) {
    const rad = 0.08 + rnd() * rnd() * 0.7;
    const m = makeAsteroid(rnd, rad);
    const z = -(3 + rnd() * 14);
    m.position.set((rnd() - 0.5) * span, (rnd() - 0.5) * Math.max(h, 2) * 2.2, z);
    m.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
    local.add(m);
    rocks.push({ m, vx: 0.05 + rnd() * 0.12, spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.25) });
  }

  // sunlight for the asteroids + hull, from the same side as the planet's lit side
  const sun = new THREE.DirectionalLight(0xfff3e6, 2.2);
  sun.position.set(-0.85, 0.25, -0.45);
  local.add(sun, sun.target);

  let last = null;
  function update(t) {
    const dt = last === null ? 0 : Math.min(t - last, 0.1);
    last = t;
    for (const r of rocks) {
      r.m.position.x += r.vx * dt;
      if (r.m.position.x > span / 2) r.m.position.x -= span;
      r.m.rotation.x += r.spin.x * dt;
      r.m.rotation.y += r.spin.y * dt;
      r.m.rotation.z += r.spin.z * dt;
    }
  }

  return { group, local, far, update };
}
