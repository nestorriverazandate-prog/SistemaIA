<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';
 import { sesion } from '$lib/sesion.svelte.js';

 const esAdmin = $derived(sesion.user?.perfil?.rol === 'admin');
 let perfil = $state(null);
 let loading = $state(true);
 let error = $state('');
 let msg = $state('');
 let planes = $state([]);
 let trabajadores = $state([]);
 let filtro = $state('');
 let planForm = $state({ trabajador_id: '', evaluacion_id: '', area: '', problema: '', objetivo: '', actividades: '', fecha_limite: '', responsable: '', proxima_evaluacion: '' });

 async function cargar() {
  try {
   const [pl, tr] = await Promise.all([
    api.planesMejora().catch(() => ({ planes: [] })),
    esAdmin ? api.trabajadores().catch(() => ({ trabajadores: [] })) : Promise.resolve({ trabajadores: [] })
   ]);
   planes = pl.planes || [];
   trabajadores = (tr.trabajadores || []).filter((t) => !['inactivo', 'suspendido'].includes(t.estado));
  } catch (e) { error = e.message; }
 }
 async function crearPlan() {
  error = '';
  if (!planForm.trabajador_id || !planForm.area) { error = 'Empleado y área son requeridos'; return; }
  try {
   await api.crearPlanMejora(planForm);
   msg = 'Plan de mejora creado';
   planForm = { trabajador_id: '', evaluacion_id: '', area: '', problema: '', objetivo: '', actividades: '', fecha_limite: '', responsable: '', proxima_evaluacion: '' };
   await cargar();
  } catch (e) { error = e.message; }
 }
 async function cambiarPlanEstado(p, estado) {
  try { await api.actualizarPlanMejora(p.id, { estado }); await cargar(); } catch (e) { error = e.message; }
 }
 const filtrados = $derived(filtro ? planes.filter((p) => (p.perfiles?.nombre || '').toLowerCase().includes(filtro.toLowerCase()) || (p.area || '').toLowerCase().includes(filtro.toLowerCase())) : planes);
 const activos = $derived(filtrados.filter((p) => p.estado !== 'completado'));
 const completados = $derived(filtrados.filter((p) => p.estado === 'completado'));

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try { const { user: me } = await api.me(); perfil = me.perfil; await cargar(); }
  catch { setToken(null); }
  finally { loading = false; }
 });
</script>

<svelte:head><title>Planes de mejora — AGI</title></svelte:head>

<div class="wrap">
 <header class="dir-head">
  <div>
   <h1>Planes de mejora</h1>
   <p class="sub">{esAdmin ? 'Seguimiento de áreas de oportunidad del equipo' : 'Tus planes de mejora asignados'}</p>
  </div>
  {#if esAdmin}<input class="busq" placeholder="Buscar por empleado o área…" bind:value={filtro} />{/if}
 </header>
 {#if error}<div class="err">{error}</div>{/if}
 {#if msg}<div class="okm">{msg}</div>{/if}

 {#if loading}
  <div class="card center"><p>Cargando…</p></div>
 {:else}
  {#if esAdmin}
   <section class="card">
    <h2>Nuevo plan de mejora</h2>
    <div class="plan-form">
     <select bind:value={planForm.trabajador_id}>
      <option value="">— Empleado —</option>
      {#each trabajadores as t}<option value={t.id}>{t.nombre || t.email}</option>{/each}
     </select>
     <input bind:value={planForm.area} placeholder="Área a mejorar *" />
     <input bind:value={planForm.problema} placeholder="Problema identificado" />
     <input bind:value={planForm.objetivo} placeholder="Objetivo de mejora" />
     <textarea bind:value={planForm.actividades} rows="2" placeholder="Actividades correctivas"></textarea>
     <div class="frow2">
      <label>Límite <input type="date" bind:value={planForm.fecha_limite} /></label>
      <label>Responsable <input bind:value={planForm.responsable} placeholder="Quién da seguimiento" /></label>
      <label>Próx. evaluación <input type="date" bind:value={planForm.proxima_evaluacion} /></label>
     </div>
     <button class="btn-sec" onclick={crearPlan}>Crear plan</button>
    </div>
   </section>
  {/if}

  <section class="card">
   <h2>Planes activos ({activos.length})</h2>
   {#each activos as p (p.id)}
    <div class="plan-card">
     <div class="ev-head"><strong>{p.perfiles?.nombre || 'Empleado'}</strong> · {p.area} <span class="sem sem-{p.estado === 'completado' ? 'ok' : p.estado === 'en_proceso' ? 'warn' : 'bad'}">{p.estado.replace('_', ' ')}</span></div>
     {#if p.problema}<p class="small"><b>Problema:</b> {p.problema}</p>{/if}
     {#if p.objetivo}<p class="small"><b>Objetivo:</b> {p.objetivo}</p>{/if}
     {#if p.actividades}<p class="small"><b>Actividades:</b> {p.actividades}</p>{/if}
     <p class="muted small">{#if p.fecha_limite}Límite: {p.fecha_limite} · {/if}{#if p.responsable}Resp: {p.responsable} · {/if}{#if p.proxima_evaluacion}Próx. eval: {p.proxima_evaluacion}{/if}</p>
     {#if esAdmin}
      <div class="acc">
       {#if p.estado === 'pendiente'}<button class="mini ghost" onclick={() => cambiarPlanEstado(p, 'en_proceso')}>Iniciar</button>{/if}
       {#if p.estado === 'en_proceso'}<button class="mini ok" onclick={() => cambiarPlanEstado(p, 'completado')}>Completar</button>{/if}
       {#if p.estado !== 'pendiente'}<button class="mini ghost" onclick={() => cambiarPlanEstado(p, 'pendiente')}>Reabrir</button>{/if}
      </div>
     {/if}
    </div>
   {:else}<p class="muted">Sin planes activos.</p>{/each}
  </section>

  {#if completados.length}
   <section class="card">
    <h2>Completados ({completados.length})</h2>
    {#each completados as p (p.id)}
     <div class="plan-card done">
      <div class="ev-head"><strong>{p.perfiles?.nombre || 'Empleado'}</strong> · {p.area} <span class="sem sem-ok">completado</span></div>
      {#if p.objetivo}<p class="small"><b>Objetivo:</b> {p.objetivo}</p>{/if}
     </div>
    {/each}
   </section>
  {/if}
 {/if}
</div>

<style>
 .wrap { max-width: 960px; margin: 0 auto; padding: 26px 24px 60px; }
 .dir-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; gap: 12px; flex-wrap: wrap; }
 .dir-head h1 { margin: 0; font-size: 24px; color: #0d3a5c; }
 .sub { margin: 4px 0 0; color: #7a8694; font-size: 13px; }
 .busq { padding: 9px 14px; border: 1px solid #ddd6c4; border-radius: 10px; font-size: 13px; min-width: 240px; }
 .err { background: #fdecea; color: #c0392b; padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 14px; }
 .okm { background: #e5f5ec; color: #14663f; padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 14px; }
 .card { background: #fff; border: 1px solid #e9e4d8; border-radius: 16px; padding: 20px; box-shadow: 0 2px 10px rgba(13,58,92,.05); margin-bottom: 18px; }
 .card h2 { margin: 0 0 14px; font-size: 15px; color: #0d3a5c; }
 .center { text-align: center; padding: 60px 20px; color: #4a5a68; }
 .muted { color: #8a94a0; font-size: 12px; }
 .btn-sec { padding: 9px 18px; border: none; border-radius: 10px; background: #0d3a5c; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
 .plan-form { display: flex; flex-direction: column; gap: 10px; }
 .plan-form select, .plan-form input, .plan-form textarea { padding: 9px 12px; border: 1px solid #ddd6c4; border-radius: 9px; font-size: 13px; }
 .frow2 { display: flex; gap: 10px; flex-wrap: wrap; }
 .frow2 label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: 700; color: #4a5a68; text-transform: uppercase; flex: 1; min-width: 160px; }
 .plan-card { border: 1px solid #eee8d8; border-radius: 12px; padding: 14px; margin-bottom: 10px; }
 .plan-card.done { opacity: .65; }
 .ev-head { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #0d3a5c; margin-bottom: 6px; flex-wrap: wrap; }
 .sem { font-size: 10.5px; font-weight: 800; text-transform: uppercase; padding: 3px 9px; border-radius: 20px; }
 .sem-ok { background: #e5f5ec; color: #14663f; }
 .sem-warn { background: #fdf3e0; color: #8a5a10; }
 .sem-bad { background: #eef5fb; color: #14507c; }
 .small { font-size: 12.5px; color: #4a5a68; margin: 4px 0; }
 .acc { margin-top: 8px; display: flex; gap: 6px; }
 .mini { padding: 5px 11px; border: none; border-radius: 8px; font-size: 11.5px; font-weight: 700; cursor: pointer; background: #eef5fb; color: #0d5c8a; }
 .mini.ghost { background: #fff; border: 1px solid #ddd6c4; }
 .mini.ok { background: #e5f5ec; color: #14663f; }
</style>
