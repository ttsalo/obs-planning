import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies the Go server's routes so the app sees the
// same single origin it does in production, where the Go server serves
// the built app itself. Astro calls are deliberately not proxied: they
// go straight to //<host>:8081 (see config.jsx), as in every
// deployment. OBS_BACKEND_URL points at the Go server — the compose
// service inside the dev overlay, localhost:8080 when the dev server
// runs on the host against `make runserver`.
const backend = process.env.OBS_BACKEND_URL || 'http://localhost:8080'
const proxy = Object.fromEntries(
  ['/api', '/login', '/config'].map(
    (path) => [path, { target: backend, changeOrigin: true }]),
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Bind-mounted sources deliver inotify events natively on Linux;
    // set VITE_USE_POLLING=1 if edits go unnoticed (VM-backed mounts
    // on Docker Desktop).
    watch: { usePolling: Boolean(process.env.VITE_USE_POLLING) },
    proxy,
  },
})
