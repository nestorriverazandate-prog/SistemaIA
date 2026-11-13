import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    // Cada ruta se genera como archivo estático (/registrar/index.html, etc.)
    // para que el hosting estático de Vercel las sirva sin fallback SPA
    adapter: adapter()
  }
};
