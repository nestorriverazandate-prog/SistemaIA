<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';

 let perfil = $state(null);
 let loading = $state(true);
 let formError = $state('');
 let formOk = $state('');

 let paquetes = $state([]);
 let equipo = $state([]);
 let formPaquete = $state({ nombre: '', descripcion: '', servicios: '', precio: '', duracion_min: 60 });

 const AREAS = ['Gerontología', 'Enfermería', 'Nutrición', 'Fisioterapia', 'Médico', 'Trabajo social', 'Odontología', 'Psicología', 'Marketing', 'Abogado', 'Agencia de viajes'];
 const estadoDe = (t) => t.estado_laboral || 'activo';

 function agregarArea(area) {
  const actual = formPaquete.servicios.trim();
  const lineas = actual ? actual.split('\n') : [];
  if (!lineas.some((l) => l.trim().toLowerCase() === area.toLowerCase())) {
   formPaquete.servicios = [...lineas, `• ${area}`].join('\n');
  }
 }
 function agregarProfesional(t) {
  const texto = `${t.nombre || ''}${t.profesion ? ' — ' + t.profesion : ''}${t.especialidad ? ' (' + t.especialidad + ')' : ''}`.trim();
  if (!texto) return;
  const actual = formPaquete.servicios.trim();
  const lineas = actual ? actual.split('\n') : [];
  if (!lineas.some((l) => l.includes(t.nombre))) {
   formPaquete.servicios = [...lineas, `• ${texto}`].join('\n');
  }
 }

 async function cargarPaquetes() {
  try { const r = await api.paquetes(); paquetes = r.paquetes || []; } catch { /* tabla puede no existir aún */ }
 }
 async function cargarEquipo() {
  try { const r = await api.directorio(); equipo = r.trabajadores || []; } catch { /* silencioso */ }
 }
 async function crearPaquete(e) {
  e.preventDefault();
  formError = ''; formOk = '';
  try {
   await api.crearPaquete(formPaquete);
   formOk = 'Paquete creado';
   formPaquete = { nombre: '', descripcion: '', servicios: '', precio: '', duracion_min: 60 };
   await cargarPaquetes();
  } catch (err) { formError = err.message; }
 }
 async function togglePaquete(p) {
  try { await api.actualizarPaquete(p.id, { activo: !p.activo }); await cargarPaquetes(); }
  catch (e) { formError = e.message; }
 }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
  } catch { setToken(null); }
  loading = false;
  if (perfil?.rol === 'admin') { cargarPaquetes(); cargarEquipo(); }
 });

 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Paquetes — Agencia Gerontológica</title></svelte:head>

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
 <h1>Paquetes y servicios</h1>
 </div>
 </a>
 <div>
 <span class="badge">{perfil.email} · Directivo</span>
 <a class="ghost link" href="/visitas">Visitas</a>
 <a class="ghost link" href="/mapa">Mapa</a>
 <a class="ghost link" href="/personal">Personal</a>
 <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="wrap">
 {#if formError}<p class="error">{formError}</p>{/if}
 {#if formOk}<p class="ok">{formOk}</p>{/if}

 <section class="card wide">
 <h2>Paquetes y servicios ({paquetes.length})</h2>
 <table>
 <thead><tr><th>Nombre</th><th>Descripción</th><th>Servicios / equipo incluido</th><th>Precio</th><th>Duración</th><th>Estado</th><th></th></tr></thead>
 <tbody>
 {#each paquetes as p (p.id)}
 <tr>
 <td>{p.nombre}</td>
 <td>{p.descripcion || '—'}</td>
 <td class="servicios-cell">{p.servicios ? p.servicios.split('\n').filter(Boolean).join(' · ') : '—'}</td>
 <td>{p.precio != null ? '$' + Number(p.precio).toFixed(2) : '—'}</td>
 <td>{p.duracion_min != null ? p.duracion_min + ' min' : '—'}</td>
 <td>{p.activo ? 'activo' : 'inactivo'}</td>
 <td><button class="mini ghost" onclick={() => togglePaquete(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button></td>
 </tr>
 {:else}<tr><td colspan="7" class="muted">Sin paquetes — crea el primero abajo</td></tr>{/each}
 </tbody>
 </table>

 <h3>Áreas profesionales disponibles</h3>
 <div class="chips">
 {#each AREAS as a}
 <button type="button" class="chip" onclick={() => agregarArea(a)}>+ {a}</button>
 {/each}
 </div>

 <h3>Equipo registrado (clic para agregarlo al paquete)</h3>
 {#if equipo.length}
 <div class="equipo-grid">
 {#each equipo.filter((t) => estadoDe(t) === 'activo') as t (t.id)}
 <button type="button" class="equipo-card" onclick={() => agregarProfesional(t)} title="Agregar al paquete">
 <strong>{t.nombre || t.email}</strong>
 <span>{[t.profesion, t.especialidad].filter(Boolean).join(' · ') || 'Sin especialidad'}</span>
 <em>{t.puesto || 'Trabajador'}</em>
 </button>
 {/each}
 </div>
 {:else}<p class="muted">No hay trabajadores registrados — agrégalos en <a href="/personal">Personal</a>.</p>{/if}

 <h3>Nuevo paquete</h3>
 <form class="exp-form" onsubmit={crearPaquete}>
 <div class="row">
 <label>Nombre <input bind:value={formPaquete.nombre} required /></label>
 <label>Precio <input bind:value={formPaquete.precio} type="number" min="0" step="0.01" /></label>
 <label>Duración (min) <input bind:value={formPaquete.duracion_min} type="number" min="15" /></label>
 </div>
 <label>Descripción <textarea bind:value={formPaquete.descripcion} rows="2"></textarea></label>
 <label>Servicios / profesionales incluidos
 <textarea bind:value={formPaquete.servicios} rows="4" placeholder="Usa los botones de arriba o escribe aquí qué incluye el paquete (ej: valoraciones por enfermería y geriatría)"></textarea>
 </label>
 <button>Crear paquete</button>
 </form>
 </section>
</main>
{/if}

<style>
 body { margin: 0; font-family: system-ui, sans-serif; background: #f4f1ea; color: #1c2733; }
 .card { background: #fff; border-radius: 14px; padding: 1.5rem; box-shadow: 0 2px 10px rgba(0,0,0,.06); }
 .center { max-width: 420px; margin: 4rem auto; text-align: center; }
 .wrap { max-width: 1100px; margin: 1.5rem auto; padding: 0 1rem; display: grid; gap: 1rem; }
 .wide { grid-column: 1 / -1; }
 header { display: flex; justify-content: space-between; align-items: center; padding: .8rem 2rem; background: oklch(0.3 0.05 222); color: #f2eee2; border-bottom: 3px solid oklch(0.7 0.1 78); flex-wrap: wrap; gap:.5rem; }
 .brand { display: flex; align-items: center; gap: .8rem; text-decoration: none; color: inherit; }
 header img { height: 44px; width: 44px; object-fit: cover; border-radius: 10px; background: #f2eee2; padding: 2px; }
 header h1 { font-size: 1.05rem; margin: 0; }
 .agency { font-size: .7rem; letter-spacing: .12em; text-transform: uppercase; opacity: .75; }
 header div:not(.brand) { display: flex; gap:.5rem; align-items: center; flex-wrap: wrap; }
 .badge { background: oklch(0.4 0.06 222); padding: .3rem .7rem; border-radius: 999px; font-size: .8rem; }
 a.ghost, button.ghost { color: #f2eee2; border: 1px solid oklch(0.55 0.05 222); background: transparent; padding: .45rem .9rem; border-radius: 8px; text-decoration: none; font: inherit; cursor: pointer; }
 a.ghost:hover, button.ghost:hover { background: oklch(0.38 0.05 222); }
 table { width: 100%; border-collapse: collapse; margin-top: .8rem; }
 th, td { text-align: left; padding: .55rem .6rem; border-bottom: 1px solid #e8e2d5; font-size: .9rem; }
 th { color: #5f6b76; font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; }
 .muted { color: #7a8691; }
 .error { background: #fdecec; color: #b3261e; padding: .7rem 1rem; border-radius: 8px; }
 .ok { background: #e8f6ec; color: #1c7c3a; padding: .7rem 1rem; border-radius: 8px; }
 .exp-form { margin-top: 1rem; display: grid; gap: .7rem; max-width: 640px; }
 .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: .7rem; }
 label { display: grid; gap: .25rem; font-size: .85rem; color: #4a5560; }
 input, textarea { padding: .55rem .7rem; border: 1px solid #d8d2c4; border-radius: 8px; font: inherit; background: #fbf9f4; }
 button { background: oklch(0.55 0.12 222); color: #fff; border: 0; padding: .6rem 1.2rem; border-radius: 8px; font: inherit; cursor: pointer; }
 button.mini { padding: .3rem .7rem; font-size: .8rem; background: oklch(0.6 0.08 222); }
 .servicios-cell { font-size: .8rem; color: #4a5560; max-width: 220px; }
 .chips { display: flex; flex-wrap: wrap; gap: .5rem; margin: .4rem 0 1rem; }
 .chip { background: #eef4f8; color: oklch(0.35 0.08 222); border: 1px solid #cfdde6; }
 .chip:hover { background: oklch(0.9 0.03 222); }
 .equipo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: .6rem; margin: .4rem 0 1rem; }
 .equipo-card { display: grid; gap: .2rem; text-align: left; background: #fbf9f4; color: #1c2733; border: 1px solid #e0d9c8; padding: .7rem .9rem; border-radius: 10px; }
 .equipo-card:hover { border-color: oklch(0.55 0.12 222); background: #f2f7fa; }
 .equipo-card strong { font-size: .92rem; }
 .equipo-card span { font-size: .82rem; color: #4a5560; }
 .equipo-card em { font-style: normal; font-size: .75rem; color: #7a8691; }
 h2 { margin: 0 0 .4rem; }
 h3 { margin: 1.2rem 0 .2rem; }
</style>
