import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import { handleImageRequest, handlePreviewRequest } from './server/preview.ts';

/** Mounts the link-preview API on Vite's dev and preview servers. */
function previewApi(): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use('/api/preview', (req, res) => void handlePreviewRequest(req, res));
    server.middlewares.use('/api/image', (req, res) => void handleImageRequest(req, res));
  };
  return {
    name: 'codeboard-preview-api',
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

export default defineConfig({
  plugins: [react(), previewApi()],
  build: { chunkSizeWarningLimit: 1000 },
});
