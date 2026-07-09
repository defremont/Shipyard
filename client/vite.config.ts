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
  // No manualChunks: grouping vendors by package pins shared transitive
  // modules into those groups, which then get pulled into the entry chunk —
  // exactly what we're trying to avoid. Rollup's automatic splitting, driven
  // by the lazy() boundaries around the editor, terminal and markdown views,
  // already keeps them off the boot path.
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
