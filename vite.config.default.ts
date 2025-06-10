import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/default',
    rollupOptions: {
      input: {
        popup: 'src/popup.ts',
        background: 'src/background.ts',
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es', // Use ES modules for popup and background scripts
      },
    },
  },
});