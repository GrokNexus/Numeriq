import { defineConfig } from 'vite';
import { codespaceHost } from './src/shared/preview.ts';

const previewHost = codespaceHost(process.env);

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: previewHost ? [previewHost] : [],
    proxy: { '/api': 'http://127.0.0.1:4318' },
  },
});
