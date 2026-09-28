import * as THREE from 'three';

// Placeholder "far" scenes. They're rendered once into a cubemap (six-sided capture),
// which is how Kane's own three.js scenes would be brought in later.

export function captureCube(renderer, scene, at = new THREE.Vector3(), size = 1024) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cam = new THREE.CubeCamera(0.1, 10000, rt);
  cam.position.copy(at);
  scene.add(cam);
  const prevXr = renderer.xr.enabled;
  renderer.xr.enabled = false;
  cam.update(renderer, scene);
  renderer.xr.enabled = prevXr;
  scene.remove(cam);
  return rt.texture;
}

// --- tiny value-noise for terrain ---
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  let f = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 6; i++) {
    f += amp * noise(x * freq, y * freq);
    amp *= 0.5;
    freq *= 2.03;
  }
  return f;
}

export function buildMountains() {
  const scene = new THREE.Scene();
  const horizon = new THREE.Color(0xc9d6e3);
  scene.fog = new THREE.Fog(horizon, 400, 4200);

  // sky
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(5000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = clamp(vP.y, 0., 1.);
          vec3 zen = vec3(0.23,0.42,0.72), hor = vec3(0.79,0.84,0.89);
          vec3 c = mix(hor, zen, pow(h, 0.55));
          vec3 sunDir = normalize(vec3(0.5,0.25,-0.8));
          float s = max(dot(normalize(vP), sunDir), 0.);
          c += vec3(1.,0.9,0.7) * (pow(s, 600.)*4. + pow(s, 12.)*0.25);
          gl_FragColor = vec4(c,1.);
          #include <colorspace_fragment>
        }`,
    }),
  );
  scene.add(sky);

  // terrain: a valley around the viewer rising into ranges further out
  const size = 9000, seg = 320;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x5d7a3a), rock = new THREE.Color(0x6e6a66), snow = new THREE.Color(0xf4f6f8);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.sqrt(x * x + z * z);
    const rise = THREE.MathUtils.smoothstep(d, 250, 2600);
    const n = fbm(x / 900, z / 900);
    const ridged = 1 - Math.abs(fbm(x / 600 + 7, z / 600 + 3) * 2 - 1);
    const h = rise * (n * 700 + ridged * ridged * 900) + fbm(x / 120, z / 120) * 25;
    pos.setY(i, h);
    const t = h / 1100;
    if (t < 0.25) tmp.copy(grass);
    else if (t < 0.62) tmp.copy(grass).lerp(rock, THREE.MathUtils.smoothstep(t, 0.25, 0.45));
    else tmp.copy(rock).lerp(snow, THREE.MathUtils.smoothstep(t, 0.62, 0.72));
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(terrain);

  // a lake in the valley
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(420, 48).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x3f6f8f }),
  );
  lake.position.set(0, 8, -520);
  scene.add(lake);

  scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x3a3a2a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
  sun.position.set(0.5, 0.35, -0.8);
  scene.add(sun);

  const eye = new THREE.Vector3(0, fbm(0, 0) * 25 + 30, 0);
  return { scene, eye };
}

export function buildStars() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020308);
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

  function addStars(count, size, bright, band = false) {
    const p = new Float32Array(count * 3), c = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    const tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      if (band) {
        // concentrate around a tilted great circle (a faint Milky Way)
        const a = rnd() * Math.PI * 2;
        const spread = (rnd() + rnd() + rnd() - 1.5) * 0.18;
        v.set(Math.cos(a), spread, Math.sin(a)).normalize().applyAxisAngle(new THREE.Vector3(1, 0, 0.3).normalize(), 1.0);
      } else {
        v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      }
      v.multiplyScalar(800);
      p.set([v.x, v.y, v.z], i * 3);
      const k = bright * (0.4 + rnd() * 0.6);
      tint.setHSL(0.55 + (rnd() - 0.5) * 0.25, 0.4 * rnd(), 0.5);
      c.set([k * (0.8 + tint.r * 0.4), k * (0.8 + tint.g * 0.4), k * (0.8 + tint.b * 0.4)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true })));
  }
  addStars(9000, 1.2, 0.55);
  addStars(2500, 1.8, 0.85);
  addStars(250, 3.0, 1.0);
  addStars(14000, 1.0, 0.28, true);
  return { scene, eye: new THREE.Vector3() };
}
