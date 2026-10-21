import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5273, strictPort: true },
  build: {
    // Fonts stay files. Inlined as data: URLs, the smallest subsets would need
    // the CSP's font-src widened just for them.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
  },
});
