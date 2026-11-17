<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';

 let perfil = $state(null);
 let loading = $state(true);
 let error = $state('');
 let msg = $state('');
 let evaluaciones = $state([]);
 let trabajadores = $state([]);
 let planes = $state([]);
 let vista = $state('tablero'); // tablero | nueva | historial | planes | mias
 let selEmp = $state('');
 let historial = $state([]);
 let metricas = $state(null);
 let form = $state({ periodo: 'mensual', fecha_inicio: '', fecha_fin: '', calificaciones: {}, fortalezas: '', oportunidades: '', observaciones: '', recomendaciones: '' });
 let planForm = $state({ trabajador_id: '', evaluacion_id: '', area: '', problema: '', objetivo: '', actividades: '', fecha_limite: '', responsable: '', proxima_evaluacion: '' });
 let capsForm = $state({ trabajador_id: '', curso: '', fecha: '', horas: '', tipo: '' });
 let capsLista = $state([]);

 const INDICADORES = [
  ['puntualidad', 'Puntualidad'], ['cumplimiento_visitas', 'Cumplimiento de visitas'], ['calidad_notas', 'Calidad de notas de evolución'],
  ['cumplimiento_actividades', 'Cumplimiento de actividades'], ['capacitacion', 'Capacitación'], ['satisfaccion', 'Satisfacción de pacientes y familiares'],
  ['seguimiento_indicaciones', 'Seguimiento de indicaciones']
 ];
 const NIVELES = { 1: 'Deficiente', 2: 'Necesita mejorar', 3: 'Satisfactorio', 4: 'Bueno', 5: 'Excelente' };
 const esAdmin = $derived(perfil?.rol === 'admin');
 const esEmpleado = $derived(['staff', 'cuidador', 'familiar'].includes(perfil?.rol));

 function iso(d) { return d.toISOString().slice(0, 10); }
 function periodoFechas() {
  const h = new Date();
  if (form.periodo === 'trimestral') { const i = Math.floor(h.getMonth() / 3) * 3; return { desde: iso(new Date(h.getFullYear(), i, 1)), hasta: iso(new Date(h.getFullYear(), i + 3, 0)) }; }
  if (form.periodo === 'semestral') { const i = h.getMonth() < 6 ? 0 : 6; return { desde: iso(new Date(h.getFullYear(), i, 1)), hasta: iso(new Date(h.getFullYear(), i + 6, 0)) }; }
  return { desde: iso(new Date(h.getFullYear(), h.getMonth(), 1)), hasta: iso(h) };
 }

 async function cargar() {
  try {
   const [ev, pl, tr, cp] = await Promise.all([
    api.evaluaciones().catch(() => ({ evaluaciones: [] })),
    api.planesMejora().catch(() => ({ planes: [] })),
    esAdmin ? api.trabajadores().catch(() => ({ trabajadores: [] })) : Promise.resolve({ trabajadores: [] }),
    esAdmin ? api.capacitaciones().catch(() => ({ capacitaciones: [] })) : api.capacitaciones(`?trabajador_id=${perfil?.id || ''}`).catch(() => ({ capacitaciones: [] }))
   ]);
   evaluaciones = ev.evaluaciones || [];
   planes = pl.planes || [];
   trabajadores = (tr.trabajadores || []).filter((t) => !['inactivo', 'suspendido'].includes(t.estado));
   capsLista = cp.capacitaciones || [];
  } catch (e) { error = e.message; }
 }

 async function abrirHistorial(tid) {
  selEmp = tid;
  const r = await api.evaluaciones(`?trabajador_id=${tid}`).catch(() => ({ evaluaciones: [] }));
  historial = r.evaluaciones || [];
  vista = 'historial';
 }

 async function cargarMetricas() {
  metricas = null;
  if (!selEmp) return;
  const { desde, hasta } = periodoFechas();
  try { metricas = (await api.metricasEmpleado(`trabajador_id=${selEmp}&desde=${desde}&hasta=${hasta}`)).metricas; } catch {}
 }

 function nuevaEval(tid) {
  selEmp = tid || '';
  const { desde, hasta } = periodoFechas();
  form = { periodo: 'mensual', fecha_inicio: desde, fecha_fin: hasta, calificaciones: {}, fortalezas: '', oportunidades: '', observaciones: '', recomendaciones: '' };
  metricas = null; error = ''; msg = '';
  vista = 'nueva';
  if (selEmp) cargarMetricas();
 }

 async function guardarEval() {
  error = '';
  const faltan = INDICADORES.filter(([k]) => !form.calificaciones[k]);
  if (faltan.length) { error = `Califica todos los indicadores (faltan ${faltan.length})`; return; }
  try {
   await api.crearEvaluacion({ trabajador_id: selEmp, periodo: form.periodo, fecha_inicio: form.fecha_inicio, fecha_fin: form.fecha_fin, calificaciones: form.calificaciones, fortalezas: form.fortalezas, oportunidades: form.oportunidades, observaciones: form.observaciones, recomendaciones: form.recomendaciones });
   msg = 'Evaluación registrada';
   vista = 'tablero';
   await cargar();
  } catch (e) { error = e.message; }
 }

 async function confirmarRevision(ev) {
  try { await api.actualizarEvaluacion(ev.id, { revisada: true }); await cargar(); } catch (e) { error = e.message; }
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
 async function registrarCap() {
  if (!capsForm.trabajador_id || !capsForm.curso) { error = 'Empleado y curso requeridos'; return; }
  try { await api.crearCapacitacion(capsForm); capsForm = { trabajador_id: '', curso: '', fecha: iso(new Date()), horas: '', tipo: '' }; await cargar(); msg = 'Capacitación registrada'; } catch (e) { error = e.message; }
 }

 // Datos derivados
 const ultimaPorEmp = $derived.by(() => {
  const m = new Map();
  for (const e of evaluaciones) if (!m.has(e.trabajador_id)) m.set(e.trabajador_id, e);
  return m;
 });
 const miEval = $derived(esEmpleado ? evaluaciones.filter((e) => e.trabajador_id === perfil?.id) : []);
 const promedioCalc = $derived(form.calificaciones && Object.keys(form.calificaciones).length ? (Object.values(form.calificaciones).reduce((a, b) => a + Number(b), 0) / Object.keys(form.calificaciones).length).toFixed(1) : null);
 const pctCalc = $derived(promedioCalc ? Math.round((promedioCalc / 5) * 100) : null);
 function resultadoDe(pct) { return pct >= 90 ? 'Desempeño excelente' : pct >= 80 ? 'Desempeño satisfactorio' : pct >= 70 ? 'Desempeño en desarrollo' : 'Requiere intervención'; }
 function puntosGrafica(lista) {
  const pts = [...lista].sort((a, b) => String(a.fecha_fin).localeCompare(String(b.fecha_fin)));
  if (pts.length < 2) return null;
  const W = 280, H = 80, pad = 8;
  return pts.map((v, i) => `${pad + (i / (pts.length - 1)) * (W - pad * 2)},${H - pad - (Number(v.promedio) / 5) * (H - pad * 2)}`).join(' ');
 }
 function reportePDF(ev) {
  const w = window.open('', '_blank');
  const inds = Object.entries(ev.calificaciones || {});
  w.document.write(`<html><head><title>Evaluación de desempeño</title><style>body{font-family:system-ui,sans-serif;max-width:700px;margin:2rem auto;padding:0 1rem}h1{font-size:1.1rem}table{width:100%;border-collapse:collapse;font-size:.82rem}th,td{border:1px solid #ccc;padding:.35rem .5rem;text-align:left}</style></head><body>
  <h1>Evaluación de desempeño — ${ev.perfiles?.nombre || ev.trabajador_id}</h1>
  <p>Periodo: ${ev.periodo} (${ev.fecha_inicio} a ${ev.fecha_fin}) · Resultado: ${ev.resultado} (${ev.porcentaje}%)</p>
  <table><tr><th>Indicador</th><th>Calificación</th></tr>
  ${inds.map(([k, v]) => `<tr><td>${INDICADORES.find(([ik]) => ik === k)?.[1] || k}</td><td>${v}/5 — ${NIVELES[v]}</td></tr>`).join('')}
  <tr><td><b>Promedio</b></td><td><b>${ev.promedio}/5</b></td></tr></table>
  ${ev.fortalezas ? `<p><b>Fortalezas:</b> ${ev.fortalezas}</p>` : ''}
  ${ev.oportunidades ? `<p><b>Áreas de oportunidad:</b> ${ev.oportunidades}</p>` : ''}
  ${ev.observaciones ? `<p><b>Observaciones:</b> ${ev.observaciones}</p>` : ''}
  ${ev.recomendaciones ? `<p><b>Recomendaciones:</b> ${ev.recomendaciones}</p>` : ''}
  </body></html>`);
  w.document.close(); w.print();
 }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
   if (!perfil || ['paciente'].includes(perfil.rol)) { loading = false; return; }
   await cargar();
   if (esEmpleado) vista = 'mias';
  } catch { setToken(null); }
  finally { loading = false; }
 });
 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Evaluación de desempeño — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil}
 <main class="card center"><p>Inicia sesión.</p><a class="ghost link" href="/">Ir al inicio</a></main>
{:else}
<header>
 <a class="brand" href="/">
  <img src="/logo.png" alt="Agencia Gerontológica Integral" />
  <div class="brand-text"><span class="agency">Agencia Gerontológica Integral</span><h1>Evaluación de desempeño</h1></div>
 </a>
 <div>
  <span class="badge">{perfil.email} · {esAdmin ? 'Directivo' : 'Personal'}</span>
  <a class="ghost link" href={esAdmin ? '/' : '/mis-pacientes'}>Volver</a>
  <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="layout">
 {#if esAdmin}
 <div class="tabs">
  <button class:active={vista === 'tablero'} onclick={() => vista = 'tablero'}>Tablero</button>
  <button class:active={vista === 'nueva'} onclick={() => nuevaEval()}>Nueva evaluación</button>
  <button class:active={vista === 'planes'} onclick={() => vista = 'planes'}>Planes de mejora ({planes.filter(p => p.estado !== 'completado').length})</button>
  <button class:active={vista === 'caps'} onclick={() => vista = 'caps'}>Capacitaciones</button>
 </div>
 {/if}
 {#if esEmpleado}<div class="tabs"><button class:active={true}>Mis evaluaciones</button></div>{/if}
 {#if error}<p class="error">{error}</p>{/if}
 {#if msg}<p class="ok">{msg}</p>{/if}

 <!-- ===== TABLERO (admin) ===== -->
 {#if esAdmin && vista === 'tablero'}
 <section class="card">
  <h3>Empleados y última evaluación</h3>
  {#if trabajadores.length === 0}<p class="muted">Sin empleados registrados.</p>{/if}
  <table>
   <thead><tr><th>Empleado</th><th>Disciplina</th><th>Última evaluación</th><th>Promedio</th><th>Resultado</th><th></th></tr></thead>
   <tbody>
   {#each trabajadores as t (t.id)}
    {@const ult = ultimaPorEmp.get(t.id)}
    <tr>
     <td><strong>{t.nombre || t.email}</strong></td>
     <td class="muted">{t.profesion || t.especialidad || '—'}</td>
     <td>{ult ? `${ult.periodo} · ${ult.fecha_fin}` : '<span class="muted">Sin evaluaciones</span>'}</td>
     <td>{ult ? `${ult.promedio}/5` : '—'}</td>
     <td>{#if ult}<span class="sem sem-{ult.porcentaje >= 80 ? 'ok' : ult.porcentaje >= 70 ? 'warn' : 'bad'}">{ult.resultado}</span>{/if}</td>
     <td class="acc">
      <button class="mini" onclick={() => abrirHistorial(t.id)}>Historial</button>
      <button class="mini ghost" onclick={() => nuevaEval(t.id)}>Evaluar</button>
     </td>
    </tr>
   {/each}
   </tbody>
  </table>
 </section>
 {/if}

 <!-- ===== NUEVA EVALUACIÓN ===== -->
 {#if esAdmin && vista === 'nueva'}
 <section class="card">
  <h3>Nueva evaluación de desempeño</h3>
  <div class="form-grid">
   <label>Empleado
    <select bind:value={selEmp} onchange={cargarMetricas}>
     <option value="">— Seleccionar —</option>
     {#each trabajadores as t}<option value={t.id}>{t.nombre || t.email}{t.profesion ? ' — ' + t.profesion : ''}</option>{/each}
    </select>
   </label>
   <label>Periodo
    <select bind:value={form.periodo} onchange={() => { const f = periodoFechas(); form.fecha_inicio = f.desde; form.fecha_fin = f.hasta; cargarMetricas(); }}>
     <option value="mensual">Mensual</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option>
    </select>
   </label>
   <label>Desde<input type="date" bind:value={form.fecha_inicio} onchange={cargarMetricas} /></label>
   <label>Hasta<input type="date" bind:value={form.fecha_fin} onchange={cargarMetricas} /></label>
  </div>

  {#if metricas}
   <div class="metricas">
    <p class="muted small"><strong>Datos automáticos del periodo</strong> (referencia para calificar — no son calificaciones):</p>
    <div class="m-grid">
     <div class="m-item"><b>{metricas.visitas.completadas}/{metricas.visitas.programadas + metricas.visitas.completadas + metricas.visitas.no_show}</b><span>Visitas realizadas</span></div>
     <div class="m-item"><b>{metricas.puntualidad_pct != null ? metricas.puntualidad_pct + '%' : '—'}</b><span>Puntualidad (GPS/QR)</span></div>
     <div class="m-item"><b>{metricas.cumplimiento_pct != null ? metricas.cumplimiento_pct + '%' : '—'}</b><span>Cumplimiento de agenda</span></div>
     <div class="m-item"><b>{metricas.notas.total}</b><span>Notas de evolución</span></div>
     <div class="m-item"><b>{metricas.evidencias}</b><span>Evidencias fotográficas</span></div>
     <div class="m-item"><b>{metricas.capacitaciones.length}</b><span>Capacitaciones</span></div>
     <div class="m-item"><b>{metricas.encuestas.promedio || '—'}</b><span>Satisfacción (1-5)</span></div>
    </div>
   </div>
  {/if}

  <h4>Calificación por indicador (1-5)</h4>
  {#each INDICADORES as [k, nombre]}
   <div class="ind-row">
    <span class="ind-name">{nombre}</span>
    <div class="ind-opts">
     {#each [1,2,3,4,5] as n}
      <label class="ind-opt" class:sel={form.calificaciones[k] === n}>
       <input type="radio" name="ev-{k}" value={n} checked={form.calificaciones[k] === n} onchange={() => form.calificaciones = { ...form.calificaciones, [k]: n }} />
       <span>{n}</span><em>{NIVELES[n]}</em>
      </label>
     {/each}
    </div>
   </div>
  {/each}
  {#if promedioCalc}<p class="score-line">Promedio: <strong>{promedioCalc}/5</strong> · {pctCalc}% · <strong>{resultadoDe(pctCalc)}</strong></p>{/if}

  <div class="form-grid">
   <label class="wide">Fortalezas<textarea bind:value={form.fortalezas} rows="2"></textarea></label>
   <label class="wide">Áreas de oportunidad<textarea bind:value={form.oportunidades} rows="2"></textarea></label>
   <label class="wide">Observaciones<textarea bind:value={form.observaciones} rows="2"></textarea></label>
   <label class="wide">Recomendaciones<textarea bind:value={form.recomendaciones} rows="2"></textarea></label>
  </div>
  <button onclick={guardarEval} disabled={!selEmp}>Guardar evaluación</button>
 </section>
 {/if}

 <!-- ===== HISTORIAL ===== -->
 {#if esAdmin && vista === 'historial'}
 <section class="card">
  <h3>Historial de evaluaciones</h3>
  {#if historial.length === 0}<p class="muted">Sin evaluaciones registradas.</p>{/if}
  {#if historial.length > 1}
   <svg class="graf" viewBox="0 0 280 80" preserveAspectRatio="none">
    <polyline points={puntosGrafica(historial)} fill="none" stroke="oklch(0.42 0.068 218)" stroke-width="2" />
   </svg>
   <p class="muted small">Evolución del promedio (1-5)</p>
  {/if}
  {#each historial as ev (ev.id)}
   <div class="ev-card">
    <div class="ev-head">
     <strong>{ev.periodo}</strong> · {ev.fecha_inicio} → {ev.fecha_fin}
     <span class="prom-chip">{ev.promedio}/5 · {ev.porcentaje}%</span>
     <span class="sem sem-{ev.porcentaje >= 80 ? 'ok' : ev.porcentaje >= 70 ? 'warn' : 'bad'}">{ev.resultado}</span>
     <button class="mini ghost" onclick={() => reportePDF(ev)}>PDF</button>
    </div>
    <table class="mini-tab">
     <thead><tr><th>Indicador</th><th>Nota</th></tr></thead>
     <tbody>{#each INDICADORES as [k, nombre]}<tr><td>{nombre}</td><td>{ev.calificaciones?.[k] ?? '—'}/5</td></tr>{/each}</tbody>
    </table>
    {#if ev.fortalezas}<p class="small"><strong>Fortalezas:</strong> {ev.fortalezas}</p>{/if}
    {#if ev.oportunidades}<p class="small"><strong>Oportunidades:</strong> {ev.oportunidades}</p>{/if}
    {#if ev.observaciones}<p class="small"><strong>Observaciones:</strong> {ev.observaciones}</p>{/if}
    {#if ev.recomendaciones}<p class="small"><strong>Recomendaciones:</strong> {ev.recomendaciones}</p>{/if}
   </div>
  {/each}
  <button class="ghost" onclick={() => vista = 'tablero'}>← Volver</button>
 </section>
 {/if}

 <!-- ===== PLANES DE MEJORA (admin) ===== -->
 {#if esAdmin && vista === 'planes'}
 <section class="card">
  <h3>Planes de mejora individual</h3>
  <div class="plan-form">
   <select bind:value={planForm.trabajador_id}>
    <option value="">— Empleado —</option>
    {#each trabajadores as t}<option value={t.id}>{t.nombre || t.email}</option>{/each}
   </select>
   <input bind:value={planForm.area} placeholder="Área a mejorar *" />
   <input bind:value={planForm.problema} placeholder="Problema identificado" />
   <input bind:value={planForm.objetivo} placeholder="Objetivo de mejora" />
   <textarea bind:value={planForm.actividades} rows="2" placeholder="Actividades correctivas"></textarea>
   <input type="date" bind:value={planForm.fecha_limite} title="Fecha límite" />
   <input bind:value={planForm.responsable} placeholder="Responsable del seguimiento" />
   <input type="date" bind:value={planForm.proxima_evaluacion} title="Próxima evaluación" />
   <button class="mini" onclick={crearPlan}>Crear plan</button>
  </div>
  {#each planes as p (p.id)}
   <div class="plan-card">
    <div class="ev-head"><strong>{p.perfiles?.nombre || p.trabajador_id}</strong> · {p.area} <span class="sem sem-{p.estado === 'completado' ? 'ok' : p.estado === 'en_proceso' ? 'warn' : 'bad'}">{p.estado.replace('_', ' ')}</span></div>
    {#if p.problema}<p class="small"><strong>Problema:</strong> {p.problema}</p>{/if}
    {#if p.objetivo}<p class="small"><strong>Objetivo:</strong> {p.objetivo}</p>{/if}
    {#if p.actividades}<p class="small"><strong>Actividades:</strong> {p.actividades}</p>{/if}
    <p class="muted small">{#if p.fecha_limite}Límite: {p.fecha_limite} · {/if}{#if p.responsable}Resp: {p.responsable} · {/if}{#if p.proxima_evaluacion}Próx. eval: {p.proxima_evaluacion}{/if}</p>
    <div class="acc">
     {#if p.estado === 'pendiente'}<button class="mini ghost" onclick={() => cambiarPlanEstado(p, 'en_proceso')}>Iniciar</button>{/if}
     {#if p.estado === 'en_proceso'}<button class="mini" onclick={() => cambiarPlanEstado(p, 'completado')}>Completar</button>{/if}
     {#if p.estado !== 'pendiente'}<button class="mini ghost" onclick={() => cambiarPlanEstado(p, 'pendiente')}>Reabrir</button>{/if}
    </div>
   </div>
  {:else}<p class="muted">Sin planes de mejora.</p>{/each}
 </section>
 {/if}

 <!-- ===== CAPACITACIONES (admin) ===== -->
 {#if esAdmin && vista === 'caps'}
 <section class="card">
  <h3>Capacitaciones del personal</h3>
  <div class="plan-form">
   <select bind:value={capsForm.trabajador_id}>
    <option value="">— Empleado —</option>
    {#each trabajadores as t}<option value={t.id}>{t.nombre || t.email}</option>{/each}
   </select>
   <input bind:value={capsForm.curso} placeholder="Curso / taller *" />
   <input type="date" bind:value={capsForm.fecha} />
   <input type="number" bind:value={capsForm.horas} placeholder="Horas" />
   <input bind:value={capsForm.tipo} placeholder="Tipo (curso/taller/charla)" />
   <button class="mini" onclick={registrarCap}>Registrar</button>
  </div>
  <table>
   <thead><tr><th>Fecha</th><th>Empleado</th><th>Curso</th><th>Horas</th><th>Tipo</th></tr></thead>
   <tbody>
   {#each capsLista as c (c.id)}
    <tr><td>{c.fecha}</td><td>{c.perfiles?.nombre || '—'}</td><td>{c.curso}</td><td>{c.horas || '—'}</td><td>{c.tipo || '—'}</td></tr>
   {:else}<tr><td colspan="5" class="muted">Sin capacitaciones registradas</td></tr>{/each}
   </tbody>
  </table>
 </section>
 {/if}

 <!-- ===== MIS EVALUACIONES (empleado) ===== -->
 {#if esEmpleado}
 {#each miEval as ev (ev.id)}
  <section class="card">
   <div class="ev-head">
    <h3>{ev.periodo} · {ev.fecha_inicio} → {ev.fecha_fin}</h3>
    <span class="prom-chip">{ev.promedio}/5 · {ev.porcentaje}%</span>
    <span class="sem sem-{ev.porcentaje >= 80 ? 'ok' : ev.porcentaje >= 70 ? 'warn' : 'bad'}">{ev.resultado}</span>
   </div>
   <table class="mini-tab">
    <thead><tr><th>Indicador</th><th>Calificación</th></tr></thead>
    <tbody>{#each INDICADORES as [k, nombre]}<tr><td>{nombre}</td><td>{ev.calificaciones?.[k] ?? '—'}/5 — {NIVELES[ev.calificaciones?.[k]] || ''}</td></tr>{/each}</tbody>
   </table>
   {#if ev.fortalezas}<p class="small"><strong>Fortalezas:</strong> {ev.fortalezas}</p>{/if}
   {#if ev.oportunidades}<p class="small"><strong>Áreas de oportunidad:</strong> {ev.oportunidades}</p>{/if}
   {#if ev.observaciones}<p class="small"><strong>Observaciones del directivo:</strong> {ev.observaciones}</p>{/if}
   {#if ev.recomendaciones}<p class="small"><strong>Recomendaciones:</strong> {ev.recomendaciones}</p>{/if}
   {#if !ev.revisada}
    <button class="mini" onclick={() => confirmarRevision(ev)}>Confirmar que revisé esta evaluación</button>
   {:else}
    <p class="muted small">✓ Revisada el {new Date(ev.revisada_at).toLocaleDateString('es-EC')}</p>
   {/if}
  </section>
 {:else}
  <section class="card center"><p class="muted">Aún no tienes evaluaciones de desempeño registradas.</p></section>
 {/each}

 {#if planes.filter(p => p.trabajador_id === perfil?.id).length}
 <section class="card">
  <h3>Mis planes de mejora</h3>
  {#each planes.filter(p => p.trabajador_id === perfil?.id) as p (p.id)}
   <div class="plan-card">
    <div class="ev-head"><strong>{p.area}</strong> <span class="sem sem-{p.estado === 'completado' ? 'ok' : p.estado === 'en_proceso' ? 'warn' : 'bad'}">{p.estado.replace('_', ' ')}</span></div>
    {#if p.objetivo}<p class="small"><strong>Objetivo:</strong> {p.objetivo}</p>{/if}
    {#if p.actividades}<p class="small"><strong>Actividades:</strong> {p.actividades}</p>{/if}
    {#if p.fecha_limite}<p class="muted small">Fecha límite: {p.fecha_limite}</p>{/if}
   </div>
  {/each}
 </section>
 {/if}
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
h3 { margin-top: 0; font-size: 1rem; } h4 { margin: 1rem 0 .5rem; font-size: .9rem; }
.tabs { display: flex; gap: .4rem; flex-wrap: wrap; }
.tabs button { background: oklch(0.94 0.02 85); color: oklch(0.4 0.05 225); }
.tabs button.active { background: oklch(0.42 0.068 218); color: #f2eee2; }
table { width: 100%; border-collapse: collapse; font-size: .82rem; }
th, td { text-align: left; padding: .45rem .4rem; border-bottom: 1px solid oklch(0.93 0.025 140); }
.acc { display: flex; gap: .3rem; }
.mini-tab th, .mini-tab td { font-size: .78rem; padding: .3rem .4rem; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: .6rem; margin: .6rem 0; }
.form-grid label { display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; font-weight: 600; }
.wide { grid-column: 1 / -1; }
.form-grid input, .form-grid select, .form-grid textarea { padding: .45rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .85rem; font-weight: 400; }
.metricas { background: oklch(0.98 0.008 140); border-radius: 10px; padding: .7rem .9rem; margin: .6rem 0; }
.m-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: .5rem; margin-top: .4rem; }
.m-item { background: #fff; border-radius: 8px; padding: .5rem .6rem; text-align: center; }
.m-item b { display: block; font-size: 1rem; }
.m-item span { font-size: .65rem; color: oklch(0.5 0.03 225); }
.ind-row { display: flex; align-items: center; gap: .8rem; padding: .4rem 0; border-bottom: 1px solid oklch(0.95 0.015 85); flex-wrap: wrap; }
.ind-name { flex: 1; min-width: 200px; font-size: .85rem; }
.ind-opts { display: flex; gap: .3rem; }
.ind-opt { display: flex; flex-direction: column; align-items: center; border: 1px solid oklch(0.88 0.02 85); border-radius: 8px; padding: .25rem .45rem; cursor: pointer; font-size: .75rem; }
.ind-opt.sel { background: oklch(0.42 0.068 218); color: #fff; border-color: oklch(0.42 0.068 218); }
.ind-opt input { display: none; }
.ind-opt em { font-style: normal; font-size: .6rem; opacity: .8; }
.score-line { font-size: .9rem; margin: .6rem 0; }
.ev-card, .plan-card { border: 1px solid oklch(0.92 0.02 140); border-radius: 10px; padding: .7rem .9rem; margin: .5rem 0; }
.ev-head { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
.prom-chip { background: oklch(0.42 0.068 218); color: #fff; border-radius: 999px; padding: .1rem .6rem; font-size: .75rem; }
.sem { font-size: .7rem; border-radius: 999px; padding: .1rem .55rem; }
.sem-ok { background: #d1e7dd; color: #0f5132; }
.sem-warn { background: #fff3cd; color: #664d03; }
.sem-bad { background: #f8d7da; color: #842029; }
.graf { width: 100%; height: 80px; }
.plan-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: .4rem; margin-bottom: .8rem; }
.plan-form input, .plan-form select, .plan-form textarea { padding: .4rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .82rem; }
button { padding:.5rem .9rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; font-family: inherit; }
button.mini { padding:.3rem .7rem; font-size:.78rem; }
button.ghost { background: transparent; color: oklch(0.4 0.05 225); border: 1px solid oklch(0.55 0.05 222); }
</style>
