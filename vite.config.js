import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.tools/**',
        '**/data/**',
        '**/data-test*/**',
        '**/uploads/**',
        '**/outputs/**',
        '**/logs/**',
        '**/audit/**',
        '**/dist/**',
        '**/*.db',
        '**/*.db-*',
        '**/.cache/**',
        '**/coverage/**',
      ],
    },
  },
});
