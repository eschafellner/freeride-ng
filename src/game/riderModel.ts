import * as THREE from 'three';

const WHEEL_RADIUS = 0.34;

/**
 * Einfache, eigene Low-Poly-Radfahrerfigur aus Grundkörpern.
 * Ursprung am Boden zwischen den Rädern, Blickrichtung +z.
 */
export class RiderModel {
  readonly root = new THREE.Group();
  private readonly wheels: THREE.Object3D[] = [];
  private readonly crank = new THREE.Group();
  private readonly legs: { thigh: THREE.Object3D; shin: THREE.Object3D; phase: number }[] = [];
  private wheelAngle = 0;
  private crankAngle = 0;

  constructor(jersey = '#e4572e') {
    const frameMat = new THREE.MeshLambertMaterial({ color: '#1f6feb', flatShading: true });
    const darkMat = new THREE.MeshLambertMaterial({ color: '#222', flatShading: true });
    const jerseyMat = new THREE.MeshLambertMaterial({ color: jersey, flatShading: true });
    const skinMat = new THREE.MeshLambertMaterial({ color: '#e0b48c', flatShading: true });
    const shortsMat = new THREE.MeshLambertMaterial({ color: '#2b2b33', flatShading: true });

    const bike = new THREE.Group();
    this.root.add(bike);

    // Räder
    for (const z of [-0.52, 0.52]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_RADIUS, 0.035, 5, 14), darkMat);
      wheel.rotation.y = Math.PI / 2;
      const holder = new THREE.Group();
      holder.position.set(0, WHEEL_RADIUS, z);
      holder.add(wheel);
      // Speichen als Kreuz, damit die Drehung sichtbar ist
      for (const rot of [0, Math.PI / 2]) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.01, WHEEL_RADIUS * 2, 0.02), darkMat);
        spoke.rotation.x = rot;
        holder.add(spoke);
      }
      bike.add(holder);
      this.wheels.push(holder);
    }

    // Rahmen (Rohre zwischen Punkten)
    const tube = (from: THREE.Vector3, to: THREE.Vector3, r = 0.025, mat = frameMat) => {
      const len = from.distanceTo(to);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 5), mat);
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      bike.add(mesh);
    };
    const bb = new THREE.Vector3(0, 0.3, 0.02); // Tretlager
    const rear = new THREE.Vector3(0, WHEEL_RADIUS, -0.52);
    const front = new THREE.Vector3(0, WHEEL_RADIUS, 0.52);
    const seat = new THREE.Vector3(0, 0.85, -0.12);
    const head = new THREE.Vector3(0, 0.88, 0.4);
    tube(bb, seat);
    tube(seat, head);
    tube(bb, head);
    tube(bb, rear);
    tube(seat, rear);
    tube(head, front);
    tube(new THREE.Vector3(-0.2, 0.95, 0.44), new THREE.Vector3(0.2, 0.95, 0.44), 0.02, darkMat); // Lenker
    tube(head, new THREE.Vector3(0, 0.95, 0.44), 0.02, darkMat);

    // Kurbel
    this.crank.position.copy(bb);
    bike.add(this.crank);
    const crankArm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.03), darkMat);
    this.crank.add(crankArm);

    // Fahrer
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.62), jerseyMat);
    torso.position.set(0, 1.18, 0.12);
    torso.rotation.x = 0.55;
    bike.add(torso);
    const headMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), skinMat);
    headMesh.position.set(0, 1.42, 0.45);
    bike.add(headMesh);
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.135, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      jerseyMat,
    );
    helmet.position.set(0, 1.44, 0.45);
    bike.add(helmet);
    for (const x of [-0.16, 0.16]) {
      tube(new THREE.Vector3(x, 1.3, 0.33), new THREE.Vector3(x * 1.2, 0.97, 0.44), 0.035, skinMat);
    }

    // Beine: Oberschenkel am Sattel, Unterschenkel zum Pedal (vereinfacht animiert)
    for (const [x, phase] of [[-0.11, 0], [0.11, Math.PI]] as const) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.95, -0.08);
      bike.add(hip);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.45, 5), shortsMat);
      thigh.position.y = -0.22;
      const knee = new THREE.Group();
      knee.position.y = -0.45;
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.45, 5), skinMat);
      shin.position.y = -0.22;
      knee.add(shin);
      const thighGroup = new THREE.Group();
      thighGroup.add(thigh, knee);
      hip.add(thighGroup);
      this.legs.push({ thigh: thighGroup, shin: knee, phase });
    }

    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  /**
   * @param speed Tempo in m/s (dreht die Räder)
   * @param cadence Trittfrequenz in U/min (dreht die Kurbel)
   */
  animate(dt: number, speed: number, cadence: number): void {
    this.wheelAngle += (speed / WHEEL_RADIUS) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    this.crankAngle += (cadence / 60) * Math.PI * 2 * dt;
    this.crank.rotation.x = this.crankAngle;
    for (const leg of this.legs) {
      const a = this.crankAngle + leg.phase;
      leg.thigh.rotation.x = -0.9 + 0.45 * Math.sin(a);
      leg.shin.rotation.x = 0.9 + 0.5 * Math.cos(a);
    }
  }
}
