import * as THREE from 'three';

// Each assigned surface gets its own stencil value (1..255).
// 1) The surface polygon is drawn invisibly, writing that value into the stencil buffer.
// 2) The portal content only draws where the stencil equals that value.
// Result: the content is only visible "through" that wall/ceiling/floor, like a window.

let nextRef = 1;
const freeRefs = [];

export function allocRef() {
  return freeRefs.length ? freeRefs.pop() : nextRef++;
}
export function releaseRef(ref) {
  freeRefs.push(ref);
}

export function makeMask(geometry, ref) {
  const mat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: ref,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.renderOrder = 1;
  return mesh;
}

// Make every material in obj only draw where stencil == ref.
export function stencilize(obj, ref) {
  obj.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      m.stencilWrite = true;
      m.stencilRef = ref;
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilFail = THREE.KeepStencilOp;
      m.stencilZFail = THREE.KeepStencilOp;
      m.stencilZPass = THREE.KeepStencilOp;
    }
    o.renderOrder = 2;
    o.frustumCulled = false;
  });
}
