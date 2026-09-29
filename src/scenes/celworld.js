import * as THREE from 'three';

// "Celworld": a Ghibli-style meadow captured from the Celworld repo's real Three.js scene
// (cottage, garden, willow, bridge, windmill hills), from eye height in the meadow.
// It is a pure panorama: no live 3D layer. Captured with tools/celworld_capture/ (six cube
// faces from headless Chromium, stitched to 8192x4096 equirect -> assets/celworld.jpg).
// The panorama is sampled by view direction, so it behaves like something infinitely far away.
// frame: Matrix4 of the scene's "front" in the room (x right, y up, -z = front), at the viewer.

let tex = null;
function getTexture() {
  if (!tex) {
    tex = new THREE.TextureLoader().load('./assets/celworld.jpg');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
  }
  return tex;
}

export function buildCelworldScene(frame) {
  const content = new THREE.Group();
  const far = new THREE.Mesh(
    new THREE.BoxGeometry(60, 60, 60),
    new THREE.ShaderMaterial({
      uniforms: { pano: { value: getTexture() }, toLocal: { value: new THREE.Matrix3().setFromMatrix4(frame).transpose() } },
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
  return { content, update: null };
}
