import * as THREE from 'three';
import { QUALITY, type QualityName } from '../config';

/** Screen rectangle in CSS pixels, origin top-left. */
export interface Viewport { x: number; y: number; w: number; h: number }

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  viewports: Viewport[] = [];
  quality: QualityName;

  constructor(quality: QualityName, container: HTMLElement) {
    this.quality = quality;
    this.gl = new THREE.WebGLRenderer({ antialias: QUALITY[quality].antialias, powerPreference: 'high-performance' });
    this.gl.domElement.id = 'gl';
    container.prepend(this.gl.domElement);
    this.apply(quality);
  }

  apply(quality: QualityName) {
    this.quality = quality;
    const q = QUALITY[quality];
    this.gl.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.gl.shadowMap.enabled = q.shadows;
    this.gl.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  }

  /** One full-screen view, or two halves (side by side in landscape, stacked in portrait). */
  resize(count: number) {
    const W = innerWidth, H = innerHeight;
    this.gl.setSize(W, H);
    if (count <= 1) this.viewports = [{ x: 0, y: 0, w: W, h: H }];
    else if (W >= H) this.viewports = [{ x: 0, y: 0, w: Math.floor(W / 2), h: H }, { x: Math.ceil(W / 2), y: 0, w: Math.floor(W / 2), h: H }];
    else this.viewports = [{ x: 0, y: 0, w: W, h: Math.floor(H / 2) }, { x: 0, y: Math.ceil(H / 2), w: W, h: Math.floor(H / 2) }];
  }

  render(scene: THREE.Scene, camera: THREE.Camera, vp: Viewport, split: boolean) {
    const gl = this.gl;
    if (split) {
      const y = innerHeight - vp.y - vp.h; // WebGL origin is bottom-left
      gl.setViewport(vp.x, y, vp.w, vp.h);
      gl.setScissor(vp.x, y, vp.w, vp.h);
      gl.setScissorTest(true);
    } else {
      gl.setScissorTest(false);
      gl.setViewport(0, 0, innerWidth, innerHeight);
    }
    gl.render(scene, camera);
  }

  /** Device pixels of a viewport height, used to size particles. */
  pixelHeight(vp: Viewport) {
    return vp.h * this.gl.getPixelRatio();
  }

  dispose() {
    this.gl.dispose();
    this.gl.forceContextLoss();
    this.gl.domElement.remove();
  }
}
