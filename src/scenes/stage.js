import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stencilize } from '../portals.js';

// A live "stage" for the near field: a floor that fades into the panorama behind it, plus GLB
// props (trees, bushes, ferns...) scattered on it with contact shadows, lit to match the
// panorama's sun. Meant to be stacked over a panorama with composeLayers.
//
// Everything is positioned in the scene's front frame (x right, y up, -z front, origin at the
// viewer's head when the scene was first assigned); the floor sits at real floor level.
// Props are merged per material and drawn as instances, so each kind costs a few draw calls
// however many copies there are (important on Quest).
//
// cfg = {
//   seed, floor: { texture, tileMetres, radius, fadeStart, tint:[r,g,b] (sRGB multipliers) },
//   sun: { dir:[x,y,z] (frame coords, toward the sun), color, intensity },
//   hemi: { sky, ground, intensity },
//   kinds: [{ url, count, scale:[min,max], r:[min,max], foot (metres across at scale 1), shadow (0..1), yLift }]
// }

const loader = new GLTFLoader();
const modelCache = new Map();

// Load a GLB and collapse it to a few { geometry, material } parts: node transforms baked in,
// meshes merged per material. Returns { parts, height, width }.
function loadParts(url) {
  let p = modelCache.get(url);
  if (p) return p;
  p = loader.loadAsync(url).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const byMat = new Map();
    gltf.scene.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
    });
    const parts = [];
    const box = new THREE.Box3();
    for (const [material, geos] of byMat) {
      // merge needs identical attribute sets and indexing
      const common = ['position', 'normal', 'uv', 'color'].filter((n) => geos.every((g) => g.attributes[n]));
      const clean = geos.map((g) => {
        const c = new THREE.BufferGeometry();
        for (const n of common) c.setAttribute(n, g.attributes[n]);
        c.setIndex(g.index);
        return c;
      });
      const indexed = clean.every((g) => g.index);
      const prepared = indexed ? clean : clean.map((g) => (g.index ? g.toNonIndexed() : g));
      const geometry = prepared.length === 1 ? prepared[0] : mergeGeometries(prepared, false);
      if (!geometry) continue;
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox);
      parts.push({ geometry, material });
    }
    const size = box.getSize(new THREE.Vector3());
    return { parts, height: size.y, width: Math.max(size.x, size.z), baseY: box.min.y };
  });
  modelCache.set(url, p);
  return p;
}

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildStage(frame, ref, cfg) {
  let s = (cfg.seed ?? 1) * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  const content = new THREE.Group();
  const stage = new THREE.Group();
  stage.matrixAutoUpdate = false;
  stage.matrix.copy(frame);
  stage.matrixWorldNeedsUpdate = true;
  content.add(stage);
  const floorY = -frame.elements[13]; // frame origin is at head height; real floor is world y = 0

  // ---- lights matched to the panorama ----
  const sun = new THREE.DirectionalLight(cfg.sun.color, cfg.sun.intensity);
  sun.position.set(...cfg.sun.dir).multiplyScalar(50);
  stage.add(sun, sun.target);
  stage.add(new THREE.HemisphereLight(cfg.hemi.sky, cfg.hemi.ground, cfg.hemi.intensity));

  // ---- floor: tiled texture, fades into the panorama's own ground toward the edge ----
  const F = cfg.floor;
  const tex = new THREE.TextureLoader().load(F.texture);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((F.radius * 2) / F.tileMetres, (F.radius * 2) / F.tileMetres);
  tex.anisotropy = 8;
  const fade = radialTexture([[0, '#fff'], [F.fadeStart, '#fff'], [1, '#000']]);
  fade.colorSpace = THREE.NoColorSpace;
  const tint = new THREE.Color().setRGB(F.tint[0], F.tint[1], F.tint[2], THREE.SRGBColorSpace);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(F.radius, 96),
    new THREE.MeshBasicMaterial({ map: tex, alphaMap: fade, color: tint, transparent: true }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.userData.renderOrder = 2;
  stage.add(floor);

  // ---- placement (deterministic) ----
  const placed = [];
  const plan = cfg.kinds.map((k) => {
    const items = [];
    for (let i = 0; i < k.count; i++) {
      for (let tries = 0; tries < 300; tries++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(k.r[0] * k.r[0] + rnd() * (k.r[1] * k.r[1] - k.r[0] * k.r[0]));
        const sc = k.scale[0] + rnd() * (k.scale[1] - k.scale[0]);
        const x = Math.cos(a) * r, z = Math.sin(a) * r, rad = (k.foot * sc) / 2;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < (p.rad + rad) * 0.85)) continue;
        placed.push({ x, z, rad });
        items.push({ x, z, sc, yaw: rnd() * Math.PI * 2 });
        break;
      }
    }
    return items;
  });

  // ---- contact shadows: one instanced mesh of soft dark discs on the floor ----
  const total = plan.reduce((n, it) => n + it.length, 0);
  const blob = radialTexture([[0, 'rgba(0,0,0,0.55)'], [0.55, 'rgba(0,0,0,0.28)'], [1, 'rgba(0,0,0,0)']]);
  const shadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    Math.max(total, 1),
  );
  shadows.userData.renderOrder = 3;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  let si = 0;
  cfg.kinds.forEach((k, ki) => {
    for (const it of plan[ki]) {
      const d = k.foot * it.sc * (k.shadow ?? 1) * 1.3;
      m.compose(pos.set(it.x, floorY + 0.02, it.z), q.identity(), scl.set(d, 1, d));
      shadows.setMatrixAt(si++, m);
    }
  });
  shadows.count = si;
  shadows.instanceMatrix.needsUpdate = true;
  stage.add(shadows);

  // ---- props: load each kind once, then draw all copies as instances ----
  cfg.kinds.forEach((k, ki) => {
    loadParts(k.url).then(({ parts, baseY }) => {
      const group = new THREE.Group();
      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, Math.max(plan[ki].length, 1));
        plan[ki].forEach((it, i) => {
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, it.yaw);
          m.compose(pos.set(it.x, floorY - baseY * it.sc + (k.yLift ?? 0), it.z), q, scl.setScalar(it.sc));
          inst.setMatrixAt(i, m);
        });
        inst.count = plan[ki].length;
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
      }
      stencilize(group, ref); // props arrive after main.js stencilised the scene, so mask them here
      stage.add(group);
    }).catch((e) => console.warn('[stage] could not load', k.url, e));
  });

  return { content, update: null };
}
