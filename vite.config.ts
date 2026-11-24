// vite.config.ts
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000, // Inline any fonts, audio, or textures as data URLs
    cssCodeSplit: false,
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
});
