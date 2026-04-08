import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import path from 'path';

export default defineConfig({
  plugins: [solidPlugin()],
  build: {
    target: 'esnext',
    outDir: 'dist/webview',
    minify: false,
    lib: {
      entry: path.resolve(__dirname, 'src/webview/main.tsx'),
      formats: ['es'],
      fileName: 'main',
    },
    rollupOptions: {
        output: {
            entryFileNames: 'main.js',
            assetFileNames: 'main.[ext]'
        }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
