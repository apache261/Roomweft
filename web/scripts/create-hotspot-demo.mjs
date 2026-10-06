import {reviewedInterior} from './reviewed-interior.mjs';
import {defaultSettings} from '../src/sceneSettings.ts';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function createHotspotDemo(origin = 'http://localhost:5173') {
  const root = `${origin}/api/v1`;
  async function request(path, method = 'GET', data) {
    const response = await fetch(root + path, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
    if (!response.ok) throw new Error(`${method} ${path}: ${await response.text()}`);
    return response.status === 204 ? undefined : response.json();
  }
  const project = await request('/projects', 'POST', { name: 'Hotspot example tour', description: 'Lobby artwork and a link to a second room. Use Show hotspot and Test hotspot to explore.' });
  try {
    const scenes = [];
    for (const [file, name] of [['house.glb', 'Lobby'], ['panorama-a.png', 'Second room (360 example)']]) {
      const bytes = await readFile(new URL(`../../tests/testdata/${file}`, import.meta.url));
      const ticket = await request(`/projects/${project.id}/uploads`, 'POST', { name: file, size: bytes.length });
      const form = new FormData();
      for (const [key, value] of Object.entries(ticket.upload.fields)) form.append(key, value);
      form.append('file', new Blob([bytes], { type: ticket.upload.fields['Content-Type'] || (file.endsWith('.glb') ? 'model/gltf-binary' : 'image/png') }), file);
      const uploaded = await fetch(ticket.upload.url, { method: 'POST', body: form });
      if (!uploaded.ok) throw new Error(`Upload failed: ${uploaded.status}`);
      await request(`/assets/${ticket.asset.id}/complete`, 'POST');
      scenes.push(await request(`/projects/${project.id}/scenes`, 'POST', { asset_id: ticket.asset.id, name }));
    }
    const [lobby, room] = scenes;
    const navigation=reviewedInterior(await readFile(new URL('../../tests/testdata/house.glb',import.meta.url)));
    const reviewed=await request(`/scenes/${lobby.id}`,'PATCH',{settings:{...defaultSettings,navigation}});Object.assign(lobby,reviewed);
    await request(`/scenes/${lobby.id}`, 'PATCH', { start_camera: { position: [0, 1.75, 0], yaw: 0, pitch: 0 } });
    const artwork = await request(`/scenes/${lobby.id}/hotspots`, 'POST', { type: 'INFO', title: 'Lobby artwork', description: 'This is an information hotspot. Authors edit it; visitors click it to read this popup.', position: { x: 0, y: 1.75, z: -2.26 } });
    await request(`/scenes/${lobby.id}/hotspots`, 'POST', { type: 'NAVIGATION', title: 'Visit second room', position: { x: 1.2, y: 1.75, z: -2.26 }, destination_scene_id: room.id });
    await request(`/scenes/${room.id}/hotspots`, 'POST', { type: 'NAVIGATION', title: 'Return to lobby', position: { yaw: -0.6, pitch: 0 }, destination_scene_id: lobby.id });
    await request(`/scenes/${room.id}/hotspots`, 'POST', { type: 'INFO', title: 'Room information', description: 'Panorama hotspots support the same Show and Test controls.', position: { yaw: 0, pitch: 0 } });
    return { project, lobby, room, artwork, request };
  } catch (error) {
    await request(`/projects/${project.id}`, 'DELETE');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.env.TOUR_ORIGIN || 'http://localhost:5173';
  const { project } = await createHotspotDemo(origin);
  console.log(`Example tour created: ${origin}/projects/${project.id}`);
}
