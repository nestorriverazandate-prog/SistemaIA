<script>
 import { onMount, onDestroy } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';
 import 'leaflet/dist/leaflet.css';

 let perfil = $state(null);
 let loading = $state(true);
 let error = $state('');
 let msg = $state('');
 let data = $state(null);
 let capas = $state({ cobertura: true, servicios: true, necesidades: true, oportunidades: true });
 let mapaLista = $state(false);
 let map = null, L = null, capaGrupos = {};
 let selZona = $state(null);
 let pestana = $state('mapa');
 let formZona = $state({ nombre: '', lat: '', lng: '', descripcion: '' });
 let formServicio = $state({ nombre: '', tipo: '', zona: '', lat: '', lng: '', fuente: '' });
 let formNecesidad = $state({ zona: '', tipo: '', nivel: 3, fuente: '', nota: '' });
 let formDato = $state({ indicador: '', grupo: '', valor: '', unidad: '', fuente: '', anio: '' });

 const esAdmin = $derived(perfil?.rol === 'admin');
 const fmtN = (n) => n == null ? '—' : Number(n).toLocaleString('es-MX');
 function zonaMatch(z) { return (z || '').trim().toLowerCase(); }

 async function cargar() {
  error = '';
  try { data = await api.observatorioResumen(); dibujarMapa(); }
  catch (e) { error = e.message; }
 }

 function dibujarMapa() {
  if (!map || !data) return;
  for (const k of Object.keys(capaGrupos)) { map.removeLayer(capaGrupos[k]); }
  capaGrupos = {};
  const mk = (key) => { const g = L.layerGroup(); capaGrupos[key] = g; if (capas[key]) g.addTo(map); return g; };

  // Cobertura: círculos proporcionales al número de pacientes (agregado por zona, sin domicilios)
  const gCob = mk('cobertura');
  for (const z of data.zonas.filter((x) => x.lat != null)) {
    const radio = 300 + Math.sqrt(z.pacientes) * 350;
    L.circle([z.lat, z.lng], { radius: radio, color: '#135666', weight: 2, fillColor: '#135666', fillOpacity: 0.12 })
      .bindPopup(`<b>${z.zona}</b><br/>Pacientes: ${z.pacientes}<br/>Profesionales: ${z.profesionales}<br/>Visitas recientes registradas`)
      .addTo(gCob);
    L.marker([z.lat, z.lng]).bindTooltip(z.zona, { permanent: false }).addTo(gCob);
  }
  // Servicios externos
  const gSer = mk('servicios');
  const icono = (tipo) => L.divIcon({ className: 'obs-pin', html: `<div style="background:${tipo === 'hospital' ? '#b02a37' : tipo === 'centro_salud' ? '#1a7f4b' : tipo === 'residencia' ? '#7a3fa0' : '#135666'};color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">✚</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
  for (const s of data.servicios.filter((x) => x.lat != null)) {
    L.marker([s.lat, s.lng], { icon: icono(s.tipo) })
      .bindPopup(`<b>${s.nombre}</b><br/>${s.tipo || ''}${s.zona ? ' · ' + s.zona : ''}<br/><span class="muted">${s.fuente || ''}</span>`)
      .addTo(gSer);
  }
  // Necesidades: calor por zona (círculo según total de necesidades registradas)
  const gNec = mk('necesidades');
  const necPorZona = {};
  for (const n of data.necesidades) { const zn = (n.zona || 'General').trim(); necPorZona[zn] = (necPorZona[zn] || 0) + (n.nivel || 1); }
  for (const z of data.zonas.filter((x) => x.lat != null)) {
    const nivel = necPorZona[z.zona] || 0;
    if (!nivel) continue;
    L.circle([z.lat, z.lng], { radius: 500 + nivel * 120, color: '#e07b00', weight: 2, fillColor: '#e07b00', fillOpacity: 0.10 + Math.min(nivel / 20, 0.15) })
      .bindPopup(`<b>${z.zona}</b><br/>Necesidades registradas: ${nivel}`)
      .addTo(gNec);
  }
  // Oportunidades de expansión
  const gOpp = mk('oportunidades');
  for (const o of (data.oportunidades || []).filter((x) => x.lat != null)) {
    L.circleMarker([o.lat, o.lng], { radius: 10, color: '#2a9d8f', weight: 3, fillColor: '#2a9d8f', fillOpacity: 0.7 })
      .bindPopup(`<b>Oportunidad: ${o.zona}</b><br/>Pacientes: ${o.pacientes} · Sin cobertura plena`)
      .addTo(gOpp);
  }
  for (const z of (data.zonas_sin_cobertura || []).filter((x) => x.lat != null)) {
    L.circleMarker([z.lat, z.lng], { radius: 10, color: '#9b2226', weight: 3, fillColor: '#9b2226', fillOpacity: 0.7 })
      .bindPopup(`<b>Zona sin cobertura: ${z.nombre}</b><br/>Registrada en catálogo territorial`)
      .addTo(gOpp);
  }
}

 async function guardarZona() {
  try { await api.obsGuardarZona({ ...formZona, lat: formZona.lat === '' ? null : Number(formZona.lat), lng: formZona.lng === '' ? null : Number(formZona.lng) }); msg = 'Zona guardada'; formZona = { nombre: '', lat: '', lng: '', descripcion: '' }; await cargar(); }
  catch (e) { error = e.message; }
 }
 async function guardarServicio() {
  try { await api.obsGuardarServicio({ ...formServicio, lat: formServicio.lat === '' ? null : Number(formServicio.lat), lng: formServicio.lng === '' ? null : Number(formServicio.lng) }); msg = 'Servicio registrado'; formServicio = { nombre: '', tipo: '', zona: '', lat: '', lng: '', fuente: '' }; await cargar(); }
  catch (e) { error = e.message; }
 }
 async function guardarNecesidad() {
  try { await api.obsGuardarNecesidad(formNecesidad); msg = 'Necesidad registrada'; formNecesidad = { zona: '', tipo: '', nivel: 3, fuente: '', nota: '' }; await cargar(); }
  catch (e) { error = e.message; }
 }
 async function guardarDato() {
  try { await api.obsGuardarDato({ ...formDato, valor: Number(formDato.valor), anio: formDato.anio ? Number(formDato.anio) : null }); msg = 'Dato demográfico registrado'; formDato = { indicador: '', grupo: '', valor: '', unidad: '', fuente: '', anio: '' }; await cargar(); }
  catch (e) { error = e.message; }
 }
 async function eliminar(tabla, id) { try { await api.obsEliminar(tabla, id); await cargar(); } catch (e) { error = e.message; } }

 function exportarCSV() {
  if (!data) return;
  const rows = [['Zona','Pacientes','Profesionales','Servicios externos','Coordenadas']];
  for (const z of data.zonas) rows.push([z.zona, z.pacientes, z.profesionales, z.servicios_externos, z.lat != null ? `${z.lat},${z.lng}` : '—']);
  for (const s of data.servicios) rows.push(['SERVICIO: ' + s.nombre, '', '', s.tipo || '', `${s.lat ?? ''},${s.lng ?? ''}`]);
  const blob = new Blob(['﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'observatorio-territorial.csv'; a.click();
 }
 function imprimir() { window.print(); }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
   if (perfil?.rol !== 'admin') { loading = false; return; }
   await cargar();
   const el = document.getElementById('mapa-obs');
   L = (await import('leaflet')).default;
   map = L.map(el).setView([31.6904, -106.4250], 11); // Ciudad Juárez
   L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
   dibujarMapa();
   mapaLista = true;
   setTimeout(() => map.invalidateSize(), 300);
  } catch { setToken(null); }
  finally { loading = false; }
 });
 onDestroy(() => { if (map) { map.remove(); map = null; } });
 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Observatorio Gerontológico — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil || !esAdmin}
 <main class="card center"><h1>Acceso restringido</h1><p class="muted">Solo el directivo.</p><a class="ghost link" href="/">Volver</a></main>
{:else}
<header>
 <a class="brand" href="/">
  <img src="/logo.png" alt="Agencia Gerontológica Integral" />
  <div class="brand-text"><span class="agency">Agencia Gerontológica Integral</span><h1>Observatorio Gerontológico de Ciudad Juárez</h1></div>
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

 <!-- KPIs -->
 {#if data}
 <section class="card">
  <h3>Indicadores territoriales</h3>
  <div class="kpis">
   <div class="kpi"><b>{fmtN(data.kpis.pacientes)}</b><span>Pacientes registrados</span></div>
   <div class="kpi"><b>{data.kpis.zonas_con_cobertura}</b><span>Zonas con cobertura</span></div>
   <div class="kpi warn"><b>{data.kpis.zonas_sin_cobertura}</b><span>Zonas sin cobertura</span></div>
   <div class="kpi"><b>{data.kpis.servicios_externos}</b><span>Servicios externos</span></div>
   <div class="kpi"><b>{data.kpis.necesidades_registradas}</b><span>Necesidades registradas</span></div>
   <div class="kpi warn"><b>{data.kpis.datos_demograficos ? fmtN(data.kpis.datos_demograficos) : 'Pendiente'}</b><span>Datos demográficos oficiales</span></div>
  </div>
 </section>

 <!-- Pestañas -->
 <div class="tabs">
  {#each [['mapa','Mapa territorial'],['datos','Datos demográficos'],['gestion','Servicios y necesidades'],['analisis','Análisis y reportes']] as [k, t]}
   <button class="tab" class:active={pestana === k} onclick={() => pestana = k}>{t}</button>
  {/each}
 </div>

 {#if pestana === 'mapa'}
 <section class="card mapa-card">
  <div class="mapa-wrap">
   <div id="mapa-obs" class="mapa"></div>
   <aside class="panel">
    <h4>Capas</h4>
    {#each [['cobertura','Cobertura de la agencia'],['servicios','Servicios disponibles'],['necesidades','Necesidades gerontológicas'],['oportunidades','Oportunidades de expansión']] as [k, t]}
     <label class="capa"><input type="checkbox" bind:checked={capas[k]} onchange={dibujarMapa} /> {t}</label>
    {/each}
    <h4>Leyenda</h4>
    <ul class="leyenda">
     <li><i class="dot azul"></i> Cobertura (tamaño = pacientes)</li>
     <li><i class="dot rojo"></i> Hospital</li>
     <li><i class="dot verde"></i> Centro de salud</li>
     <li><i class="dot morado"></i> Residencia</li>
     <li><i class="dot azul2"></i> Otros servicios</li>
     <li><i class="dot naranja"></i> Necesidades (intensidad)</li>
     <li><i class="dot teal"></i> Oportunidad de expansión</li>
     <li><i class="dot rojo2"></i> Zona sin cobertura</li>
    </ul>
    <p class="muted small">Los círculos de cobertura muestran <strong>datos agregados por zona</strong>. No se muestran domicilios exactos ni datos personales.</p>
   </aside>
  </div>
 </section>

 <!-- Ficha de zona seleccionada (clic en popup ya muestra resumen; aquí tabla completa) -->
 <section class="card">
  <h3>Zonas con cobertura ({data.zonas.length})</h3>
  <div class="tabla-scroll"><table>
   <thead><tr><th>Zona</th><th>Pacientes</th><th>Profesionales</th><th>Servicios externos</th><th>Top servicios</th><th>Necesidades</th></tr></thead>
   <tbody>
    {#each data.zonas as z}
     <tr onclick={() => selZona = z} class="fila-zona">
      <td><strong>{z.zona}</strong></td>
      <td>{z.pacientes}</td><td>{z.profesionales}</td><td>{z.servicios_externos}</td>
      <td class="muted small">{z.top_servicios.map(([s, n]) => `${s.replace('paquete:', '')} (${n})`).join(', ') || '—'}</td>
      <td class="muted small">{Object.keys(z.necesidades).length ? Object.entries(z.necesidades).map(([t, n]) => `${t} (${n})`).join(', ') : '—'}</td>
     </tr>
    {/each}
   </tbody>
  </table></div>
 </section>
 {:else if pestana === 'datos'}
 <section class="card">
  <h3>Indicadores demográficos de la población adulta mayor</h3>
  {#if data.datos_demograficos.length}
   <table><thead><tr><th>Indicador</th><th>Grupo</th><th>Valor</th><th>Fuente</th><th>Año</th></tr></thead>
   <tbody>{#each data.datos_demograficos as d}
    <tr><td>{d.indicador}</td><td>{d.grupo || '—'}</td><td>{d.valor} {d.unidad || ''}</td><td class="muted small">{d.fuente || '—'}</td><td>{d.anio || '—'}</td></tr>
   {/each}</tbody></table>
  {:else}
   <p class="muted">No hay datos demográficos oficiales registrados. Para mostrar cifras reales de INEGI, CONAPO, COESPO o IMIP, regístralas abajo con su fuente y año. <strong>No se muestran estimaciones sin fuente verificable.</strong></p>
  {/if}
  <h4>Registrar dato oficial</h4>
  <div class="form-grid">
   <input bind:value={formDato.indicador} placeholder="Indicador (ej: Población 60+)" />
   <input bind:value={formDato.grupo} placeholder="Grupo (ej: mujeres, 80-89)" />
   <input bind:value={formDato.valor} placeholder="Valor" type="number" step="any" />
   <input bind:value={formDato.unidad} placeholder="Unidad (personas, %, etc.)" />
   <input bind:value={formDato.fuente} placeholder="Fuente (INEGI, CONAPO…)" />
   <input bind:value={formDato.anio} placeholder="Año" type="number" />
   <button class="mini" onclick={guardarDato}>Agregar dato</button>
  </div>
 </section>
 {:else if pestana === 'gestion'}
 <div class="grid2">
  <section class="card">
   <h3>Servicios de atención al adulto mayor</h3>
   {#each data.servicios as s}
    <div class="item"><strong>{s.nombre}</strong> <span class="muted small">{s.tipo}{s.zona ? ' · ' + s.zona : ''}</span>
     <button class="mini ghost" onclick={() => eliminar('servicios', s.id)}>Quitar</button></div>
   {:else}<p class="muted">Sin servicios registrados.</p>{/each}
   <h4>Registrar servicio</h4>
   <div class="form-grid">
    <input bind:value={formServicio.nombre} placeholder="Nombre (ej: Hospital General)" />
    <select bind:value={formServicio.tipo}>{#each data.tipos_servicio as t}<option value={t}>{t}</option>{/each}</select>
    <input bind:value={formServicio.zona} placeholder="Zona / colonia" />
    <input bind:value={formServicio.lat} placeholder="Lat" type="number" step="any" />
    <input bind:value={formServicio.lng} placeholder="Lng" type="number" step="any" />
    <input bind:value={formServicio.fuente} placeholder="Fuente" />
    <button class="mini" onclick={guardarServicio}>Agregar servicio</button>
   </div>
   <p class="muted small">Tip: para obtener coordenadas, busca el lugar en Google Maps y copia el punto (clic derecho → las coordenadas aparecen en el enlace).</p>
  </section>

  <section class="card">
   <h3>Necesidades gerontológicas por zona</h3>
   {#each data.necesidades.slice(0, 30) as n}
    <div class="item"><strong>{n.tipo}</strong> <span class="muted small">{n.zona || 'General'} · nivel {n.nivel || '—'}{n.fuente ? ' · ' + n.fuente : ''}</span>
     <button class="mini ghost" onclick={() => eliminar('necesidades', n.id)}>Quitar</button></div>
   {:else}<p class="muted">Sin necesidades registradas.</p>{/each}
   <h4>Registrar necesidad</h4>
   <div class="form-grid">
    <input bind:value={formNecesidad.zona} placeholder="Zona / colonia" />
    <select bind:value={formNecesidad.tipo}>{#each data.tipos_necesidad as t}<option value={t}>{t.replace(/_/g, ' ')}</option>{/each}</select>
    <select bind:value={formNecesidad.nivel}>{#each [1,2,3,4,5] as n}<option value={n}>{n}</option>{/each}</select>
    <input bind:value={formNecesidad.fuente} placeholder="Fuente (oficial/estudio/encuesta interna)" />
    <input bind:value={formNecesidad.nota} placeholder="Nota" />
    <button class="mini" onclick={guardarNecesidad}>Agregar necesidad</button>
   </div>
   <h4>Zonas del catálogo</h4>
   {#each data.catalogo_zonas as z}
    <div class="item"><strong>{z.nombre}</strong> <span class="muted small">{z.tipo}{z.lat != null ? ' · ' + Number(z.lat).toFixed(4) + ', ' + Number(z.lng).toFixed(4) : ''}</span></div>
   {:else}<p class="muted">Sin zonas en catálogo. Registra colonias/sectores con coordenadas para verlas en el mapa.</p>{/each}
   <h4>Nueva zona</h4>
   <div class="form-grid">
    <input bind:value={formZona.nombre} placeholder="Nombre de la zona" />
    <input bind:value={formZona.lat} placeholder="Lat" type="number" step="any" />
    <input bind:value={formZona.lng} placeholder="Lng" type="number" step="any" />
    <input bind:value={formZona.descripcion} placeholder="Descripción" />
    <button class="mini" onclick={guardarZona}>Agregar zona</button>
   </div>
  </section>
 </div>
 {:else}
 <section class="card">
  <h3>Análisis de oportunidades de expansión</h3>
  <p class="muted small">Puntuación indicativa = pacientes × 2 + profesionales asignados + bonus si no hay servicios externos. <strong>Es una señal de análisis, no una conclusión:</strong> verifica con datos de campo antes de decidir.</p>
  <table><thead><tr><th>Zona</th><th>Pacientes</th><th>Profesionales</th><th>Servicios externos</th><th>Puntaje</th></tr></thead>
   <tbody>{#each data.oportunidades as o}<tr><td><strong>{o.zona}</strong></td><td>{o.pacientes}</td><td>{o.profesionales}</td><td>{o.servicios_externos}</td><td><b>{o.score}</b></td></tr>{/each}</tbody></table>
  {#if data.zonas_sin_cobertura.length}
   <h4>Zonas del catálogo sin cobertura de la agencia</h4>
   <table><thead><tr><th>Zona</th><th>Tipo</th></tr></thead>
   <tbody>{#each data.zonas_sin_cobertura as z}<tr><td>{z.nombre}</td><td>{z.tipo}</td></tr>{/each}</tbody></table>
  {/if}
  <div class="acciones-top">
   <button class="mini" onclick={exportarCSV}>Descargar Excel (CSV)</button>
   <button class="mini ghost" onclick={imprimir}>Informe PDF (imprimir)</button>
  </div>
 </section>
 {/if}
 {/if}
</main>

<!-- Ficha de zona -->
{#if selZona}
<div class="overlay" role="presentation" onclick={() => selZona = null}>
 <div class="sheet" onclick={(e) => e.stopPropagation()}>
  <div class="sheet-head"><h3>{selZona.zona}</h3><button class="mini ghost" onclick={() => selZona = null}>✕</button></div>
  <table class="mini-tab">
   <tbody>
    <tr><td>Pacientes atendidos</td><td><b>{selZona.pacientes}</b></td></tr>
    <tr><td>Profesionales asignados</td><td><b>{selZona.profesionales}</b></td></tr>
    <tr><td>Servicios externos cercanos</td><td><b>{selZona.servicios_externos}</b></td></tr>
    <tr><td>Servicios más solicitados</td><td>{selZona.top_servicios.map(([s, n]) => `${s} (${n})`).join(', ') || '—'}</td></tr>
    <tr><td>Necesidades registradas</td><td>{Object.keys(selZona.necesidades).length ? Object.entries(selZona.necesidades).map(([t, n]) => `${t} (${n})`).join(', ') : 'Sin datos — pendiente de integración'}</td></tr>
   </tbody>
  </table>
  <p class="muted small">Datos agregados por zona. Los domicilios exactos no se muestran en este módulo.</p>
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
.layout { padding: 1rem 2rem; max-width: 1250px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }
.muted { color: oklch(0.45 0.03 225); font-size:.85rem; }
.small { font-size:.78rem; }
.error { color: oklch(0.55 0.2 27); font-size:.85rem; }
.ok { color: oklch(0.45 0.08 160); font-size:.85rem; }
.warn { color: oklch(0.6 0.15 40); }
.link { padding:.4rem.8rem; border: 1px solid oklch(0.45 0.03 225); border-radius: 8px; text-decoration: none; }
h3 { margin-top: 0; font-size: 1rem; } h4 { margin: .9rem 0 .4rem; font-size: .85rem; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .6rem; margin: .6rem 0; }
.kpi { background: oklch(0.98 0.008 140); border-radius: 10px; padding: .6rem .8rem; text-align: center; }
.kpi b { display: block; font-size: 1.15rem; }
.kpi span { font-size: .7rem; color: oklch(0.5 0.03 225); }
.kpi.warn b { color: oklch(0.55 0.15 40); }
.tabs { display: flex; gap: .4rem; flex-wrap: wrap; }
.tab { background: transparent; color: oklch(0.45 0.03 225); border: 1px solid oklch(0.8 0.02 85); }
.tab.active { background: oklch(0.42 0.068 218); color: #fff; border-color: oklch(0.42 0.068 218); }
.mapa-card { padding: .6rem; }
.mapa-wrap { display: flex; gap: .8rem; height: 560px; }
.mapa { flex: 1; border-radius: 10px; min-height: 400px; }
.panel { width: 240px; flex-shrink: 0; border-left: 1px solid oklch(0.92 0.02 140); padding-left: .8rem; overflow-y: auto; }
.capa { display: flex; gap: .4rem; align-items: center; font-size: .85rem; margin: .25rem 0; }
.leyenda { list-style: none; padding: 0; font-size: .78rem; }
.leyenda li { display: flex; align-items: center; gap: .4rem; margin: .2rem 0; }
.dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
.azul { background: #135666; opacity: .5; } .rojo { background: #b02a37; } .verde { background: #1a7f4b; } .morado { background: #7a3fa0; }
.azul2 { background: #135666; } .naranja { background: #e07b00; opacity: .6; } .teal { background: #2a9d8f; } .rojo2 { background: #9b2226; }
.tabla-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: .82rem; }
th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid oklch(0.93 0.025 140); }
.fila-zona { cursor: pointer; } .fila-zona:hover { background: oklch(0.97 0.01 140); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 900px) { .grid2, .mapa-wrap { grid-template-columns: 1fr; flex-direction: column; height: auto; } .mapa { height: 380px; } .panel { width: 100%; border-left: 0; border-top: 1px solid oklch(0.92 0.02 140); padding: .8rem 0 0; } }
.item { display: flex; gap: .5rem; align-items: center; padding: .3rem 0; border-bottom: 1px solid oklch(0.95 0.015 140); font-size: .85rem; }
.item strong { flex: 1; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: .4rem; margin-top: .4rem; }
.form-grid input, .form-grid select { padding: .4rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .82rem; }
.acciones-top { display: flex; gap: .5rem; margin-top: .6rem; }
.mini-tab td { padding: .3rem .4rem; }
.overlay { position: fixed; inset: 0; background: oklch(0.2 0.03 260 / .5); display: flex; align-items: flex-start; justify-content: center; z-index: 60; padding: 1.5rem 1rem; }
.sheet { background: #fff; border-radius: 14px; padding: 1.25rem 1.5rem; max-width: 560px; width: 100%; }
.sheet-head { display: flex; justify-content: space-between; align-items: center; }
.sheet-head h3 { margin: 0; }
button { padding:.5rem .9rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; font-family: inherit; }
button.mini { padding:.3rem .7rem; font-size:.78rem; }
button.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.55 0.05 222); }
@media print { header div:not(.brand), .tabs, .acciones-top, .panel, .form-grid { display: none !important; } .mapa-wrap { height: 500px; } }
</style>
