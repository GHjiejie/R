import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // React 使用 /api 访问 FastAPI，开发时由 Vite 转发到后端端口。
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
})
