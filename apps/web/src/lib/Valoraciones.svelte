<script>
 import { onMount } from 'svelte';
 import { api } from '$lib/api';

 let { pacienteId } = $props();

 let valoraciones = $state([]);
 let loading = $state(true);
 let error = $state('');
 let msg = $state('');
 let formEscala = $state('');
 let formFecha = $state(new Date().toISOString().slice(0, 10));
 let formNotas = $state('');
 let formResp = $state({});
 let guardando = $state(false);
 let perfil = $state(null);

 // ---------- Definición de escalas validadas ----------
 // items: { k: clave, t: texto, o: [[etiqueta, puntos], ...] }  — se puntúa por opción
 const ESCALAS = {
  barthel: {
   nombre: 'Índice de Barthel',
   desc: 'Actividades básicas de la vida diaria (0-100). Mayor puntaje = mayor independencia.',
   max: 100,
   items: [
    { k: 'alimentacion', t: 'Alimentación', o: [['Independiente', 10], ['Necesita ayuda', 5], ['Dependiente', 0]] },
    { k: 'aseo', t: 'Aseo personal', o: [['Independiente', 5], ['Necesita ayuda', 0]] },
    { k: 'retrete', t: 'Uso del retrete', o: [['Independiente', 10], ['Necesita algo de ayuda', 5], ['Dependiente', 0]] },
    { k: 'transferencias', t: 'Transferencias (cama-silla)', o: [['Independiente', 15], ['Algo de ayuda', 10], ['Ayuda importante', 5], ['Dependiente', 0]] },
    { k: 'deambulacion', t: 'Deambulación', o: [['Independiente', 15], ['Usa dispositivo de ayuda', 10], ['Ayuda importante', 5], ['Silla de ruedas', 0]] },
    { k: 'escaleras', t: 'Subir escaleras', o: [['Independiente', 10], ['Necesita ayuda', 5], ['No puede', 0]] },
    { k: 'vestido', t: 'Vestido', o: [['Independiente', 10], ['Necesita ayuda', 5], ['Dependiente', 0]] },
    { k: 'arreglo', t: 'Arreglo personal (cabello, afeitado, etc.)', o: [['Independiente', 5], ['Necesita ayuda', 0]] },
    { k: 'deposiciones', t: 'Control de deposiciones', o: [['Continente', 10], ['Incontinencia ocasional', 5], ['Incontinencia', 0]] },
    { k: 'miccion', t: 'Control de micción', o: [['Continente', 10], ['Incontinencia ocasional', 5], ['Incontinencia o sonda', 0]] }
   ],
   interpretar: (p) => p >= 100 ? 'Independiente en todas las actividades' : p >= 91 ? 'Dependencia leve' : p >= 61 ? 'Dependencia moderada' : p >= 21 ? 'Dependencia grave' : 'Dependencia total'
  },
  lawton: {
   nombre: 'Lawton y Brody',
   desc: 'Actividades instrumentales de la vida diaria (0-8).',
   max: 8,
   items: [
    { k: 'telefono', t: 'Uso del teléfono', o: [['Independiente', 1], ['Necesita ayuda', 0]] },
    { k: 'compras', t: 'Realizar compras', o: [['Independiente', 1], ['Necesita ayuda', 0]] },
    { k: 'comida', t: 'Preparar la comida', o: [['Independiente', 1], ['Necesita ayuda', 0]] },
    { k: 'casa', t: 'Cuidado de la casa', o: [['Independiente', 1], ['Necesita ayuda', 0]] },
    { k: 'lavanderia', t: 'Lavado de ropa', o: [['Independiente', 1], ['Necesita ayuda', 0]] },
    { k: 'transporte', t: 'Medios de transporte', o: [['Independiente', 1], ['Necesita ayuda', 0]] },
    { k: 'medicamentos', t: 'Responsabilidad con medicamentos', o: [['Independiente', 1], ['Necesita ayuda', 0]] },
    { k: 'finanzas', t: 'Manejo de finanzas', o: [['Independiente', 1], ['Necesita ayuda', 0]] }
   ],
   interpretar: (p) => p === 8 ? 'Independiente para las AIVD' : p >= 5 ? 'Dependencia moderada' : 'Dependencia grave'
  },
  tinetti: {
   nombre: 'Tinetti (POMA)',
   desc: 'Equilibrio y marcha (0-28). Mayor puntaje = menor riesgo de caídas.',
   max: 28,
   balance: [
    { k: 'sentado', t: 'Equilibrio sentado (30 s sin apoyo)', o: [['Sí', 3], ['No', 0]] },
    { k: 'intentos', t: 'Intentos de incorporarse (5 veces)', o: [['Capaz', 3], ['No capaz', 0]] },
    { k: 'incorporarse', t: 'Incorporarse tras sentarse', o: [['Capaz', 3], ['No capaz', 0]] },
    { k: 'estabilidad', t: 'Estabilidad de pie (10 s)', o: [['Seguro', 3], ['Leve inseguridad', 1], ['Inseguro', 0]] },
    { k: 'sentarse_manos', t: 'Sentarse sin usar manos', o: [['Sí', 1], ['No', 0]] },
    { k: 'tronco', t: 'Girar el tronco', o: [['Sí', 1], ['No', 0]] },
    { k: 'pasos_giro', t: 'Girar 360° con pasos continuos', o: [['Sí', 1], ['No', 0]] },
    { k: 'sentarse_final', t: 'Sentarse de forma segura', o: [['Sí', 1], ['No', 0]] }
   ],
   items: [
    { k: 'inicio', t: 'Inicio de la marcha', o: [['Seguro', 2], ['Dudoso', 1], ['Inseguro', 0]] },
    { k: 'paso_long', t: 'Longitud del paso', o: [['Igual', 1], ['Corta', 0]] },
    { k: 'paso_altura', t: 'Altura del pie', o: [['Levanta el pie', 1], ['Arrastra', 0]] },
    { k: 'simetria', t: 'Simetría del paso', o: [['Simétrico', 1], ['Asimétrico', 0]] },
    { k: 'continuidad', t: 'Continuidad de los pasos', o: [['Continuos', 1], ['Discontinuos', 0]] },
    { k: 'direccion', t: 'Dirección de la marcha', o: [['Recta', 1], ['Desviada', 0]] },
    { k: 'tronco_piernas', t: 'Relación tronco-piernas', o: [['Normal', 1], ['Alterada', 0]] },
    { k: 'estabilidad_marcha', t: 'Estabilidad durante la marcha', o: [['Estable', 1], ['Inestable', 0]] },
    { k: 'giro_marcha', t: 'Giro durante la marcha', o: [['Seguro', 1], ['Inseguro', 0]] },
    { k: 'parada', t: 'Parada final', o: [['Segura', 1], ['Insegura', 0]] },
    { k: 'recuperacion', t: 'Recuperación del equilibrio tras la parada', o: [['Rápida', 1], ['Lenta o con apoyo', 0]] }
   ],
   interpretar: (p) => p >= 24 ? 'Riesgo de caídas bajo' : p >= 19 ? 'Riesgo de caídas moderado' : 'Riesgo de caídas alto'
  },
  yesavage: {
   nombre: 'Yesavage (GDS-15)',
   desc: 'Tamizaje de síntomas depresivos (0-15). Es una escala de cribado, no un diagnóstico.',
   max: 15,
   // En GDS-15, la respuesta "depresiva" es: Sí en ítems 1,5,7,8,11,13 y No en los demás
   items: [
    { k: 'g1', t: '¿Está básicamente satisfecho/a con su vida?', o: [['Sí', 0], ['No', 1]] },
    { k: 'g2', t: '¿Ha abandonado muchas actividades e intereses?', o: [['Sí', 1], ['No', 0]] },
    { k: 'g3', t: '¿Siente que su vida está vacía?', o: [['Sí', 1], ['No', 0]] },
    { k: 'g4', t: '¿Se aburre frecuentemente?', o: [['Sí', 1], ['No', 0]] },
    { k: 'g5', t: '¿Está de buen ánimo la mayor parte del tiempo?', o: [['Sí', 0], ['No', 1]] },
    { k: 'g6', t: '¿Se preocupa por cosas que antes no le preocupaban?', o: [['Sí', 1], ['No', 0]] },
    { k: 'g7', t: '¿Se siente feliz la mayor parte del tiempo?', o: [['Sí', 0], ['No', 1]] },
    { k: 'g8', t: '¿Se siente indefenso/a ante la situación actual?', o: [['Sí', 1], ['No', 0]] },
    { k: 'g9', t: '¿Prefiere quedarse en casa en lugar de salir?', o: [['Sí', 1], ['No', 0]] },
    { k: 'g10', t: '¿Cree que es mejor estar vivo que muerto?', o: [['Sí', 0], ['No', 1]] },
    { k: 'g11', t: '¿Cree que su situación es mejor que la de otras personas?', o: [['Sí', 0], ['No', 1]] },
    { k: 'g12', t: '¿Piensa que la mayoría de las personas está mejor que usted?', o: [['Sí', 1], ['No', 0]] },
    { k: 'g13', t: '¿Se siente inútil?', o: [['Sí', 1], ['No', 0]] },
    { k: 'g14', t: '¿Está inquieto/a y nervioso/a?', o: [['Sí', 1], ['No', 0]] },
    { k: 'g15', t: '¿Piensa que la vida es muy valiosa?', o: [['Sí', 0], ['No', 1]] }
   ],
   interpretar: (p) => p <= 5 ? 'Sin síntomas depresivos significativos (tamizaje)' : p <= 10 ? 'Síntomas depresivos leves-moderados — requiere evaluación profesional' : 'Síntomas depresivos probables severos — requiere evaluación profesional'
  },
  mmse: {
   nombre: 'Mini-Mental (MMSE-30)',
   desc: 'Evaluación cognitiva (0-30). Usar la versión autorizada y validada; ajustar por edad y escolaridad.',
   max: 30,
   dominios: [
    { k: 'orient_t', t: 'Orientación temporal (fecha, día, mes, año, estación)', max: 5, ayuda: '1 punto por cada dato correcto (máx 5)' },
    { k: 'orient_e', t: 'Orientación espacial (país, provincia, ciudad, lugar, piso)', max: 5, ayuda: '1 punto por cada dato correcto (máx 5)' },
    { k: 'registro', t: 'Registro inmediato (3 palabras)', max: 3, ayuda: '1 punto por cada palabra repetida (máx 3)' },
    { k: 'atencion', t: 'Atención y cálculo (restas seriales o deletrear)', max: 5, ayuda: '1 punto por cada resta correcta (máx 5)' },
    { k: 'recuerdo', t: 'Recuerdo diferido (3 palabras)', max: 3, ayuda: '1 punto por cada palabra recordada (máx 3)' },
    { k: 'lenguaje', t: 'Lenguaje (denominación, repetición, orden, lectura, escritura)', max: 8, ayuda: 'Denominación 2 · repetición 1 · orden 3 · lectura 1 · escritura 1' },
    { k: 'dibujo', t: 'Copia del dibujo (dos pentágonos)', max: 1, ayuda: '1 punto si la copia es correcta' }
   ],
   interpretar: (p) => p >= 24 ? 'Cognición dentro de lo esperado' : p >= 19 ? 'Deterioro cognitivo leve' : p >= 10 ? 'Deterioro cognitivo moderado' : 'Deterioro cognitivo severo'
  }
 };

 const escalasLista = Object.entries(ESCALAS);
 const escActiva = $derived(formEscala ? ESCALAS[formEscala] : null);
 const itemsEscala = $derived(escActiva
  ? [...(escActiva.balance || []), ...(escActiva.items || escActiva.dominios || [])]
  : []);

 function puntosDe(resp, escala) {
  const e = ESCALAS[escala];
  if (!e) return 0;
  if (e.dominios) return e.dominios.reduce((s, d) => s + (Number(resp[d.k]) || 0), 0);
  const items = e.items || [];
  const bal = e.balance || [];
  let total = 0;
  for (const it of [...items, ...bal]) {
   const sel = resp[it.k];
   if (sel == null) continue;
   const opt = it.o.find(([lbl]) => lbl === sel);
   if (opt) total += opt[1];
  }
  return total;
 }
 const puntajePrevia = $derived(formEscala ? puntosDe(formResp, formEscala) : 0);
 const interpretePrevia = $derived(formEscala && escActiva ? escActiva.interpretar(puntajePrevia) : '');
 const completa = $derived(formEscala ? itemsEscala.every((it) => formResp[it.k] !== undefined && formResp[it.k] !== '') : false);

 function nuevaValoracion(esc) {
  formEscala = esc;
  formFecha = new Date().toISOString().slice(0, 10);
  formNotas = '';
  formResp = {};
  error = ''; msg = '';
 }

 async function guardar() {
  if (!formEscala) { error = 'Selecciona una escala'; return; }
  const e = ESCALAS[formEscala];
  const puntaje = puntosDe(formResp, formEscala);
  guardando = true; error = '';
  try {
   await api.crearValoracion(pacienteId, {
    escala: formEscala, fecha: formFecha, respuestas: formResp, puntaje,
    interpretacion: e.interpretar(puntaje), notas: formNotas
   });
   msg = 'Valoración registrada';
   formEscala = '';
   await cargar();
  } catch (err) { error = err.message; }
  finally { guardando = false; }
 }

 async function eliminar(v) {
  if (!confirm(`¿Eliminar la valoración de ${ESCALAS[v.escala]?.nombre || v.escala} del ${v.fecha}?`)) return;
  try { await api.eliminarValoracion(v.id); await cargar(); } catch (e) { error = e.message; }
 }

 async function cargar() {
  try {
   const r = await api.valoraciones(pacienteId);
   valoraciones = r.valoraciones || [];
  } catch (e) { error = e.message; }
  finally { loading = false; }
 }

 // Agrupar por escala: última + historial
 const porEscala = $derived.by(() => {
  const m = new Map();
  for (const v of [...valoraciones].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))) {
   if (!m.has(v.escala)) m.set(v.escala, []);
   m.get(v.escala).push(v);
  }
  return m;
 });

 // Gráfica SVG simple por escala
 function puntosGrafica(lista) {
  const pts = [...lista].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const max = ESCALAS[pts[0]?.escala]?.max || 100;
  const W = 300, H = 90, pad = 8;
  return pts.map((v, i) => {
   const x = pad + (pts.length === 1 ? (W - pad * 2) / 2 : (i / (pts.length - 1)) * (W - pad * 2));
   const y = H - pad - (Number(v.puntaje) / max) * (H - pad * 2);
   return `${x},${y}`;
  }).join(' ');
 }
 function cambio(lista) {
  if (lista.length < 2) return null;
  const asc = [...lista].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const d = Number(asc[asc.length - 1].puntaje) - Number(asc[0].puntaje);
  return d === 0 ? 'Sin cambio' : `${d > 0 ? '+' : ''}${d} puntos desde la primera valoración`;
 }

 function reportePDF() {
  const w = window.open('', '_blank');
  const filas = [...valoraciones].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  w.document.write(`<html><head><title>Valoración gerontológica</title>
   <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;color:#222}
   h1{font-size:1.2rem}h2{font-size:1rem;margin-top:1.5rem}table{width:100%;border-collapse:collapse;font-size:.8rem}
   th,td{border:1px solid #ccc;padding:.35rem .5rem;text-align:left}th{background:#f0f0f0}
   .nota{font-size:.75rem;color:#555;margin-top:2rem}</style></head><body>
   <h1>Agencia Gerontológica Integral — Valoración gerontológica y funcional</h1>
   <p>Paciente ID: ${pacienteId} · Generado: ${new Date().toLocaleString('es-EC')}</p>
   ${escalasLista.map(([k, e]) => {
    const lista = porEscala.get(k) || [];
    if (!lista.length) return '';
    return `<h2>${e.nombre} — ${e.desc}</h2>
    <table><tr><th>Fecha</th><th>Puntaje</th><th>Interpretación</th><th>Evaluador</th><th>Notas</th></tr>
    ${[...lista].sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha))).map((v) =>
     `<tr><td>${v.fecha}</td><td>${v.puntaje}/${e.max}</td><td>${v.interpretacion || ''}</td><td>${v.evaluador_nombre || ''}${v.evaluador_disciplina ? ' · ' + v.evaluador_disciplina : ''}</td><td>${v.notas || ''}</td></tr>`).join('')}
    </table>`;
   }).join('')}
   <p class="nota">Documento generado con fines de seguimiento. Las puntuaciones e interpretaciones son registradas por profesionales competentes; no constituyen diagnóstico médico.</p>
   </body></html>`);
  w.document.close();
  w.print();
 }

 onMount(async () => {
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
   await cargar();
  } catch (e) { error = e.message; loading = false; }
 });
</script>

<div class="val-wrap">
 {#if error}<p class="error">{error}</p>{/if}
 {#if msg}<p class="ok">{msg}</p>{/if}

 <div class="val-head">
  <h4>Valoración gerontológica y funcional</h4>
  <button class="mini ghost" onclick={reportePDF} disabled={!valoraciones.length}>🖨️ Reporte PDF</button>
 </div>
 <p class="muted small">Escalas validadas: Barthel, Lawton y Brody, Tinetti, Yesavage (GDS-15) y Mini-Mental. Los resultados los registra y revisa un profesional competentes; el sistema no diagnostica.</p>

 {#if loading}<p class="muted">Cargando valoraciones…</p>
 {:else if !valoraciones.length && !formEscala}
  <p class="muted">Sin valoraciones registradas. Selecciona una escala para la valoración inicial.</p>
 {/if}

 <!-- Resumen por escala -->
 {#each escalasLista as [k, e]}
  {@const lista = porEscala.get(k) || []}
  {#if lista.length}
   {@const ult = lista[lista.length - 1]}
   <div class="esc-card">
    <div class="esc-head">
     <strong>{e.nombre}</strong>
     <span class="puntaje-chip">{ult.puntaje}/{e.max}</span>
     <span class="muted small">{ult.fecha} · {e.interpretar(Number(ult.puntaje))}</span>
    </div>
    {#if lista.length > 1}
     <svg class="grafica" viewBox="0 0 300 90" preserveAspectRatio="none">
      <polyline points={puntosGrafica(lista)} fill="none" stroke="oklch(0.42 0.068 218)" stroke-width="2" />
      {#each [...lista].sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha))) as v, i}
       {@const pts = puntosGrafica(lista).split(' ')}
       {#if pts[i]}<circle cx={pts[i].split(',')[0]} cy={pts[i].split(',')[1]} r="3" fill="oklch(0.7 0.1 78)" />{/if}
      {/each}
     </svg>
     <p class="muted small">{cambio(lista)} · {lista.length} valoración(es)</p>
    {/if}
    <details>
     <summary class="muted small">Historial</summary>
     {#each [...lista].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))) as v (v.id)}
      <div class="val-item">
       <div class="val-meta"><strong>{v.fecha}</strong> · {v.puntaje}/{e.max} · {v.interpretacion || ''} · {v.evaluador_nombre || '—'}{v.evaluador_disciplina ? ' · ' + v.evaluador_disciplina : ''}</div>
       {#if v.notas}<p class="muted small">{v.notas}</p>{/if}
       <button class="mini ghost" onclick={() => eliminar(v)}>Eliminar</button>
      </div>
     {/each}
    </details>
   </div>
  {/if}
 {/each}

 <!-- Selector de escala -->
 {#if !formEscala}
  <div class="esc-picker">
   <p class="muted small">Nueva valoración:</p>
   {#each escalasLista as [k, e]}
    <button class="esc-btn" onclick={() => nuevaValoracion(k)}>+ {e.nombre}</button>
   {/each}
  </div>
 {:else}
  <div class="esc-form">
   <div class="esc-form-head">
    <strong>{escActiva.nombre}</strong>
    <button class="mini ghost" onclick={() => formEscala = ''}>✕ Cancelar</button>
   </div>
   <p class="muted small">{escActiva.desc}</p>
   <div class="form-row">
    <label>Fecha<input type="date" bind:value={formFecha} /></label>
   </div>

   {#if escActiva.dominios}
    {#each escActiva.dominios as d (d.k)}
     <label class="val-field">{d.t} <span class="muted small">(máx {d.max} — {d.ayuda})</span>
      <input type="number" min="0" max={d.max} bind:value={formResp[d.k]} placeholder="0-{d.max}" />
     </label>
    {/each}
   {:else}
    {#if escActiva.balance}
     <p class="muted small"><strong>Equilibrio</strong> (máx 16)</p>
    {/if}
    {#each itemsEscala as it (it.k)}
     <label class="val-field">{it.t}
      <select bind:value={formResp[it.k]}>
       <option value="">— Seleccionar respuesta —</option>
       {#each it.o as [lbl, pts]}
        <option value={lbl}>{lbl} ({pts} pts)</option>
       {/each}
      </select>
     </label>
     {#if escActiva.balance && it.k === escActiva.balance[escActiva.balance.length - 1].k}
      <p class="muted small"><strong>Marcha</strong> (máx 12)</p>
     {/if}
    {/each}
   {/if}

   <label class="val-field">Notas del evaluador<textarea bind:value={formNotas} rows="2" placeholder="Observaciones, condiciones de aplicación…"></textarea></label>

   <div class="val-score">
    <span>Puntaje: <strong>{puntajePrevia}</strong>/{escActiva.max}</span>
    <span class="muted small">{interpretePrevia}</span>
   </div>
   <div class="val-btns">
    <button onclick={guardar} disabled={guardando || !completa}>{guardando ? 'Guardando…' : 'Registrar valoración'}</button>
   </div>
  </div>
 {/if}
</div>

<style>
.val-wrap { margin-top: 1rem; }
.val-head { display: flex; justify-content: space-between; align-items: center; }
.val-head h4 { margin: 0; }
.muted { color: oklch(0.45 0.03 225); }
.small { font-size: .78rem; }
.error { color: oklch(0.55 0.2 27); font-size: .85rem; }
.ok { color: oklch(0.45 0.08 160); font-size: .85rem; }
.esc-card { background: oklch(0.98 0.008 140); border: 1px solid oklch(0.92 0.02 140); border-radius: 10px; padding: .7rem .9rem; margin: .5rem 0; }
.esc-head { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; font-size: .88rem; }
.puntaje-chip { background: oklch(0.42 0.068 218); color: #fff; border-radius: 999px; padding: .1rem .6rem; font-size: .78rem; font-weight: 700; }
.grafica { width: 100%; height: 90px; margin: .4rem 0 .2rem; }
.val-item { border-top: 1px solid oklch(0.92 0.02 140); padding: .4rem 0; font-size: .8rem; }
.val-meta { display: flex; gap: .4rem; flex-wrap: wrap; }
.esc-picker { display: flex; flex-wrap: wrap; gap: .4rem; margin: .6rem 0; align-items: center; }
.esc-btn { background: oklch(0.94 0.02 85); color: oklch(0.4 0.05 225); }
.esc-form { background: #fff; border: 1px solid oklch(0.9 0.02 85); border-radius: 10px; padding: .8rem; margin-top: .6rem; }
.esc-form-head { display: flex; justify-content: space-between; align-items: center; }
.form-row { display: flex; gap: .6rem; margin: .4rem 0; }
.form-row label { display: flex; flex-direction: column; font-size: .8rem; gap: .2rem; }
.form-row input { padding: .4rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
.val-field { display: block; margin: .5rem 0; font-size: .82rem; }
.val-field input, .val-field textarea, .val-field select { width: 100%; padding: .4rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; margin-top: .2rem; box-sizing: border-box; }
.opts { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .25rem; }
.opt { display: flex; align-items: center; gap: .25rem; font-size: .78rem; font-weight: 400; cursor: pointer; }
.opt em { color: oklch(0.5 0.03 225); font-style: normal; font-size: .7rem; }
.val-score { display: flex; justify-content: space-between; align-items: center; background: oklch(0.95 0.02 85); border-radius: 8px; padding: .5rem .8rem; margin: .6rem 0; font-size: .9rem; }
.val-btns { display: flex; gap: .5rem; }
button { padding:.5rem .9rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; font-family: inherit; }
button.mini { padding:.3rem .7rem; font-size:.78rem; }
button.ghost { background: transparent; color: oklch(0.4 0.05 225); border: 1px solid oklch(0.55 0.05 222); }
details summary { cursor: pointer; }
</style>
