<script>
  import { onMount, tick } from 'svelte';
  import { api, getToken } from '$lib/api';
  import { env } from '$env/dynamic/public';
  import 'leaflet/dist/leaflet.css';

  let L; // Leaflet se importa dinámicamente en onMount (no existe en SSR)

  let mapEl;
  let map;
  let drawing = $state(false);
  let radio = $state(500);           // metros
  let nombre = $state('');
  let lista = $state([]);
  let msg = $state('');
  let error = $state('');
  let token = $state(getToken());
  let loading = $state(true);

  let previewCircle = null;         // círculo temporal al dibujar
  let previewCenter = null;
  const capas = {};                  // id -> L.layer
  const marcadores = {};             // clave -> L.layer (pacientes y trabajadores)
  let pacientes = $state([]);
  let visitasActivas = $state([]);
  let pollTimer = null;

  // Asignación de domicilio del paciente en el mapa
  let modoPaciente = $state(null);   // paciente al que se le asigna ubicación
  let puntoSel = $state(null);       // latlng elegido en el mapa
  let marcadorTmp = null;

  function renderGeocerca(g) {
    if (g.tipo === 'circulo' && g.centro_lat != null) {
      const c = L.circle([g.centro_lat, g.centro_lng], {
        radius: g.radio_m || 500,
        color: '#135666',
        fillColor: '#135666',
        fillOpacity: 0.15,
        weight: 2
      });
      c.bindTooltip(g.nombre);
      c.addTo(map);
      capas[g.id] = c;
    }
  }

  // Marcadores de adultos mayores (domicilios) y trabajadores en visita activa
  function icono(color, texto) {
    return L.divIcon({
      className: 'pin',
      html: `<div style="background:${color};color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${texto}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
  }

  // Color del marcador según estado de la visita
  function colorVisita(v) {
    if (v.estado === 'finalizada') return '#b91c1c';
    if (v.estado === 'en_curso') {
      const reciente = v.ultima_dentro_at && (Date.now() - new Date(v.ultima_dentro_at) < 10 * 60 * 1000);
      return reciente ? '#256346' : '#135666'; // verde dentro / azul en curso
    }
    const ping = v.ultima_ping_at ? Date.now() - new Date(v.ultima_ping_at) : Infinity;
    return ping < 5 * 60 * 1000 ? '#135666' : '#8a9a96'; // azul con señal / gris sin conexión
  }

  function fmtHora(iso) {
    return iso ? new Date(iso).toLocaleTimeString() : '—';
  }

  function fmtDuracion(v) {
    if (!v.llegada_at) return '—';
    const fin = v.salida_at ? new Date(v.salida_at) : new Date();
    return Math.max(0, Math.round((fin - new Date(v.llegada_at)) / 60000)) + ' min';
  }

  function pintarDatos() {
    // limpiar marcadores dinámicos
    for (const k of Object.keys(marcadores)) { map.removeLayer(marcadores[k]); delete marcadores[k]; }
    for (const p of pacientes) {
      if (p.lat == null || p.lng == null) continue;
      const m = L.marker([p.lat, p.lng], { icon: icono('#135666', 'A') })
        .bindPopup(`<b>${p.nombre} ${p.apellido}</b><br/>${p.direccion || ''}<br/><small>${p.tipo_servicio || ''}</small>`);
      m.addTo(map);
      marcadores[`pac-${p.id}`] = m;
    }
    for (const v of visitasActivas) {
      if (v.ultima_ubicacion_lat == null) continue;
      const nom = v.perfiles?.nombre || v.perfiles?.email || 'Trabajador';
      const pac = v.pacientes ? `${v.pacientes.nombre} ${v.pacientes.apellido}` : '';
      const foto = v.perfiles?.avatar_url ? `<img src="${v.perfiles.avatar_url}" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:4px" />` : '';
      const color = colorVisita(v);
      const m = L.marker([v.ultima_ubicacion_lat, v.ultima_ubicacion_lng], { icon: icono(color, 'T') })
        .bindPopup(`<b>${foto}${nom}</b> — ${pac}<br/>${v.pacientes?.direccion || ''}<br/><small>Estado: ${v.trabajador_estado || v.estado} · GPS: ${fmtHora(v.ultima_ping_at)}</small>`);
      m.addTo(map);
      marcadores[`vis-${v.id}`] = m;
    }
  }

  async function cargarDatos() {
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const [p, enCurso, delDia] = await Promise.all([
        api.pacientes().catch(() => ({ pacientes: [] })),
        api.visitas('?estado=en_curso').catch(() => ({ visitas: [] })),
        api.visitas(`?fecha=${hoy}`).catch(() => ({ visitas: [] }))
      ]);
      pacientes = p.pacientes || [];
      // Combina visitas en curso (cualquier fecha) con todas las de hoy
      const mapa = new Map();
      for (const v of [...(enCurso.visitas || []), ...(delDia.visitas || [])]) mapa.set(v.id, v);
      visitasActivas = [...mapa.values()].filter((v) => !['cancelada', 'no_show'].includes(v.estado));
      if (map) pintarDatos();
    } catch { /* silencioso: polling */ }
  }

  async function cargar() {
    try {
      const { geocercas } = await api.geocercas();
      lista = geocercas;
      for (const g of geocercas) renderGeocerca(g);
    } catch (e) {
      error = e.message;
    }
  }

  function iniciarDibujo() {
    drawing = true;
    modoPaciente = null;
    puntoSel = null;
    if (marcadorTmp) { map.removeLayer(marcadorTmp); marcadorTmp = null; }
    msg = 'Click en el mapa para ubicar el centro de la geocerca';
    error = '';
  }

  function iniciarUbicacion(p) {
    modoPaciente = p;
    puntoSel = null;
    drawing = false;
    if (previewCircle) { map.removeLayer(previewCircle); previewCircle = null; }
    error = '';
    msg = `Click en el mapa para marcar el domicilio de ${p.nombre} ${p.apellido}`;
  }

  function cancelarUbicacion() {
    modoPaciente = null;
    puntoSel = null;
    if (marcadorTmp) { map.removeLayer(marcadorTmp); marcadorTmp = null; }
    msg = '';
  }

  async function guardarUbicacion() {
    if (!modoPaciente || !puntoSel) return;
    try {
      await api.actualizarPaciente(modoPaciente.id, { lat: puntoSel.lat, lng: puntoSel.lng });
      if (marcadorTmp) { map.removeLayer(marcadorTmp); marcadorTmp = null; }
      msg = `Domicilio de ${modoPaciente.nombre} ${modoPaciente.apellido} guardado`;
      modoPaciente = null;
      puntoSel = null;
      await cargarDatos();
    } catch (e) {
      error = e.message;
    }
  }

  function cancelarDibujo() {
    drawing = false;
    previewCenter = null;
    if (previewCircle) { map.removeLayer(previewCircle); previewCircle = null; }
    msg = '';
  }

  async function guardar() {
    if (!nombre.trim() || !previewCenter) {
      error = 'Escribe un nombre y marca el centro en el mapa';
      return;
    }
    try {
      const { geocerca } = await api.crearGeocerca({
        nombre: nombre.trim(),
        tipo: 'circulo',
        centro_lat: previewCenter.lat,
        centro_lng: previewCenter.lng,
        radio_m: radio
      });
      renderGeocerca(geocerca);
      lista = [geocerca, ...lista];
      nombre = '';
      cancelarDibujo();
      msg = 'Geocerca guardada';
    } catch (e) {
      error = e.message;
    }
  }

  async function eliminar(g) {
    try {
      await api.eliminarGeocerca(g.id);
      if (capas[g.id]) { map.removeLayer(capas[g.id]); delete capas[g.id]; }
      lista = lista.filter((x) => x.id !== g.id);
    } catch (e) {
      error = e.message;
    }
  }

  function onPageShow(e) { if (e.persisted) window.location.reload(); }

  onMount(async () => {
    window.addEventListener('pageshow', onPageShow);
    L = (await import('leaflet')).default;
    if (!token) { loading = false; return; }
    try {
      const { user } = await api.me();
      if (!user?.perfil || user.perfil.estado !== 'aprobado') {
        error = 'Cuenta no aprobada';
        loading = false;
        return;
      }
      if (!['admin', 'staff'].includes(user.perfil.rol)) {
        error = 'El mapa de monitoreo es solo para directivo/staff';
        loading = false;
        return;
      }
    } catch {
      error = 'Sesión inválida';
      loading = false;
      return;
    }

    // El div del mapa solo existe cuando loading=false → renderizar primero
    loading = false;
    await tick();
    if (!mapEl) return;

    // Centro inicial: ubicación del usuario o Santiago por defecto
    let center = [-33.4489, -70.6693];
    map = L.map(mapEl).setView(center, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        map.setView([pos.coords.latitude, pos.coords.longitude], 14);
      });
    }

    map.on('click', (e) => {
      if (modoPaciente) {
        puntoSel = e.latlng;
        if (marcadorTmp) map.removeLayer(marcadorTmp);
        marcadorTmp = L.marker(e.latlng, { icon: icono('#135666', '?') }).addTo(map);
        msg = `Posición marcada: ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)} — pulsa "Guardar ubicación"`;
        return;
      }
      if (!drawing) return;
      previewCenter = e.latlng;
      if (previewCircle) map.removeLayer(previewCircle);
      previewCircle = L.circle(e.latlng, {
        radius: radio, color: '#b91c1c', fillOpacity: 0.15, weight: 2, dashArray: '6 4'
      }).addTo(map);
      msg = `Centro: ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)} — ${radio} m`;
    });

    await cargar();
    await cargarDatos();
    pollTimer = setInterval(cargarDatos, 20000); // respaldo; el SSE actualiza al instante
    const es = new EventSource('/api/eventos');
    es.onmessage = (e) => { try { if (JSON.parse(e.data).tipo === 'notificacion') cargarDatos(); } catch {} };

    return () => { if (map) map.remove(); if (pollTimer) clearInterval(pollTimer); es.close(); window.removeEventListener('pageshow', onPageShow); };
  });
</script>

<svelte:head><title>Geocercas</title></svelte:head>

<header>
  <div class="brand">
    <img src="/logo.png" alt="Agencia Gerontológica Integral" />
    <div class="brand-text">
      <span class="agency">Agencia Gerontológica Integral</span>
      <h1>Mapa — Geocercas y Visitas</h1>
    </div>
  </div>
  <div>
    <a class="ghost" href="/visitas">Visitas</a>
    <a class="ghost" href="/">← Volver</a>
  </div>
</header>

{#if loading}
  <main class="center"><p>Cargando…</p></main>
{:else if !token}
  <main class="center card"><p>Inicia sesión primero.</p><a href="/">Ir al login</a></main>
{:else if error && !lista.length}
  <main class="center card"><p class="error">{error}</p><a href="/">Volver</a></main>
{:else}
  <div class="layout">
    <section class="card">
      <h2>Dibujar geocerca</h2>
      <label>Radio (metros) <input type="number" min="10" max="50000" bind:value={radio} /></label>
      {#if drawing}
        <p class="hint">Click en el mapa para fijar el centro.</p>
        <label>Nombre <input bind:value={nombre} placeholder="Ej: Zona centro" /></label>
        <div class="btns">
          <button onclick={guardar}>Guardar</button>
          <button class="ghost" onclick={cancelarDibujo}>Cancelar</button>
        </div>
      {:else}
        <button onclick={iniciarDibujo}>+ Dibujar geocerca</button>
      {/if}
      {#if msg}<p class="ok">{msg}</p>{/if}
      {#if error}<p class="error">{error}</p>{/if}

      <h2>Geocercas ({lista.length})</h2>
      <ul>
        {#each lista as g (g.id)}
          <li>
            <span><strong>{g.nombre}</strong> — {g.radio_m || '—'} m</span>
            <button class="mini danger" onclick={() => eliminar(g)}>Eliminar</button>
          </li>
        {:else}
          <li class="muted">Sin geocercas</li>
        {/each}
      </ul>

      <h2>Domicilio de pacientes ({pacientes.length})</h2>
      {#if modoPaciente}
        <p class="hint">Click en el mapa para marcar el domicilio de <b>{modoPaciente.nombre} {modoPaciente.apellido}</b></p>
        <div class="btns">
          <button onclick={guardarUbicacion} disabled={!puntoSel}>Guardar ubicación</button>
          <button class="ghost" onclick={cancelarUbicacion}>Cancelar</button>
        </div>
      {/if}
      <ul>
        {#each pacientes as p (p.id)}
          <li>
            <span>{p.nombre} {p.apellido}{#if p.lat != null} <small class="ok">· ubicado</small>{/if}</span>
            <button class="mini" onclick={() => iniciarUbicacion(p)}>{p.lat != null ? 'Mover' : 'Ubicar'}</button>
          </li>
        {:else}
          <li class="muted">Sin pacientes registrados</li>
        {/each}
      </ul>
    </section>
    <div class="map-wrap">
      <div bind:this={mapEl} class="map"></div>
      <div class="leyenda">
        <span class="pin-dot" style="background:#256346"></span> Dentro del domicilio &nbsp;
        <span class="pin-dot" style="background:#135666"></span> En camino / en curso &nbsp;
        <span class="pin-dot" style="background:#8a9a96"></span> Sin señal GPS &nbsp;
        <span class="pin-dot" style="background:#b91c1c"></span> Finalizada / incidencia &nbsp;
        <span class="pin-dot" style="background:#135666"></span> Adulto mayor
      </div>
    </div>
  </div>

  <section class="card monitor">
    <h2>Monitoreo de visitas ({visitasActivas.length}) — se actualiza cada 20 s</h2>
    <table>
      <thead>
        <tr><th>Trabajador</th><th>Paciente</th><th>Dirección</th><th>Programada</th><th>Entrada</th><th>Salida</th><th>Tiempo</th><th>Estado</th><th>Último GPS</th></tr>
      </thead>
      <tbody>
        {#each visitasActivas as v (v.id)}
          <tr>
            <td>
              {#if v.perfiles?.avatar_url}<img class="avatar" src={v.perfiles.avatar_url} alt="" />{/if}
              {v.perfiles?.nombre || v.perfiles?.email || 'Sin asignar'}
            </td>
            <td>{v.pacientes?.nombre} {v.pacientes?.apellido}</td>
            <td>{v.pacientes?.direccion || '—'}</td>
            <td>{v.hora_programada || '—'}</td>
            <td>{fmtHora(v.llegada_at)}</td>
            <td>{fmtHora(v.salida_at)}</td>
            <td>{fmtDuracion(v)}</td>
            <td><span class="estado estado-{v.estado}">{v.trabajador_estado || v.estado.replace('_', ' ')}</span></td>
            <td>{fmtHora(v.ultima_ping_at)}</td>
          </tr>
        {:else}
          <tr><td colspan="9" class="muted">Sin visitas hoy ni en curso</td></tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; background: oklch(0.985 0.007 85); color: oklch(0.27 0.035 225); }
  header { display: flex; justify-content: space-between; align-items: center; padding: .8rem 2rem; background: oklch(0.3 0.05 222); color: #f2eee2; border-bottom: 3px solid oklch(0.7 0.1 78); }
  .brand { display: flex; align-items: center; gap: .8rem; }
  .brand-text { display: flex; flex-direction: column; }
  .agency { font-size: .72rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: oklch(0.7 0.1 78); }
  header img { height: 44px; width: 44px; object-fit: cover; border-radius: 10px; background: #f2eee2; padding: 2px; }
  header h1 { font-size: 1.05rem; margin: 0; }
  header div:not(.brand) { display: flex; gap: .5rem; }
  header a.ghost { color: #f2eee2; border: 1px solid oklch(0.55 0.05 222); padding: .4rem .8rem; border-radius: 8px; text-decoration: none; }
  .leyenda { position: absolute; bottom: 12px; left: 12px; z-index: 1000; background: #fff; padding: .5rem .8rem; border-radius: 8px; font-size: .78rem; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
  .map-wrap { position: relative; }
  .layout { display: grid; grid-template-columns: 340px 1fr; gap: 1rem; padding: 1rem; height: calc(100vh - 64px); }
  @media (max-width: 800px) { .layout { grid-template-columns: 1fr; height: auto; } }
  .card { background: #fff; border-radius: 12px; padding: 1rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: auto; }
  .map-wrap { border-radius: 12px; overflow: hidden; min-height: 400px; }
  .map { width: 100%; height: 100%; min-height: 400px; }
  label { display: flex; flex-direction: column; gap: .25rem; font-size: .85rem; font-weight: 600; margin-bottom: .6rem; }
  input { padding: .5rem .6rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
  button { padding: .55rem 1rem; border: 0; border-radius: 8px; background: #135666; color: #fff; font-weight: 600; cursor: pointer; margin-top: .4rem; }
  button:hover:not(:disabled) { background: #004555; }
  button.ghost, a.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.45 0.03 225); text-decoration: none; display: inline-block; padding: .4rem .8rem; border-radius: 8px; }
  header a.ghost { color: #f2eee2; }
  button.mini { padding: .2rem .5rem; font-size: .75rem; margin: 0; }
  button.danger { background: #b91c1c; }
  .btns { display: flex; gap: .5rem; }
  .hint { font-size: .8rem; color: oklch(0.45 0.03 225); }
  .ok { color: oklch(0.45 0.08 160); font-size: .85rem; }
  .error { color: oklch(0.55 0.2 27); font-size: .85rem; }
  .muted { color: oklch(0.55 0.03 225); }
  .center { text-align: center; padding: 3rem; }
  ul { list-style: none; padding: 0; margin: .8rem 0 0; }
  li { display: flex; justify-content: space-between; align-items: center; padding: .45rem 0; border-bottom: 1px solid oklch(0.93 0.025 140); font-size: .88rem; }
  h2 { font-size: 1rem; margin: 1rem 0 .5rem; }
  h2:first-child { margin-top: 0; }
  .pin-dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; vertical-align: middle; }
  .monitor { margin: 0 1rem 1rem; overflow: auto; }
  .monitor table { font-size: .82rem; }
  .avatar { width: 22px; height: 22px; border-radius: 50%; vertical-align: middle; margin-right: 5px; object-fit: cover; }
  .estado { padding: .12rem .45rem; border-radius: 999px; font-size: .7rem; background: oklch(0.94 0.025 80); }
  .estado-en_curso, .estado-en_domicilio { background: oklch(0.93 0.025 140); }
  .estado-programada, .estado-en_camino { background: #cfe2ff; }
  .estado-descanso { background: #fff3cd; }
  .estado-finalizada { background: #d1e7dd; }
  .estado-cancelada, .estado-no_show { background: #f8d7da; }
</style>
