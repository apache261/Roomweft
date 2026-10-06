import { Box3, Camera, Matrix4, Mesh, Object3D, Raycaster, Vector3 } from 'three';
import type { Intersection } from 'three';
import type { HotspotPosition } from './api';
import { panoramaPoint } from './panorama.ts';

export function hotspotPoint(position: HotspotPosition): Vector3 {
  return new Vector3(...('x' in position ? [position.x, position.y, position.z] : panoramaPoint(position)));
}

type Occluder = { mesh: Mesh; bounds: Box3; matrix: Matrix4; signature: string; dynamic: boolean };
export type VisibilityResult = { point: Vector3; screen: Vector3; visible: boolean; revision: number };

// One evaluator per layer: synchronize once per rendered frame, then share results
// between HTML markers and reticle targeting. No timer is needed in demand mode.
export class HotspotVisibility {
  readonly stats = { evaluations: 0, cacheHits: 0, raycasts: 0, candidates: 0, rejected: 0 };
  private occluders: Occluder[] = [];
  private records = new Map<Mesh, Occluder>();
  private view = new Matrix4();
  private previousView = new Matrix4().makeScale(0, 0, 0);
  private origin = new Vector3();
  private direction = new Vector3();
  private boundsHit = new Vector3();
  private ray = new Raycaster();
  private hits: Intersection[] = [];
  private camera!: Camera;
  private panorama = false;
  private revision = 0;
  private seen = new Set<Mesh>();
  private visit = (object: Object3D) => {
    if (!(object instanceof Mesh) || !object.layers.test(this.camera.layers)) return;
    const mesh = object;
    this.seen.add(mesh);
    const geometry = mesh.geometry;
    // Animated deformation/instance bounds are deliberately conservative. Transform
    // animations on ordinary meshes use refreshed world-space boxes instead.
    const dynamic = !!(mesh as Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean }).isSkinnedMesh
      || !!(mesh as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh
      || !!mesh.morphTargetInfluences?.length;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const signature = `${geometry.uuid}:${geometry.attributes.position?.version}:${geometry.index?.version}:${materials.map(m => `${m.uuid}:${m.version}:${m.side}`).join(',')}`;
    let record = this.records.get(mesh);
    if (!record) {
      record = { mesh, bounds: new Box3(), matrix: new Matrix4(), signature: '', dynamic };
      this.records.set(mesh, record);
    }
    if (dynamic || record.dynamic !== dynamic || record.signature !== signature || !record.matrix.equals(mesh.matrixWorld)) {
      if (!dynamic) {
        if (record.signature !== signature) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
        if (geometry.boundingBox) record.bounds.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
        else record.bounds.makeEmpty();
      }
      record.matrix.copy(mesh.matrixWorld); record.signature = signature; record.dynamic = dynamic;
      this.revision++;
    }
  };

  begin(camera: Camera, objects: Object3D[], panorama: boolean) {
    this.camera = camera;
    camera.updateWorldMatrix(true, false);
    this.view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!this.view.equals(this.previousView) || panorama !== this.panorama) {
      this.previousView.copy(this.view); this.revision++;
    }
    this.panorama = panorama;
    camera.getWorldPosition(this.origin);
    this.ray.camera = camera; this.ray.layers.mask = camera.layers.mask;
    this.seen.clear();
    if (!panorama) for (const root of objects) {
      const authored = (root.userData.runtimeAuthoredRoot as Object3D | undefined) || root;
      authored.updateWorldMatrix(true, true);
      authored.traverseVisible(this.visit);
    }
    // Visibility, hierarchy, loading and removals invalidate cached answers too.
    if (this.seen.size !== this.occluders.length || this.occluders.some(r => !this.seen.has(r.mesh))) this.revision++;
    this.occluders.length = 0;
    for (const mesh of this.seen) this.occluders.push(this.records.get(mesh)!);
    for (const mesh of this.records.keys()) if (!this.seen.has(mesh)) this.records.delete(mesh);
  }

  evaluate(result: VisibilityResult): VisibilityResult {
    if (result.revision === this.revision) { this.stats.cacheHits++; return result; }
    result.revision = this.revision; this.stats.evaluations++;
    const screen = result.screen.copy(result.point).applyMatrix4(this.view);
    result.visible = false;
    if (!Number.isFinite(screen.x + screen.y + screen.z) || Math.abs(screen.x) > 1 || Math.abs(screen.y) > 1 || Math.abs(screen.z) > 1) {
      this.stats.rejected++; return result;
    }
    if (this.panorama) { result.visible = true; return result; }
    this.direction.copy(result.point).sub(this.origin);
    // Surface tolerance preserves legacy markers placed directly on geometry.
    this.ray.near = 0; this.ray.far = Math.max(0, this.direction.length() - .07);
    this.ray.set(this.origin, this.direction.normalize());
    for (const record of this.occluders) {
      if (!record.dynamic && !record.bounds.containsPoint(this.origin)) {
        const hit = this.ray.ray.intersectBox(record.bounds, this.boundsHit);
        if (!hit || this.origin.distanceToSquared(hit) > this.ray.far * this.ray.far) continue;
      }
      this.stats.candidates++; this.stats.raycasts++;
      this.hits.length = 0;
      this.ray.intersectObject(record.mesh, false, this.hits);
      if (this.hits.length) return result;
    }
    result.visible = true;
    return result;
  }
}

export function visibilityResult(point: Vector3): VisibilityResult {
  return { point, screen: new Vector3(), visible: false, revision: -1 };
}

// Standalone compatibility helper; frame callbacks should reuse an evaluator.
export function hotspotVisible(point: Vector3, camera: Camera, objects: Object3D[], panorama: boolean): boolean {
  const evaluator = new HotspotVisibility();
  evaluator.begin(camera, objects, panorama);
  return evaluator.evaluate(visibilityResult(point)).visible;
}
