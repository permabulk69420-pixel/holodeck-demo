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

// "Far" window: samples a pre-captured cubemap by view direction.
// Leaning changes what you see through the window (like a real window onto a distant view),
// but near and far things inside it don't shift against each other.
// surfaceMatrix: the surface frame (right, up, normal). The captured scene's -Z is
// mapped to "into the wall", so whatever was in front of the capture camera sits behind that wall.
export function makeCubeWindow(cubeTexture, surfaceMatrix) {
  const toLocal = new THREE.Matrix3().setFromMatrix4(surfaceMatrix).transpose();
  const mat = new THREE.ShaderMaterial({
    uniforms: { env: { value: cubeTexture }, toLocal: { value: toLocal } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform samplerCube env;
      uniform mat3 toLocal;
      varying vec3 vDir;
      void main() {
        gl_FragColor = textureCube(env, normalize(toLocal * vDir));
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 40), mat);
  box.userData.followCamera = true;
  return box;
}
