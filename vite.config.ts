import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

// Номер версии приложения — единый источник: package.json.
// Он подставляется в сборку как __APP_VERSION__ и больше нигде не дублируется.
const appVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version as string;

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GOOGLE_MAPS_PLATFORM_KEY': JSON.stringify(process.env.GOOGLE_MAPS_PLATFORM_KEY || ''),
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            firebase: ['firebase/app', 'firebase/auth', 'firebase/database'],
            pdf: ['pdfjs-dist'],
            leaflet: ['leaflet', 'react-leaflet'],
            motion: ['motion/react'],
            virtuoso: ['react-virtuoso'],
          },
        },
      },
    },
  };
});
