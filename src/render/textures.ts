import * as THREE from 'three';

export function makeDevGridTexture(
  baseHex: string,
  majorHex: string,
  minorHex: string,
  accentHex: string,
  maxAnisotropy: number,
  labelText = '64',
  chevrons = false,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;

  g.fillStyle = baseHex;
  g.fillRect(0, 0, 256, 256);

  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0.14)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);

  // Minor 16u subdivisions
  g.strokeStyle = minorHex;
  g.lineWidth = 1;
  for (let i = 0; i <= 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.stroke();

    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }

  // Optional glowing directional chevrons (for booster pads)
  if (chevrons) {
    g.strokeStyle = accentHex;
    g.lineWidth = 10;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let y = 40; y < 256; y += 84) {
      g.beginPath();
      g.moveTo(46, y + 36);
      g.lineTo(128, y);
      g.lineTo(210, y + 36);
      g.stroke();
    }
  }

  // Major 64u border
  g.strokeStyle = majorHex;
  g.lineWidth = 4;
  g.strokeRect(2, 2, 252, 252);

  // Corner accent ticks
  g.fillStyle = accentHex;
  g.fillRect(0, 0, 14, 4);
  g.fillRect(0, 0, 4, 14);
  g.fillRect(242, 252, 14, 4);
  g.fillRect(252, 242, 4, 14);

  if (labelText && !chevrons) {
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.font = '700 22px JetBrains Mono, monospace';
    g.fillText(labelText, 16, 32);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  return tex;
}

export function makeHazardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;

  g.fillStyle = '#0f131a';
  g.fillRect(0, 0, 256, 256);

  g.fillStyle = '#b45309';
  for (let i = -256; i < 512; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 28, 0);
    g.lineTo(i - 228, 256);
    g.lineTo(i - 256, 256);
    g.closePath();
    g.fill();
  }

  g.strokeStyle = 'rgba(251, 191, 36, 0.25)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 253, 253);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 45);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
