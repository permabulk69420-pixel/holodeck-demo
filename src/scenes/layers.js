import * as THREE from 'three';

// Stack scene layers (e.g. a far panorama + a near live stage) into one scene.
// Each layer is { content: Group, update: fn | null }. Layer children are flattened into the result
// so the "followCamera" flag on a panorama box stays a direct child, where main.js looks for it.
export function composeLayers(...layers) {
  const content = new THREE.Group();
  const updates = [];
  for (const layer of layers) {
    for (const child of [...layer.content.children]) content.add(child);
    if (layer.update) updates.push(layer.update);
  }
  return { content, update: updates.length ? (t) => { for (const u of updates) u(t); } : null };
}
