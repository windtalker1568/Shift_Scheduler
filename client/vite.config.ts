import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: ['..'] }, // the shared/ folder lives one level up
    proxy: { '/api': 'http://localhost:4000' },
  },
});
