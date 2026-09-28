import * as THREE from 'three';

// A "surface" is one real wall / floor / ceiling (from the Quest room scan via WebXR
// plane detection), or one side of a fake test room when there's no scan.
//
// Every surface gets a frame for portal content:
//   center, right, up, normal (normal points INTO the room, toward you)
//   width/height of the polygon measured along right/up
//   geometry: the polygon triangulated in world space (for the stencil mask)

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function buildSurface(worldPoints, label, viewerPos) {
  // centroid + normal from the polygon
  const c = new THREE.Vector3();
  worldPoints.forEach((p) => c.add(p));
  c.divideScalar(worldPoints.length);
  const n = new THREE.Vector3();
  for (let i = 0; i < worldPoints.length; i++) {
    const a = worldPoints[i], b = worldPoints[(i + 1) % worldPoints.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  n.normalize();
  if (n.lengthSq() < 0.5) return null;
  // face the room
  const toViewer = viewerPos.clone().sub(c);
  if (n.dot(toViewer) < 0) n.negate();

  const up = new THREE.Vector3();
  if (Math.abs(n.y) < 0.7) {
    up.copy(WORLD_UP).addScaledVector(n, -n.dot(WORLD_UP)).normalize();
  } else {
    // floor / ceiling: pick "up" as the horizontal direction away from the viewer
    const flat = c.clone().sub(viewerPos);
    flat.y = 0;
    if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1);
    up.copy(flat.normalize());
  }
  const right = new THREE.Vector3().crossVectors(up, n).normalize();
  up.crossVectors(n, right).normalize();

  // 2D coords on the surface, bounds
  const pts2 = worldPoints.map((p) => {
    const d = p.clone().sub(c);
    return new THREE.Vector2(d.dot(right), d.dot(up));
  });
  const box = new THREE.Box2().setFromPoints(pts2);
  const center = c.clone()
    .addScaledVector(right, (box.min.x + box.max.x) / 2)
    .addScaledVector(up, (box.min.y + box.max.y) / 2);

  // triangulate in 2D, emit world-space triangles
  const tris = THREE.ShapeUtils.triangulateShape(pts2, []);
  const positions = [];
  for (const t of tris) for (const i of t) {
    const p = worldPoints[i];
    positions.push(p.x, p.y, p.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(worldPoints.map((p) => p.clone().addScaledVector(n, 0.004))),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthTest: false }),
  );
  outline.renderOrder = 5;

  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }),
  );
  fill.renderOrder = 4;

  const matrix = new THREE.Matrix4().makeBasis(right, up, n).setPosition(center);

  return {
    label,
    center,
    right,
    up,
    normal: n,
    width: box.max.x - box.min.x,
    height: box.max.y - box.min.y,
    geometry,
    outline,
    fill,
    matrix,
    portal: null,
  };
}

// Axis-aligned fake room around a point (used on desktop, or in the headset when
// the browser gives no room scan).
export function fakeRoomPolys(center, w = 4.2, d = 4.8, h = 2.6) {
  const x0 = center.x - w / 2, x1 = center.x + w / 2;
  const z0 = center.z - d / 2, z1 = center.z + d / 2;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  return [
    { label: 'wall', pts: [V(x0, 0, z0), V(x1, 0, z0), V(x1, h, z0), V(x0, h, z0)] },
    { label: 'wall', pts: [V(x1, 0, z0), V(x1, 0, z1), V(x1, h, z1), V(x1, h, z0)] },
    { label: 'wall', pts: [V(x1, 0, z1), V(x0, 0, z1), V(x0, h, z1), V(x1, h, z1)] },
    { label: 'wall', pts: [V(x0, 0, z1), V(x0, 0, z0), V(x0, h, z0), V(x0, h, z1)] },
    { label: 'floor', pts: [V(x0, 0, z0), V(x0, 0, z1), V(x1, 0, z1), V(x1, 0, z0)] },
    { label: 'ceiling', pts: [V(x0, h, z0), V(x1, h, z0), V(x1, h, z1), V(x0, h, z1)] },
    // a window on the first wall, like the ones the room scan reports
    { label: 'window frame', pts: [V(center.x - 0.6, 0.9, z0 + 0.01), V(center.x + 0.6, 0.9, z0 + 0.01), V(center.x + 0.6, 2.0, z0 + 0.01), V(center.x - 0.6, 2.0, z0 + 0.01)] },
  ];
}
