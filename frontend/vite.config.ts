import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 27778,
    proxy: {
      '/api': {
        target: 'http://localhost:27779',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    // Ant Design/rc-* 作为长期缓存的共享 UI 包；当前压缩后约 310 kB。
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor'
          if (id.includes('/axios/')) return 'http-vendor'
          return 'ui-vendor'
        },
      },
    },
  }
})
