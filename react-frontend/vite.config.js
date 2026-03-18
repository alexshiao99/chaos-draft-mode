import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: mode === 'development' ? {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5050',
      '/elixir.svg': 'http://localhost:5050',
    },
  } : { port: 5173 },
}))
