<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';

 let perfil = $state(null);
 let loading = $state(true);
 let visitas = $state([]);
 let pacientes = $state([]);
 let trabajadores = $state([]);
 let vista = $state('semana'); // dia | semana | mes
 let cursor = $state(new Date());
 let sel = $state(null); // visita seleccionada
 let notasSel = $state([]);
 let error = $state('');
 let msg = $state('');
 let showForm = $state(false);
 let conflict = $state(null);
 let ordenado = $state(false);

 const DISCIPLINAS = ['Gerontología', 'Terapia Física y Rehabilitación', 'Psicología', 'Nutrición', 'Enfermería', 'Cuidadores', 'Trabajo social'];
 let form = $state({ paciente_id: '', trabajador_id: '', fecha: '', hora_programada: '', duracion_estimada_min: 60, disciplina: '' });
 let reprog = $state({ nueva_fecha: '', nueva_hora: '', motivo: '' });

 const esAdmin = $derived(perfil?.rol === 'admin');
 const esEmpleado = $derived(['staff', 'cuidador', 'familiar'].includes(perfil?.rol));

 function iso(d) { return d.toISOString().slice(0, 10); }
 function rango() {
  const c = new Date(cursor);
  if (vista === 'dia') return { desde: iso(c), hasta: iso(c) };
  if (vista === 'mes') {
   const f = new Date(c.getFullYear(), c.getMonth(), 1);
   const l = new Date(c.getFullYear(), c.getMonth() + 1, 0);
   return { desde: iso(f), hasta: iso(l) };
  }
  const dow = (c.getDay() + 6) % 7; // lunes=0
  const f = new Date(c); f.setDate(c.getDate() - dow);
  const l = new Date(f); l.setDate(f.getDate() + 6);
  return { desde: iso(f), hasta: iso(l) };
 }

 async function cargar() {
  try {
   const { desde, hasta } = rango();
   const r = await api.visitas(`?desde=${desde}&hasta=${hasta}&limit=500`);
   visitas = r.visitas || [];
  } catch (e) { error = e.message; }
 }

 async function cargarCatalogos() {
  try {
   const [p, t] = await Promise.all([
    api.pacientes ? api.pacientes().catch(() => ({ pacientes: [] })) : Promise.resolve({ pacientes: [] }),
    api.trabajadores ? api.trabajadores().catch(() => ({ trabajadores: [] })) : Promise.resolve({ trabajadores: [] })
   ]);
   pacientes = p.pacientes || p || [];
   trabajadores = (t.trabajadores || t || []).filter((x) => x.estado !== 'suspendido' && x.estado !== 'inactivo');
  } catch {}
 }

 async function abrirVisita(v) {
  sel = v; reprog = { nueva_fecha: v.fecha, nueva_hora: v.hora_programada || '', motivo: '' };
  notasSel = [];
  try { const n = await api.notasVisita(v.id); notasSel = n.notas || []; } catch {}
 }

 async function crearVisita(confirmar = false) {
  error = ''; msg = ''; conflict = null;
  try {
   const body = { ...form, confirmar_conflicto: confirmar };
   await api.crearVisita(body);
   msg = 'Visita programada';
   showForm = false;
   await cargar();
  } catch (e) {
   if (e.status === 409 && e.data?.conflictos) {
    conflict = e.data.conflictos;
    error = e.message;
   } else error = e.message;
  }
 }

 async function actualizar(patch) {
  try { await api.actualizarVisita(sel.id, patch); msg = 'Visita actualizada'; await cargar(); await abrirVisita({ ...sel, ...patch }); }
  catch (e) { error = e.message; }
 }

 async function solicitarReprog() {
  if (!reprog.nueva_fecha) { error = 'Indica la nueva fecha'; return; }
  try {
   await api.solicitarReprogramacion(sel.id, reprog);
   msg = 'Solicitud enviada al directivo';
  } catch (e) { error = e.message; }
 }

 function comoLlegar(v) {
  const p = v.pacientes || {};
  const dest = p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : encodeURIComponent([p.direccion, p.ciudad].filter(Boolean).join(', '));
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest}`, '_blank');
 }

 // Orden sugerido por cercanía geográfica (geocodifica domicilios una vez)
 async function ordenarCercania() {
  const delDia = visitasDelDia().filter((v) => v.pacientes?.direccion || (v.pacientes?.lat != null));
  if (delDia.length < 2) { msg = 'Se necesitan al menos 2 visitas en el día'; return; }
  ordenado = true;
  const cache = {};
  async function coords(p) {
   const key = p.id;
   if (cache[key]) return cache[key];
   if (p.lat != null && p.lng != null) return (cache[key] = { lat: +p.lat, lng: +p.lng });
   try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent([p.direccion, p.ciudad, 'Ecuador'].filter(Boolean).join(', '))}`, { headers: { 'Accept-Language': 'es' } });
    const j = await r.json();
    return (cache[key] = j[0] ? { lat: +j[0].lat, lng: +j[0].lon } : null);
   } catch { return (cache[key] = null); }
  }
  const pts = [];
  for (const v of delDia) { const c = await coords(v.pacientes); if (c) pts.push({ v, c }); }
  if (pts.length < 2) { ordenado = false; msg = 'No hay coordenadas suficientes para ordenar'; return; }
  // Vecino más cercano encadenado
  const resto = [...pts];
  const orden = [resto.shift()];
  while (resto.length) {
   const ult = orden[orden.length - 1].c;
   let bi = 0, bd = Infinity;
   resto.forEach((p, i) => { const d = (p.c.lat - ult.lat) ** 2 + (p.c.lng - ult.lng) ** 2; if (d < bd) { bd = d; bi = i; } });
   orden.push(resto.splice(bi, 1)[0]);
  }
  ordenIdx = new Map(orden.map((o, i) => [o.v.id, i]));
  visitas = [...visitas].sort((a, b) => (ordenIdx.get(a.id) ?? 999) - (ordenIdx.get(b.id) ?? 999));
 }
 let ordenIdx = $state(new Map());

 function visitasDelDia() {
  const d = iso(new Date());
  return visitas.filter((v) => v.fecha === d && v.estado !== 'cancelada');
 }
 function porFecha(f) { return visitas.filter((v) => v.fecha === f).sort((a, b) => (a.hora_programada || '').localeCompare(b.hora_programada || '')); }
 function nombreV(v) { return `${v.pacientes?.nombre || ''} ${v.pacientes?.apellido || ''}`.trim() || 'Paciente'; }
 function nombreT(v) { return v.perfiles?.nombre || v.perfiles?.email || 'Sin asignar'; }
 function fmtFechaLarga(f) { return new Date(f + 'T12:00:00').toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }

 // --- Vistas ---
 const diasSemana = $derived.by(() => {
  const { desde } = rango();
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(desde + 'T12:00:00'); d.setDate(d.getDate() + i); return d; });
 });
 const diasMes = $derived.by(() => {
  const c = cursor;
  const primero = new Date(c.getFullYear(), c.getMonth(), 1);
  const offset = (primero.getDay() + 6) % 7;
  const start = new Date(primero); start.setDate(primero.getDate() - offset);
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
 });
 const titulo = $derived(vista === 'dia' ? fmtFechaLarga(iso(cursor)) : vista === 'mes' ? cursor.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' }) : `${diasSemana[0].toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })} — ${diasSemana[6].toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })}`);
 function navDir(d) { const c = new Date(cursor); c.setDate(c.getDate() + d * (vista === 'mes' ? 30 : vista === 'semana' ? 7 : 1)); if (vista === 'mes') c.setMonth(cursor.getMonth() + d); cursor = c; }
 function irHoy() { cursor = new Date(); }
 function abrirForm(fecha, hora = '') {
  form = { paciente_id: '', trabajador_id: esEmpleado ? perfil.id : '', fecha: fecha || iso(new Date()), hora_programada: hora || '', duracion_estimada_min: 60, disciplina: '' };
  showForm = true; conflict = null; error = '';
 }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
   if (!perfil || perfil.estado === 'pendiente' || perfil.estado === 'rechazado') { loading = false; return; }
   await cargarCatalogos();
   await cargar();
  } catch { setToken(null); }
  finally { loading = false; }
 });
 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Agenda inteligente — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil}
 <main class="card center"><p>Inicia sesión para ver la agenda.</p><a class="ghost link" href="/">Ir al inicio</a></main>
{:else}
<header>
 <a class="brand" href="/">
  <img src="/logo.png" alt="Agencia Gerontológica Integral" />
  <div class="brand-text">
   <span class="agency">Agencia Gerontológica Integral</span>
   <h1>Agenda inteligente</h1>
  </div>
 </a>
 <div>
  <span class="badge">{perfil.email} · {esAdmin ? 'Directivo' : 'Personal'}</span>
  <a class="ghost link" href={esAdmin ? '/' : '/mis-pacientes'}>Volver</a>
  <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="layout">
 <section class="card barra">
  <div class="controles">
   <button class="ghost" onclick={() => navDir(-1)}>←</button>
   <button class="ghost" onclick={irHoy}>Hoy</button>
   <button class="ghost" onclick={() => navDir(1)}>→</button>
   <strong class="titulo">{titulo}</strong>
   <div class="vistas">
    <button class:active={vista === 'dia'} onclick={() => vista = 'dia'}>Día</button>
    <button class:active={vista === 'semana'} onclick={() => vista = 'semana'}>Semana</button>
    <button class:active={vista === 'mes'} onclick={() => vista = 'mes'}>Mes</button>
   </div>
  </div>
  <div class="controles2">
   {#if esAdmin}<button onclick={() => abrirForm()}>+ Nueva cita</button>{/if}
   {#if vista === 'dia'}<button class="ghost" onclick={ordenarCercania}> Ordenar por cercanía</button>{/if}
   <button class="ghost" onclick={cargar}>↻ Actualizar</button>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  {#if msg}<p class="ok">{msg}</p>{/if}
 </section>

 {#if showForm}
 <section class="card">
  <h3>Nueva visita domiciliaria</h3>
  <div class="form-grid">
   <label>Paciente
    <select bind:value={form.paciente_id}>
     <option value="">— Seleccionar —</option>
     {#each pacientes as p (p.id)}<option value={p.id}>{p.nombre} {p.apellido}</option>{/each}
    </select>
   </label>
   {#if esAdmin}
   <label>Profesional responsable
    <select bind:value={form.trabajador_id}>
     <option value="">— Sin asignar —</option>
     {#each trabajadores as t (t.id)}<option value={t.id}>{t.nombre || t.email} {t.profesion ? '· ' + t.profesion : ''}</option>{/each}
    </select>
   </label>
   {/if}
   <label>Fecha<input type="date" bind:value={form.fecha} /></label>
   <label>Hora<input type="time" bind:value={form.hora_programada} /></label>
   <label>Duración (min)<input type="number" min="15" step="15" bind:value={form.duracion_estimada_min} /></label>
   <label>Disciplina
    <select bind:value={form.disciplina}>
     <option value="">— General —</option>
     {#each DISCIPLINAS as d}<option value={d}>{d}</option>{/each}
    </select>
   </label>
  </div>
  {#if conflict}
   <div class="conflictos">
    <p class="error"> Conflicto de horario detectado:</p>
    <ul>{#each conflict as c}<li>{c.hora} — {c.paciente}</li>{/each}</ul>
    <button class="mini warn" onclick={() => crearVisita(true)}>Confirmar de todos modos</button>
   </div>
  {/if}
  <div class="form-btns">
   <button onclick={() => crearVisita()}>Programar</button>
   <button class="ghost" onclick={() => showForm = false}>Cancelar</button>
  </div>
 </section>
 {/if}

 <!-- ===== Vista Día ===== -->
 {#if vista === 'dia'}
 <section class="card">
  <h3>Visitas del día</h3>
  {#if visitasDelDia().length === 0}<p class="muted">Sin visitas programadas para hoy.</p>{/if}
  <div class="dia-lista">
   {#each visitasDelDia() as v, i (v.id)}
    <button class="vis-card" class:orden={ordenIdx.get(v.id) != null} onclick={() => abrirVisita(v)}>
     {#if ordenIdx.get(v.id) != null}<span class="orden-n">#{ordenIdx.get(v.id) + 1}</span>{/if}
     <span class="hora">{v.hora_programada || '—'}</span>
     <span class="v-info">
      <strong>{nombreV(v)}</strong>
      <span class="muted small">{nombreT(v)}{v.disciplina ? ' · ' + v.disciplina : ''} · {v.duracion_estimada_min || 60} min</span>
     </span>
     <span class="estado estado-{v.estado}">{v.estado}</span>
    </button>
   {/each}
  </div>
 </section>
 {/if}

 <!-- ===== Vista Semana ===== -->
 {#if vista === 'semana'}
 <section class="card semana">
  {#each diasSemana as d (iso(d))}
   {@const f = iso(d)}
   {@const vs = porFecha(f)}
   <div class="sem-col" class:today={f === iso(new Date())}>
    <div class="sem-head"><span>{d.toLocaleDateString('es-EC', { weekday: 'short' })}</span><strong>{d.getDate()}</strong></div>
    {#each vs as v (v.id)}
     <button class="sem-vis estado-{v.estado}" onclick={() => abrirVisita(v)} title="{nombreV(v)} — {nombreT(v)}">
      {v.hora_programada || ''} {nombreV(v)}
     </button>
    {:else}<p class="muted small">—</p>{/each}
   </div>
  {/each}
 </section>
 {/if}

 <!-- ===== Vista Mes ===== -->
 {#if vista === 'mes'}
 <section class="card mes">
  <div class="mes-grid">
   {#each ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'] as d}<div class="mes-dow">{d}</div>{/each}
   {#each diasMes as d (iso(d))}
    {@const f = iso(d)}
    {@const vs = porFecha(f)}
    <div class="mes-cell" class:out={d.getMonth() !== cursor.getMonth()} class:today={f === iso(new Date())}>
     <span class="mes-num">{d.getDate()}</span>
     {#each vs.slice(0, 3) as v (v.id)}
      <button class="mes-vis estado-{v.estado}" onclick={() => abrirVisita(v)}>{v.hora_programada || ''} {nombreV(v)}</button>
     {/each}
     {#if vs.length > 3}<span class="muted small">+{vs.length - 3} más</span>{/if}
    </div>
   {/each}
  </div>
 </section>
 {/if}

 <!-- ===== Detalle de visita ===== -->
 {#if sel}
 <div class="overlay" role="presentation" onclick={() => sel = null}>
  <div class="sheet" onclick={(e) => e.stopPropagation()}>
   <div class="sheet-head">
    <h3>{nombreV(sel)}</h3>
    <button class="mini ghost" onclick={() => sel = null}>Cerrar</button>
   </div>
   <p class="muted">{fmtFechaLarga(sel.fecha)}{sel.hora_programada ? ' · ' + sel.hora_programada : ''} · {sel.duracion_estimada_min || 60} min{sel.disciplina ? ' · ' + sel.disciplina : ''}</p>
   <p><strong>Profesional:</strong> {nombreT(sel)}</p>
   {#if sel.pacientes?.direccion}<p><strong>Domicilio:</strong> {sel.pacientes.direccion}{sel.pacientes.ciudad ? ', ' + sel.pacientes.ciudad : ''}</p>{/if}
   <p><strong>Estado:</strong> <span class="estado estado-{sel.estado}">{sel.estado}</span></p>
   <div class="sheet-btns">
    <button class="mini" onclick={() => comoLlegar(sel)}> Cómo llegar</button>
    {#if esEmpleado && sel.trabajador_id === perfil.id && sel.estado === 'programada'}
     <button class="mini ok-btn" onclick={() => actualizar({ estado: 'finalizada' })}> Confirmar realizada</button>
    {/if}
    {#if esAdmin}
     <button class="mini ghost" onclick={() => { const f = prompt('Nueva fecha (AAAA-MM-DD):', sel.fecha); if (f) actualizar({ fecha: f }); }}>Reprogramar fecha</button>
     <button class="mini ghost" onclick={() => { const h = prompt('Nueva hora (HH:MM):', sel.hora_programada || ''); if (h) actualizar({ hora_programada: h }); }}>Cambiar hora</button>
     <button class="mini ghost" onclick={() => { const t = prompt('ID del nuevo trabajador (o vacío para desasignar):', sel.trabajador_id || ''); if (t !== null) actualizar({ trabajador_id: t || null }); }}>Reasignar</button>
     {#if sel.estado === 'programada'}<button class="mini warn" onclick={() => { if (confirm('¿Cancelar esta visita?')) actualizar({ estado: 'cancelada' }); }}>Cancelar visita</button>{/if}
     {#if sel.estado !== 'finalizada' && sel.estado !== 'no_show'}<button class="mini warn" onclick={() => { if (confirm('¿Marcar como no realizada?')) actualizar({ estado: 'no_show' }); }}>No show</button>{/if}
    {/if}
   </div>

   {#if esEmpleado && sel.trabajador_id === perfil.id && sel.estado === 'programada'}
    <h4>Solicitar reprogramación</h4>
    <div class="form-grid">
     <label>Nueva fecha<input type="date" bind:value={reprog.nueva_fecha} /></label>
     <label>Nueva hora<input type="time" bind:value={reprog.nueva_hora} /></label>
     <label class="wide">Motivo<input bind:value={reprog.motivo} placeholder="Ej: conflicto personal, emergencia…" /></label>
    </div>
    <button class="mini" onclick={solicitarReprog}>Enviar solicitud al directivo</button>
   {/if}

   {#if notasSel.length}
    <h4>Notas de evolución</h4>
    {#each notasSel as n (n.id)}
     <div class="nota-mini">
      <strong>{new Date(n.created_at).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
      {#if n.especialidad}<span class="muted small"> · {n.especialidad}</span>{/if}
      {#if n.actividades}<p><strong>Actividades:</strong> {n.actividades}</p>{/if}
      {#if n.evolucion}<p><strong>Evolución:</strong> {n.evolucion}</p>{/if}
     </div>
    {/each}
   {:else if sel.estado === 'finalizada' || sel.estado === 'en_curso'}
    <p class="muted small"> Visita finalizada sin nota de evolución registrada.</p>
   {/if}
  </div>
 </div>
 {/if}
</main>
{/if}

<style>
:global(body) { margin: 0; font-family: system-ui, sans-serif; background: oklch(0.985 0.007 85); color: oklch(0.27 0.035 225); }
header { display: flex; justify-content: space-between; align-items: center; padding: .8rem 2rem; background: oklch(0.3 0.05 222); color: #f2eee2; border-bottom: 3px solid oklch(0.7 0.1 78); flex-wrap: wrap; gap:.5rem; }
.brand { display: flex; align-items: center; gap: .8rem; text-decoration: none; color: inherit; }
.brand-text { display: flex; flex-direction: column; }
.agency { font-size: .72rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: oklch(0.7 0.1 78); }
header img { height: 44px; width: 44px; object-fit: cover; border-radius: 10px; background: #f2eee2; padding: 2px; }
header h1 { font-size: 1.05rem; margin: 0; }
header div:not(.brand) { display: flex; gap:.5rem; align-items: center; flex-wrap: wrap; }
.badge { font-size:.75rem; background: oklch(0.42 0.068 218); color: #f2eee2; padding:.3rem.6rem; border-radius: 999px; }
.card { background: #fff; border-radius: 12px; padding: 1.25rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.center { text-align: center; max-width: 460px; margin: 4rem auto; }
.layout { padding: 1rem 2rem; max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }
.muted { color: oklch(0.45 0.03 225); font-size:.85rem; }
.small { font-size:.78rem; }
.error { color: oklch(0.55 0.2 27); font-size:.85rem; }
.ok { color: oklch(0.45 0.08 160); font-size:.85rem; }
.link { padding:.4rem.8rem; border: 1px solid oklch(0.45 0.03 225); border-radius: 8px; text-decoration: none; }
h3 { margin-top: 0; font-size: 1.05rem; } h4 { margin: 1rem 0 .5rem; font-size: .9rem; }
.barra { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: .6rem; }
.controles { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
.controles2 { display: flex; gap: .5rem; flex-wrap: wrap; }
.titulo { font-size: 1rem; min-width: 220px; text-align: center; }
.vistas { display: flex; gap: .25rem; margin-left: .5rem; }
.vistas button { background: oklch(0.94 0.02 85); color: oklch(0.4 0.05 225); }
.vistas button.active { background: oklch(0.42 0.068 218); color: #f2eee2; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: .6rem; margin: .6rem 0; }
.form-grid label { display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; font-weight: 600; }
.wide { grid-column: 1 / -1; }
.form-grid input, .form-grid select { padding: .45rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .85rem; font-weight: 400; }
.form-btns { display: flex; gap: .5rem; margin-top: .4rem; }
.conflictos { background: oklch(0.97 0.03 60); border: 1px solid oklch(0.85 0.08 60); border-radius: 8px; padding: .6rem .8rem; margin: .5rem 0; }
.conflictos ul { margin: .3rem 0; padding-left: 1.2rem; font-size: .85rem; }
.dia-lista { display: flex; flex-direction: column; gap: .45rem; }
.vis-card { display: flex; align-items: center; gap: .8rem; width: 100%; text-align: left; background: oklch(0.98 0.008 140); border: 1px solid oklch(0.92 0.02 140); border-radius: 10px; padding: .6rem .8rem; cursor: pointer; font: inherit; color: inherit; }
.vis-card .hora { font-weight: 700; min-width: 52px; color: oklch(0.42 0.068 218); }
.v-info { display: flex; flex-direction: column; flex: 1; }
.orden-n { background: oklch(0.42 0.068 218); color: #fff; border-radius: 999px; font-size: .7rem; padding: .05rem .45rem; }
.vis-card.orden { border-color: oklch(0.55 0.1 218); }
.semana { display: grid; grid-template-columns: repeat(7, 1fr); gap: .5rem; overflow-x: auto; }
.sem-col { min-width: 130px; background: oklch(0.985 0.008 140); border-radius: 10px; padding: .5rem; display: flex; flex-direction: column; gap: .35rem; }
.sem-col.today { outline: 2px solid oklch(0.7 0.1 78); }
.sem-head { display: flex; justify-content: space-between; font-size: .8rem; text-transform: capitalize; }
.sem-vis { background: oklch(0.94 0.02 85); border: 0; border-radius: 6px; padding: .3rem .4rem; font-size: .72rem; cursor: pointer; text-align: left; color: inherit; font-family: inherit; }
.mes-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.mes-dow { font-size: .72rem; font-weight: 700; text-align: center; padding: .3rem; color: oklch(0.5 0.03 225); }
.mes-cell { min-height: 84px; background: oklch(0.985 0.008 140); border-radius: 6px; padding: .3rem; font-size: .72rem; display: flex; flex-direction: column; gap: .15rem; }
.mes-cell.out { opacity: .4; }
.mes-cell.today { outline: 2px solid oklch(0.7 0.1 78); }
.mes-num { font-weight: 700; font-size: .75rem; }
.mes-vis { background: transparent; border: 0; padding: .1rem .2rem; font-size: .68rem; cursor: pointer; text-align: left; color: inherit; font-family: inherit; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.estado { font-size: .68rem; border-radius: 999px; padding: .1rem .5rem; background: oklch(0.93 0.02 85); }
.estado-programada { background: #cfe2ff; color: #084298; }
.estado-finalizada, .estado-en_curso { background: #d1e7dd; color: #0f5132; }
.estado-cancelada { background: #f8d7da; color: #842029; }
.estado-no_show { background: #fff3cd; color: #664d03; }
button { padding:.5rem .9rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; font-family: inherit; }
button.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.55 0.05 222); }
button.mini { padding:.3rem .7rem; font-size:.78rem; }
button.warn { background: #b91c1c; }
button.ok-btn { background: #15803d; }
.overlay { position: fixed; inset: 0; background: oklch(0.2 0.03 260 / .5); display: flex; align-items: flex-start; justify-content: center; z-index: 60; padding: 1.5rem 1rem; overflow-y: auto; }
.sheet { background: #fff; border-radius: 14px; padding: 1.25rem 1.5rem; max-width: 560px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
.sheet-head { display: flex; justify-content: space-between; align-items: center; }
.sheet-head h3 { margin: 0; }
.sheet-btns { display: flex; gap: .4rem; flex-wrap: wrap; margin: .7rem 0; }
.sheet-btns .mini { color: #f2eee2; }
.sheet-btns .mini.ghost { color: oklch(0.4 0.05 225); }
.nota-mini { background: oklch(0.98 0.008 140); border-radius: 8px; padding: .5rem .7rem; margin: .4rem 0; font-size: .82rem; }
.nota-mini p { margin: .1rem 0; }
@media (max-width: 800px) { .layout { padding: .6rem; } .semana { grid-template-columns: repeat(7, minmax(120px, 1fr)); } header { padding: .7rem 1rem; } }
</style>
