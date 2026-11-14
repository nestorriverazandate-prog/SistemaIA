<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';

 let perfil = $state(null);
 let loading = $state(true);
 let notas = $state([]);
 let stats = $state(null);
 let formError = $state('');
 let formOk = $state('');

 let filtroEstado = $state(''); // '' | 'pendientes' | 'revisadas'
 let filtroTrabajador = $state('');
 let busqueda = $state('');
 let sel = $state(null);        // nota abierta
 let evs = $state([]);          // evidencias de la nota abierta (con url)
 let evLoading = $state(false);
 let comentario = $state('');
 let correccion = $state('');
 let lightbox = $state(null);   // {url, descripcion}

 const filtradas = $derived(notas.filter((n) => {
  if (filtroEstado === 'pendientes' && n.revisado) return false;
  if (filtroEstado === 'revisadas' && !n.revisado) return false;
  if (filtroTrabajador && (n.trabajador?.nombre || '') !== filtroTrabajador) return false;
  const q = busqueda.trim().toLowerCase();
  if (q) {
   const texto = [n.paciente?.nombre, n.paciente?.apellido, n.trabajador?.nombre, n.disciplina, n.actividades, n.evolucion].filter(Boolean).join(' ').toLowerCase();
   if (!texto.includes(q)) return false;
  }
  return true;
 }));
 const trabajadores = $derived([...new Set(notas.map((n) => n.trabajador?.nombre).filter(Boolean))].sort());

 async function cargar() {
  try {
   const r = await api.seguimiento();
   notas = r.notas || [];
   stats = r.stats || null;
  } catch (e) { formError = e.message; }
 }

 async function abrirNota(n) {
  sel = n;
  comentario = n.comentario_admin || '';
  correccion = n.correccion || '';
  evs = [];
  if (n.evidencias?.length) {
   evLoading = true;
   try {
    const { evidencias } = await api.evidenciasNota(n.id);
    evs = await Promise.all((evidencias || []).map(async (e) => {
     try { const { url } = await api.evidenciaArchivo(e.id); return { ...e, url }; }
     catch { return { ...e, url: null }; }
    }));
   } catch { evs = []; }
   evLoading = false;
  }
 }
 function cerrarNota() { sel = null; evs = []; lightbox = null; }

 async function guardarRevision() {
  if (!sel) return;
  formError = ''; formOk = '';
  try {
   await api.actualizarNota(sel.id, { comentario_admin: comentario, correccion: correccion || null });
   formOk = 'Observaciones guardadas';
  } catch (e) { formError = e.message; }
 }
 async function toggleRevisado() {
  if (!sel) return;
  try {
   await api.actualizarNota(sel.id, { revisado: !sel.revisado });
   sel = { ...sel, revisado: !sel.revisado };
   await cargar();
  } catch (e) { formError = e.message; }
 }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
  } catch { setToken(null); }
  loading = false;
  if (perfil?.rol === 'admin') cargar();
 });
 function logout() { setToken(null); window.location.href = '/'; }
 const fmt = (v) => v ? new Date(v).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
</script>

<svelte:head><title>Seguimiento — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil || perfil.rol !== 'admin'}
 <main class="card center">
 <h1>Acceso restringido</h1>
 <p class="muted">Esta sección es exclusiva del directivo.</p>
 <a class="ghost link" href="/">Volver al inicio</a>
 </main>
{:else}
<header>
 <a class="brand" href="/">
 <img src="/logo.png" alt="Agencia Gerontológica Integral" />
 <div class="brand-text">
 <span class="agency">Agencia Gerontológica Integral</span>
 <h1>Seguimiento de pacientes y reportes de evolución</h1>
 </div>
 </a>
 <div>
 <span class="badge">{perfil.email} · Directivo</span>
 <a class="ghost link" href="/visitas">Visitas</a>
 <a class="ghost link" href="/mapa">Mapa</a>
 <a class="ghost link" href="/personal">Personal</a>
 <a class="ghost link" href="/pacientes">Pacientes</a>
 <a class="ghost link" href="/paquetes">Paquetes</a>
 <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="wrap">
 {#if formError}<p class="error">{formError}</p>{/if}
 {#if formOk}<p class="ok">{formOk}</p>{/if}

 {#if stats}
 <section class="stats">
 <div class="stat"><strong>{stats.sesiones}</strong><span>Sesiones</span></div>
 <div class="stat"><strong>{stats.notas}</strong><span>Notas de evolución</span></div>
 <div class="stat warn"><strong>{stats.pendientes}</strong><span>Pendientes de revisión</span></div>
 <div class="stat ok"><strong>{stats.revisadas}</strong><span>Revisadas</span></div>
 <div class="stat"><strong>{stats.fotos}</strong><span>Evidencias fotográficas</span></div>
 <div class="stat"><strong>{stats.pacientes_periodo}</strong><span>Pacientes (30 días)</span></div>
 </section>
 {#if Object.keys(stats.por_trabajador || {}).length}
 <section class="card">
 <h3>Sesiones por empleado</h3>
 <div class="chips">
 {#each Object.entries(stats.por_trabajador) as [nombre, n]}
 <span class="chip-info">{nombre}: {n}</span>
 {/each}
 </div>
 </section>
 {/if}
 {/if}

 <section class="card">
 <div class="filtros">
 <input placeholder="Buscar paciente, empleado, actividad…" bind:value={busqueda} />
 <select bind:value={filtroEstado}>
 <option value="">Todos los reportes</option>
 <option value="pendientes">Pendientes de revisión</option>
 <option value="revisadas">Revisados</option>
 </select>
 <select bind:value={filtroTrabajador}>
 <option value="">Todos los empleados</option>
 {#each trabajadores as t}<option value={t}>{t}</option>{/each}
 </select>
 <button class="ghost" onclick={cargar}>Actualizar</button>
 </div>

 <table>
 <thead><tr><th>Fecha</th><th>Paciente</th><th>Profesional</th><th>Disciplina</th><th>Sesión</th><th>Evidencias</th><th>Estado</th><th></th></tr></thead>
 <tbody>
 {#each filtradas as n (n.id)}
 <tr class:sel-row={sel?.id === n.id}>
 <td>{fmt(n.created_at)}</td>
 <td>{n.paciente?.nombre} {n.paciente?.apellido}</td>
 <td>{n.trabajador?.nombre || '—'}</td>
 <td>{n.disciplina || n.especialidad || '—'}</td>
 <td>{n.sesion || n.visita?.hora_programada?.slice(0,5) || '—'}</td>
 <td>{n.evidencias?.length || 0} foto(s)</td>
 <td><span class="estado {n.revisado ? 'estado-completado' : 'estado-pendiente'}">{n.revisado ? 'revisado' : 'pendiente'}</span>{#if n.correccion}<br/><small class="warn-txt">con corrección</small>{/if}</td>
 <td><button class="mini" onclick={() => abrirNota(n)}>Ver reporte</button></td>
 </tr>
 {:else}<tr><td colspan="8" class="muted">Sin reportes{filtroEstado || filtroTrabajador || busqueda ? ' con esos filtros' : ''}</td></tr>{/each}
 </tbody>
 </table>
 </section>

 {#if sel}
 <div class="overlay" onclick={cerrarNota} role="presentation">
 <div class="panel" onclick={(e) => e.stopPropagation()}>
 <div class="panel-head">
 <h3>Reporte de evolución</h3>
 <button class="mini ghost" onclick={cerrarNota}>Cerrar</button>
 </div>
 <div class="grid-det">
 <div><span>Paciente</span><strong>{sel.paciente?.nombre} {sel.paciente?.apellido}</strong></div>
 <div><span>Domicilio</span><strong>{sel.paciente?.direccion || '—'}</strong></div>
 <div><span>Profesional</span><strong>{sel.trabajador?.nombre || '—'}</strong></div>
 <div><span>Disciplina</span><strong>{sel.disciplina || sel.especialidad || '—'}</strong></div>
 <div><span>Fecha de atención</span><strong>{fmt(sel.visita?.llegada_at || sel.visita?.fecha)}</strong></div>
 <div><span>Enviado</span><strong>{fmt(sel.created_at)}</strong></div>
 </div>
 <div class="nota-campos">
 {#if sel.actividades}<p><b>Actividades:</b> {sel.actividades}</p>{/if}
 {#if sel.observaciones}<p><b>Observaciones:</b> {sel.observaciones}</p>{/if}
 {#if sel.evolucion}<p><b>Evolución del paciente:</b> {sel.evolucion}</p>{/if}
 {#if sel.incidencias}<p><b>Incidencias:</b> {sel.incidencias}</p>{/if}
 {#if sel.recomendaciones}<p><b>Recomendaciones:</b> {sel.recomendaciones}</p>{/if}
 {#if sel.material}<p><b>Material:</b> {sel.material}</p>{/if}
 </div>

 <h4>Evidencias fotográficas ({evs.length})</h4>
 {#if evLoading}<p class="muted">Cargando fotos…</p>{/if}
 <div class="galeria">
 {#each evs as ev}
 <figure>
 {#if ev.url}<img src={ev.url} alt={ev.descripcion || 'Evidencia'} onclick={() => (lightbox = { url: ev.url, descripcion: ev.descripcion })} />{:else}<div class="sin-img">Sin acceso</div>{/if}
 <figcaption>{ev.descripcion || ev.nombre_archivo || 'Evidencia'}<br/><small>{fmt(ev.created_at)}</small></figcaption>
 </figure>
 {/each}
 </div>

 <h4>Revisión del directivo</h4>
 <label>Comentarios / observaciones administrativas
 <textarea rows="2" bind:value={comentario}></textarea>
 </label>
 <label>Solicitar corrección al empleado (no elimina el reporte)
 <textarea rows="2" bind:value={correccion} placeholder="Describe qué debe corregir o complementar…"></textarea>
 </label>
 <div class="btns">
 <button onclick={guardarRevision}>Guardar observaciones</button>
 <button class="ghost" onclick={toggleRevisado}>{sel.revisado ? 'Marcar como pendiente' : 'Marcar como revisado'}</button>
 </div>
 {#if sel.revisado}<p class="ok small">✓ Revisado{sel.revisado_por ? ` por ${sel.revisado_por}` : ''}{sel.revisado_at ? ` el ${fmt(sel.revisado_at)}` : ''}</p>{/if}
 {#if sel.correccion}<p class="warn-txt small">Corrección solicitada: {sel.correccion}</p>{/if}
 {#if sel.comentario_admin}<p class="muted small">Comentario admin: {sel.comentario_admin}</p>{/if}
 </div>
 </div>
 {/if}

 {#if lightbox}
 <div class="overlay top" onclick={() => (lightbox = null)} role="presentation">
 <figure class="lightbox">
 <img src={lightbox.url} alt="" />
 <figcaption>{lightbox.descripcion || ''}</figcaption>
 </figure>
 </div>
 {/if}
</main>
{/if}

<style>
 body { margin: 0; font-family: system-ui, sans-serif; background: #f4f1ea; color: #1c2733; }
 .card { background: #fff; border-radius: 14px; padding: 1.25rem; box-shadow: 0 2px 10px rgba(0,0,0,.06); }
 .center { max-width: 420px; margin: 4rem auto; text-align: center; }
 .wrap { max-width: 1200px; margin: 1.5rem auto; padding: 0 1rem; display: grid; gap: 1rem; }
 header { display: flex; justify-content: space-between; align-items: center; padding: .8rem 2rem; background: oklch(0.3 0.05 222); color: #f2eee2; border-bottom: 3px solid oklch(0.7 0.1 78); flex-wrap: wrap; gap:.5rem; }
 .brand { display: flex; align-items: center; gap: .8rem; text-decoration: none; color: inherit; }
 header img { height: 44px; width: 44px; object-fit: cover; border-radius: 10px; background: #f2eee2; padding: 2px; }
 header h1 { font-size: 1.05rem; margin: 0; }
 .agency { font-size: .7rem; letter-spacing: .12em; text-transform: uppercase; opacity: .75; }
 header div:not(.brand) { display: flex; gap:.5rem; align-items: center; flex-wrap: wrap; }
 .badge { background: oklch(0.4 0.06 222); padding: .3rem .7rem; border-radius: 999px; font-size: .8rem; }
 a.ghost, button.ghost { color: #f2eee2; border: 1px solid oklch(0.55 0.05 222); background: transparent; padding: .45rem .9rem; border-radius: 8px; text-decoration: none; font: inherit; cursor: pointer; }
 a.ghost:hover, button.ghost:hover { background: oklch(0.38 0.05 222); }
 .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .7rem; }
 .stat { background: #fff; border-radius: 12px; padding: 1rem; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
 .stat strong { display: block; font-size: 1.6rem; color: oklch(0.35 0.08 222); }
 .stat span { font-size: .78rem; color: #7a8691; }
 .stat.warn strong { color: #b45309; }
 .stat.ok strong { color: #15803d; }
 .chips { display: flex; flex-wrap: wrap; gap: .5rem; }
 .chip-info { background: #eef4f8; color: oklch(0.35 0.08 222); border: 1px solid #cfdde6; padding: .25rem .7rem; border-radius: 999px; font-size: .82rem; }
 .filtros { display: flex; gap: .6rem; flex-wrap: wrap; margin-bottom: .8rem; }
 .filtros input { flex: 1; min-width: 200px; }
 select, input, textarea { padding: .5rem .65rem; border: 1px solid #d8d2c4; border-radius: 8px; font: inherit; background: #fbf9f4; }
 table { width: 100%; border-collapse: collapse; font-size: .88rem; }
 th, td { text-align: left; padding: .55rem .6rem; border-bottom: 1px solid #e8e2d5; }
 th { color: #5f6b76; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
 tr.sel-row td { background: #eef4f8; }
 .muted { color: #7a8691; }
 .small { font-size: .8rem; }
 .error { background: #fdecec; color: #b3261e; padding: .7rem 1rem; border-radius: 8px; }
 .ok { background: #e8f6ec; color: #1c7c3a; padding: .7rem 1rem; border-radius: 8px; }
 .warn-txt { color: #b45309; }
 .estado { padding: .15rem .55rem; border-radius: 999px; font-size: .75rem; }
 .estado-pendiente { background: #fef3c7; color: #92400e; }
 .estado-completado { background: #d1e7dd; color: #14532d; }
 .overlay { position: fixed; inset: 0; background: oklch(0.2 0.03 260 / .5); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 1rem; }
 .overlay.top { z-index: 60; }
 .panel { background: #fff; border-radius: 14px; max-width: 860px; width: 100%; max-height: 90vh; overflow: auto; padding: 1.5rem; }
 .panel-head { display: flex; justify-content: space-between; align-items: center; }
 .panel-head h3 { margin: 0; }
 .grid-det { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: .8rem; margin: .8rem 0; }
 .grid-det span { display: block; font-size: .72rem; color: #7a8691; text-transform: uppercase; }
 .nota-campos p { margin: .4rem 0; font-size: .9rem; }
 h4 { margin: 1rem 0 .5rem; }
 .galeria { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: .7rem; }
 .galeria figure { margin: 0; }
 .galeria img { width: 100%; height: 120px; object-fit: cover; border-radius: 8px; cursor: zoom-in; }
 .galeria figcaption { font-size: .75rem; color: #5f6b76; margin-top: .25rem; }
 .sin-img { width: 100%; height: 120px; display: flex; align-items: center; justify-content: center; background: #eee; border-radius: 8px; font-size: .8rem; color: #888; }
 label { display: grid; gap: .3rem; font-size: .85rem; font-weight: 600; margin-bottom: .6rem; }
 .btns { display: flex; gap: .5rem; }
 button { background: oklch(0.55 0.12 222); color: #fff; border: 0; padding: .55rem 1.1rem; border-radius: 8px; font: inherit; cursor: pointer; }
 button.mini { padding: .3rem .7rem; font-size: .8rem; background: oklch(0.6 0.08 222); }
 .lightbox { background: #fff; border-radius: 12px; padding: 1rem; max-width: 900px; max-height: 90vh; overflow: auto; }
 .lightbox img { max-width: 100%; border-radius: 8px; }
 .lightbox figcaption { padding: .6rem; font-size: .9rem; }
</style>
