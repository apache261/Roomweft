import type { LayoutDocument, Attachment } from './layout';
import type { SceneSettings } from './sceneSettings';
export type Project = {
  id: string;
  name: string;
  description: string;
  slug: string;
  published: boolean;
  start_scene_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export type Asset = { id: string; project_id: string; name: string; file_type: 'GLB' | 'PANORAMA' | 'IMAGE' | 'TEXTURE_BASE_COLOR' | 'TEXTURE_NORMAL' | 'TEXTURE_ROUGHNESS' | 'TEXTURE_AO' | 'TEXTURE_LIGHTMAP'; upload_status: 'pending' | 'ready'; size: number };
export type CameraView = { position: [number, number, number]; yaw: number; pitch: number };
export type PanoramaView = { yaw: number; pitch: number };
export type StartView = CameraView | PanoramaView;
export type HotspotPosition = { x: number; y: number; z: number; attachment?: Attachment } | PanoramaView;
export type Hotspot = { id: string; scene_id: string; type: 'NAVIGATION' | 'INFO'; title: string; description: string; external_link: string; image_asset_id: string | null; position: HotspotPosition; destination_scene_id: string | null };
export type Scene = { id: string; project_id: string; asset_id: string | null; layout: LayoutDocument; layout_revision: number; name: string; type: '3D' | 'PANORAMA' | 'LAYOUT'; sort_order: number; settings: SceneSettings; start_camera: StartView | Record<string, never> };
export type UploadTicket = { asset: Asset; upload: { url: string; fields: Record<string, string>; expires_at: string } };
export function uploadFile(ticket: UploadTicket, file: File, progress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', ticket.upload.url); xhr.timeout = 15 * 60 * 1000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and storage CORS, then try again.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out. Please try again.'));
    xhr.onabort = () => reject(new Error('Upload was cancelled.'));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage rejected the upload (${xhr.status}). Please try again.`));
    const data = new FormData();
    Object.entries(ticket.upload.fields).forEach(([key, value]) => data.append(key, value));
    data.append('file', new File([file], file.name, { type: ticket.upload.fields['Content-Type'] || ticket.upload.fields['content-type'] || file.type || 'model/gltf-binary' }));
    xhr.send(data);
  });
}
