<script>
 import { onMount, tick } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';
 import Valoraciones from '$lib/Valoraciones.svelte';

 let perfil = $state(null);
 let loading = $state(true);
 let exp = $state(null);
 let error = $state('');
 let msg = $state('');
 let plan = $state('');
 let planSaving = $state(false);
 let fDisc = $state('');
 let fProf = $state('');
 let fDesde = $state('');
 let fHasta = $state('');
 let evUrls = $state({});
 let tab = $state(new URLSearchParams(window.location.search).get('tab') || 'evolucion'); // evolucion | valoracion | plan | auditoria

 const DISCIPLINAS = ['Gerontología', 'Terapia Física y Rehabilitación', 'Psicología', 'Nutrición', 'Enfermería', 'Cuidadores', 'Trabajo social'];

 function irTab(t) {
  tab = t;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', t);
  history.replaceState(null, '', url);
 }

 async function cargar() {
  try {
   const id = new URLSearchParams(window.location.search).get('id');
   if (!id) { error = 'Falta el paciente'; return; }
   const exped = await api.expedientePaciente(id);
   exp = exped;
   plan = exped.paciente.plan_atencion || '';
   evUrls = {};
   for (const e of (exped.evidencias || []).slice(0, 80)) {
    api.evidenciaUrl(e.id).then((r) => { evUrls = { ...evUrls, [e.id]: r.url }; }).catch(() => {});
   }
  } catch (e) { error = e.message; }
 }

 async function guardarPlan() {
  planSaving = true; error = '';
  try {
   const { paciente } = await api.actualizarPaciente(exp.paciente.id, { plan_atencion: plan });
   exp.paciente = { ...exp.paciente, ...paciente };
   msg = 'Plan de atención guardado';
  } catch (e) { error = e.message; }
  finally { planSaving = false; }
 }

 const esAdmin = $derived(perfil?.rol === 'admin');

 const timeline = $derived.by(() => {
  if (!exp) return [];
  const vById = new Map((exp.visitas || []).map((v) => [v.id, v]));
  let items = (exp.notas || []).map((n) => {
   const v = n.visita_id ? vById.get(n.visita_id) : null;
   return {
    n, v,
    fecha: v?.fecha || String(n.created_at || '').slice(0, 10),
    hora: v?.hora_programada || '',
    prof: v?.perfiles?.nombre || v?.perfiles?.email || 'Personal',
    disc: n.especialidad || v?.perfiles?.especialidad || v?.perfiles?.profesion || 'General'
   };
  }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.n.created_at || '').localeCompare(String(a.n.created_at || '')));
  if (fDisc) items = items.filter((i) => i.disc === fDisc);
  if (fProf) items = items.filter((i) => i.prof === fProf);
  if (fDesde) items = items.filter((i) => String(i.fecha) >= fDesde);
  if (fHasta) items = items.filter((i) => String(i.fecha) <= fHasta);
  return items;
 });
 const tDiscs = $derived([...new Set((exp?.notas || []).map((n) => n.especialidad || 'General'))].sort());
 const tProfs = $derived([...new Set((exp?.notas || []).map((n) => {
  const v = (exp.visitas || []).find((x) => x.id === n.visita_id);
  return v?.perfiles?.nombre || v?.perfiles?.email || 'Personal';
 }))].sort());
 const evPorNota = $derived.by(() => {
  const m = new Map();
  for (const e of exp?.evidencias || []) m.set(e.nota_id, [...(m.get(e.nota_id) || []), e]);
  return m;
 });

 function fmtFecha(f) { return f ? new Date(f.length === 10 ? f + 'T12:00:00' : f).toLocaleDateString('es-EC', { dateStyle: 'medium' }) : '—'; }
 function fmtFechaHora(f) { return f ? new Date(f).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
   if (!['admin', 'staff', 'cuidador', 'familiar'].includes(perfil?.rol)) { loading = false; return; }
   await cargar();
  } catch { setToken(null); }
  finally { loading = false; }
 });
 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Expediente multidisciplinario — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil || !exp}
 <main class="card center">
  {#if error}<p class="error">{error}</p>{/if}
  <h1>Expediente no disponible</h1>
  <p class="muted">No tienes acceso a este expediente o no existe.</p>
  <a class="ghost link" href="/">Volver</a>
 </main>
{:else}
<header>
 <a class="brand" href="/">
  <img src="/logo.png" alt="Agencia Gerontológica Integral" />
  <div class="brand-text">
   <span class="agency">Agencia Gerontológica Integral</span>
   <h1>Expediente multidisciplinario</h1>
  </div>
 </a>
 <div>
  <span class="badge">{perfil.email} · {esAdmin ? 'Directivo' : 'Personal'}</span>
  <a class="ghost link" href={esAdmin ? '/pacientes' : '/mis-pacientes'}>Volver</a>
  <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="layout">
 <section class="card">
  <div class="pac-head">
   <div>
    <h2>{exp.paciente.nombre} {exp.paciente.apellido}</h2>
    <p class="muted">{exp.paciente.cedula ? exp.paciente.cedula + ' años · ' : ''}{exp.paciente.direccion || '—'} · {exp.paciente.telefono || '—'}</p>
    <p class="muted">{exp.paciente.diagnostico || exp.paciente.descripcion || 'Sin diagnóstico registrado'}</p>
   </div>
  </div>
  <div class="tabs">
   <button class:active={tab === 'evolucion'} onclick={() => irTab('evolucion')}>Evolución ({exp.notas.length})</button>
   <button class:active={tab === 'valoracion'} onclick={() => irTab('valoracion')}>Valoración</button>
   <button class:active={tab === 'plan'} onclick={() => irTab('plan')}>Plan de atención</button>
   {#if esAdmin}<button class:active={tab === 'auditoria'} onclick={() => irTab('auditoria')}>Auditoría ({(exp.auditoria || []).length})</button>{/if}
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  {#if msg}<p class="ok">{msg}</p>{/if}
 </section>

 {#if tab === 'evolucion'}
 <section class="card">
  <h3>Línea de tiempo de intervenciones</h3>
  <div class="filtros">
   <input type="date" bind:value={fDesde} title="Desde" />
   <input type="date" bind:value={fHasta} title="Hasta" />
   <select bind:value={fProf}><option value="">Todos los profesionales</option>{#each tProfs as pr}<option value={pr}>{pr}</option>{/each}</select>
   <select bind:value={fDisc}><option value="">Todas las disciplinas</option>{#each tDiscs as d}<option value={d}>{d}</option>{/each}</select>
   <span class="muted">{timeline.length} registro(s)</span>
  </div>
  <div class="timeline">
   {#each timeline as it (it.n.id)}
    <div class="tl-item">
     <div class="tl-dot"></div>
     <div class="tl-card">
      <div class="tl-meta">
       <strong>{fmtFecha(it.fecha)}{it.hora ? ' · ' + it.hora : ''}</strong>
       <span class="muted"> · {it.prof} · {it.disc}{it.n.sesion ? ' · ' + it.n.sesion : ''}</span>
       {#if it.n.cerrada}<span class="cerrada-badge">🔒 Cerrada{it.n.cerrada_por ? ' por ' + it.n.cerrada_por : ''}</span>{/if}
       {#if it.n.revisado}<span class="revisado-badge">✓ Revisado</span>{/if}
      </div>
      {#if it.n.objetivos}<p><strong>Objetivos de la disciplina:</strong> {it.n.objetivos}</p>{/if}
      {#if it.n.actividades}<p><strong>Actividades:</strong> {it.n.actividades}</p>{/if}
      {#if it.n.evolucion}<p><strong>Evolución:</strong> {it.n.evolucion}</p>{/if}
      {#if it.n.observaciones}<p><strong>Observaciones:</strong> {it.n.observaciones}</p>{/if}
      {#if it.n.recomendaciones}<p><strong>Recomendaciones para el equipo:</strong> {it.n.recomendaciones}</p>{/if}
      {#if it.n.incidencias}<p class="incidencia"><strong>⚠ Incidencia:</strong> {it.n.incidencias}</p>{/if}
      {#if it.n.correccion}<p class="correccion"><strong>Corrección solicitada:</strong> {it.n.correccion}</p>{/if}
      {#if it.n.comentario_admin}<p class="comentario"><strong>Comentario del directivo:</strong> {it.n.comentario_admin}</p>{/if}
      {#if (evPorNota.get(it.n.id) || []).length}
       <div class="tl-evs">
        {#each evPorNota.get(it.n.id) as e (e.id)}
         {#if evUrls[e.id]}<img class="tl-ev" src={evUrls[e.id]} alt={e.descripcion || ''} title={e.descripcion || ''} />{/if}
        {/each}
       </div>
      {/if}
     </div>
    </div>
   {:else}<p class="muted">Sin información registrada</p>{/each}
  </div>
 </section>
 {/if}

 {#if tab === 'valoracion'}
 <section class="card">
  <Valoraciones pacienteId={exp.paciente.id} />
 </section>
 {/if}

 {#if tab === 'plan'}
 <section class="card">
  <h3>Plan de atención interdisciplinario</h3>
  <p class="muted small">Objetivos generales y particulares por disciplina. {esAdmin ? 'Solo el directivo puede editarlo.' : 'Consulta de solo lectura.'}</p>
  {#if esAdmin}
   <textarea bind:value={plan} rows="8" placeholder="Objetivos generales del plan…&#10;&#10;Por disciplina:&#10;• Gerontología: …&#10;• Psicología: …&#10;• Nutrición: …"></textarea>
   <button class="mini" onclick={guardarPlan} disabled={planSaving}>{planSaving ? 'Guardando…' : 'Guardar plan'}</button>
  {:else}
   <div class="plan-view">{plan || 'Sin plan de atención registrado'}</div>
  {/if}
  {#if DISCIPLINAS.length}
   <p class="muted small">Disciplinas del equipo: {DISCIPLINAS.join(' · ')}</p>
  {/if}
 </section>
 {/if}

 {#if tab === 'auditoria' && esAdmin}
 <section class="card">
  <h3>Auditoría del expediente</h3>
  {#if (exp.auditoria || []).length}
   <table>
    <thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Detalle</th></tr></thead>
    <tbody>
    {#each exp.auditoria as a (a.id)}
     <tr>
      <td class="muted">{fmtFechaHora(a.created_at)}</td>
      <td>{a.actor}</td>
      <td><span class="audit-chip">{a.accion}</span></td>
      <td class="muted small">{a.detalle ? JSON.stringify(a.detalle).slice(0, 120) : '—'}</td>
     </tr>
    {/each}
    </tbody>
   </table>
  {:else}<p class="muted">Sin eventos registrados</p>{/if}
 </section>
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
.layout { padding: 1rem 2rem; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }
.muted { color: oklch(0.45 0.03 225); font-size:.85rem; }
.small { font-size:.78rem; }
.error { color: oklch(0.55 0.2 27); font-size:.85rem; }
.ok { color: oklch(0.45 0.08 160); font-size:.85rem; }
.link { padding:.4rem.8rem; border: 1px solid oklch(0.45 0.03 225); border-radius: 8px; text-decoration: none; }
h2 { margin: 0; font-size: 1.2rem; } h3 { margin-top: 0; font-size: 1rem; }
.pac-head { margin-bottom: .6rem; }
.tabs { display: flex; gap: .4rem; margin-top: .8rem; flex-wrap: wrap; }
.tabs button { background: oklch(0.94 0.02 85); color: oklch(0.4 0.05 225); }
.tabs button.active { background: oklch(0.42 0.068 218); color: #f2eee2; }
.filtros { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin: .6rem 0; }
.filtros input, .filtros select { padding: .4rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .8rem; }
.timeline { position: relative; padding-left: 1.4rem; max-height: 65vh; overflow-y: auto; }
.timeline::before { content: ''; position: absolute; left: 7px; top: 6px; bottom: 6px; width: 2px; background: oklch(0.8 0.05 220); }
.tl-item { position: relative; margin-bottom: .9rem; }
.tl-dot { position: absolute; left: -1.4rem; top: 6px; width: 14px; height: 14px; border-radius: 50%; background: oklch(0.42 0.068 218); border: 3px solid #fff; box-shadow: 0 0 0 1px oklch(0.8 0.05 220); }
.tl-card { background: oklch(0.985 0.008 140); border: 1px solid oklch(0.92 0.02 140); border-radius: 10px; padding: .7rem .9rem; font-size: .85rem; }
.tl-meta { margin-bottom: .3rem; }
.tl-card p { margin: .15rem 0; }
.tl-card .incidencia { color: oklch(0.55 0.2 27); }
.tl-card .correccion { color: oklch(0.6 0.15 40); }
.tl-card .comentario { color: oklch(0.4 0.08 160); }
.cerrada-badge { display: inline-block; font-size: .68rem; background: oklch(0.9 0.03 260); border-radius: 999px; padding: .1rem .5rem; margin-left: .3rem; }
.revisado-badge { display: inline-block; font-size: .68rem; background: #d1e7dd; color: #0f5132; border-radius: 999px; padding: .1rem .5rem; margin-left: .3rem; }
.tl-evs { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .4rem; }
.tl-ev { width: 90px; height: 68px; object-fit: cover; border-radius: 6px; border: 1px solid oklch(0.86 0.02 85); cursor: pointer; }
textarea { width: 100%; padding: .6rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
.plan-view { white-space: pre-wrap; background: oklch(0.97 0.01 85); border-radius: 8px; padding: .8rem; font-size: .88rem; }
.audit-chip { font-size: .7rem; background: oklch(0.94 0.02 85); border-radius: 999px; padding: .1rem .5rem; }
table { width: 100%; border-collapse: collapse; font-size: .82rem; }
th, td { text-align: left; padding: .45rem .4rem; border-bottom: 1px solid oklch(0.93 0.025 140); }
button { padding:.5rem .9rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; }
button.mini { padding:.3rem .7rem; font-size:.78rem; }
button.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.55 0.05 222); }
</style>
