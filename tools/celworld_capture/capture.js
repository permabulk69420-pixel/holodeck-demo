import * as THREE from 'three';
import { createWorld } from './src/world.js';
import { time, eye } from './src/materials.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
const world = createWorld();
const { scene, grass, animateLife } = world;
const details = world.details || [];

// forward, up per face; python stitching uses the same table
const FACES = [
  ['px', [1, 0, 0], [0, 1, 0]], ['nx', [-1, 0, 0], [0, 1, 0]],
  ['py', [0, 1, 0], [0, 0, 1]], ['ny', [0, -1, 0], [0, 0, -1]],
  ['pz', [0, 0, 1], [0, 1, 0]], ['nz', [0, 0, -1], [0, 1, 0]],
];

window.shoot = async (x, y, z, size, t) => {
  renderer.setSize(size, size, false);
  const cam = new THREE.PerspectiveCamera(90, 1, 0.06, 900);
  cam.position.set(x, y, z);
  time.value = t;
  eye.value.copy(cam.position);
  for (const p of grass.patches) p.mesh.visible = Math.hypot(p.x - x, p.z - z) < 73;
  for (const d of details) d.root.visible = Math.hypot(d.x - x, d.z - z) < d.distance;
  animateLife(t);
  const out = {};
  for (const [name, f, u] of FACES) {
    cam.up.set(...u);
    cam.lookAt(x + f[0], y + f[1], z + f[2]);
    cam.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    renderer.render(scene, cam);
    out[name] = canvas.toDataURL('image/png');
    await new Promise(r => setTimeout(r, 50));
  }
  return out;
};
window.captureReady = true;
