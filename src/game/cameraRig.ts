import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';

/** Tempo (m/s), ab dem die Kamera zurückfährt und das Blickfeld weiter wird. */
const SPEED_FROM = 5;
const SPEED_TO = 14;

/**
 * Verfolgerkamera hinter dem Fahrer, weich nachgeführt.
 * - Blickt in Kurven auf einen Punkt voraus auf der Straße und schwenkt dadurch mit
 * - Fährt bei hohem Tempo etwas zurück und öffnet das Blickfeld (Gefühl für Tempo)
 */
export class CameraRig {
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private initialized = false;
  private speedFactor = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: Heightfield,
    public distance = 7.5,
    public height = 2.8,
    public baseFov = 60,
  ) {}

  /**
   * @param ahead Punkt etwa 18 m voraus auf dem Weg (folgt Kurven und Abzweigungen)
   * @param speed Tempo in m/s
   */
  update(dt: number, target: THREE.Vector3, forward: THREE.Vector3, ahead: THREE.Vector3 | null = null, speed = 0): void {
    // Tempo-Anteil weich nachführen, damit Zoom und Blickfeld nicht zucken
    const goal = THREE.MathUtils.clamp((speed - SPEED_FROM) / (SPEED_TO - SPEED_FROM), 0, 1);
    this.speedFactor += (goal - this.speedFactor) * (1 - Math.exp(-dt * 1.5));
    const dist = this.distance + this.speedFactor * 2.2;

    this.desired.copy(target).addScaledVector(forward, -dist);
    this.desired.y += this.height + this.speedFactor * 0.4;
    // Nicht unter das Gelände tauchen
    const ground = this.terrain.sample(this.desired.x, this.desired.z) + 1.2;
    this.desired.y = Math.max(this.desired.y, ground);

    // Blickpunkt: geradeaus vor dem Fahrer, in Kurven Richtung Straße voraus gezogen
    this.lookAt.copy(target).addScaledVector(forward, 6);
    this.lookAt.y += 1.1;
    if (ahead) {
      const toAhead = new THREE.Vector3(ahead.x - target.x, 0, ahead.z - target.z);
      const len = toAhead.length();
      if (len > 1) {
        toAhead.divideScalar(len);
        // Seitlicher Anteil der Kurve, begrenzt, damit die Kamera nicht von der Straße weg schaut
        const side = toAhead.x * forward.z - toAhead.z * forward.x;
        const curve = THREE.MathUtils.clamp(Math.abs(side) * 1.6, 0, 0.6);
        const curved = new THREE.Vector3(ahead.x, ahead.y + 1.1, ahead.z);
        this.lookAt.lerp(curved, curve);
      }
    }

    if (!this.initialized) {
      this.pos.copy(this.desired);
      this.look.copy(this.lookAt);
      this.initialized = true;
    } else {
      this.pos.lerp(this.desired, 1 - Math.exp(-dt * 3.5));
      this.look.lerp(this.lookAt, 1 - Math.exp(-dt * 4));
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    const fov = this.baseFov + this.speedFactor * 7;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
