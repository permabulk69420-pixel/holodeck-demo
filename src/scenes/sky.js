import * as THREE from 'three';

// "Sky islands": standing on a ledge above a sea of cloud at golden hour, all the way around you.
// Everything is in the Blender render (tools/render_sky.py -> assets/sky.jpg): sun, cloud sea,
// floating islands with waterfalls, drifting rock debris. There is deliberately no live 3D layer;
// the panorama is sampled by view direction, so it behaves like something infinitely far away.
// frame: Matrix4 of the scene's "front" in the room (x right, y up, -z = front), at the viewer.

let skyTex = null;
function getSkyTexture() {
  if (!skyTex) {
    skyTex = new THREE.TextureLoader().load('./assets/sky.jpg');
    skyTex.colorSpace = THREE.SRGBColorSpace;
    skyTex.generateMipmaps = false;
    skyTex.minFilter = THREE.LinearFilter;
    skyTex.magFilter = THREE.LinearFilter;
  }
  return skyTex;
}

export function buildSkyScene(frame) {
  const content = new THREE.Group();
  const far = new THREE.Mesh(
    new THREE.BoxGeometry(60, 60, 60),
    new THREE.ShaderMaterial({
      uniforms: { pano: { value: getSkyTexture() }, toLocal: { value: new THREE.Matrix3().setFromMatrix4(frame).transpose() } },
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
