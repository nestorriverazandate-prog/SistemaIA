<script>
  import { onMount, onDestroy } from 'svelte';
  import { api, getToken } from '$lib/api';

  let token = $state(getToken());
  let me = $state(null);
  let loading = $state(true);
  let error = $state('');
  let msg = $state('');

  let pacientes = $state([]);
  let trabajadores = $state([]);
  const ETIQUETAS_ROL = { admin: 'Directivo', staff: 'Trabajador', paciente: 'Paciente', familiar: 'Familiar', cuidador: 'Cuidador' };
  const etiquetaRol = (r) => ETIQUETAS_ROL[r] || r;
  let visitas = $state([]);
  let historial = $state([]);
  let dash = $state(null);

  let vista = $state('agenda'); // agenda | admin | historial
  let filtroFecha = $state(new Date().toISOString().slice(0, 10));

  // Form asignar visita
  let form = $state({ paciente_id: '', trabajador_id: '', fecha: new Date().toISOString().slice(0, 10), hora_programada: '', duracion_estimada_min: 60, radio_m: 50 });

  // Tracking GPS del trabajador
  let watchId = $state(null);
  let pingTimer = $state(null);
  let visitandoId = $state(null);
  let gpsMsg = $state('');
  let trabajadorEstado = $state('en_camino');
  let notaId = $state(null);
  let notaForm = $state({ actividades: '', observaciones: '', evolucion: '', incidencias: '', recomendaciones: '', material: '' });
  let notaMsg = $state('');

  const esAdmin = $derived(me?.perfil?.rol === 'admin' || me?.perfil?.rol === 'staff');

  async function cargar() {
    try {
      const params = filtroFecha ? `?fecha=${filtroFecha}` : '';
      const [v, h] = await Promise.all([api.visitas(params), api.historial(params)]);
      visitas = v.visitas;
      historial = h.visitas;
      if (esAdmin) {
        const [d, t, p] = await Promise.all([api.dashboard().catch(() => null), api.trabajadores().catch(() => ({ trabajadores: [] })), api.pacientes().catch(() => ({ pacientes: [] }))]);
        dash = d; trabajadores = t.trabajadores; pacientes = p.pacientes;
      }
    } catch (e) { error = e.message; }
  }

  async function asignar(e) {
    e.preventDefault();
    error = ''; msg = '';
    try {
      await api.crearVisita(form);
      msg = 'Visita asignada';
      form = { ...form, paciente_id: '', trabajador_id: '', hora_programada: '' };
      await cargar();
    } catch (err) { error = err.message; }
  }

  async function cancelarVisita(v) {
    try { await api.actualizarVisita(v.id, { estado: 'cancelada' }); await cargar(); }
    catch (e) { error = e.message; }
  }

  function iniciarSeguimiento(v) {
    error = ''; gpsMsg = '';
    if (!navigator.geolocation) { error = 'Tu dispositivo no soporta geolocalización'; return; }
    visitandoId = v.id;
    watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        try {
          const r = await api.pingVisita(v.id, pos.coords.latitude, pos.coords.longitude, trabajadorEstado);
          gpsMsg = `Distancia: ${r.distancia_m} m — ${r.dentro ? 'DENTRO de la geocerca' : 'fuera'} — ${r.estado}`;
          await cargar();
        } catch (e) { gpsMsg = e.message; }
      },
      (e) => { gpsMsg = 'GPS: ' + e.message; },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    pingTimer = setInterval(() => {}, 15000); // el watchPosition ya emite; el ping va en cada posición
  }

  function detenerSeguimiento() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    if (pingTimer) clearInterval(pingTimer);
    watchId = null; pingTimer = null; visitandoId = null;
    gpsMsg = '';
    trabajadorEstado = 'en_camino';
  }

  function mapaDomicilio(v) {
    const p = v.pacientes;
    if (p?.lat == null) return '#';
    return `https://www.google.com/maps?q=${p.lat},${p.lng}`;
  }

  async function guardarNota(v) {
    error = ''; notaMsg = '';
    try {
      await api.notaVisita(v.id, notaForm);
      notaMsg = 'Nota de atención guardada en el expediente';
      notaId = null;
      notaForm = { actividades: '', observaciones: '', evolucion: '', incidencias: '', recomendaciones: '', material: '' };
    } catch (e) { error = e.message; }
  }

  async function reportarGps(v) {
    const d = prompt('Describe el problema con tu GPS (ej: sin señal, GPS apagado, batería):');
    if (!d) return;
    error = ''; msg = '';
    try {
      await api.incidenciaGps(v.id, d);
      msg = 'Incidencia reportada. El directivo fue notificado.';
    } catch (e) { error = e.message; }
  }

  async function exportar() {
    try {
      const blob = await api.exportarVisitas(filtroFecha ? `?fecha=${filtroFecha}` : '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `visitas_${filtroFecha || 'todas'}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { error = e.message; }
  }

  function onPageShow(e) { if (e.persisted) window.location.reload(); }

  onMount(async () => {
    window.addEventListener('pageshow', onPageShow);
    if (!token) { loading = false; return; }
    try {
      const { user } = await api.me();
      me = user;
      if (!user?.perfil || user.perfil.estado !== 'aprobado') { error = 'Cuenta no aprobada'; loading = false; return; }
      if (esAdmin) vista = 'admin';
      await cargar();
    } catch (e) { error = e.message; }
    loading = false;
  });

  onDestroy(() => { if (typeof window === 'undefined') return; if (watchId != null) navigator.geolocation.clearWatch(watchId); window.removeEventListener('pageshow', onPageShow); });
</script>

<svelte:head><title>Visitas Domiciliarias</title></svelte:head>

<header>
  <a class="brand" href="/">
    <img src="/logo.png" alt="Agencia Gerontológica Integral" />
    <div class="brand-text">
      <span class="agency">Agencia Gerontológica Integral</span>
      <h1>Visitas Domiciliarias</h1>
    </div>
  </a>
  <div>
    <a class="ghost link" href="/">Inicio</a>
    <a class="ghost link" href="/mapa">Mapa</a>
  </div>
</header>

{#if loading}
  <main class="center"><p>Cargando…</p></main>
{:else if !token}
  <main class="center card"><p>Inicia sesión primero.</p><a href="/">Ir al login</a></main>
{:else}
  <div class="tabs">
    {#if esAdmin}
      <button class={vista === 'admin' ? 'tab active' : 'tab'} onclick={() => (vista = 'admin')}>Panel admin</button>
      <button class={vista === 'agenda' ? 'tab active' : 'tab'} onclick={() => (vista = 'agenda')}>Agenda</button>
    {/if}
    <button class={vista === 'historial' ? 'tab active' : 'tab'} onclick={() => (vista = 'historial')}>Historial</button>
    <input type="date" bind:value={filtroFecha} onchange={cargar} class="date" />
  </div>

  {#if error}<p class="error center">{error}</p>{/if}
  {#if msg}<p class="ok center">{msg}</p>{/if}

  {#if vista === 'admin' && esAdmin}
    <div class="grid">
      <section class="card">
        <h2>Indicadores de hoy</h2>
        {#if dash}
          <div class="stats">
            <div class="stat"><b>{dash.programadas_hoy}</b><span>Programadas</span></div>
            <div class="stat warn"><b>{dash.en_curso}</b><span>En curso</span></div>
            <div class="stat ok"><b>{dash.finalizadas_hoy}</b><span>Finalizadas</span></div>
            <div class="stat"><b>{dash.trabajadores_activos}</b><span>Trabajadores activos</span></div>
            <div class="stat"><b>{dash.tiempo_promedio_min ?? '—'}</b><span>Min promedio</span></div>
          </div>
        {:else}<p class="muted">Sin datos</p>{/if}
      </section>

      <section class="card wide">
        <h2>Agendar visita</h2>
        <form onsubmit={asignar} class="sched-table">
          <table>
            <thead>
              <tr><th>Fecha</th><th>Hora</th><th>Adulto mayor</th><th>Trabajador</th><th>Duración (min)</th><th>Radio (m)</th><th></th></tr>
            </thead>
            <tbody>
              <tr>
                <td><input type="date" bind:value={form.fecha} required /></td>
                <td><input type="time" bind:value={form.hora_programada} /></td>
                <td>
                  <select bind:value={form.paciente_id} required>
                    <option value="">Seleccionar…</option>
                    {#each pacientes.filter(p => p.lat != null) as p (p.id)}
                      <option value={p.id}>{p.nombre} {p.apellido} — {p.direccion || 's/d'}</option>
                    {/each}
                  </select>
                </td>
                <td>
                  <select bind:value={form.trabajador_id}>
                    <option value="">Sin asignar</option>
                    {#each trabajadores as t (t.id)}
                      <option value={t.id}>{t.nombre || t.email} ({etiquetaRol(t.rol)})</option>
                    {/each}
                  </select>
                </td>
                <td><input type="number" min="15" max="480" bind:value={form.duracion_estimada_min} /></td>
                <td><input type="number" min="10" max="500" bind:value={form.radio_m} /></td>
                <td><button>Agendar</button></td>
              </tr>
            </tbody>
          </table>
          <p class="muted small">Solo aparecen adultos mayores con ubicación GPS registrada. Usa el botón "Usar mi ubicación GPS" en el formulario de pacientes.</p>
        </form>
      </section>

      <section class="card wide">
        <h2>Visitas del día ({visitas.length})</h2>
        <table>
          <thead><tr><th>Hora</th><th>Paciente</th><th>Trabajador</th><th>Estado</th><th>Llegada</th><th>Salida</th><th></th></tr></thead>
          <tbody>
            {#each visitas as v (v.id)}
              <tr>
                <td>{v.hora_programada || '—'}</td>
                <td>{v.pacientes?.nombre} {v.pacientes?.apellido}<br /><small>{v.pacientes?.direccion || ''}</small></td>
                <td>{v.perfiles?.nombre || v.perfiles?.email || 'Sin asignar'}</td>
                <td><span class="estado estado-{v.estado}">{v.estado.replace('_', ' ')}</span></td>
                <td>{v.llegada_at ? new Date(v.llegada_at).toLocaleTimeString() : '—'}</td>
                <td>{v.salida_at ? new Date(v.salida_at).toLocaleTimeString() : '—'}</td>
                <td>{#if ['programada'].includes(v.estado)}<button class="mini danger" onclick={() => cancelarVisita(v)}>Cancelar</button>{/if}</td>
              </tr>
            {:else}<tr><td colspan="7" class="muted">Sin visitas</td></tr>{/each}
          </tbody>
        </table>
      </section>
    </div>
  {:else if vista === 'historial'}
    <section class="card">
      <div class="hist-head">
        <h2>Historial de visitas ({historial.length})</h2>
        {#if esAdmin}<button class="ghost" onclick={exportar}>Exportar CSV (Excel)</button>{/if}
      </div>
      <table>
        <thead><tr><th>Fecha</th><th>Hora</th><th>Paciente</th><th>Trabajador</th><th>Estado</th><th>Llegada</th><th>Salida</th><th>Duración</th></tr></thead>
        <tbody>
          {#each historial as v (v.id)}
            <tr>
              <td>{v.fecha}</td><td>{v.hora_programada || '—'}</td>
              <td>{v.pacientes?.nombre} {v.pacientes?.apellido}</td>
              <td>{v.perfiles?.nombre || v.perfiles?.email || '—'}</td>
              <td><span class="estado estado-{v.estado}">{v.estado.replace('_', ' ')}</span></td>
              <td>{v.llegada_at ? new Date(v.llegada_at).toLocaleString() : '—'}</td>
              <td>{v.salida_at ? new Date(v.salida_at).toLocaleString() : '—'}</td>
              <td>{v.duracion_min != null ? v.duracion_min + ' min' : '—'}</td>
            </tr>
          {:else}<tr><td colspan="8" class="muted">Sin registros</td></tr>{/each}
        </tbody>
      </table>
      <p class="muted small">Para PDF: usa la impresión del navegador (Cmd+P) sobre esta tabla.</p>
    </section>
  {:else}
    <!-- Agenda del trabajador -->
    {#if visitandoId}<p class="gps">GPS activo — {gpsMsg}</p>{/if}
    <div class="grid">
      {#each visitas as v (v.id)}
        <section class="card">
          <h2>{v.pacientes?.nombre} {v.pacientes?.apellido}</h2>
          <p class="muted">{v.pacientes?.direccion || 'Sin dirección'}
          {#if v.pacientes?.telefono}<br />Tel. contacto: {v.pacientes.telefono}{/if}
          {#if v.pacientes?.lat != null} · <a href={mapaDomicilio(v)} target="_blank" rel="noopener">Ver domicilio en mapa</a>{/if}<br />
          Programada: {v.hora_programada || '—'} · Duración est.: {v.duracion_estimada_min || '—'} min · Estado: <span class="estado estado-{v.estado}">{v.trabajador_estado || v.estado.replace('_', ' ')}</span></p>
          {#if v.llegada_at}<p class="ok">Llegada: {new Date(v.llegada_at).toLocaleTimeString()}</p>{/if}
          {#if v.salida_at}<p>Llegada→Salida: {Math.round((new Date(v.salida_at) - new Date(v.llegada_at)) / 60000)} min</p>{/if}
          {#if ['programada', 'en_curso'].includes(v.estado)}
            {#if visitandoId === v.id}
              <div class="estado-btns">
                <button class="mini {trabajadorEstado === 'en_camino' ? 'active' : 'ghost'}" onclick={() => (trabajadorEstado = 'en_camino')}>En camino</button>
                <button class="mini {trabajadorEstado === 'en_domicilio' ? 'active' : 'ghost'}" onclick={() => (trabajadorEstado = 'en_domicilio')}>En domicilio</button>
                <button class="mini {trabajadorEstado === 'descanso' ? 'active' : 'ghost'}" onclick={() => (trabajadorEstado = 'descanso')}>Descanso</button>
                <button class="mini danger" onclick={detenerSeguimiento}>Detener</button>
              </div>
            {:else}
              <button onclick={() => iniciarSeguimiento(v)}>Iniciar seguimiento GPS</button>
            {/if}
          {/if}
          <div class="acc-actions">
            <button class="mini ghost" onclick={() => { notaId = notaId === v.id ? null : v.id; notaMsg = ''; }}>Nota de atención</button>
            <button class="mini ghost" onclick={() => reportarGps(v)}>GPS con falla</button>
          </div>
          {#if notaId === v.id}
            <div class="nota-form">
              <label>Actividades realizadas <textarea rows="2" bind:value={notaForm.actividades}></textarea></label>
              <label>Observaciones <textarea rows="2" bind:value={notaForm.observaciones}></textarea></label>
              <label>Evolución <textarea rows="2" bind:value={notaForm.evolucion}></textarea></label>
              <label>Incidencias <textarea rows="2" bind:value={notaForm.incidencias}></textarea></label>
              <label>Recomendaciones <textarea rows="2" bind:value={notaForm.recomendaciones}></textarea></label>
              <label>Material utilizado <input bind:value={notaForm.material} /></label>
              {#if notaMsg}<p class="ok">{notaMsg}</p>{/if}
              <button onclick={() => guardarNota(v)}>Guardar nota</button>
            </div>
          {/if}
        </section>
      {:else}
        <section class="card"><p class="muted">No tienes visitas para esta fecha.</p></section>
      {/each}
    </div>
  {/if}
{/if}

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; background: oklch(0.985 0.007 85); color: oklch(0.27 0.035 225); }
  header { display: flex; justify-content: space-between; align-items: center; padding: .8rem 2rem; background: oklch(0.3 0.05 222); color: #f2eee2; border-bottom: 3px solid oklch(0.7 0.1 78); }
  .brand { display: flex; align-items: center; gap: .8rem; text-decoration: none; color: inherit; }
  .brand-text { display: flex; flex-direction: column; }
  .agency { font-size: .72rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: oklch(0.7 0.1 78); }
  header img { height: 44px; width: 44px; object-fit: cover; border-radius: 10px; background: #f2eee2; padding: 2px; }
  header h1 { font-size: 1.05rem; margin: 0; }
  header div:not(.brand) { display: flex; gap: .5rem; }
  .tabs { display: flex; gap: .5rem; padding: 1rem 1.5rem 0; align-items: center; flex-wrap: wrap; }
  .tab { padding: .5rem 1rem; border: 1px solid oklch(0.86 0.02 85); background: #fff; border-radius: 8px; cursor: pointer; font-weight: 600; color: oklch(0.45 0.03 225); }
  .tab.active { background: #135666; color: #f2eee2; border-color: #135666; }
  .date { margin-left: auto; padding: .45rem .6rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; padding: 1rem 1.5rem; }
  .wide { grid-column: 1 / -1; }
  .card { background: #fff; border-radius: 12px; padding: 1.1rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .center { text-align: center; padding: 2rem; }
  h2 { margin: 0 0 .5rem; font-size: 1rem; }
  form { display: flex; flex-direction: column; gap: .6rem; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: .6rem; }
  label { display: flex; flex-direction: column; gap: .25rem; font-size: .82rem; font-weight: 600; }
  input, select { padding: .5rem .6rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
  button { padding: .55rem 1rem; border: 0; border-radius: 8px; background: #135666; color: #f2eee2; font-weight: 600; cursor: pointer; }
  button:hover:not(:disabled) { background: #004555; }
  button.danger { background: oklch(0.55 0.2 27); }
  button.mini { padding: .25rem .6rem; font-size: .78rem; }
  .estado-btns { display: flex; gap: .4rem; flex-wrap: wrap; margin-top: .5rem; }
  .estado-btns .mini.active { background: #135666; color: #f2eee2; border-color: #135666; }
  .acc-actions { display: flex; gap: .4rem; margin-top: .5rem; }
  .nota-form { display: flex; flex-direction: column; gap: .5rem; margin-top: .7rem; border-top: 1px solid oklch(0.93 0.025 140); padding-top: .7rem; }
  .nota-form label { font-size: .8rem; }
  .nota-form textarea, .nota-form input { padding: .45rem .55rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
  a.ghost, button.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.45 0.03 225); border-radius: 8px; padding: .45rem .8rem; text-decoration: none; font-weight: 600; font-size: .85rem; cursor: pointer; }
  header a.ghost { color: #f2eee2; border-color: oklch(0.55 0.05 222); }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: .7rem; }
  .stat { background: oklch(0.93 0.025 140); border-radius: 10px; padding: .8rem; text-align: center; }
  .stat b { display: block; font-size: 1.5rem; }
  .stat span { font-size: .75rem; color: oklch(0.45 0.03 225); }
  .stat.warn b { color: #c19652; } .stat.ok b { color: oklch(0.45 0.08 160); }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th, td { text-align: left; padding: .5rem .4rem; border-bottom: 1px solid oklch(0.93 0.025 140); vertical-align: top; }
  .estado { padding: .15rem .5rem; border-radius: 999px; font-size: .72rem; background: oklch(0.94 0.025 80); }
  .estado-programada { background: oklch(0.94 0.025 80); } .estado-en_curso { background: oklch(0.93 0.025 140); }
  .estado-finalizada { background: #d1e7dd; } .estado-cancelada, .estado-no_show { background: #f8d7da; }
  .error { color: oklch(0.55 0.2 27); } .ok { color: oklch(0.45 0.08 160); } .muted { color: oklch(0.55 0.03 225); font-size: .85rem; }
  .small { font-size: .78rem; }
  .gps { background: #135666; color: #f2eee2; padding: .6rem 1rem; border-radius: 8px; margin: 0 1.5rem; font-size: .85rem; }
  .sched-table table { width: 100%; }
  .sched-table th { font-size: .78rem; }
  .sched-table input, .sched-table select { width: 100%; min-width: 110px; padding: .45rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .85rem; }
  .sched-table button { white-space: nowrap; }
  .hist-head { display: flex; justify-content: space-between; align-items: center; }
</style>
