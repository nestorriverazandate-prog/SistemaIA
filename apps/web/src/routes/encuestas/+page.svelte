<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';

 let perfil = $state(null);
 let loading = $state(true);
 let error = $state('');
 let msg = $state('');
 let stats = $state(null);
 let encuestas = $state([]);
 let preguntas = $state([]);
 let sel = $state(null);
 let fPeriodo = $state('');
 let fEstado = $state('');
 let accionForm = $state({ acciones: '', accion_responsable: '', accion_fecha: '', accion_resultado: '' });

 const esAdmin = $derived(perfil?.rol === 'admin');
 function profDe(e) {
  const t = e.trabajador;
  return t ? `${t.nombre || ''}${t.profesion ? ' (' + t.profesion + ')' : ''}`.trim() : 'Sin profesional asignado';
 }
 function promDe(e) {
  const vals = Object.values(e.respuestas || {}).map(Number).filter((v) => v >= 1 && v <= 5);
  return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
 }
 function fmtFecha(f) { return f ? new Date(f).toLocaleDateString('es-EC', { dateStyle: 'medium' }) : '—'; }
 async function cargar() {
  error = '';
  try {
   const qs = new URLSearchParams();
   if (fPeriodo) qs.set('periodo', fPeriodo);
   if (fEstado) qs.set('estado', fEstado);
   const [st, r] = await Promise.all([
    api.estadisticasEncuestas().catch(() => null),
    api.encuestasPeriodo(`?${qs}`)
   ]);
   stats = st;
   encuestas = r.encuestas || [];
   preguntas = r.preguntas || [];
  } catch (e) { error = e.message; }
 }
 async function generar() {
  try { const r = await api.generarEncuestasPeriodo(fPeriodo || undefined); msg = `Encuestas generadas para ${r.periodo}: ${r.encuestas_generadas}`; await cargar(); }
  catch (e) { error = e.message; }
 }
 async function abrir(e) { sel = e; accionForm = { acciones: e.acciones || '', accion_responsable: e.accion_responsable || '', accion_fecha: e.accion_fecha || '', accion_resultado: e.accion_resultado || '' }; }
 async function guardarAccion() {
  try { await api.accionEncuestaPeriodo(sel.id, accionForm); msg = 'Acción guardada'; sel = { ...sel, ...accionForm }; await cargar(); }
  catch (e) { error = e.message; }
 }
 function exportarCSV() {
  const rows = [['Periodo','Paciente','Familiar','Profesional','Paquete','Estado','Promedio','Comentario','Acciones']];
  for (const e of encuestas) rows.push([e.periodo, `${e.pacientes?.nombre||''} ${e.pacientes?.apellido||''}`.trim(), e.perfiles?.nombre||e.perfiles?.email||'', profDe(e), e.pacientes?.paquetes?.nombre||'', e.estado, promDe(e), (e.comentario||'').replace(/\n/g,' '), (e.acciones||'').replace(/\n/g,' ')]);
  const blob = new Blob(['﻿'+rows.map(r=>r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'encuestas-satisfaccion.csv'; a.click();
 }
 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
   if (perfil?.rol !== 'admin') { loading = false; return; }
   await cargar();
  } catch { setToken(null); }
  finally { loading = false; }
 });
 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Encuestas de satisfacción — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil || !esAdmin}
 <main class="card center"><h1>Acceso restringido</h1><p class="muted">Solo el directivo.</p><a class="ghost link" href="/">Volver</a></main>
{:else}
<header>
 <a class="brand" href="/">
  <img src="/logo.png" alt="Agencia Gerontológica Integral" />
  <div class="brand-text"><span class="agency">Agencia Gerontológica Integral</span><h1>Encuestas de satisfacción familiar</h1></div>
 </a>
 <div>
  <span class="badge">{perfil.email} · Directivo</span>
  <a class="ghost link" href="/">Volver</a>
  <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="layout">
 {#if error}<p class="error">{error}</p>{/if}
 {#if msg}<p class="ok">{msg}</p>{/if}

 <!-- Estadísticas -->
 {#if stats}
 <section class="card">
  <h3>Resultados de satisfacción familiar</h3>
  <div class="kpis">
   <div class="kpi"><b>{stats.total_enviadas}</b><span>Enviadas</span></div>
   <div class="kpi"><b>{stats.total_respondidas}</b><span>Respondidas</span></div>
   <div class="kpi warn"><b>{stats.pendientes}</b><span>Pendientes</span></div>
   <div class="kpi"><b>{stats.participacion}%</b><span>Participación</span></div>
   <div class="kpi ok"><b>{stats.promedio_general ?? '—'}/5</b><span>Promedio general</span></div>
   <div class="kpi warn"><b>{stats.bajas}</b><span>Calificaciones bajas</span></div>
  </div>
  {#if Object.keys(stats.por_aspecto || {}).length}
   <h4>Satisfacción por criterio</h4>
   <div class="aspectos">
    {#each Object.entries(stats.por_aspecto) as [asp, v]}
     <div class="asp-row"><span class="asp-name">{asp}</span><div class="bar"><div class="fill" style="width:{v != null ? (v / 5) * 100 : 0}%"></div></div><b>{v ?? '—'}</b></div>
    {/each}
   </div>
  {/if}
  {#if Object.keys(stats.por_trabajador || {}).length}
   <h4>Satisfacción por profesional</h4>
   <div class="aspectos">
    {#each Object.entries(stats.por_trabajador).sort((a, b) => a[1] - b[1]) as [nom, v]}
     <div class="asp-row"><span class="asp-name">{nom}</span><div class="bar"><div class="fill" style="width:{(v / 5) * 100}%"></div></div><b>{v}/5</b></div>
    {/each}
   </div>
  {/if}
  {#if (stats.tendencia || []).length > 1}
   <h4>Evolución mensual</h4>
   <table class="mini-tab"><thead><tr><th>Periodo</th><th>Promedio</th><th>Respuestas</th></tr></thead>
   <tbody>{#each stats.tendencia as t}<tr><td>{t.periodo}</td><td>{t.promedio}/5</td><td>{t.n}</td></tr>{/each}</tbody></table>
  {/if}
  <div class="acciones-top">
   <button class="mini" onclick={generar}>Generar encuestas del mes anterior</button>
   <button class="mini ghost" onclick={exportarCSV}>Descargar Excel (CSV)</button>
  </div>
 </section>
 {/if}

 <!-- Filtros + lista -->
 <section class="card">
  <div class="filtros">
   <input type="month" bind:value={fPeriodo} onchange={cargar} title="Periodo" />
   <select bind:value={fEstado} onchange={cargar}>
    <option value="">Todos</option><option value="pendiente">Pendientes</option><option value="respondida">Respondidas</option>
   </select>
   <button class="mini ghost" onclick={cargar}>Filtrar</button>
   <span class="muted small">{encuestas.length} encuesta(s)</span>
  </div>
  {#each encuestas as e (e.id)}
   <div class="enc-card">
    <div class="enc-head">
     <strong>{e.pacientes?.nombre} {e.pacientes?.apellido}</strong>
     <span class="muted small">{e.periodo} · {e.perfiles?.nombre || e.perfiles?.email} · {profDe(e)} · {e.pacientes?.paquetes?.nombre || 'Sin paquete'}</span>
     <span class="sem sem-{e.estado === 'respondida' ? 'ok' : 'warn'}">{e.estado}</span>
     {#if e.estado === 'respondida'}<b class="prom">{promDe(e)}/5</b>{/if}
     <button class="mini ghost" onclick={() => abrir(e)}>Ver respuestas</button>
    </div>
    {#if e.comentario && e.estado === 'respondida'}<p class="small"><strong>Comentario:</strong> {e.comentario}</p>{/if}
    {#if e.acciones}<p class="small"><strong>Acción:</strong> {e.acciones}</p>{/if}
    {#if e.solicitar_contacto}<p class="small warn">El familiar solicitó contacto del directivo.</p>{/if}
   </div>
  {:else}<p class="muted">Sin encuestas registradas. Usa "Generar encuestas" para crear las del mes anterior.</p>{/each}
 </section>
</main>

<!-- Detalle -->
{#if sel}
<div class="overlay" role="presentation" onclick={() => sel = null}>
 <div class="sheet" onclick={(e) => e.stopPropagation()}>
  <div class="sheet-head"><h3>{sel.pacientes?.nombre} {sel.pacientes?.apellido} — {sel.periodo}</h3><button class="mini ghost" onclick={() => sel = null}>Cerrar</button></div>
  <p class="muted small">Familiar: {sel.perfiles?.nombre || sel.perfiles?.email} · Profesional: {profDe(sel)} · Paquete: {sel.pacientes?.paquetes?.nombre || '—'} · Estado: {sel.estado}{sel.respondida_at ? ' · Respondida ' + fmtFecha(sel.respondida_at) : ''}</p>
  {#if sel.estado === 'respondida'}
   <p class="prom-big">Promedio: <strong>{promDe(sel)}/5</strong></p>
   <table class="mini-tab">
    <thead><tr><th>Pregunta</th><th>Aspecto</th><th>Nota</th></tr></thead>
    <tbody>{#each preguntas as p}
     <tr><td>{p.texto}</td><td class="muted">{p.aspecto}</td><td><b>{sel.respuestas?.[p.k] ?? '—'}</b>/5</td></tr>
    {/each}</tbody>
   </table>
   {#if sel.comentario}<p><strong>Comentario:</strong> {sel.comentario}</p>{/if}
   {#if sel.solicitar_contacto}<p class="warn"><strong>Solicita contacto del directivo.</strong></p>{/if}
  {:else}<p class="muted">Encuesta pendiente de respuesta.</p>{/if}
  <h4>Plan de mejora / acción correctiva</h4>
  <div class="plan-form">
   <textarea bind:value={accionForm.acciones} rows="2" placeholder="Acciones a implementar"></textarea>
   <input bind:value={accionForm.accion_responsable} placeholder="Responsable" />
   <input type="date" bind:value={accionForm.accion_fecha} title="Fecha seguimiento" />
   <textarea bind:value={accionForm.accion_resultado} rows="2" placeholder="Resultado / seguimiento"></textarea>
   <button class="mini" onclick={guardarAccion}>Guardar acción</button>
  </div>
 </div>
</div>
{/if}
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
.warn { color: oklch(0.6 0.15 40); }
.link { padding:.4rem.8rem; border: 1px solid oklch(0.45 0.03 225); border-radius: 8px; text-decoration: none; }
h3 { margin-top: 0; font-size: 1rem; } h4 { margin: .8rem 0 .4rem; font-size: .85rem; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: .6rem; margin: .6rem 0; }
.kpi { background: oklch(0.98 0.008 140); border-radius: 10px; padding: .6rem .8rem; text-align: center; }
.kpi b { display: block; font-size: 1.15rem; }
.kpi span { font-size: .7rem; color: oklch(0.5 0.03 225); }
.kpi.ok b { color: oklch(0.4 0.08 160); }
.kpi.warn b { color: oklch(0.55 0.15 40); }
.aspectos { display: flex; flex-direction: column; gap: .3rem; margin: .5rem 0; }
.asp-row { display: flex; align-items: center; gap: .6rem; font-size: .82rem; }
.asp-name { width: 200px; flex-shrink: 0; }
.bar { flex: 1; height: 10px; background: oklch(0.93 0.02 85); border-radius: 999px; overflow: hidden; }
.fill { height: 100%; background: oklch(0.42 0.068 218); }
.mini-tab { width: 100%; border-collapse: collapse; font-size: .78rem; }
.mini-tab th, .mini-tab td { text-align: left; padding: .3rem .4rem; border-bottom: 1px solid oklch(0.93 0.025 140); }
.acciones-top { display: flex; gap: .5rem; margin-top: .6rem; }
.filtros { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin-bottom: .6rem; }
.filtros input, .filtros select { padding: .4rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .82rem; }
.enc-card { border: 1px solid oklch(0.92 0.02 140); border-radius: 10px; padding: .6rem .8rem; margin: .4rem 0; }
.enc-head { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
.prom { color: oklch(0.42 0.068 218); }
.sem { font-size: .68rem; border-radius: 999px; padding: .1rem .5rem; }
.sem-ok { background: #d1e7dd; color: #0f5132; }
.sem-warn { background: #fff3cd; color: #664d03; }
.overlay { position: fixed; inset: 0; background: oklch(0.2 0.03 260 / .5); display: flex; align-items: flex-start; justify-content: center; z-index: 60; padding: 1.5rem 1rem; overflow-y: auto; }
.sheet { background: #fff; border-radius: 14px; padding: 1.25rem 1.5rem; max-width: 640px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
.sheet-head { display: flex; justify-content: space-between; align-items: center; }
.sheet-head h3 { margin: 0; }
.prom-big { font-size: 1.1rem; }
.plan-form { display: flex; flex-direction: column; gap: .4rem; margin-top: .5rem; }
.plan-form input, .plan-form textarea { padding: .45rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .85rem; }
button { padding:.5rem .9rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; font-family: inherit; }
button.mini { padding:.3rem .7rem; font-size:.78rem; }
button.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.55 0.05 222); }
</style>
