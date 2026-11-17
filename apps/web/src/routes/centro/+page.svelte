<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';

 let perfil = $state(null);
 let loading = $state(true);
 let datos = $state(null);
 let error = $state('');
 let filtro = $state('mes'); // dia | semana | mes | anio
 let desde = $state('');
 let hasta = $state('');
 let profSel = $state('');
 let packSel = $state('');
 let pacientes = $state([]);
 let pagosLista = $state([]);
 let showPago = $state(false);
 let pagoForm = $state({ paciente_id: '', monto: '', fecha: '', metodo: '', estado: 'pagado', periodo: '', notas: '' });
 let pagoMsg = $state('');

 function iso(d) { return d.toISOString().slice(0, 10); }
 function rangoActual() {
  const h = new Date();
  if (filtro === 'dia') return { desde: iso(h), hasta: iso(h) };
  if (filtro === 'semana') { const f = new Date(h); f.setDate(h.getDate() - ((h.getDay() + 6) % 7)); return { desde: iso(f), hasta: iso(h) }; }
  if (filtro === 'anio') return { desde: `${h.getFullYear()}-01-01`, hasta: iso(h) };
  return { desde: `${h.toISOString().slice(0, 7)}-01`, hasta: iso(h) };
 }
 async function cargar() {
  loading = true; error = '';
  try {
   const { desde: d, hasta: h } = rangoActual();
   const qs = new URLSearchParams({ desde: d, hasta: h });
   if (profSel) qs.set('profesional', profSel);
   if (packSel) qs.set('paquete', packSel);
   datos = await api.centro(`?${qs}`);
   const [p, pg] = await Promise.all([api.pacientes().catch(() => ({ pacientes: [] })), api.pagos(`?desde=${d}&hasta=${h}`).catch(() => ({ pagos: [] }))]);
   pacientes = p.pacientes || [];
   pagosLista = pg.pagos || [];
  } catch (e) { error = e.message; }
  finally { loading = false; }
 }

 async function registrarPago() {
  pagoMsg = '';
  try {
   await api.crearPago({ ...pagoForm, monto: Number(pagoForm.monto) });
   pagoMsg = 'Pago registrado';
   showPago = false;
   pagoForm = { paciente_id: '', monto: '', fecha: iso(new Date()), metodo: '', estado: 'pagado', periodo: '', notas: '' };
   await cargar();
  } catch (e) { pagoMsg = e.message; }
 }
 async function togglePago(p) {
  try { await api.actualizarPago(p.id, { estado: p.estado === 'pagado' ? 'pendiente' : 'pagado' }); await cargar(); }
  catch (e) { error = e.message; }
 }

 // --- Gráficas SVG ---
 function barrasVisitas() {
  const entries = Object.entries(datos?.visitasPorDia || {}).sort();
  if (!entries.length) return null;
  const max = Math.max(...entries.map(([, v]) => v));
  const W = 600, H = 120, bw = Math.max(8, Math.floor(W / entries.length) - 4);
  return entries.map(([f, v], i) => {
   const bh = Math.round((v / max) * (H - 20));
   const x = i * (bw + 4);
   return `<rect x="${x}" y="${H - bh}" width="${bw}" height="${bh}" rx="2" fill="oklch(0.42 0.068 218)"><title>${f}: ${v}</title></rect>`;
  }).join('');
 }
 function torta() {
  const entries = Object.entries(datos?.pacientes?.porPaquete || {});
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) return null;
  const colors = ['oklch(0.42 0.068 218)', 'oklch(0.7 0.1 78)', 'oklch(0.55 0.12 160)', 'oklch(0.6 0.15 30)', 'oklch(0.5 0.1 300)', 'oklch(0.45 0.03 225)'];
  const R = 40, cx = 50, cy = 50;
  let acc = 0;
  const paths = entries.map(([nom, v], i) => {
   const frac = v / total;
   const a0 = acc * Math.PI * 2 - Math.PI / 2;
   acc += frac;
   const a1 = acc * Math.PI * 2 - Math.PI / 2;
   const large = frac > 0.5 ? 1 : 0;
   const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
   const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
   return `<path d="M${cx},${cy} L${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} Z" fill="${colors[i % colors.length]}" stroke="#fff" stroke-width="1"><title>${nom}: ${v}</title></path>`;
  }).join('');
  const leyenda = entries.map(([nom, v], i) => `<div class="ley"><span class="dot" style="background:${colors[i % colors.length]}"></span>${nom}: ${v}</div>`).join('');
  return { svg: `<svg viewBox="0 0 100 100" style="width:110px;height:110px">${paths}</svg>`, leyenda };
 }
 const tortaData = $derived(datos ? torta() : null);

 function fmtMoney(n) { return `$${Number(n || 0).toFixed(2)}`; }
 function exportarCSV() {
  if (!datos) return;
  const rows = [
   ['Sección', 'Indicador', 'Valor'],
   ['Pacientes', 'Total', datos.pacientes.total],
   ['Pacientes', 'Activos', datos.pacientes.activos],
   ['Pacientes', 'Inactivos', datos.pacientes.inactivos],
   ['Pacientes', 'Nuevos en periodo', datos.pacientes.nuevos],
   ['Empleados', 'Total', datos.empleados.total],
   ['Empleados', 'Activos', datos.empleados.activos],
   ['Visitas', 'Programadas', datos.empleados.programadas],
   ['Visitas', 'Completadas', datos.empleados.completadas],
   ['Visitas', 'Cumplimiento horarios %', datos.empleados.cumplimiento_horarios ?? ''],
   ['Finanzas', 'Cobrado', datos.finanzas.cobrado],
   ['Finanzas', 'Pendiente', datos.finanzas.pendiente],
   ['Finanzas', 'Proyección', datos.finanzas.proyeccion],
   ['Calidad', 'Valoraciones', datos.calidad.valoraciones],
   ['Calidad', 'Notas evolución', datos.calidad.notas],
   ['Calidad', 'Alertas rojas', datos.calidad.alertasRojas]
  ];
  const csv = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `centro-inteligencia-${datos.periodo.desde}_${datos.periodo.hasta}.csv`;
  a.click();
 }
 function reportePDF() {
  const w = window.open('', '_blank');
  const d = datos;
  w.document.write(`<html><head><title>Centro de Inteligencia</title>
   <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem}
   h1{font-size:1.2rem}h2{font-size:1rem;margin-top:1.4rem}.grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
   .k{border:1px solid #ddd;border-radius:8px;padding:.5rem .8rem}.k b{display:block;font-size:1.1rem}.k span{font-size:.75rem;color:#555}
table{width:100%;border-collapse:collapse;font-size:.8rem}th,td{border:1px solid #ccc;padding:.3rem .5rem;text-align:left}
.nota{font-size:.72rem;color:#555;margin-top:2rem}</style></head><body>
   <h1>Agencia Gerontológica Integral — Centro de Inteligencia</h1>
   <p>Periodo: ${d.periodo.desde} a ${d.periodo.hasta} · Generado: ${new Date().toLocaleString('es-EC')}</p>
   <h2>Pacientes</h2><div class="grid">
    <div class="k"><b>${d.pacientes.total}</b><span>Total</span></div>
    <div class="k"><b>${d.pacientes.activos}</b><span>Activos</span></div>
    <div class="k"><b>${d.pacientes.inactivos}</b><span>Inactivos</span></div>
    <div class="k"><b>${d.pacientes.nuevos}</b><span>Nuevos</span></div></div>
   <h2>Empleados</h2><div class="grid">
    <div class="k"><b>${d.empleados.total}</b><span>Total</span></div>
    <div class="k"><b>${d.empleados.activos}</b><span>Activos</span></div>
    <div class="k"><b>${d.empleados.completadas}</b><span>Visitas completadas</span></div>
    <div class="k"><b>${d.empleados.cumplimiento_horarios ?? '—'}%</b><span>Cumplimiento horarios</span></div></div>
   <h2>Finanzas</h2><div class="grid">
    <div class="k"><b>${fmtMoney(d.finanzas.cobrado)}</b><span>Cobrado</span></div>
    <div class="k"><b>${fmtMoney(d.finanzas.pendiente)}</b><span>Pendiente</span></div>
    <div class="k"><b>${fmtMoney(d.finanzas.proyeccion)}</b><span>Proyección mensual</span></div></div>
   <h2>Calidad</h2><div class="grid">
    <div class="k"><b>${d.calidad.valoraciones}</b><span>Valoraciones</span></div>
    <div class="k"><b>${d.calidad.notas}</b><span>Notas de evolución</span></div>
    <div class="k"><b>${d.calidad.alertasRojas}</b><span>Alertas rojas abiertas</span></div>
    <div class="k"><b>${d.calidad.alertasAmarillas}</b><span>Alertas amarillas</span></div></div>
   <p class="nota">Reporte administrativo generado desde registros reales de la plataforma. Ingresos cobrados ≠ proyección.</p>
   </body></html>`);
  w.document.close();
  w.print();
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

<svelte:head><title>Centro de Inteligencia — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil || perfil.rol !== 'admin'}
 <main class="card center"><h1>Acceso restringido</h1><p class="muted">El Centro de Inteligencia es exclusivo del directivo.</p><a class="ghost link" href="/">Volver</a></main>
{:else if datos}
<header>
 <a class="brand" href="/">
  <img src="/logo.png" alt="Agencia Gerontológica Integral" />
  <div class="brand-text">
   <span class="agency">Agencia Gerontológica Integral</span>
   <h1>Centro de Inteligencia</h1>
  </div>
 </a>
 <div>
  <span class="badge">{perfil.email} · Directivo</span>
  <a class="ghost link" href="/">Volver</a>
  <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="layout">
 <!-- Filtros -->
 <section class="card filtros">
  <div class="f-row">
   <div class="seg">
    {#each [['dia','Día'],['semana','Semana'],['mes','Mes'],['anio','Año']] as [k,l]}
     <button class:active={filtro === k} onclick={() => { filtro = k; cargar(); }}>{l}</button>
    {/each}
   </div>
   <select bind:value={profSel} onchange={cargar}>
    <option value="">Todos los profesionales</option>
    {#each datos.filtros.profesionales as t}<option value={t.id}>{t.nombre}</option>{/each}
   </select>
   <select bind:value={packSel} onchange={cargar}>
    <option value="">Todos los paquetes</option>
    {#each datos.filtros.paquetes as k}<option value={k.id}>{k.nombre}</option>{/each}
   </select>
   <span class="muted small">{datos.periodo.desde} → {datos.periodo.hasta}</span>
   <button class="mini ghost" onclick={cargar}>↻</button>
  </div>
  <div class="f-row">
   <button class="mini" onclick={exportarCSV}>⬇ Excel (CSV)</button>
   <button class="mini" onclick={reportePDF}>🖨️ Reporte PDF</button>
   <button class="mini ghost" onclick={() => showPago = !showPago}>+ Registrar pago</button>
  </div>
  {#if showPago}
   <div class="pago-form">
    <select bind:value={pagoForm.paciente_id}>
     <option value="">— Paciente —</option>
     {#each pacientes as p}<option value={p.id}>{p.nombre} {p.apellido}</option>{/each}
    </select>
    <input type="number" step="0.01" min="0" bind:value={pagoForm.monto} placeholder="Monto $" />
    <input type="date" bind:value={pagoForm.fecha} />
    <select bind:value={pagoForm.metodo}>
     <option value="">Método</option><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option>
    </select>
    <select bind:value={pagoForm.estado}><option value="pagado">Pagado</option><option value="pendiente">Pendiente</option></select>
    <input bind:value={pagoForm.periodo} placeholder="Periodo (ej: 2025-01)" />
    <button class="mini" onclick={registrarPago}>Guardar</button>
    {#if pagoMsg}<span class="muted small">{pagoMsg}</span>{/if}
   </div>
  {/if}
 </section>

 <!-- PACIENTES -->
 <section class="card">
  <h3>👥 Pacientes</h3>
  <div class="kpis">
   <div class="kpi"><b>{datos.pacientes.total}</b><span>Total</span></div>
   <div class="kpi"><b>{datos.pacientes.activos}</b><span>Activos</span></div>
   <div class="kpi"><b>{datos.pacientes.inactivos}</b><span>Inactivos</span></div>
   <div class="kpi"><b>{datos.pacientes.nuevos}</b><span>Nuevos</span></div>
  </div>
  {#if datos.pacientes.proximosVencer.length}
   <p class="warn small">⚠️ Paquetes próximos a vencer: {datos.pacientes.proximosVencer.map((p) => `${p.nombre} (${p.dias_restantes}d)`).join(' · ')}</p>
  {/if}
  {#if tortaData}
   <div class="chart-row">
    {@html tortaData.svg}
    <div class="leyenda">{#each Object.entries(datos.pacientes.porPaquete) as [nom, v]}<div class="ley"><span class="dot"></span>{nom}: {v}</div>{/each}</div>
   </div>
  {/if}
 </section>

 <!-- EMPLEADOS -->
 <section class="card">
  <h3>🧑‍⚕️ Empleados</h3>
  <div class="kpis">
   <div class="kpi"><b>{datos.empleados.total}</b><span>Total</span></div>
   <div class="kpi"><b>{datos.empleados.activos}</b><span>Activos</span></div>
   <div class="kpi"><b>{datos.empleados.programadas}</b><span>Visitas programadas</span></div>
   <div class="kpi"><b>{datos.empleados.completadas}</b><span>Completadas</span></div>
   <div class="kpi"><b>{datos.empleados.cumplimiento_horarios ?? '—'}%</b><span>Cumplimiento</span></div>
   <div class="kpi warn"><b>{datos.empleados.incidencias}</b><span>Incidencias</span></div>
  </div>
  {#if Object.keys(datos.empleados.porProfesional).length}
   <table class="mini-tab">
    <thead><tr><th>Profesional</th><th>Visitas en periodo</th></tr></thead>
    <tbody>{#each Object.entries(datos.empleados.porProfesional).sort((a,b)=>b[1]-a[1]) as [n,c]}<tr><td>{n}</td><td>{c}</td></tr>{/each}</tbody>
   </table>
  {/if}
 </section>

 <!-- FINANZAS -->
 <section class="card">
  <h3>💰 Finanzas</h3>
  <div class="kpis">
   <div class="kpi ok"><b>{fmtMoney(datos.finanzas.cobrado)}</b><span>Cobrado</span></div>
   <div class="kpi warn"><b>{fmtMoney(datos.finanzas.pendiente)}</b><span>Pendiente</span></div>
   <div class="kpi"><b>{fmtMoney(datos.finanzas.proyeccion)}</b><span>Proyección/mes</span></div>
   <div class="kpi"><b>{datos.finanzas.totalPagos}</b><span>Registros</span></div>
  </div>
  <p class="muted small">💡 Cobrado = pagos marcados como pagados. Proyección = suma de paquetes activos vigentes (no es ingreso real aún).</p>
  {#if Object.keys(datos.finanzas.cobradoPorPaquete).length}
   <table class="mini-tab">
    <thead><tr><th>Paquete</th><th>Cobrado</th></tr></thead>
    <tbody>{#each Object.entries(datos.finanzas.cobradoPorPaquete) as [n,v]}<tr><td>{n}</td><td>{fmtMoney(v)}</td></tr>{/each}</tbody>
   </table>
  {/if}
  {#if pagosLista.length}
   <h4>Pagos recientes</h4>
   <table class="mini-tab">
    <thead><tr><th>Fecha</th><th>Paciente</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
    <tbody>
    {#each pagosLista.slice(0, 10) as p (p.id)}
     <tr>
      <td>{p.fecha}</td>
      <td>{p.pacientes?.nombre} {p.pacientes?.apellido}</td>
      <td>{fmtMoney(p.monto)}</td>
      <td><span class="estado estado-{p.estado}">{p.estado}</span></td>
      <td><button class="mini ghost" onclick={() => togglePago(p)}>{p.estado === 'pagado' ? 'Pendiente' : 'Pagado'}</button></td>
     </tr>
    {/each}
    </tbody>
   </table>
  {/if}
 </section>

 <!-- CALIDAD -->
 <section class="card">
  <h3>✅ Calidad asistencial</h3>
  <div class="kpis">
   <div class="kpi"><b>{datos.calidad.valoraciones}</b><span>Valoraciones</span></div>
   <div class="kpi"><b>{datos.calidad.notas}</b><span>Notas de evolución</span></div>
   <div class="kpi"><b>{datos.calidad.pacientesConSeguimiento}</b><span>Pacientes con seguimiento</span></div>
   <div class="kpi warn"><b>{datos.calidad.alertasRojas}</b><span>Alertas rojas</span></div>
   <div class="kpi"><b>{datos.calidad.alertasAmarillas}</b><span>Alertas amarillas</span></div>
  </div>
 </section>

 <!-- GRÁFICAS -->
 <section class="card">
  <h3>📈 Visitas por día</h3>
  {#if barrasVisitas()}
   <svg viewBox="0 0 600 120" style="width:100%;height:120px">{@html barrasVisitas()}</svg>
  {:else}<p class="muted">Sin visitas en el periodo</p>{/if}
 </section>

 <section class="card">
  <h3>📊 Tendencia últimos 6 meses</h3>
  <table class="mini-tab">
   <thead><tr><th>Mes</th><th>Visitas</th><th>Ingresos cobrados</th></tr></thead>
   <tbody>
   {#each datos.tendencia as t}
    <tr><td>{t.mes}</td><td>{t.visitas}</td><td>{fmtMoney(t.ingresos)}</td></tr>
   {/each}
   </tbody>
  </table>
 </section>
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
.warn { color: oklch(0.6 0.15 40); }
.link { padding:.4rem.8rem; border: 1px solid oklch(0.45 0.03 225); border-radius: 8px; text-decoration: none; }
h3 { margin-top: 0; font-size: 1rem; } h4 { margin: .8rem 0 .4rem; font-size: .85rem; }
.f-row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin-bottom: .5rem; }
.seg { display: flex; gap: .2rem; }
.seg button { background: oklch(0.94 0.02 85); color: oklch(0.4 0.05 225); }
.seg button.active { background: oklch(0.42 0.068 218); color: #f2eee2; }
.f-row select { padding: .35rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .82rem; }
.pago-form { display: flex; gap: .4rem; flex-wrap: wrap; margin-top: .5rem; padding: .6rem; background: oklch(0.98 0.008 140); border-radius: 8px; }
.pago-form input, .pago-form select { padding: .35rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .82rem; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: .6rem; margin: .6rem 0; }
.kpi { background: oklch(0.98 0.008 140); border-radius: 10px; padding: .6rem .8rem; text-align: center; }
.kpi b { display: block; font-size: 1.15rem; }
.kpi span { font-size: .7rem; color: oklch(0.5 0.03 225); }
.kpi.ok b { color: oklch(0.4 0.08 160); }
.kpi.warn b { color: oklch(0.55 0.15 40); }
.mini-tab { width: 100%; border-collapse: collapse; font-size: .8rem; margin-top: .5rem; }
.mini-tab th, .mini-tab td { text-align: left; padding: .3rem .4rem; border-bottom: 1px solid oklch(0.93 0.025 140); }
.chart-row { display: flex; gap: 1rem; align-items: center; margin-top: .5rem; flex-wrap: wrap; }
.leyenda { font-size: .78rem; display: flex; flex-direction: column; gap: .2rem; }
.ley { display: flex; align-items: center; gap: .4rem; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: oklch(0.42 0.068 218); display: inline-block; }
.estado { padding:.1rem .45rem; border-radius: 999px; font-size:.7rem; }
.estado-pagado { background: #d1e7dd; color: #0f5132; }
.estado-pendiente { background: #fff3cd; color: #664d03; }
button { padding:.5rem .9rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; font-family: inherit; }
button.mini { padding:.3rem .7rem; font-size:.78rem; }
button.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.55 0.05 222); }
@media (max-width: 800px) { .layout { padding: .6rem; } header { padding: .7rem 1rem; } }
</style>
