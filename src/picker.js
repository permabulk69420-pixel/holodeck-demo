import * as THREE from 'three';

// Small floating menu of scenes. Each row is a flat button with a canvas-drawn label.

function labelTexture(text, sub, bg) {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 144;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(4, 4, c.width - 8, c.height - 8, 36);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '600 54px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text, 44, sub ? 56 : c.height / 2);
  if (sub) {
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = '400 34px system-ui, sans-serif';
    g.fillText(sub, 44, 104);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Picker {
  constructor(options) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.buttons = [];
    const W = 0.4, H = 0.075, gap = 0.012;
    options.forEach((opt, i) => {
      const normal = labelTexture(opt.title, opt.sub, 'rgba(28,30,38,0.92)');
      const hover = labelTexture(opt.title, opt.sub, 'rgba(58,110,190,0.95)');
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(W, H),
        new THREE.MeshBasicMaterial({ map: normal, transparent: true, depthTest: false }),
      );
      mesh.position.y = -i * (H + gap);
      mesh.renderOrder = 10;
      mesh.userData = { opt, normal, hover };
      this.group.add(mesh);
      this.buttons.push(mesh);
    });
    this.surface = null;
  }

  openFor(surface, hitPoint, viewerPos) {
    this.surface = surface;
    // float ~0.6 m in front of you, toward the spot you clicked
    const dir = hitPoint.clone().sub(viewerPos).normalize();
    const p = viewerPos.clone().addScaledVector(dir, 0.6);
    p.y = THREE.MathUtils.clamp(p.y, viewerPos.y - 0.35, viewerPos.y + 0.1);
    this.group.position.copy(p);
    this.group.position.y += 0.12;
    this.group.lookAt(viewerPos);
    this.group.visible = true;
  }

  close() {
    this.group.visible = false;
    this.surface = null;
  }

  setHover(mesh) {
    for (const b of this.buttons) b.material.map = b === mesh ? b.userData.hover : b.userData.normal;
  }
}
