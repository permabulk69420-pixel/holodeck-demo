import * as THREE from 'three';

// Cycles-rendered 360° cavern, with room-locked fireflies for moving stereo depth.
// Deliberately no window frame, balcony, railing or close foreground border.
let panorama = null;
function getPanorama() {
  if (!panorama) {
    panorama = new THREE.TextureLoader().load('./assets/sanctuary.jpg');
    panorama.colorSpace = THREE.SRGBColorSpace;
    panorama.wrapS = THREE.RepeatWrapping;
    panorama.generateMipmaps = false;
    panorama.minFilter = THREE.LinearFilter;
    panorama.magFilter = THREE.LinearFilter;
  }
  return panorama;
}

export function buildSanctuaryScene(frame) {
  const content = new THREE.Group();
  const far = new THREE.Mesh(
    new THREE.BoxGeometry(60, 60, 60),
    new THREE.ShaderMaterial({
      uniforms: {
        pano: { value: getPanorama() },
        toLocal: { value: new THREE.Matrix3().setFromMatrix4(frame).transpose() },
      },
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
          vec3 d = normalize(toLocal * vDir);
          vec2 uv = vec2(0.5 + atan(d.x, -d.z) / 6.2831853,
                         0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.1415927);
          gl_FragColor = texture2D(pano, uv);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  far.userData.followCamera = true;
  content.add(far);

  const mid = new THREE.Group();
  mid.matrixAutoUpdate = false;
  mid.matrix.copy(frame);
  mid.matrixWorldNeedsUpdate = true;
  content.add(mid);

  let seed = 7241;
  const rnd = () => ((seed = seed * 16807 % 2147483647) / 2147483647);
  const count = 160;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = rnd() * Math.PI * 2;
    const radius = 10 + rnd() * 29;
    positions.set([Math.cos(angle) * radius, -4 + rnd() * 10, Math.sin(angle) * radius], i * 3);
    phases.set([rnd() * Math.PI * 2, 0.4 + rnd() * 0.6, rnd()], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phases, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 phase;
      uniform float time;
      varying float vGlow;
      varying vec3 vColor;
      void main() {
        float t = time * 0.22 * phase.y + phase.x;
        vec3 p = position + vec3(sin(t) * 0.65, sin(t * 1.7) * 0.4, cos(t * 0.8) * 0.65);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(95.0 * projectionMatrix[1][1] / max(-mv.z, 0.1), 1.0, 15.0);
        vGlow = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(time * phase.y + phase.x), 2.0);
        vColor = mix(vec3(0.12, 0.8, 0.65), vec3(1.0, 0.66, 0.2), step(0.84, phase.z));
      }`,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      varying vec3 vColor;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = dot(p, p);
        if (r > 1.0) discard;
        float glow = exp(-r * 7.0) * vGlow;
        gl_FragColor = vec4(vColor * glow, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const motes = new THREE.Points(geo, mat);
  motes.frustumCulled = false;
  mid.add(motes);
  return { content, update(t) { mat.uniforms.time.value = t; } };
}
