import * as THREE from 'three';
import { pointOnSegment, SEGMENT_KIND_LABEL, type Segment, type SegmentKind } from '../world/segments';

/** Farben je Segmentart (Banner, Karte, HUD). */
export const SEGMENT_COLOR: Record<SegmentKind, string> = {
  sprint: '#2fb344',
  climb: '#d6336c',
  tt: '#1c7ed6',
};

/** Halbe Durchfahrtsbreite des Bogens in m (breiter als jede Fahrbahn). */
const HALF_SPAN = 4.6;
/** Bögen stehen etwas vom Knoten entfernt, damit sie nicht mitten in der Kreuzung stehen. */
const INSET = 8;

function bannerTexture(title: string, sub: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1024, 160);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let x = -160; x < 1024; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 160);
    ctx.lineTo(x + 40, 160);
    ctx.lineTo(x + 200, 0);
    ctx.lineTo(x + 160, 0);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 74px system-ui, sans-serif';
  ctx.fillText(title, 512, 62, 980);
  ctx.font = '600 36px system-ui, sans-serif';
  ctx.fillText(sub, 512, 128, 980);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function arch(title: string, sub: string, color: string): THREE.Group {
  const g = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: '#e9ecef', flatShading: true });
  for (const x of [-HALF_SPAN, HALF_SPAN]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.4, 0.3), postMat);
    post.position.set(x, 2.2, 0);
    post.castShadow = true;
    g.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(HALF_SPAN * 2 + 0.3, 0.95, 0.12),
    [postMat, postMat, postMat, postMat,
      new THREE.MeshLambertMaterial({ map: bannerTexture(title, sub, color) }),
      new THREE.MeshLambertMaterial({ map: bannerTexture(title, sub, color) })],
  );
  banner.position.y = 4.0;
  banner.castShadow = true;
  g.add(banner);
  return g;
}

/** Start- und Zielbögen aller Segmente. */
export function createSegmentMarkers(segments: Segment[]): THREE.Group {
  const group = new THREE.Group();
  for (const seg of segments) {
    const color = SEGMENT_COLOR[seg.kind];
    const kind = SEGMENT_KIND_LABEL[seg.kind];
    const loop = seg.nodes[0] === seg.nodes[seg.nodes.length - 1];
    const places: { d: number; title: string }[] = loop
      ? [{ d: INSET, title: 'START · ZIEL' }]
      : [{ d: INSET, title: 'START' }, { d: seg.length - INSET, title: 'ZIEL' }];
    for (const { d, title } of places) {
      const p = pointOnSegment(seg, d);
      const a = arch(title, `${kind} ${seg.name}`, color);
      a.position.set(p.x, p.y - 0.2, p.z);
      a.rotation.y = Math.atan2(p.dx, p.dz);
      group.add(a);
    }
  }
  return group;
}
