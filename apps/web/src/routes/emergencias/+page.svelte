<script>
  import { onMount, onDestroy } from 'svelte';
  import { api, getToken } from '$lib/api';
  import 'leaflet/dist/leaflet.css';

  let L;
  let me = $state(null);
  let esAdmin = $state(false);
  let lista = $state([]);
  let eventos = $state([]);
  let loading = $state(true);
  let error = $state('');
  let mapEl;
  let map = null;
  let marcadores = {};
  let eventoAbierto = $state(null);
  let chatAbierto = $state(null);
  let mensajes = $state([]);
  let mensajeTexto = $state('');
  let accionesTexto = $state('');
  let contactoRealizado = $state('');
  let pollTimer = null;
  let es = null;

  const ESTADOS = {
    activa: ' ALERTA ACTIVADA', confirmada: ' DIRECTIVO ENTERADO',
    en_gestion: ' AYUDA EN GESTIÓN', atendida: ' EMERGENCIA ATENDIDA',
    cerrada: ' EMERGENCIA CERRADA', cancelada: 'CANCELADA'
  };

  function fmtFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function tiempoRespuesta(e) {
    if (!e.confirmada_at || !e.created_at) return '—';
    const ms = new Date(e.confirmada_at) - new Date(e.created_at);
    return ms < 0 ? '—' : `${Math.round(ms / 1000)}s`;
  }
  function eventosDe(id) { return eventos.filter((ev) => ev.emergencia_id === id); }
  function fotoUrl(p) { return p?.foto_path ? `/api/perfiles/${p.id}/foto?t=${Date.now()}` : null; }

  async function cargar() {
    try {
      const data = await api.raw('/api/emergencias');
      lista = data.emergencias || [];
      eventos = data.eventos || [];
      error = '';
    } catch (e) { error = e.message; }
    loading = false;
    dibujarMarcadores();
  }

  async function eliminarHistorial() {
    const n = lista.filter((e) => ['cerrada','cancelada'].includes(e.estado)).length;
    if (!n) { error = 'No hay historial para eliminar'; return; }
    if (!confirm(`¿Eliminar ${n} emergencia(s) cerradas o canceladas del historial? Esta acción no se puede deshacer.`)) return;
    try {
      const d = await api.raw('/api/emergencias/historial', { method: 'DELETE' });
      error = '';
      await cargar();
    } catch (e) { error = e.message; }
  }

  async function eliminarActivas() {
    const n = lista.filter((e) => ['activa','confirmada','en_gestion','atendida'].includes(e.estado)).length;
    if (!n) { error = 'No hay alertas activas'; return; }
    if (!confirm(`¿Eliminar ${n} alerta(s) activas o en gestión? Se borrarán junto con su chat y bitácora. Solo hazlo si ya no son reales.`)) return;
    try {
      await api.raw('/api/emergencias/activas', { method: 'DELETE' });
      error = '';
      await cargar();
    } catch (e) { error = e.message; }
  }

  async function toggleChat(e) {
    chatAbierto = chatAbierto === e.id ? null : e.id;
    if (chatAbierto === e.id) await cargarMensajes(e.id);
  }
  async function cargarMensajes(id) {
    try { const d = await api.raw(`/api/emergencias/${id}/mensajes`); mensajes = d.mensajes || []; }
    catch { mensajes = []; }
  }
  async function enviarMensaje(e) {
    if (!mensajeTexto.trim()) return;
    try {
      await api.raw(`/api/emergencias/${e.id}/mensajes`, { method: 'POST', body: JSON.stringify({ mensaje: mensajeTexto }) });
      mensajeTexto = '';
      await cargarMensajes(e.id);
    } catch (err) { error = err.message; }
  }
  function nombreRemitente(m) { return m.perfiles?.nombre || (m.remitente_id === me?.user?.id ? 'Tú' : 'Contacto'); }

  async function confirmar(e) {
    try { await api.raw(`/api/emergencias/${e.id}/confirmar`, { method: 'POST', body: '{}' }); await cargar(); }
    catch (err) { error = err.message; }
  }
  async function atender(e) {
    try {
      await api.raw(`/api/emergencias/${e.id}/atender`, {
        method: 'POST',
        body: JSON.stringify({ acciones: accionesTexto, contacto_realizado: contactoRealizado || null })
      });
      accionesTexto = ''; contactoRealizado = ''; eventoAbierto = null;
      await cargar();
    } catch (err) { error = err.message; }
  }
  async function gestionar(e) {
    try { await api.raw(`/api/emergencias/${e.id}/gestion`, { method: 'POST', body: '{}' }); await cargar(); }
    catch (err) { error = err.message; }
  }
  async function cerrar(e) {
    const obs = prompt('Observaciones de cierre de la emergencia:');
    if (obs === null) return;
    try { await api.raw(`/api/emergencias/${e.id}/cerrar`, { method: 'POST', body: JSON.stringify({ observaciones: obs }) }); await cargar(); }
    catch (err) { error = err.message; }
  }
  async function cancelar(e) {
    const motivo = prompt('Motivo de cancelación:');
    if (motivo === null) return;
    try { await api.raw(`/api/emergencias/${e.id}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo }) }); await cargar(); }
    catch (err) { error = err.message; }
  }

  function dibujarMarcadores() {
    if (!map || !L) return;
    Object.values(marcadores).forEach((m) => map.removeLayer(m));
    marcadores = {};
    const activas = lista.filter((e) => ['activa','confirmada','en_gestion'].includes(e.estado));
    let bounds = [];
    for (const e of lista) {
      if (e.lat == null || e.lng == null) continue;
      const color = e.estado === 'activa' ? '#e74c3c' : ['confirmada','en_gestion'].includes(e.estado) ? '#e67e22' : '#95a5a6';
      const mk = L.circleMarker([e.lat, e.lng], { radius: 10, color, fillColor: color, fillOpacity: .6, weight: 3 })
        .addTo(map)
        .bindPopup(`<b>${e.perfiles?.nombre || 'Empleado'}</b><br>${ESTADOS[e.estado] || e.estado}<br>${e.pacientes ? 'Paciente: ' + e.pacientes.nombre + ' ' + (e.pacientes.apellido || '') : ''}<br>${fmtFecha(e.created_at)}`);
      marcadores[e.id] = mk;
      if (activas.includes(e)) bounds.push([e.lat, e.lng]);
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    else if (!map.getCenter()) map.setView([20.67, -103.35], 12);
  }

  onMount(async () => {
    if (!getToken()) { window.location.href = '/'; return; }
    L = (await import('leaflet')).default;
    me = await api.raw('/api/me').catch(() => null);
    esAdmin = me?.user?.perfil?.rol === 'admin' || me?.perfil?.rol === 'admin';
    map = L.map(mapEl).setView([20.67, -103.35], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    await cargar();
    pollTimer = setInterval(cargar, 10000);
    es = new EventSource('/api/eventos');
    es.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data);
        if (d.tipo === 'emergencia') cargar();
      } catch {}
    };
  });
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (es) es.close();
    if (map) map.remove();
  });
</script>

<svelte:head><title>Centro de Emergencias — AGI</title></svelte:head>

<div class="wrap">
  <header>
    <div>
      <h1> CENTRO DE EMERGENCIAS</h1>
      <p class="sub">Alertas del botón de pánico · {new Date().toLocaleString('es-MX')}</p>
    </div>
    <div class="head-actions">
      {#if esAdmin}<button class="ghost link danger" onclick={eliminarActivas}>Eliminar activas</button>{/if}
      {#if esAdmin}<button class="ghost link danger" onclick={eliminarHistorial}>Eliminar historial</button>{/if}
      <a class="ghost link" href="/">← Inicio</a>
    </div>
  </header>

  {#if error}<div class="alert-error">{error}</div>{/if}

  <div class="grid">
    <section class="col-mapa">
      <div class="card">
        <h2>Mapa de alertas</h2>
        <div class="mapa" bind:this={mapEl}></div>
        <div class="leyenda">
          <span><i style="background:#e74c3c"></i> Activa</span>
          <span><i style="background:#e67e22"></i> Confirmada</span>
          <span><i style="background:#95a5a6"></i> Cerrada</span>
        </div>
      </div>
      <div class="card">
        <h2>Historial ({lista.filter(e => !['activa','confirmada','en_gestion'].includes(e.estado)).length})</h2>
        {#each lista.filter(e => !['activa','confirmada','en_gestion'].includes(e.estado)) as e}
          <div class="hist">
            <b>{e.perfiles?.nombre || '—'}</b> · {ESTADOS[e.estado] || e.estado} · {fmtFecha(e.created_at)}
            {#if e.motivo_cancelacion}<span class="mut"> — motivo: {e.motivo_cancelacion}</span>{/if}
          </div>
        {/each}
        {#if !lista.filter(e => !['activa','confirmada','en_gestion'].includes(e.estado)).length}
          <p class="mut">Sin incidentes previos.</p>
        {/if}
      </div>
    </section>

    <section class="col-lista">
      <h2>Alertas activas ({lista.filter(e => ['activa','confirmada','en_gestion'].includes(e.estado)).length})</h2>
      {#if loading}<p class="mut">Cargando…</p>{/if}
      {#each lista.filter(e => ['activa','confirmada','en_gestion'].includes(e.estado)) as e}
        {@const emp = e.perfiles}
        {@const pac = e.pacientes}
        <div class="card alerta {e.estado}">
          <div class="alerta-head">
            <span class="badge {e.estado}">{ESTADOS[e.estado] || e.estado}</span>
            <span class="hora">{fmtFecha(e.created_at)}</span>
          </div>
          <div class="datos">
            <div class="foto-wrap">
              {#if fotoUrl(emp)}<img class="foto" src={fotoUrl(emp)} alt="" />{:else}<div class="foto placeholder"></div>{/if}
            </div>
            <div>
              <b>{emp?.nombre || 'Empleado'}</b>
              <div class="mut">{emp?.profesion || ''} {emp?.telefono ? '· ' + emp.telefono : ''}</div>
              <div class="mut"> <a href="tel:{emp?.telefono}">{emp?.telefono || 'sin teléfono'}</a>
                {#if e.contacto_respaldo} · respaldo: {e.contacto_respaldo}{/if}</div>
            </div>
          </div>
          {#if pac}
            <div class="pac">
              <b>Paciente:</b> {pac.nombre} {pac.apellido || ''}
              {#if pac.direccion}<div class="mut"> {pac.direccion}</div>{/if}
            </div>
          {:else}
            <div class="mut">Sin paciente asociado</div>
          {/if}
          <div class="mut">
            Servicio: {e.servicio || '—'} · GPS: {e.lat != null ? e.lat.toFixed(5) + ', ' + e.lng.toFixed(5) : 'no disponible'} ·
            Silenciosa: {e.silenciosa ? 'sí' : 'no'}
          </div>
          <div class="mut">Respuesta: {e.estado === 'confirmada' ? tiempoRespuesta(e) : 'pendiente'}</div>

          {#if e.empleado_confirmo_at}
            <div class="mut"> Empleado confirmó recepción del aviso: {fmtFecha(e.empleado_confirmo_at)}</div>
          {:else if ['confirmada','en_gestion'].includes(e.estado)}
            <div class="mut"> Esperando que el empleado confirme recepción del aviso</div>
          {/if}
          <div class="acciones">
            {#if esAdmin && e.estado === 'activa'}
              <button class="btn-confirmar" onclick={() => confirmar(e)}> YA ESTOY ENTERADO DE LA EMERGENCIA</button>
            {/if}
            {#if esAdmin && e.estado === 'confirmada'}
              <button class="btn-gestion" onclick={() => gestionar(e)}> Estoy gestionando la ayuda</button>
            {/if}
            {#if esAdmin && ['activa','confirmada','en_gestion'].includes(e.estado)}
              <button class="btn-atender" onclick={() => (eventoAbierto = eventoAbierto === e.id ? null : e.id)}> Registrar atención</button>
            {/if}
            {#if esAdmin && ['confirmada','en_gestion','atendida'].includes(e.estado)}
              <button class="btn-cerrar" onclick={() => cerrar(e)}> Cerrar incidente</button>
            {/if}
            {#if ['activa','confirmada','en_gestion','atendida'].includes(e.estado)}
              <a class="btn-chat" href="/chat-emergencia?e={e.id}"> Chat emergencia</a>
              <button class="btn-cancelar" onclick={() => cancelar(e)}> Falsa alarma</button>
            {/if}
            <button class="btn-eventos" onclick={() => (eventoAbierto = eventoAbierto === e.id ? null : e.id)}> Bitácora</button>
          </div>

          {#if eventoAbierto === e.id}
            <div class="detalle">
              {#if esAdmin && (e.estado === 'activa' || e.estado === 'confirmada')}
                <h3>Cerrar emergencia</h3>
                <input placeholder="Acciones realizadas (llamé al empleado, contacté a familia…)" bind:value={accionesTexto} />
                <input placeholder="Contacto realizado (teléfono, familiar, 911…)" bind:value={contactoRealizado} />
                <button class="btn-atender" onclick={() => atender(e)}>Marcar ATENDIDA</button>
              {/if}
              <h3>Eventos ({eventosDe(e.id).length})</h3>
              {#each eventosDe(e.id) as ev}
                <div class="ev"><span class="mut">{fmtFecha(ev.created_at)}</span> <b>{ev.tipo}</b> — {ev.detalle}</div>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        {#if !loading}<div class="card ok"><b>No hay alertas activas.</b> El personal está seguro por ahora.</div>{/if}
      {/each}
    </section>
  </div>

  <footer class="nota911"> Este sistema es una herramienta de apoyo y <b>no sustituye la llamada al 911</b> ante peligro inmediato.</footer>
</div>

<style>
  .wrap { max-width: 1200px; margin: 0 auto; padding: 1rem; font-family: inherit; color: #1f2937; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: .5rem; }
  .head-actions { display: flex; gap: .5rem; align-items: center; }
  .danger { color: #b91c1c !important; border-color: #fca5a5 !important; }
  h1 { font-size: 1.4rem; color: #c0392b; margin: 0; }
  h2 { font-size: 1rem; margin: 0 0 .6rem; }
  h3 { font-size: .85rem; margin: .8rem 0 .4rem; }
  .sub, .mut { color: #6b7280; font-size: .82rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem; margin-bottom: 1rem; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .alerta { border-left: 5px solid #e74c3c; }
  .alerta.confirmada { border-left-color: #e67e22; }
  .alerta-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: .5rem; }
  .badge { padding: 3px 10px; border-radius: 999px; font-size: .72rem; font-weight: 800; color: #fff; background: #e74c3c; }
  .badge.confirmada { background: #e67e22; }
  .hora { font-size: .78rem; color: #6b7280; }
  .datos { display: flex; gap: .7rem; align-items: center; margin-bottom: .5rem; }
  .foto { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; }
  .foto.placeholder { display: flex; align-items: center; justify-content: center; background: #f3f4f6; font-size: 1.4rem; }
  .pac { background: #fef2f2; border-radius: 8px; padding: .5rem .7rem; margin: .4rem 0; font-size: .9rem; }
  .acciones { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .7rem; }
  button, .btn-confirmar, .btn-atender, .btn-cancelar, .btn-eventos {
    border: none; border-radius: 8px; padding: .55rem .9rem; font-weight: 700; font-size: .82rem; cursor: pointer;
  }
  .btn-confirmar { background: #16a085; color: #fff; }
  .btn-atender { background: #2c3e50; color: #fff; }
  .btn-cancelar { background: #f3f4f6; color: #b91c1c; }
  .btn-eventos { background: #eef2ff; color: #3730a3; }
  .btn-gestion { background: #b45309; color: #fff; }
  .btn-cerrar { background: #374151; color: #fff; }
  .btn-chat { background: #0ea5e9; color: #fff; }
  .badge.en_gestion { background: #b45309; }
  .badge.cerrada { background: #374151; }
  .chat { margin-top: .8rem; border-top: 1px dashed #d1d5db; padding-top: .6rem; max-height: 260px; overflow-y: auto; }
  .msg { background: #f3f4f6; border-radius: 10px; padding: .5rem .7rem; margin: .4rem 0; font-size: .88rem; }
  .msg.mio { background: #dbeafe; }
  .chat-input { display: flex; gap: .5rem; margin-top: .5rem; }
  .chat-input input { flex: 1; padding: .55rem; border: 1px solid #d1d5db; border-radius: 8px; }
  .detalle { margin-top: .8rem; border-top: 1px dashed #d1d5db; padding-top: .6rem; }
  .detalle input { display: block; width: 100%; margin: .4rem 0; padding: .5rem; border: 1px solid #d1d5db; border-radius: 8px; box-sizing: border-box; }
  .ev { font-size: .8rem; padding: .25rem 0; border-bottom: 1px solid #f3f4f6; }
  .mapa { height: 320px; border-radius: 10px; z-index: 1; }
  .leyenda { display: flex; gap: 1rem; margin-top: .5rem; font-size: .8rem; color: #4b5563; }
  .leyenda i { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 4px; }
  .hist { font-size: .85rem; padding: .4rem 0; border-bottom: 1px solid #f3f4f6; }
  .ok { text-align: center; padding: 2rem; color: #16a085; }
  .alert-error { background: #fee2e2; color: #b91c1c; padding: .7rem 1rem; border-radius: 10px; margin-bottom: 1rem; }
  .nota911 { text-align: center; font-size: .78rem; color: #6b7280; margin-top: 1rem; }
  .ghost.link { color: #374151; text-decoration: none; font-weight: 600; }
</style>
