// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoName = 'dsing'; // ⚠️ troque se seu repositório for "dsign"

export default defineConfig({
  plugins: [react()],
  base: `/${repoName}/`, // importante!
  build: {
    outDir: 'docs',
  },
});
