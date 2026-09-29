import * as THREE from 'three';

// Panorama scenes: an equirect image sampled by view direction, so it behaves like something
// infinitely far away. No live 3D layer. frame = Matrix4 of the scene's "front" in the room
// (x right, y up, -z = front), at the viewer. Both builders return { content, update: null }.

const texCache = new Map();
function getTexture(url) {
  let t = texCache.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    texCache.set(url, t);
  }
  return t;
}

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const EQUIRECT = /* glsl */ `
  vec2 equirect(vec3 d) {
    return vec2(0.5 + atan(d.x, -d.z) / 6.2831853, 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.1415927);
  }`;

function wrap(frame, material) {
  const content = new THREE.Group();
  const far = new THREE.Mesh(new THREE.BoxGeometry(60, 60, 60), material);
  far.userData.followCamera = true;
  content.add(far);
  return { content, update: null };
}

const toLocal = (frame) => new THREE.Matrix3().setFromMatrix4(frame).transpose();

// One panorama.
export function buildPano(frame, url) {
  return wrap(frame, new THREE.ShaderMaterial({
    uniforms: { pano: { value: getTexture(url) }, toLocal: { value: toLocal(frame) } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D pano;
      uniform mat3 toLocal;
      varying vec3 vDir;
      ${EQUIRECT}
      void main() {
        gl_FragColor = vec4(texture2D(pano, equirect(normalize(toLocal * vDir))).rgb, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  }));
}

// A panorama with transparent parts (e.g. a ship interior with the windows cut out) composited
// over a second panorama, so you look out of the windows at the exterior scene.
// headingDeg turns the exterior around (positive = clockwise seen from above).
export function buildLayeredPano(frame, interiorUrl, exteriorUrl, headingDeg = 0) {
  const h = THREE.MathUtils.degToRad(headingDeg);
  const rot = new THREE.Matrix3().set(Math.cos(h), 0, Math.sin(h), 0, 1, 0, -Math.sin(h), 0, Math.cos(h));
  return wrap(frame, new THREE.ShaderMaterial({
    uniforms: {
      interior: { value: getTexture(interiorUrl) },
      exterior: { value: getTexture(exteriorUrl) },
      toLocal: { value: toLocal(frame) },
      extRot: { value: rot },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D interior;
      uniform sampler2D exterior;
      uniform mat3 toLocal;
      uniform mat3 extRot;
      varying vec3 vDir;
      ${EQUIRECT}
      void main() {
        vec3 d = normalize(toLocal * vDir);
        vec4 inside = texture2D(interior, equirect(d));
        vec3 outside = texture2D(exterior, equirect(normalize(extRot * d))).rgb;
        gl_FragColor = vec4(mix(outside, inside.rgb, inside.a), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  }));
}
