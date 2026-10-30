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
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            firebase: ['firebase/app', 'firebase/auth', 'firebase/database'],
            leaflet: ['leaflet', 'react-leaflet'],
            motion: ['motion/react'],
            virtuoso: ['react-virtuoso'],
          },
        },
      },
    },
  };
});
