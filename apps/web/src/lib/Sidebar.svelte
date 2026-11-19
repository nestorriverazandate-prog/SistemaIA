<script>
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { api, getToken, setToken } from '$lib/api';

  let perfil = $state(null);
  let cargado = $state(false);
  let menuAbierto = $state(false);
  let gruposAbiertos = $state({});

  const NAV = {
    admin: [
      { area: 'Dirección', items: [
        { href: '/', label: 'Resumen ejecutivo' },
        { href: '/centro', label: 'Centro de inteligencia' }
      ]},
      { area: 'Gestión de pacientes', items: [
        { href: '/pacientes', label: 'Pacientes' },
        { href: '/expediente', label: 'Expediente 360°' },
        { href: '/semaforo', label: 'Semáforo de riesgo' },
        { href: '/paquetes', label: 'Paquetes y cobros' },
        { href: '/constancia', label: 'Constancias' }
      ]},
      { area: 'Atención profesional', items: [
        { href: '/agenda', label: 'Agenda' },
        { href: '/visitas', label: 'Visitas' },
        { href: '/registrar', label: 'Registrar visita' },
        { href: '/seguimiento', label: 'Seguimiento' },
        { href: '/mapa', label: 'Mapa en vivo' }
      ]},
      { area: 'Familia', items: [
        { href: '/familiar', label: 'Portal familiar' },
        { href: '/encuestas', label: 'Encuestas de satisfacción' }
      ]},
      { area: 'Talento humano', items: [
        { href: '/personal', label: 'Personal' },
        { href: '/academia', label: 'Academia' },
        { href: '/evaluaciones', label: 'Evaluaciones' }
      ]},
      { area: 'Innovación y territorio', items: [
        { href: '/observatorio', label: 'Observatorio gerontológico' }
      ]},
      { area: 'Comunicación', items: [
        { href: '/mensajeria', label: 'Mensajería' },
        { href: '/emergencias', label: 'Emergencias' },
        { href: '/chat-emergencia', label: 'Chat de emergencia' }
      ]}
    ],
    staff: [
      { area: 'Mi trabajo', items: [
        { href: '/', label: 'Mi panel' },
        { href: '/mis-pacientes', label: 'Mis pacientes' },
        { href: '/mapa-pacientes', label: 'Mapa de pacientes' },
        { href: '/agenda', label: 'Mi agenda' },
        { href: '/visitas', label: 'Mis visitas' },
        { href: '/registrar', label: 'Registrar visita' },
        { href: '/seguimiento', label: 'Seguimiento' }
      ]},
      { area: 'Formación', items: [
        { href: '/academia', label: 'Academia' },
        { href: '/evaluaciones', label: 'Mis evaluaciones' }
      ]},
      { area: 'Comunicación', items: [
        { href: '/mensajeria', label: 'Mensajería' },
        { href: '/chat-emergencia', label: 'Chat de emergencia' }
      ]}
    ],
    familiar: [
      { area: 'Mi familia', items: [
        { href: '/familiar', label: 'Portal familiar' },
        { href: '/encuestas', label: 'Encuestas' },
        { href: '/mensajeria', label: 'Mensajería' }
      ]}
    ],
    otro: [
      { area: 'General', items: [
        { href: '/', label: 'Inicio' },
        { href: '/mensajeria', label: 'Mensajería' }
      ]}
    ]
  };

  const rol = $derived(perfil?.rol || '');
  const nav = $derived(NAV[rol === 'admin' ? 'admin' : ['staff', 'cuidador'].includes(rol) ? 'staff' : rol === 'familiar' ? 'familiar' : 'otro'] || NAV.otro);
  const visible = $derived(!!perfil);

  function activo(href) {
    const p = page.url.pathname;
    return href === '/' ? p === '/' : p === href || p.startsWith(href + '/');
  }
  function grupoActivo(g) { return g.items.some((i) => activo(i.href)); }
  function toggleGrupo(area) { gruposAbiertos[area] = !gruposAbiertos[area]; gruposAbiertos = { ...gruposAbiertos }; }
  function etiquetaRol(r) { return { admin: 'Directivo', staff: 'Empleado', cuidador: 'Cuidador', familiar: 'Familiar', paciente: 'Paciente' }[r] || r; }

  function cerrar() { menuAbierto = false; document.body.classList.remove('menu-movil'); }
  function toggleMenu() {
    menuAbierto = !menuAbierto;
    document.body.classList.toggle('menu-movil', menuAbierto);
  }

  onMount(async () => {
    if (!getToken()) return;
    try {
      const me = await api.raw('/api/me');
      perfil = me?.user?.perfil || me?.perfil || null;
      if (perfil?.rol === 'admin') perfil = { ...perfil, rol: 'admin' };
    } catch {}
    cargado = true;
    if (perfil) {
      // abrir por defecto el grupo que contiene la ruta actual
      const init = {};
      for (const g of nav) init[g.area] = grupoActivo(g);
      gruposAbiertos = init;
      document.body.classList.add('con-menu');
    }
    const onResize = () => { if (window.innerWidth >= 900) cerrar(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });
  onDestroy(() => { if (typeof document !== 'undefined') document.body.classList.remove('con-menu', 'menu-movil'); });
</script>

{#if visible}
<button class="btn-menu" onclick={toggleMenu} aria-label="Menú">≡</button>
{#if menuAbierto}<button class="backdrop" onclick={cerrar} aria-label="Cerrar menú"></button>{/if}

<aside class="sidebar" class:abierto={menuAbierto}>
  <div class="side-head">
    <img src="/logo.png" alt="AGI" />
    <div>
      <strong>AGI</strong>
      <span>Gerontológica Integral</span>
    </div>
  </div>

  <nav class="nav">
    {#each nav as g}
      <div class="grupo">
        <button class="grupo-head" onclick={() => toggleGrupo(g.area)}>
          <span>{g.area}</span>
          <span class="chev" class:cerrado={!gruposAbiertos[g.area] && !grupoActivo(g)}>▾</span>
        </button>
        {#if gruposAbiertos[g.area] || grupoActivo(g)}
          {#each g.items as item}
            <a href={item.href} class="item" class:act={activo(item.href)} onclick={cerrar}>
              {item.label}
            </a>
          {/each}
        {/if}
      </div>
    {/each}
  </nav>

  <div class="side-foot">
    <div class="user-box">
      <b>{perfil?.nombre || perfil?.email}</b>
      <span>{etiquetaRol(perfil?.rol)}</span>
    </div>
    <a class="salir" href="/" onclick={(e) => { e.preventDefault(); setToken(null); window.location.href = '/'; }}>Cerrar sesión</a>
  </div>
</aside>
{/if}

<style>
  .sidebar {
    position: fixed; top: 0; left: 0; bottom: 0; width: 250px; z-index: 9995;
    background: oklch(0.24 0.04 225); color: #e8e4da;
    display: flex; flex-direction: column;
    transform: translateX(-100%); transition: transform .25s ease;
    box-shadow: 4px 0 20px rgba(0,0,0,.25);
  }
  :global(body.con-menu) .sidebar { transform: translateX(0); }
  :global(body.menu-movil) .sidebar { transform: translateX(0); }
  :global(body.menu-movil) .sidebar.abierto { transform: translateX(0); }

  .side-head {
    display: flex; align-items: center; gap: .7rem; padding: 1rem 1.1rem;
    border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .side-head img { width: 42px; height: 42px; border-radius: 10px; object-fit: cover; background: #f2eee2; padding: 2px; }
  .side-head strong { display: block; font-size: .95rem; color: #f2eee2; letter-spacing: .06em; }
  .side-head span { font-size: .65rem; color: oklch(0.7 0.1 78); letter-spacing: .08em; text-transform: uppercase; }

  .nav { flex: 1; overflow-y: auto; padding: .6rem 0 .8rem; }
  .grupo-head {
    width: 100%; display: flex; justify-content: space-between; align-items: center;
    background: none; border: none; cursor: pointer; text-align: left;
    padding: .55rem 1.1rem .3rem; font-size: .68rem; font-weight: 800;
    letter-spacing: .12em; text-transform: uppercase; color: oklch(0.72 0.03 85);
  }
  .chev { transition: transform .2s; font-size: .7rem; }
  .chev.cerrado { transform: rotate(-90deg); }
  .item {
    display: block; padding: .42rem 1.1rem .42rem 1.5rem;
    color: #d6d2c8; text-decoration: none; font-size: .86rem;
    border-left: 3px solid transparent; transition: background .15s, color .15s;
  }
  .item:hover { background: rgba(255,255,255,.06); color: #fff; }
  .item.act {
    background: rgba(240,190,90,.14); color: oklch(0.85 0.1 85);
    border-left-color: oklch(0.7 0.1 78); font-weight: 700;
  }

  .side-foot { border-top: 1px solid rgba(255,255,255,.08); padding: .8rem 1.1rem; }
  .user-box { margin-bottom: .6rem; }
  .user-box b { display: block; font-size: .85rem; color: #f2eee2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .user-box span { font-size: .72rem; color: oklch(0.72 0.03 85); }
  .salir {
    display: block; text-align: center; padding: .5rem; border-radius: 8px;
    background: rgba(231,76,60,.16); color: #fca5a5; text-decoration: none;
    font-size: .82rem; font-weight: 700;
  }
  .salir:hover { background: rgba(231,76,60,.3); color: #fff; }

  .btn-menu {
    display: none; position: fixed; top: 12px; left: 12px; z-index: 9996;
    width: 42px; height: 42px; border-radius: 10px; border: none; cursor: pointer;
    background: oklch(0.3 0.05 222); color: #f2eee2; font-size: 1.3rem; line-height: 1;
    box-shadow: 0 2px 10px rgba(0,0,0,.3);
  }
  .backdrop {
    display: none; position: fixed; inset: 0; z-index: 9994;
    background: rgba(0,0,0,.45); border: none; cursor: pointer; padding: 0;
  }

  @media (max-width: 900px) {
    .sidebar { width: 280px; }
    :global(body.con-menu:not(.menu-movil)) .sidebar { transform: translateX(-100%); }
    .btn-menu { display: flex; align-items: center; justify-content: center; }
    :global(body.menu-movil) .backdrop { display: block; }
    :global(body.menu-movil) { overflow: hidden; }
  }
</style>
