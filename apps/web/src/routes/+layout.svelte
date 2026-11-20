<script>
  import PanicButton from '$lib/PanicButton.svelte';
  import Sidebar from '$lib/Sidebar.svelte';
  import Topbar from '$lib/Topbar.svelte';
  import { sesion, cargarSesion } from '$lib/sesion.svelte.js';
  import { onMount } from 'svelte';
  let { children } = $props();

  onMount(() => {
    cargarSesion();
  });

  // Reserva de espacio para el sidebar fijo
  $effect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('con-menu', !!sesion.user);
    document.documentElement.dataset.sb = 'full';
    try {
      document.documentElement.dataset.sb = localStorage.getItem('agi_menu_colapsado') === '1' ? 'mini' : 'full';
    } catch {}
    return () => document.body.classList.remove('con-menu');
  });
</script>

<Sidebar />
<Topbar />
{@render children()}
<PanicButton />

<style>
  :root { --sb-w: 264px; }
  :root[data-sb='mini'] { --sb-w: 76px; }
  @media (max-width: 900px) { :root { --sb-w: 0px; } }

  :global(body) {
    background: #f5f3ee;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    transition: padding-left .25s ease;
  }
  :global(body.con-menu) { padding-left: var(--sb-w); }
  :global(body.con-menu .panic-fab) { left: calc(var(--sb-w) + 16px); }

  /* Los encabezados de página ya no saturan la barra superior:
     la navegación vive en el sidebar y la topbar ejecutiva */
  :global(body:has(aside.side) header a.ghost.link) { display: none; }

  :global(header a.brand) { display: flex; align-items: center; gap: 12px; text-decoration: none; }
  :global(header a.brand img) { width: 44px; height: 44px; border-radius: 12px; object-fit: cover; }
  :global(header .brand-text .agency) { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #8a7a4e; }
  :global(header .brand-text h1) { margin: 2px 0 0; font-size: 20px; color: #0d3a5c; }

  @media (max-width: 900px) {
    :global(body.con-menu) { padding-left: 0; }
    :global(body.con-menu .panic-fab) { left: 16px; }
    :global(header) { flex-wrap: wrap; }
  }
</style>
