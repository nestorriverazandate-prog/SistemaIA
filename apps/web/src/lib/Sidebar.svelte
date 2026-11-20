<script>
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { limpiarSesion, cargarSesion, sesion } from '$lib/sesion.svelte.js';
  import Icon from '$lib/Icon.svelte';
  import { navParaRol, rutaActiva } from '$lib/nav.js';

  const rol = $derived(sesion.user?.perfil?.rol || '');
  const nav = $derived(rol ? navParaRol(rol) : []);
  const nombre = $derived(sesion.user?.perfil?.nombre || sesion.user?.nombre || sesion.user?.email || '');
  const rolTexto = $derived(
    rol === 'admin' ? 'Directivo' : rol === 'staff' ? 'Empleado' : rol === 'cuidador' ? 'Cuidador' : rol === 'familiar' ? 'Familiar' : 'Cuenta'
  );
  const iniciales = $derived((nombre || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase());
  const fotoUrl = $derived(
    sesion.user?.perfil?.foto_path ? `/api/perfiles/${sesion.user.perfil.id}/foto?t=${Date.now()}` : null
  );

  let abiertas = $state(new Set());
  let colapsado = $state(false);
  let movil = $state(false);

  function grupoDe(pathname) {
    for (const g of nav) if (g.items.some((i) => rutaActiva(pathname, i.href))) return g.area;
    return null;
  }
  $effect(() => {
    const area = grupoDe(page.url.pathname);
    if (area) abiertas.add(area);
  });

  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    colapsado = localStorage.getItem('agi_menu_colapsado') === '1';
  });
  function toggleColapso() {
    colapsado = !colapsado;
    try {
      localStorage.setItem('agi_menu_colapsado', colapsado ? '1' : '0');
      document.documentElement.dataset.sb = colapsado ? 'mini' : 'full';
    } catch {}
  }

  function cerrarSesion() {
    limpiarSesion();
    window.location.href = '/';
  }

  onMount(() => {
    cargarSesion();
    function onKey(e) { if (e.key === 'Escape') movil = false; }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if sesion.cargada && sesion.user}
  {#if movil}
    <div class="fondo" onclick={() => (movil = false)} role="button" tabindex="-1" aria-label="Cerrar menú" onkeydown={(e) => e.key === 'Escape' && (movil = false)}></div>
  {/if}

  <aside class="side {colapsado ? 'mini' : ''} {movil ? 'abierto' : ''}">
    <div class="logo">
      <img src="/logo.png" alt="AGI" />
      {#if !colapsado}
        <div>
          <b>AGI</b>
          <span>Agencia Gerontológica Integral</span>
        </div>
      {/if}
    </div>

    <button class="colapsar" onclick={toggleColapso} title={colapsado ? 'Expandir menú' : 'Contraer menú'} aria-label="Contraer o expandir menú">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d={colapsado ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} /></svg>
    </button>

    <nav class="nav">
      {#each nav as grupo (grupo.area)}
        <section class="grupo">
          {#if !colapsado}
            <button class="area" onclick={() => { const s = new Set(abiertas); s.has(grupo.area) ? s.delete(grupo.area) : s.add(grupo.area); abiertas = s; }} aria-expanded={abiertas.has(grupo.area)}>
              <span class="area-nombre">{grupo.area}</span>
              <svg class="chev {abiertas.has(grupo.area) ? 'giro' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          {/if}
          {#if colapsado || abiertas.has(grupo.area)}
            <ul class="items {colapsado ? 'solo-iconos' : ''}">
              {#each grupo.items as item (item.href)}
                {@const activo = rutaActiva(page.url.pathname, item.href)}
                <li>
                  <a href={item.href} class:activo class="item" title={colapsado ? item.label : ''} aria-label={item.label} onclick={() => (movil = false)}>
                    <span class="ico"><Icon name={item.icon} size={18} /></span>
                    {#if !colapsado}<span class="lbl">{item.label}</span>{/if}
                    {#if activo}<span class="punto" aria-hidden="true"></span>{/if}
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    </nav>

    <div class="pie">
      {#if fotoUrl}
        <img class="avatar" src={fotoUrl} alt="" />
      {:else}
        <span class="avatar ini">{iniciales}</span>
      {/if}
      {#if !colapsado}
        <div class="quien">
          <b>{nombre}</b>
          <span>{rolTexto}</span>
        </div>
        <button class="salir" onclick={cerrarSesion} title="Cerrar sesión" aria-label="Cerrar sesión">
          <Icon name="logout" size={16} />
        </button>
      {/if}
    </div>
  </aside>

  <button class="hamb" onclick={() => (movil = !movil)} aria-label="Abrir menú">
    <Icon name="menu" size={20} />
  </button>
{/if}

<style>
  .side {
    position: fixed; top: 0; bottom: 0; left: 0; width: var(--sb-w, 264px); z-index: 60;
    background: linear-gradient(180deg, #07263f 0%, #04182b 100%);
    color: #e8eef4; display: flex; flex-direction: column;
    border-right: 1px solid rgba(212, 175, 55, .18);
    box-shadow: 4px 0 24px rgba(4, 24, 43, .18);
    transition: width .25s ease, transform .25s ease;
  }
  .side.mini { width: 76px; }
  .logo {
    display: flex; align-items: center; gap: 12px; padding: 18px 16px 14px;
    border-bottom: 1px solid rgba(255,255,255,.07);
  }
  .logo img { width: 40px; height: 40px; border-radius: 12px; object-fit: cover; background: #fff; }
  .logo b { display: block; font-size: 18px; letter-spacing: .08em; color: #d4af37; }
  .logo span { font-size: 10.5px; color: #9fb4c7; line-height: 1.3; }
  .colapsar {
    position: absolute; right: -13px; top: 64px; width: 26px; height: 26px;
    border-radius: 50%; border: 1px solid rgba(255,255,255,.15);
    background: #0d3a5c; color: #d4af37; cursor: pointer;
    display: flex; align-items: center; justify-content: center; z-index: 2;
  }
  .colapsar:hover { background: #14507c; }
  .nav { flex: 1; overflow-y: auto; padding: 12px 10px; }
  .nav::-webkit-scrollbar { width: 4px; }
  .nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 4px; }
  .grupo { margin-bottom: 6px; }
  .area {
    width: 100%; display: flex; align-items: center; justify-content: space-between;
    padding: 9px 12px; background: none; border: none; color: #9fb4c7;
    font-size: 10.5px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase;
    cursor: pointer; border-radius: 8px;
  }
  .area:hover { color: #e8eef4; background: rgba(255,255,255,.04); }
  .chev { transition: transform .2s; }
  .chev.giro { transform: rotate(180deg); }
  .items { list-style: none; margin: 2px 0 6px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .item {
    display: flex; align-items: center; gap: 11px; padding: 8px 12px;
    border-radius: 10px; color: #c6d4e0; text-decoration: none;
    font-size: 13.5px; font-weight: 500; position: relative;
    transition: background .15s, color .15s;
  }
  .item:hover { background: rgba(255,255,255,.06); color: #fff; }
  .item.activo { background: linear-gradient(90deg, rgba(212,175,55,.18), rgba(212,175,55,.05)); color: #f0d27a; }
  .item.activo::before {
    content: ''; position: absolute; left: 0; top: 20%; bottom: 20%;
    width: 3px; border-radius: 3px; background: #d4af37;
  }
  .ico { display: flex; align-items: center; justify-content: center; width: 20px; flex-shrink: 0; }
  .item.activo .ico { color: #d4af37; }
  .solo-iconos .item { justify-content: center; padding: 10px 0; }
  .punto { margin-left: auto; width: 6px; height: 6px; border-radius: 50%; background: #d4af37; }
  .pie {
    display: flex; align-items: center; gap: 10px; padding: 14px 14px 16px;
    border-top: 1px solid rgba(255,255,255,.07);
  }
  .avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(212,175,55,.5); flex-shrink: 0; }
  .avatar.ini { display: flex; align-items: center; justify-content: center; background: #d4af37; color: #07263f; font-weight: 800; font-size: 13px; }
  .quien { flex: 1; min-width: 0; }
  .quien b { display: block; font-size: 13px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .quien span { font-size: 11px; color: #8fa9bd; }
  .salir {
    background: none; border: 1px solid rgba(255,255,255,.15); color: #9fb4c7;
    border-radius: 8px; padding: 6px 8px; cursor: pointer; display: flex;
  }
  .salir:hover { color: #fff; border-color: rgba(255,255,255,.3); }
  .side.mini .pie { flex-direction: column; }
  .side.mini .logo { justify-content: center; padding: 16px 8px; }
  .hamb {
    display: none; position: fixed; top: 12px; left: 12px; z-index: 70;
    width: 40px; height: 40px; border-radius: 10px; border: 1px solid #d8d2c2;
    background: #fff; color: #0d3a5c; cursor: pointer;
    align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,.15);
  }
  .fondo { display: none; }

  @media (max-width: 900px) {
    .hamb { display: flex; }
    .side {
      width: 280px !important; transform: translateX(-105%);
      transition: transform .25s ease;
    }
    .side.abierto { transform: translateX(0); }
    .side.mini { width: 280px !important; }
    .colapsar { display: none; }
    .fondo {
      display: block; position: fixed; inset: 0; z-index: 55;
      background: rgba(4, 24, 43, .55); backdrop-filter: blur(2px);
    }
  }
</style>
