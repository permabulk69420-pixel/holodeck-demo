import * as THREE from 'three';

// Placeholder "near" scene: a live 3D fish tank that sits behind the surface.
// Frame: the window is the XY plane at z = 0 (w wide, h high), the tank extends into -z.
// Returns { group, update(t) }.

const FISH_COLORS = [0xff7a1a, 0xffd21f, 0x2f7dff, 0xff3d6e, 0x35d0c0, 0xffffff, 0x9b6bff];

export function buildFishTank(w, h, depth = 2.4, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  const group = new THREE.Group();
  const floorY = -h / 2;

  // Tank interior (back + sides + top + floor), seen from inside
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, depth),
    [
      new THREE.MeshStandardMaterial({ color: 0x0b3b5c, side: THREE.BackSide }), // +x
      new THREE.MeshStandardMaterial({ color: 0x0b3b5c, side: THREE.BackSide }), // -x
      new THREE.MeshStandardMaterial({ color: 0x1c6b8f, side: THREE.BackSide, emissive: 0x0a3550 }), // top
      new THREE.MeshStandardMaterial({ color: 0xcdb98a, side: THREE.BackSide }), // floor (sand)
      new THREE.MeshStandardMaterial({ color: 0x000000, side: THREE.BackSide, visible: false }), // front (the window)
      new THREE.MeshStandardMaterial({ color: 0x082f4a, side: THREE.BackSide, emissive: 0x04182a }), // back
    ],
  );
  walls.position.z = -depth / 2;
  group.add(walls);

  // Light inside the tank (from above)
  const light = new THREE.PointLight(0x9fe6ff, 6, Math.max(w, h, depth) * 2.5, 1.2);
  light.position.set(0, h / 2 - 0.1, -depth * 0.45);
  group.add(light);

  // Rocks
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a7266, roughness: 1, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const r = 0.08 + rnd() * 0.22;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
    rock.position.set((rnd() - 0.5) * (w - 0.4), floorY + r * 0.5, -0.4 - rnd() * (depth - 0.6));
    rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    rock.scale.y = 0.6 + rnd() * 0.5;
    group.add(rock);
  }

  // Seaweed: chains of segments that sway
  const weedMat = new THREE.MeshStandardMaterial({ color: 0x2f9a4a, roughness: 0.8 });
  const segGeo = new THREE.CylinderGeometry(0.018, 0.026, 0.13, 6);
  segGeo.translate(0, 0.065, 0);
  const weeds = [];
  for (let i = 0; i < 22; i++) {
    const root = new THREE.Group();
    root.position.set((rnd() - 0.5) * (w - 0.3), floorY, -0.3 - rnd() * (depth - 0.5));
    group.add(root);
    let parent = root;
    const segs = [];
    const n = 4 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const seg = new THREE.Mesh(segGeo, weedMat);
      if (k > 0) seg.position.y = 0.13;
      parent.add(seg);
      segs.push(seg);
      parent = seg;
    }
    weeds.push({ segs, phase: rnd() * 6.28, speed: 0.8 + rnd() * 0.8 });
  }

  // Fish (built facing +z so Object3D.lookAt points them along their path)
  const fish = [];
  for (let i = 0; i < 14; i++) {
    const color = FISH_COLORS[Math.floor(rnd() * FISH_COLORS.length)];
    const size = 0.6 + rnd() * 0.9;
    const f = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), bodyMat);
    body.scale.set(0.55, 0.9, 1.8);
    f.add(body);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.07, 4), bodyMat);
    tail.rotation.x = Math.PI / 2; // point backwards (-z)
    const tailPivot = new THREE.Group();
    tailPivot.position.z = -0.085;
    tail.position.z = -0.02;
    tailPivot.add(tail);
    f.add(tailPivot);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), eyeMat);
      eye.position.set(sx * 0.024, 0.012, 0.055);
      f.add(eye);
    }
    f.scale.setScalar(size);
    group.add(f);
    fish.push({
      obj: f,
      tail: tailPivot,
      c: new THREE.Vector3((rnd() - 0.5) * w * 0.3, (rnd() - 0.3) * h * 0.3, -depth * (0.35 + rnd() * 0.3)),
      a: new THREE.Vector3(w * (0.2 + rnd() * 0.18), h * (0.08 + rnd() * 0.12), depth * (0.15 + rnd() * 0.12)),
      f: new THREE.Vector3(0.12 + rnd() * 0.15, 0.2 + rnd() * 0.2, 0.15 + rnd() * 0.2),
      p: new THREE.Vector3(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28),
      wag: 8 + rnd() * 6,
    });
  }

  // Bubbles
  const bubbleMat = new THREE.MeshStandardMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.45, roughness: 0.1 });
  const bubbleGeo = new THREE.SphereGeometry(0.012, 8, 6);
  const bubbles = [];
  const bubbleX = (rnd() - 0.5) * (w - 0.6), bubbleZ = -0.6 - rnd() * (depth - 1);
  for (let i = 0; i < 26; i++) {
    const b = new THREE.Mesh(bubbleGeo, bubbleMat);
    b.userData.off = rnd();
    b.scale.setScalar(0.6 + rnd());
    group.add(b);
    bubbles.push(b);
  }

  const p = new THREE.Vector3(), q = new THREE.Vector3();
  const lim = new THREE.Vector3(w / 2 - 0.15, h / 2 - 0.12, 0);
  function pathAt(fd, t, out) {
    out.set(
      fd.c.x + fd.a.x * Math.sin(t * fd.f.x + fd.p.x),
      fd.c.y + fd.a.y * Math.sin(t * fd.f.y + fd.p.y),
      fd.c.z + fd.a.z * Math.sin(t * fd.f.z + fd.p.z),
    );
    out.x = THREE.MathUtils.clamp(out.x, -lim.x, lim.x);
    out.y = THREE.MathUtils.clamp(out.y, -lim.y, lim.y);
    out.z = THREE.MathUtils.clamp(out.z, -depth + 0.2, -0.25);
    return out;
  }

  function update(t) {
    for (const w of weeds) {
      w.segs.forEach((seg, k) => {
        seg.rotation.z = Math.sin(t * w.speed + w.phase + k * 0.5) * 0.14;
        seg.rotation.x = Math.cos(t * w.speed * 0.7 + w.phase + k * 0.4) * 0.08;
      });
    }
    for (const fd of fish) {
      pathAt(fd, t, p);
      pathAt(fd, t + 0.05, q);
      fd.obj.position.copy(p);
      // lookAt works in world space, so convert the point just ahead on the path
      fd.obj.lookAt(group.localToWorld(q));
      fd.tail.rotation.y = Math.sin(t * fd.wag) * 0.5;
    }
    for (const b of bubbles) {
      const k = (t * 0.18 + b.userData.off) % 1;
      b.position.set(bubbleX + Math.sin(k * 20 + b.userData.off * 9) * 0.03, floorY + k * h, bubbleZ);
    }
  }

  return { group, update };
}
