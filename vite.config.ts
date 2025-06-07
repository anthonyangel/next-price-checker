import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: 'src/popup.ts'
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
