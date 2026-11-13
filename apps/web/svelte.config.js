import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    // SPA estática: el API (Express) sirve estos archivos en el mismo servidor
    adapter: adapter({ fallback: 'index.html' })
  }
};
