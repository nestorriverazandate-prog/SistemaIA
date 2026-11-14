<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';
 import QRCode from 'qrcode';

 let perfil = $state(null);
 let loading = $state(true);
 let pacientes = $state([]);
 let formError = $state('');
 let formOk = $state('');

 let qrModal = $state(null);
 let qrImg = $state('');
 let qrToken = $state('');
 let generandoQRs = $state(false);

 async function cargar() {
  const p = await api.pacientes();
  pacientes = p.pacientes;
 }

 async function abrirQR(p) {
  formError = ''; formOk = '';
  let token = p.qr_token;
  if (!token) {
   token = `AGI-${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
   try {
    const { paciente } = await api.actualizarPaciente(p.id, { qr_token: token });
    if (!paciente.qr_token) { formError = 'El QR no se pudo guardar: falta ejecutar supabase/TODO-EN-UNO.sql en Supabase'; return; }
    const idx = pacientes.findIndex((x) => x.id === p.id);
    if (idx >= 0) pacientes[idx] = paciente;
   } catch (e) { formError = e.message; return; }
  }
  qrToken = token;
  qrImg = await QRCode.toDataURL(`${window.location.origin}/registrar?t=${token}`, { width: 320, margin: 2 });
  qrModal = p;
 }
 async function imprimirTodosQR() {
  formError = ''; formOk = '';
  generandoQRs = true;
  try {
   let sinGuardar = 0;
   for (const p of pacientes) {
    if (!p.qr_token) {
     const token = `AGI-${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
     const { paciente } = await api.actualizarPaciente(p.id, { qr_token: token });
     if (!paciente.qr_token) { sinGuardar++; continue; }
     const idx = pacientes.findIndex((x) => x.id === p.id);
     if (idx >= 0) pacientes[idx] = paciente;
    }
   }
   if (sinGuardar) formError = `${sinGuardar} paciente(s) sin QR guardado: ejecuta supabase/TODO-EN-UNO.sql en Supabase`;
   const items = [];
   for (const p of pacientes) {
    if (!p.qr_token) continue;
    const img = await QRCode.toDataURL(`${window.location.origin}/registrar?t=${p.qr_token}`, { width: 200, margin: 1 });
    items.push({ img, nombre: `${p.nombre || ''} ${p.apellido || ''}`.trim(), token: p.qr_token });
   }
   if (!items.length) { formError = 'No hay pacientes para generar QR'; return; }
   const w = window.open('', '_blank', 'width=900,height=700');
   const tarjetas = items.map((it) => `
    <div class="card-qr">
    <img src="/logo.png" class="logo" alt="" />
    <img src="${it.img}" alt="QR" />
    <strong>${it.nombre}</strong>
    <span>ID: ${it.token}</span>
    <p>Código de identificación del domicilio.<br/>Exclusivo para el registro de visitas del personal autorizado.</p>
    </div>`).join('');
   w.document.write(`<html><head><title>QR domicilios</title><style>
    body{font-family:system-ui;margin:16px}h1{font-size:18px;color:#234;text-align:center}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
    .card-qr{border:1px solid #ccc;border-radius:10px;padding:10px;text-align:center;page-break-inside:avoid}
    .card-qr img.qr, .card-qr img[alt="QR"]{width:140px;height:140px;image-rendering:pixelated}
    .logo{height:36px}.card-qr strong{display:block;font-size:13px;margin-top:4px}
    .card-qr span{font-size:10px;color:#666}.card-qr p{font-size:9px;color:#777;margin-top:4px}
    @media print{body{margin:0}.grid{gap:10px}}
    </style></head><body>
    <h1>Agencia Gerontológica Integral — Códigos QR de domicilios</h1>
    <div class="grid">${tarjetas}</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script>
    </body></html>`);
   w.document.close();
   formOk = `${items.length} códigos QR listos para imprimir`;
  } catch (e) { formError = e.message; }
  finally { generandoQRs = false; }
 }
 function cerrarQR() { qrModal = null; qrImg = ''; qrToken = ''; }
 function descargarQR() {
  const a = document.createElement('a');
  a.href = qrImg; a.download = `qr-domicilio-${qrModal?.id || 'paciente'}.png`; a.click();
 }
 function imprimirQR() {
  const w = window.open('', '_blank', 'width=480,height=640');
  w.document.write(`<html><head><title>QR domicilio</title>
  <style>body{font-family:system-ui;text-align:center;padding:24px}img{width:280px}h2{color:#234}p{color:#567;font-size:13px}</style></head>
  <body><img src="/logo.png" style="height:64px" alt="Agencia Gerontológica Integral"/>
  <h2>Agencia Gerontológica Integral</h2>
  <img src="${qrImg}" alt="QR"/><p><strong>${qrModal?.nombre || ''} ${qrModal?.apellido || ''}</strong><br>ID: ${qrToken}</p>
  <p>Código de identificación del domicilio. Exclusivo para el registro de visitas del personal autorizado.</p>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
 }

 async function eliminar(p) {
  if (!confirm(`¿Eliminar a ${p.nombre} ${p.apellido}?`)) return;
  formError = ''; formOk = '';
  try { await api.eliminarPaciente(p.id); formOk = 'Paciente eliminado.'; await cargar(); }
  catch (e) { formError = e.message; }
 }
 async function cambiarEstado(id, estado) {
  try { await api.estadoPaciente(id, estado); await cargar(); }
  catch (e) { formError = e.message; }
 }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
  } catch { setToken(null); }
  loading = false;
  if (perfil?.rol === 'admin') cargar().catch((e) => { formError = e.message; });
 });
 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Pacientes — Agencia Gerontológica</title></svelte:head>

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
 <h1>Pacientes</h1>
 </div>
 </a>
 <div>
 <span class="badge">{perfil.email} · Directivo</span>
 <a class="ghost link" href="/visitas">Visitas</a>
 <a class="ghost link" href="/mapa">Mapa</a>
 <a class="ghost link" href="/personal">Personal</a>
 <a class="ghost link" href="/pacientes">Pacientes</a>
 <a class="ghost link" href="/seguimiento">Seguimiento</a>
 <a class="ghost link" href="/paquetes">Paquetes</a>
 <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="grid">
 {#if formError}<p class="error">{formError}</p>{/if}
 {#if formOk}<p class="ok">{formOk}</p>{/if}

 <section class="card wide">
 <h2>Pacientes ({pacientes.length})
 <a class="mini ghost" href="/">+ Nuevo paciente</a>
 <button class="mini ghost" onclick={imprimirTodosQR} disabled={generandoQRs}>{generandoQRs ? 'Generando…' : 'Imprimir todos los QR'}</button>
 </h2>
 <table>
 <thead>
 <tr><th>Paciente</th><th>Edad</th><th>Servicio</th><th>Estado</th><th></th><th></th></tr>
 </thead>
 <tbody>
 {#each pacientes as p (p.id)}
 <tr>
 <td>{p.nombre} {p.apellido}{#if p.contacto_emergencia}<br/><small class="muted">Emergencia: {p.contacto_emergencia}{p.telefono_emergencia ? ` · ${p.telefono_emergencia}` : ''}</small>{/if}</td>
 <td>{p.cedula ? p.cedula + ' años' : '—'}</td>
 <td>{p.tipo_servicio || '—'}{#if p.fecha_inicio || p.fecha_termino}<br/><small class="muted">Inicio: {p.fecha_inicio ? String(p.fecha_inicio).slice(0, 10) : '—'} · Fin: {p.fecha_termino ? String(p.fecha_termino).slice(0, 10) : '—'}</small>{/if}</td>
 <td><span class="estado estado-{p.estado}">{p.estado}</span></td>
 <td>
 <select value={p.estado} onchange={(e) => cambiarEstado(p.id, e.target.value)}>
 <option value="pendiente">pendiente</option>
 <option value="en_proceso">en_proceso</option>
 <option value="completado">completado</option>
 <option value="cancelado">cancelado</option>
 </select>
 </td>
 <td class="acciones">
 <button class="mini" onclick={() => { window.location.href = `/?editar=${p.id}`; }}>Editar</button>
 <button class="mini" onclick={() => abrirQR(p)}>QR</button>
 <button class="mini danger" onclick={() => eliminar(p)}>Eliminar</button>
 </td>
 </tr>
 {:else}
 <tr><td colspan="6">Sin registros</td></tr>
 {/each}
 </tbody>
 </table>
 </section>
</main>

{#if qrModal}
 <div class="qr-overlay" onclick={cerrarQR} role="presentation">
 <div class="qr-sheet" onclick={(e) => e.stopPropagation()}>
 <img class="qr-logo" src="/logo.png" alt="Agencia Gerontológica Integral" />
 <h3>Código QR del domicilio</h3>
 <p class="muted">{qrModal.nombre} {qrModal.apellido}</p>
 {#if qrImg}<img class="qr-img" src={qrImg} alt="Código QR" />{/if}
 <p class="qr-id">ID: {qrToken}</p>
 <p class="muted small">Código de identificación del domicilio. Exclusivo para el registro de visitas del personal autorizado.</p>
 <div class="btns">
 <button class="mini" onclick={descargarQR}>Descargar PNG</button>
 <button class="mini" onclick={imprimirQR}>Imprimir / PDF</button>
 <button class="mini ghost" onclick={cerrarQR}>Cerrar</button>
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
main.card { max-width: 420px; margin: 4rem auto; }
.center { text-align: center; }
.muted { color: oklch(0.45 0.03 225); font-size:.9rem; }
.small { font-size:.78rem; }
h2 { margin-top: 0; font-size: 1.05rem; }
form { display: flex; flex-direction: column; gap:.75rem; }
.row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:.75rem; }
.grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 1.5rem; padding: 1.5rem 2rem; max-width: 1200px; margin: 0 auto; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
label { display: flex; flex-direction: column; gap:.25rem; font-size:.85rem; font-weight: 600; }
input, textarea, select { padding:.55rem.65rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
button { padding:.6rem 1rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; }
button:hover:not(:disabled) { background: oklch(0.36 0.068 218); }
button:disabled { opacity:.6; cursor: default; }
button.ghost, button.mini.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.45 0.03 225); }
header button.ghost, header a.ghost { color: #f2eee2; border-color: oklch(0.55 0.05 222); }
.link { padding:.4rem.8rem; border: 1px solid oklch(0.45 0.03 225); border-radius: 8px; text-decoration: none; }
.geo-row { display: flex; gap: .6rem; align-items: center; }
.geo-row .ghost { margin: 0; }
button.mini { padding:.25rem.6rem; font-size:.75rem; margin-right:.35rem; }
.acciones { white-space: nowrap; }
.btns { display: flex; gap: .5rem; }
.btns button { flex: 0 0 auto; }
.btns button.ghost { color: oklch(0.45 0.03 225); border: 1px solid oklch(0.45 0.03 225); }
button.mini.danger { background: oklch(0.55 0.2 27); }
.error { color: oklch(0.55 0.2 27); font-size:.85rem; }
.ok { color: oklch(0.45 0.08 160); font-size:.85rem; }
table { width: 100%; border-collapse: collapse; font-size:.85rem; }
th, td { text-align: left; padding:.5rem.4rem; border-bottom: 1px solid oklch(0.93 0.025 140); }
.estado { padding:.15rem.5rem; border-radius: 999px; font-size:.75rem; background: oklch(0.94 0.025 80); }
.estado-pendiente { background: oklch(0.94 0.025 80); }
.estado-en_proceso { background: oklch(0.93 0.025 140); }
.estado-completado,.estado-aprobado { background: #d1e7dd; }
.estado-cancelado,.estado-rechazado { background: #f8d7da; }
.qr-overlay { position: fixed; inset: 0; background: oklch(0.2 0.03 260 / .45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 1rem; }
.qr-sheet { background: #fff; border-radius: 16px; padding: 1.5rem; max-width: 380px; width: 100%; text-align: center; box-shadow: 0 10px 40px oklch(0.2 0.03 260 / .3); }
.qr-logo { height: 56px; }
.qr-img { width: 240px; height: 240px; image-rendering: pixelated; margin: .8rem auto; display: block; }
.qr-id { font-family: monospace; font-size: .8rem; color: oklch(0.5 0.03 85); word-break: break-all; }
</style>
