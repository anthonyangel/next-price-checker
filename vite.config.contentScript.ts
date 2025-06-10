import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/contentScript',
    rollupOptions: {
      input: {
        contentScript: 'src/contentScript.ts',
      },
      output: {
        entryFileNames: '[name].js',
        format: 'iife', // Use IIFE for content scripts
        inlineDynamicImports: true,
      },
    },
  },
});