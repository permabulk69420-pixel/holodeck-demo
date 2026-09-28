import * as THREE from 'three';
import { buildSurface, fakeRoomPolys } from './surfaces.js';
import { allocRef, releaseRef, makeMask, stencilize, makeCubeWindow } from './portals.js';
import { captureCube, buildMountains, buildStars } from './scenes/far.js';
import { buildFishTank } from './scenes/fishtank.js';
import { Picker } from './picker.js';

const statusEl = document.getElementById('status');
const enterBtn = document.getElementById('enter');
const params = new URLSearchParams(location.search);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 1.6, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(1, 3, 2);
scene.add(dirLight);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- scene library ----------
// Far scenes are captured once into cubemaps (six-sided camera capture).
const mountains = buildMountains();
const stars = buildStars();
const cubes = {
  mountains: captureCube(renderer, mountains.scene, mountains.eye),
  stars: captureCube(renderer, stars.scene, stars.eye),
};
// For comparison: the fish tank captured as a cubemap, to see why near things need live 3D.
{
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
  const tank = buildFishTank(3, 2.2, 2.4, 3);
  tank.update(4);
  s.add(tank.group);
  cubes.fishStatic = captureCube(renderer, s, new THREE.Vector3(0, 0, 1.6));
}

const OPTIONS = [
  { id: 'mountains', title: 'Mountains', sub: 'far · cubemap' },
  { id: 'stars', title: 'Stars', sub: 'far · cubemap' },
  { id: 'fish', title: 'Fish tank', sub: 'near · live 3D' },
  { id: 'fishStatic', title: 'Fish tank', sub: 'as cubemap (compare)' },
  { id: 'clear', title: 'Clear', sub: 'back to your real wall' },
];

// ---------- surfaces ----------
const surfaces = [];
const surfaceRoot = new THREE.Group();
scene.add(surfaceRoot);
const portalRoot = new THREE.Group();
scene.add(portalRoot);

function addSurface(s) {
  surfaces.push(s);
  surfaceRoot.add(s.outline, s.fill);
  s.fill.userData.surface = s;
}
function clearSurfaces() {
  for (const s of surfaces) clearPortal(s);
  surfaces.length = 0;
  surfaceRoot.clear();
}
function useFakeRoom(center) {
  clearSurfaces();
  const viewer = new THREE.Vector3(center.x, 1.6, center.z);
  for (const p of fakeRoomPolys(center)) {
    const s = buildSurface(p.pts, p.label, viewer);
    if (s) addSurface(s);
  }
}

// ---------- portals ----------
const updaters = new Set();

function clearPortal(s) {
  if (!s.portal) return;
  portalRoot.remove(s.portal.mask, s.portal.content);
  if (s.portal.update) updaters.delete(s.portal.update);
  releaseRef(s.portal.ref);
  s.portal = null;
}

function assign(s, id) {
  clearPortal(s);
  if (id === 'clear') return;
  const ref = allocRef();
  const mask = makeMask(s.geometry, ref);
  let content, update = null;
  if (id === 'fish') {
    const tank = buildFishTank(s.width, s.height, 2.4, ref);
    content = new THREE.Group();
    content.matrixAutoUpdate = false;
    content.matrix.copy(s.matrix);
    content.matrixWorldNeedsUpdate = true;
    content.add(tank.group);
    update = tank.update;
  } else {
    content = makeCubeWindow(cubes[id], s.matrix);
  }
  stencilize(content, ref);
  portalRoot.add(mask, content);
  if (update) updaters.add(update);
  s.portal = { ref, mask, content, update, id };
}

// ---------- picker / input ----------
const picker = new Picker(OPTIONS);
scene.add(picker.group);
const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 0;

function pick(origin, dir) {
  raycaster.set(origin, dir);
  if (picker.group.visible) {
    const hit = raycaster.intersectObjects(picker.buttons, false)[0];
    if (hit) return { button: hit.object, point: hit.point, distance: hit.distance };
  }
  const hit = raycaster.intersectObjects(surfaces.map((s) => s.fill), false)[0];
  if (hit) return { surface: hit.object.userData.surface, point: hit.point, distance: hit.distance };
  return null;
}

let hovered = new Set();
function applyHover(hits) {
  const surfs = new Set();
  let btn = null;
  for (const h of hits) {
    if (!h) continue;
    if (h.surface) surfs.add(h.surface);
    if (h.button) btn = h.button;
  }
  for (const s of surfaces) {
    const on = surfs.has(s);
    s.outline.material.opacity = on ? 0.95 : s.portal ? 0.0 : 0.25;
    s.outline.material.color.set(on ? 0x7fd4ff : 0xffffff);
    s.fill.material.opacity = on && !s.portal ? 0.08 : 0.0;
  }
  picker.setHover(btn);
  hovered = surfs;
}

function select(hit, viewerPos) {
  if (hit?.button) {
    if (picker.surface) assign(picker.surface, hit.button.userData.opt.id);
    picker.close();
  } else if (hit?.surface) {
    picker.openFor(hit.surface, hit.point, viewerPos);
  } else {
    picker.close();
  }
}

// XR controllers
const controllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
  );
  line.scale.z = 3;
  line.renderOrder = 6;
  c.add(line);
  c.userData.line = line;
  c.addEventListener('connected', (e) => { c.userData.inputSource = e.data; line.visible = e.data.targetRayMode === 'tracked-pointer'; });
  c.addEventListener('select', () => {
    const { origin, dir } = controllerRay(c);
    select(pick(origin, dir), viewerPos);
  });
  scene.add(c);
  return c;
});
function controllerRay(c) {
  const origin = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld);
  return { origin, dir };
}

// Desktop: drag to look, click to pick
let yaw = 0, pitch = 0, dragging = false, moved = 0;
const mouse = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; moved = 0; });
addEventListener('pointerup', (e) => {
  const wasDrag = dragging;
  dragging = false;
  if (wasDrag && moved < 5 && !renderer.xr.isPresenting) {
    mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    select(pick(raycaster.ray.origin, raycaster.ray.direction), camera.position);
  }
});
addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (!dragging) return;
  moved += Math.abs(e.movementX) + Math.abs(e.movementY);
  yaw -= e.movementX * 0.004;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.004, -1.4, 1.4);
});

// ---------- in-headset status note ----------
const note = (() => {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 160;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.64, 0.1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  mesh.renderOrder = 11;
  mesh.visible = false;
  scene.add(mesh);
  return {
    show(text) {
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = 'rgba(20,22,28,0.85)';
      g.beginPath(); g.roundRect(4, 4, c.width - 8, c.height - 8, 40); g.fill();
      g.fillStyle = '#fff';
      g.font = '500 44px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, c.width / 2, c.height / 2);
      tex.needsUpdate = true;
      // 1 m in front of you, a bit below eye level
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(renderer.xr.getCamera().quaternion);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      mesh.position.copy(viewerPos).addScaledVector(fwd, 1.0);
      mesh.position.y -= 0.25;
      mesh.lookAt(viewerPos.x, mesh.position.y, viewerPos.z);
      mesh.visible = true;
    },
    hide() { mesh.visible = false; },
  };
})();

// ---------- XR session ----------
let xrMode = null;
let planesSeen = new Map(); // XRPlane -> { surface, changed }
let sessionStart = 0;
let usingFake = false;
let roomCaptureAsked = false;
let xrSession = null;

async function detectXR() {
  if (!navigator.xr) return null;
  if (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false)) return 'immersive-ar';
  if (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)) return 'immersive-vr';
  return null;
}

detectXR().then((mode) => {
  xrMode = mode;
  if (!mode) {
    enterBtn.textContent = 'No WebXR here — desktop preview';
    return;
  }
  enterBtn.disabled = false;
  enterBtn.textContent = mode === 'immersive-ar' ? 'Enter Holodeck' : 'Enter (VR, no passthrough)';
});

enterBtn.addEventListener('click', async () => {
  const session = await navigator.xr.requestSession(xrMode, {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['plane-detection', 'hand-tracking'],
  });
  clearSurfaces();
  planesSeen = new Map();
  usingFake = false;
  roomCaptureAsked = false;
  xrSession = session;
  sessionStart = performance.now();
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  await renderer.xr.setSession(session);
  session.addEventListener('end', () => {
    note.hide();
    xrSession = null;
    clearSurfaces();
    useFakeRoom(new THREE.Vector3());
    usingFake = true;
  });
});

const viewerPos = new THREE.Vector3(0, 1.6, 0);
const tmpM = new THREE.Matrix4();

function syncPlanes(frame) {
  const ref = renderer.xr.getReferenceSpace();
  const planes = frame.detectedPlanes;
  if (planes && planes.size) {
    if (usingFake) { clearSurfaces(); planesSeen = new Map(); usingFake = false; note.hide(); }
    for (const plane of planes) {
      const known = planesSeen.get(plane);
      if (known && known.changed === plane.lastChangedTime) continue;
      const pose = frame.getPose(plane.planeSpace, ref);
      if (!pose) continue;
      tmpM.fromArray(pose.transform.matrix);
      const pts = plane.polygon.map((p) => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(tmpM));
      if (known) {
        clearPortal(known.surface);
        surfaceRoot.remove(known.surface.outline, known.surface.fill);
        surfaces.splice(surfaces.indexOf(known.surface), 1);
      }
      const s = buildSurface(pts, plane.semanticLabel || plane.orientation, viewerPos);
      if (s) {
        addSurface(s);
        planesSeen.set(plane, { surface: s, changed: plane.lastChangedTime });
      }
    }
  } else if (performance.now() - sessionStart > 2500 && surfaces.length === 0 && !usingFake) {
    // No room scan for this space. On Quest the browser can open Space Setup for us;
    // once it's done the planes arrive and replace the test room automatically.
    if (!roomCaptureAsked && xrSession && typeof xrSession.initiateRoomCapture === 'function') {
      roomCaptureAsked = true;
      xrSession.initiateRoomCapture().catch(() => {});
    }
    useFakeRoom(new THREE.Vector3(viewerPos.x, 0, viewerPos.z));
    usingFake = true;
    note.show(roomCaptureAsked ? 'No room scan yet: test room for now' : 'No room scan available: test room');
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();
useFakeRoom(new THREE.Vector3());
usingFake = true;
scene.background = new THREE.Color(0x1a1b21);
{
  const grid = new THREE.GridHelper(20, 40, 0x444444, 0x2a2a2a);
  grid.userData.desktopOnly = true;
  scene.add(grid);
  renderer.xr.addEventListener('sessionstart', () => (grid.visible = false));
  renderer.xr.addEventListener('sessionend', () => { grid.visible = true; scene.background = new THREE.Color(0x1a1b21); });
}

// optional: preassign for quick looks, e.g. ?demo=1
if (params.has('demo')) {
  const [back, right, , left, floor, ceiling] = surfaces;
  assign(back, 'fish');
  assign(right, 'mountains');
  assign(left, 'fishStatic');
  assign(ceiling, 'stars');
}
if (params.has('yaw')) yaw = parseFloat(params.get('yaw'));
if (params.has('pitch')) pitch = parseFloat(params.get('pitch'));
if (params.has('x')) camera.position.x = parseFloat(params.get('x'));

renderer.setAnimationLoop((time, frame) => {
  const t = clock.getElapsedTime();
  const hits = [];

  if (renderer.xr.isPresenting && frame) {
    const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
    if (pose) viewerPos.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
    syncPlanes(frame);
    for (const c of controllers) {
      if (!c.userData.inputSource) continue;
      const { origin, dir } = controllerRay(c);
      const h = pick(origin, dir);
      c.userData.line.scale.z = h ? h.distance : 3;
      hits.push(h);
    }
  } else {
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    viewerPos.copy(camera.position);
    raycaster.setFromCamera(mouse, camera);
    hits.push(pick(raycaster.ray.origin, raycaster.ray.direction));
  }
  applyHover(hits);

  // cube windows sit around the viewer so they behave like distant views
  for (const s of surfaces) {
    if (s.portal?.content.userData.followCamera) s.portal.content.position.copy(viewerPos);
  }
  for (const u of updaters) u(t);

  statusEl.textContent = renderer.xr.isPresenting ? '' :
    `${surfaces.length} surfaces · drag to look · click a wall`;
  renderer.render(scene, camera);
});
