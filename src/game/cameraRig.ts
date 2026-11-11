import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';

/** Verfolgerkamera hinter dem Fahrer, weich nachgeführt. */
export class CameraRig {
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private initialized = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: Heightfield,
    public distance = 7.5,
    public height = 2.8,
  ) {}

  update(dt: number, target: THREE.Vector3, forward: THREE.Vector3): void {
    const desired = target.clone().addScaledVector(forward, -this.distance);
    desired.y += this.height;
    // Nicht unter das Gelände tauchen
    const ground = this.terrain.sample(desired.x, desired.z) + 1.2;
    desired.y = Math.max(desired.y, ground);

    const lookAt = target.clone().addScaledVector(forward, 6);
    lookAt.y += 1.1;

    if (!this.initialized) {
      this.pos.copy(desired);
      this.look.copy(lookAt);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-dt * 3.5);
      this.pos.lerp(desired, k);
      this.look.lerp(lookAt, 1 - Math.exp(-dt * 6));
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
