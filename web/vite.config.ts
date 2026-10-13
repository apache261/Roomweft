import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({mode}) => {
  const splat = process.env.VITE_SPLAT_SUPPORT ?? loadEnv(mode, process.cwd()).VITE_SPLAT_SUPPORT;
  if (splat !== undefined && !['off','viewer','on'].includes(splat)) throw new Error('VITE_SPLAT_SUPPORT must be off, viewer or on');
  for(const name of ['VITE_SPLAT_WALKING','VITE_SPLAT_STREAMING']){const value=process.env[name]??loadEnv(mode,process.cwd())[name];if(value!==undefined&&!['off','on'].includes(value))throw new Error(`${name} must be off or on`);}
  return {
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:8080',
      '/health': process.env.API_PROXY_TARGET || 'http://localhost:8080',
    },
  },
};
});
