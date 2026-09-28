import * as THREE from 'three';

// "Space": floating in space near a ringed planet, all the way around you.
//   far:  a Blender-rendered 360 panorama (planet, rings, nebula, stars), sampled by
//         view direction, so it behaves like something infinitely far away
//   mid:  asteroids drifting past on all sides (live 3D, parallax when you move)
// frame: Matrix4 of the scene's "front" in the room (x right, y up, -z = front), at the viewer.

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

export function buildSpaceScene(frame, seed = 1) {
  let s = seed * 7919 + 17;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const content = new THREE.Group();

  // ---- far: panorama, following the head ----
  const far = new THREE.Mesh(
    new THREE.BoxGeometry(60, 60, 60),
    new THREE.ShaderMaterial({
      uniforms: { pano: { value: getSpaceTexture() }, toLocal: { value: new THREE.Matrix3().setFromMatrix4(frame).transpose() } },
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

  // ---- mid: asteroids drifting past on all sides, 6-22 m out ----
  const mid = new THREE.Group();
  mid.matrixAutoUpdate = false;
  mid.matrix.copy(frame);
  mid.matrixWorldNeedsUpdate = true;
  content.add(mid);

  const rocks = [];
  const span = 60;
  for (let i = 0; i < 22; i++) {
    const rad = 0.1 + rnd() * rnd() * 0.9;
    const m = makeAsteroid(rnd, rad);
    const a = rnd() * Math.PI * 2;
    const r = 6 + rnd() * 16;
    m.position.set((rnd() - 0.5) * span, (rnd() - 0.5) * 14, 0);
    m.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
    mid.add(m);
    // each rock drifts along x inside its own lane, turned to face a random heading
    rocks.push({ m, x: m.position.x, y: m.position.y, a, r, vx: 0.05 + rnd() * 0.15, spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.25) });
  }

  // sunlight for the asteroids, from the same side as the planet's lit side
  const sun = new THREE.DirectionalLight(0xfff3e6, 2.2);
  sun.position.set(-0.85, 0.25, -0.45);
  mid.add(sun, sun.target);

  const v = new THREE.Vector3();
  let last = null;
  function update(t) {
    const dt = last === null ? 0 : Math.min(t - last, 0.1);
    last = t;
    for (const r of rocks) {
      r.x += r.vx * dt;
      if (r.x > span / 2) r.x -= span;
      v.set(r.x, r.y, -r.r).applyAxisAngle(THREE.Object3D.DEFAULT_UP, r.a);
      r.m.position.copy(v);
      r.m.rotation.x += r.spin.x * dt;
      r.m.rotation.y += r.spin.y * dt;
      r.m.rotation.z += r.spin.z * dt;
    }
  }

  return { content, update };
}
