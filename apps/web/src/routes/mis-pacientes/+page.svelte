<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';

 let perfil = $state(null);
 let loading = $state(true);
 let pacientes = $state([]);
 let error = $state('');
 let exp = $state(null);
 let expLoading = $state(false);
 let expFoto = $state('');
 let expErr = $state('');

 function fmtFecha(f) { return f ? new Date(f + 'T00:00:00').toLocaleDateString('es-EC', { dateStyle: 'medium' }) : '—'; }
 function estadoPac(p) { return p.estado || 'sin estado'; }

 async function cargar() {
  try {
   const r = await api.misPacientes();
   pacientes = r.pacientes || [];
   // Fotos en paralelo (cada una es URL firmada de 1h)
   for (const p of pacientes) {
    api.fotoPaciente(p.id).then((f) => { p._foto = f?.url || ''; }).catch(() => {});
   }
  } catch (e) { error = e.message; }
 }

 async function abrirExpediente(p) {
  expErr = ''; exp = { paciente: p, notas: [], visitas: [], evidencias: [] };
  expLoading = true; expFoto = '';
  try {
   const [exped, foto] = await Promise.all([
    api.expedientePaciente(p.id),
    api.fotoPaciente(p.id).then((r) => r.url).catch(() => '')
   ]);
   exp = { ...exped, paciente: { ...exped.paciente, paquete: p.paquete, proxima_visita: p.proxima_visita } };
   expFoto = foto || p._foto || '';
  } catch (e) { expErr = e.message; }
  finally { expLoading = false; }
 }
 function cerrarExpediente() { exp = null; expFoto = ''; }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
   if (!['staff', 'cuidador', 'familiar', 'admin'].includes(perfil?.rol) || perfil?.estado === 'rechazado') { loading = false; return; }
   await cargar();
  } catch { setToken(null); }
  finally { loading = false; }
 });
 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Mis pacientes — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil || !['staff', 'cuidador', 'familiar', 'admin'].includes(perfil.rol)}
 <main class="card center"><h1>Acceso restringido</h1><p class="muted">Esta sección es para personal empleado.</p><a class="ghost link" href="/">Volver</a></main>
{:else}
<header>
 <a class="brand" href="/">
  <img src="/logo.png" alt="Agencia Gerontológica Integral" />
  <div class="brand-text">
   <span class="agency">Agencia Gerontológica Integral</span>
   <h1>Mis pacientes</h1>
  </div>
 </a>
 <div>
  <span class="badge">{perfil.email} · {perfil.rol === 'admin' ? 'Directivo' : 'Empleado'}</span>
  <a class="ghost link" href="/mapa-pacientes">Mapa de pacientes</a>
  <a class="ghost link" href="/visitas">Mis visitas</a>
  <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="layout">
 {#if error}<p class="error">{error}</p>{/if}
 <section class="card wide">
  <h2>Pacientes asignados ({pacientes.length})</h2>
  {#if !pacientes.length}<p class="muted">Sin pacientes asignados. El directivo asigna pacientes mediante las visitas programadas.</p>{/if}
  <div class="pac-grid">
   {#each pacientes as p (p.id)}
    <button class="pac-card" onclick={() => abrirExpediente(p)}>
     {#if p._foto}<img class="pac-foto" src={p._foto} alt="" />{:else}<div class="pac-foto vacio">{(p.nombre || '?').charAt(0)}</div>{/if}
     <div class="pac-info">
      <strong>{p.nombre} {p.apellido}</strong>
      <span class="muted">{p.cedula ? p.cedula + ' años' : 'Edad no registrada'}</span>
      <span class="muted">{p.direccion || 'Sin dirección'}</span>
      <span class="muted">{p.telefono || p.contacto_emergencia || 'Sin teléfono'}</span>
      <span class="pac-meta">
       {p.paquete?.nombre || p.tipo_servicio || 'Sin paquete'}
       {#if p.proxima_visita} · Próxima: {fmtFecha(p.proxima_visita.fecha)} {p.proxima_visita.hora_programada || ''}{/if}
      </span>
      <span class="estado estado-{p.estado}">{estadoPac(p)}</span>
     </div>
    </button>
   {/each}
  </div>
 </section>
</main>

{#if exp}
 <div class="exp-overlay" role="presentation" onclick={cerrarExpediente}>
 <div class="exp-sheet" onclick={(e) => e.stopPropagation()}>
  <div class="exp-head">
   <div class="exp-id">
    {#if expFoto}<img class="exp-foto" src={expFoto} alt="" />{:else}<div class="exp-foto vacio">?</div>{/if}
    <div>
     <h3>{exp.paciente.nombre} {exp.paciente.apellido}</h3>
     <p class="muted">{exp.paciente.cedula ? exp.paciente.cedula + ' años · ' : ''}{exp.paciente.telefono || '—'} · {exp.paciente.direccion || '—'}</p>
    </div>
   </div>
   <div class="exp-acciones">
    <a class="mini link" href="/expediente?id={exp.paciente.id}&tab=valoracion">🩺 Valoración</a>
    <a class="mini link" href="/expediente?id={exp.paciente.id}">📋 Expediente multidisciplinario</a>
    <button class="mini ghost" onclick={cerrarExpediente}>✕ Cerrar</button>
   </div>
  </div>
  {#if expErr}<p class="error">{expErr}</p>{/if}
  {#if expLoading}<p class="muted">Cargando expediente…</p>{/if}
  {#if exp.paciente.paquete}<p><strong>Paquete:</strong> {exp.paciente.paquete.nombre} — ${Number(exp.paciente.paquete.precio || 0).toFixed(2)}/mes<br/>
  <strong>Servicios:</strong> {exp.paciente.paquete.servicios || exp.paciente.paquete.descripcion || '—'}</p>{/if}
  {#if exp.paciente.proxima_visita}<p><strong>Próxima visita:</strong> {fmtFecha(exp.paciente.proxima_visita.fecha)} {exp.paciente.proxima_visita.hora_programada || ''} · {exp.paciente.proxima_visita.estado}</p>{/if}
  {#if exp.paciente.diagnostico}<p><strong>Diagnóstico:</strong> {exp.paciente.diagnostico}</p>{/if}
  {#if exp.paciente.objetivos}<p><strong>Objetivos:</strong> {exp.paciente.objetivos}</p>{/if}
  <h4>Notas de evolución</h4>
  <div class="historial">
   {#each (exp.notas || []) as n (n.id)}
    <div class="h-nota">
     <strong>{new Date(n.created_at).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
     {#if n.especialidad || n.sesion}<span class="muted small"> · {[n.especialidad, n.sesion].filter(Boolean).join(' · ')}</span>{/if}
     {#if n.actividades}<p><strong>Actividades:</strong> {n.actividades}</p>{/if}
     {#if n.evolucion}<p><strong>Evolución:</strong> {n.evolucion}</p>{/if}
     {#if n.observaciones}<p><strong>Observaciones:</strong> {n.observaciones}</p>{/if}
     {#if n.recomendaciones}<p><strong>Recomendaciones:</strong> {n.recomendaciones}</p>{/if}
    </div>
   {:else}<p class="muted">Sin notas registradas</p>{/each}
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
.center { text-align: center; max-width: 420px; margin: 4rem auto; }
.layout { padding: 1rem; max-width: 1100px; margin: 0 auto; }
.wide { width: 100%; }
.muted { color: oklch(0.45 0.03 225); font-size:.9rem; }
.small { font-size:.78rem; }
.error { color: oklch(0.55 0.2 27); font-size:.85rem; }
.link { padding:.4rem.8rem; border: 1px solid oklch(0.55 0.05 222); border-radius: 8px; text-decoration: none; color: #f2eee2; }
h2 { margin-top: 0; font-size: 1.05rem; }
.pac-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: .9rem; }
.pac-card { display: flex; gap: .8rem; text-align: left; background: #fff; border: 1px solid oklch(0.9 0.02 85); border-radius: 12px; padding: .8rem; cursor: pointer; font: inherit; color: inherit; }
.pac-card:hover { border-color: oklch(0.42 0.068 218); box-shadow: 0 2px 10px rgba(0,0,0,.08); }
.pac-foto { width: 64px; height: 64px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
.pac-foto.vacio { display: flex; align-items: center; justify-content: center; background: oklch(0.93 0.03 80); color: oklch(0.45 0.06 250); font-weight: 700; font-size: 1.4rem; }
.pac-info { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
.pac-info strong { font-size: .95rem; }
.pac-meta { font-size: .78rem; color: oklch(0.4 0.06 250); margin-top: .2rem; }
.estado { align-self: flex-start; font-size: .7rem; padding: .1rem .5rem; border-radius: 999px; background: oklch(0.94 0.025 80); margin-top: .25rem; }
.estado-completado,.estado-aprobado { background: #d1e7dd; }
.estado-cancelado,.estado-rechazado { background: #f8d7da; }
.exp-overlay { position: fixed; inset: 0; background: oklch(0.2 0.03 260 / .5); display: flex; align-items: flex-start; justify-content: center; z-index: 60; padding: 1.5rem 1rem; overflow-y: auto; }
.exp-sheet { background: #fff; border-radius: 16px; padding: 1.25rem; max-width: 720px; width: 100%; box-shadow: 0 10px 40px oklch(0.2 0.03 260 / .3); }
.exp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; border-bottom: 1px solid oklch(0.93 0.025 140); padding-bottom: .75rem; }
.exp-head h3 { margin: 0; }
.exp-acciones { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
.exp-acciones .link { padding:.3rem .7rem; border:1px solid oklch(0.45 0.03 225); border-radius:8px; text-decoration:none; color:oklch(0.35 0.05 222); font-size:.78rem; font-weight:600; }
.exp-id { display: flex; gap: .9rem; align-items: center; }
.exp-foto { width: 64px; height: 64px; border-radius: 10px; object-fit: cover; }
.exp-foto.vacio { display: flex; align-items: center; justify-content: center; background: oklch(0.95 0.02 85); }
.historial { max-height: 50vh; overflow-y: auto; }
.h-nota { border-bottom: 1px solid oklch(0.93 0.025 140); padding: .6rem 0; font-size: .85rem; }
.h-nota p { margin: .15rem 0; font-size: .82rem; }
button { padding:.5rem .9rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; }
button.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.55 0.05 222); }
button.mini.ghost { color: oklch(0.45 0.03 225); border-color: oklch(0.45 0.03 225); }
</style>
