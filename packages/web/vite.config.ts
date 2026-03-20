import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from '@unocss/vite';

export default defineConfig({
  appType: 'mpa',
  plugins: [vue(), UnoCSS()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/sub': 'http://127.0.0.1:8787',
      '/health': 'http://127.0.0.1:8787'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        reset: resolve(__dirname, 'reset.html'),
        // 旧路径（兼容）
        login: resolve(__dirname, 'login.html'),
        navigation: resolve(__dirname, 'navigation.html'),
        nav: resolve(__dirname, 'nav.html'),
        subscriptions: resolve(__dirname, 'subscriptions.html'),
        clipboard: resolve(__dirname, 'clipboard.html'),
        snippets: resolve(__dirname, 'snippets.html'),
        notes: resolve(__dirname, 'notes.html'),
        images: resolve(__dirname, 'images.html'),
        logs: resolve(__dirname, 'logs.html'),
        settings: resolve(__dirname, 'settings.html'),
        // 新路径（/riku/*）
        'riku-login': resolve(__dirname, 'riku/login.html'),
        'riku-nav': resolve(__dirname, 'riku/nav.html'),
        'riku-images': resolve(__dirname, 'riku/images.html'),
        'riku-notes': resolve(__dirname, 'riku/notes.html'),
        'riku-snippets': resolve(__dirname, 'riku/snippets.html'),
        'riku-subscriptions': resolve(__dirname, 'riku/subscriptions.html'),
        'riku-logs': resolve(__dirname, 'riku/logs.html'),
        'riku-settings': resolve(__dirname, 'riku/settings.html')
      }
    }
  }
});
