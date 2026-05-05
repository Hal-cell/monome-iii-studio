import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages project sites live at https://<user>.github.io/<repo>/,
// so production builds must reference assets via that subpath. The
// VITE_BASE env lets the workflow override it (e.g. '/' if you ever
// deploy to a custom domain). Dev server stays at '/'.
const base = process.env.VITE_BASE ?? '/monome-iii-studio/';

export default defineConfig(({ command }) => ({
  plugins: [solid(), tailwindcss()],
  base: command === 'build' ? base : '/',
  server: {
    port: 5173,
  },
}));
