import {reviewedInterior} from './reviewed-interior.mjs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function createAppearanceDemo(origin = 'http://localhost:5173') {
  const root = origin + '/api/v1';
  async function request(path, method = 'GET', data) {
    const response = await fetch(root + path, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
    if (!response.ok) throw new Error(`${method} ${path}: ${await response.text()}`);
    return response.status === 204 ? undefined : response.json();
  }
  const settings = {
    appearance: { exposure: 1, environment_intensity: 1, light_intensity: 1, background: '#edf1e8', tint: '', roughness: null },
    model: { scale: 1, up_axis: 'Y', rotation: 0 },
  };
  const project = await request('/projects', 'POST', { name: 'Textured interior example', description: 'Neutral lighting, embedded floor tiles, and red/blue artwork. The second scene demonstrates centimetre/Z-up preparation.' });
  async function upload(bytes, name, sceneName) {
    const ticket = await request(`/projects/${project.id}/uploads`, 'POST', { name, size: bytes.length });
    const form = new FormData();
    for (const [key, value] of Object.entries(ticket.upload.fields)) form.append(key, value);
    form.append('file', new Blob([bytes], { type: 'model/gltf-binary' }), name);
    const response = await fetch(ticket.upload.url, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
    await request(`/assets/${ticket.asset.id}/complete`, 'POST');
    return request(`/projects/${project.id}/scenes`, 'POST', { asset_id: ticket.asset.id, name: sceneName });
  }
  try {
    const lobby = await upload(await readFile(new URL('../../tests/testdata/textured-interior.glb', import.meta.url)), 'textured-interior.glb', 'Textured lobby and rooms');
    const corrected = await upload(await readFile(new URL('../../tests/testdata/textured-interior-cm-z.glb', import.meta.url)), 'textured-interior-cm-z.glb', 'Corrected centimetre Z-up interior');
    await request(`/scenes/${corrected.id}`, 'PATCH', { settings: { ...settings, model: { scale: 0.01, up_axis: 'Z', rotation: 0 } } });
    for(const [scene,file,model]of [[lobby,'textured-interior.glb',settings.model],[corrected,'textured-interior-cm-z.glb',{scale:.01,up_axis:'Z',rotation:0}]]){const reviewed=await request(`/scenes/${scene.id}`,'PATCH',{settings:{...settings,model,navigation:reviewedInterior(await readFile(new URL('../../tests/testdata/'+file,import.meta.url)),model)}});Object.assign(scene,reviewed);}
    for (const scene of [lobby, corrected]) {
      await request(`/scenes/${scene.id}`, 'PATCH', { start_camera: { position: [0, 1.75, 2], yaw: 0, pitch: 0 } });
      await request(`/scenes/${scene.id}/hotspots`, 'POST', { type: 'INFO', title: 'Red artwork', description: 'Embedded materials and textures remain intact. Use Appearance and model preparation to adjust lighting.', position: { x: -0.6, y: 1.75, z: -0.78 } });
      await request(`/scenes/${scene.id}/hotspots`, 'POST', { type: 'NAVIGATION', title: scene.id === lobby.id ? 'Corrected import' : 'Return to lobby', position: { x: 1.8, y: 1.75, z: -0.78 }, destination_scene_id: scene.id === lobby.id ? corrected.id : lobby.id });
    }
    return { project, lobby, corrected, request, upload, settings };
  } catch (error) {
    await request(`/projects/${project.id}`, 'DELETE'); throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.env.TOUR_ORIGIN || 'http://localhost:5173';
  const { project } = await createAppearanceDemo(origin);
  console.log(`Textured example created: ${origin}/projects/${project.id}`);
}
