import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5420',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:5420',
        ws: true,
      },
    },
  },
})
