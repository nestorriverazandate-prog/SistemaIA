<script>
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import Icon from '$lib/Icon.svelte';
  import { navParaRol, moduloActual } from '$lib/nav.js';
  import { sesion, cargarSesion } from '$lib/sesion.svelte.js';

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
  const actual = $derived(moduloActual(page.url.pathname, nav));

  let ahora = $state(new Date());
  onMount(() => {
    cargarSesion();
    const t = setInterval(() => (ahora = new Date()), 30000);
    return () => clearInterval(t);
  });
  const fechaTxt = $derived(
    ahora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  );
  const horaTxt = $derived(ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));

  let notifs = $state([]);
  const noLeidas = $derived(notifs.filter((n) => !n.leida).length);
  let panelNotif = $state(false);
  let timerNotif;

  async function cargarNotifs() {
    if (!sesion.user) return;
    try { notifs = (await api.notificaciones('1')).notificaciones || []; } catch {}
  }
  $effect(() => {
    if (!sesion.user) return;
    cargarNotifs();
    timerNotif = setInterval(cargarNotifs, 60000);
    return () => clearInterval(timerNotif);
  });

  async function marcarLeida(n) {
    n.leida = true;
    try { await api.leerNotificacion(n.id); } catch {}
  }
  async function leerTodas() {
    try { await api.leerTodas(); } catch {}
    notifs = [];
  }

</script>

{#if sesion.cargada && sesion.user}
<header class="top">
  <div class="izq">
    <div class="mig">
      {#if actual}
        <span class="area">{actual.area}</span>
        <span class="sep">/</span>
        <b>{actual.item.label}</b>
      {:else}
        <b>{page.url.pathname === '/' ? 'Inicio' : 'AGI'}</b>
      {/if}
    </div>
  </div>

  <div class="der">
    <span class="reloj" title={fechaTxt}>{fechaTxt} · {horaTxt}</span>

    <div class="notif-wrap">
      <button class="icono-btn" onclick={() => (panelNotif = !panelNotif)} aria-label="Notificaciones" title="Notificaciones">
        <Icon name="bell" size={18} />
        {#if noLeidas}<span class="badge">{noLeidas}</span>{/if}
      </button>
      {#if panelNotif}
        <div class="notif-panel">
          <div class="np-head">
            <b>Notificaciones</b>
            {#if noLeidas}<button class="mini" onclick={leerTodas}>Marcar leídas</button>{/if}
          </div>
          <div class="np-list">
            {#each notifs.slice(0, 12) as n (n.id)}
              <button class="n-item" onclick={() => marcarLeida(n)}>
                <span class="n-txt">{n.mensaje}</span>
                <span class="n-fecha">{new Date(n.created_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </button>
            {:else}
              <p class="mut">Sin notificaciones pendientes</p>
            {/each}
          </div>
          <a href="/mensajeria" class="np-link" onclick={() => (panelNotif = false)}>Ir a mensajería</a>
        </div>
      {/if}
    </div>

    <a href="/mensajeria" class="icono-btn" title="Mensajes" aria-label="Mensajes">
      <Icon name="chat" size={18} />
    </a>

    <div class="usuario">
      {#if fotoUrl}
        <img src={fotoUrl} alt="" />
      {:else}
        <span class="ini">{iniciales}</span>
      {/if}
      <div class="u-txt">
        <b>{nombre}</b>
        <span>{rolTexto}</span>
      </div>
    </div>
  </div>
</header>
{/if}

<style>
  .top {
    position: sticky; top: 0; z-index: 50; height: 60px;
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 0 22px 0 20px; margin-left: var(--sb-w, 264px);
    background: rgba(255, 255, 255, .92); backdrop-filter: blur(10px);
    border-bottom: 1px solid #e9e4d8;
    transition: margin-left .25s ease;
  }
  .izq { display: flex; align-items: center; gap: 18px; min-width: 0; flex: 1; }
  .mig { display: flex; align-items: baseline; gap: 7px; white-space: nowrap; }
  .mig .area { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #8a7a4e; }
  .mig .sep { color: #c9c2b0; }
  .mig b { font-size: 15px; color: #0d3a5c; }
  .mut { padding: 10px 12px; font-size: 12px; color: #8a94a0; margin: 0; }
  .der { display: flex; align-items: center; gap: 10px; }
  .reloj { font-size: 12px; color: #6b7a89; white-space: nowrap; }
  .icono-btn {
    position: relative; width: 38px; height: 38px; border-radius: 10px;
    border: 1px solid #e0dac8; background: #fff; color: #0d3a5c;
    display: flex; align-items: center; justify-content: center; cursor: pointer;
    text-decoration: none;
  }
  .icono-btn:hover { border-color: #b8932f; color: #8a6d1f; }
  .badge {
    position: absolute; top: -5px; right: -5px; min-width: 17px; height: 17px;
    border-radius: 9px; background: #c0392b; color: #fff;
    font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; padding: 0 4px;
  }
  .notif-wrap { position: relative; }
  .notif-panel {
    position: absolute; right: 0; top: calc(100% + 8px); width: 340px; z-index: 90;
    background: #fff; border: 1px solid #e4ddcc; border-radius: 14px;
    box-shadow: 0 16px 40px rgba(13, 58, 92, .2); overflow: hidden;
  }
  .np-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #eee8d8; }
  .np-head b { font-size: 13px; color: #0d3a5c; }
  .np-list { max-height: 320px; overflow-y: auto; }
  .n-item {
    display: block; width: 100%; text-align: left; padding: 10px 14px;
    border: none; background: none; border-bottom: 1px solid #f3efe4; cursor: pointer;
  }
  .n-item:hover { background: #faf8f2; }
  .n-txt { display: block; font-size: 12.5px; color: #24303d; }
  .n-fecha { font-size: 10.5px; color: #9aa5b1; }
  .np-link { display: block; padding: 10px 14px; font-size: 12px; font-weight: 700; color: #0d5c8a; text-decoration: none; text-align: center; }
  .np-link:hover { background: #f5f2ea; }
  .usuario { display: flex; align-items: center; gap: 9px; padding-left: 10px; border-left: 1px solid #e9e4d8; }
  .usuario img, .usuario .ini {
    width: 34px; height: 34px; border-radius: 50%; object-fit: cover;
    border: 2px solid #d4af37;
  }
  .usuario .ini { display: flex; align-items: center; justify-content: center; background: #0d3a5c; color: #d4af37; font-weight: 800; font-size: 12px; }
  .u-txt b { display: block; font-size: 12.5px; color: #0d3a5c; line-height: 1.2; }
  .u-txt span { font-size: 10.5px; color: #8a94a0; }

  @media (max-width: 1100px) { .reloj, .u-txt { display: none; } }
  @media (max-width: 900px) {
    .top { margin-left: 0; padding: 0 14px 0 62px; }
    .mig .area, .mig .sep { display: none; }
  }
</style>
