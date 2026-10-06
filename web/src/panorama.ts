import { Vector3 } from 'three';
import type { PanoramaView } from './api';

export function panoramaPoint(view: PanoramaView, radius = 10): [number, number, number] {
  const horizontal = Math.cos(view.pitch) * radius;
  return [-Math.sin(view.yaw) * horizontal, Math.sin(view.pitch) * radius, -Math.cos(view.yaw) * horizontal];
}
export function panoramaAngles(point: Vector3): PanoramaView {
  return { yaw: Math.atan2(-point.x, -point.z), pitch: Math.asin(Math.max(-1, Math.min(1, point.y / point.length()))) };
}
