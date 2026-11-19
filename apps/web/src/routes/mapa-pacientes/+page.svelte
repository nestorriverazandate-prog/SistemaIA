<script>
 import { onMount, tick } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';
 import 'leaflet/dist/leaflet.css';

 let perfil = $state(null);
 let loading = $state(true);
 let pacientes = $state([]);
 let L;
 let map;
 let mapEl;
 let marcadores = {};
 let msg = $state('');
 const geoCache = {};

 function iconoDomicilio() {
  return L.divIcon({
   className: 'marker-div',
   html: '<div style="background:#135666;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
   iconSize: [28, 28], iconAnchor: [14, 14]
  });
 }

 function pintar() {
  if (!map || !L) return;
  for (const k of Object.keys(marcadores)) { map.removeLayer(marcadores[k]); delete marcadores[k]; }
  const conCoords = pacientes.filter((p) => p.lat != null && p.lng != null);
  for (const p of conCoords) {
   const m = L.marker([p.lat, p.lng], { icon: iconoDomicilio() })
    .bindPopup(`<b>${p.nombre} ${p.apellido}</b><br/>${p.direccion || ''}<br/><small>${p.telefono || ''}</small>`);
   m.addTo(map);
   marcadores[`pac-${p.id}`] = m;
  }
  if (conCoords.length) {
   map.fitBounds(L.latLngBounds(conCoords.map((p) => [p.lat, p.lng])).pad(0.25));
  }
 }

 async function geocodificar(p) {
  const q = `${p.direccion || ''}, ${p.nombre || ''} ${p.apellido || ''}`.trim();
  if (!q || geoCache[q]) return geoCache[q] || null;
  try {
   const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
   const j = await r.json();
   if (j?.[0]) geoCache[q] = { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
  } catch { /* sin geocodificación */ }
  return geoCache[q] || null;
 }

 function comoLlegar(p) {
  const dest = p.lat != null && p.lng != null
   ? `${p.lat},${p.lng}`
   : encodeURIComponent(`${p.direccion || ''} ${p.nombre || ''} ${p.apellido || ''}`.trim());
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest}`, '_blank');
 }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
   if (!['staff', 'cuidador', 'familiar', 'admin'].includes(perfil?.rol) || perfil?.estado === 'rechazado') { loading = false; return; }
   const r = await api.pacientes();
   pacientes = r.pacientes || [];
   // Geocodificar pacientes sin coordenadas
   for (const p of pacientes) {
    if (p.lat != null || !p.direccion) continue;
    const g = await geocodificar(p);
    if (g) { p.lat = g.lat; p.lng = g.lng; }
   }
   await tick();
   if (!mapEl) { loading = false; return; }
   L = (await import('leaflet')).default;
   const conCoords = pacientes.filter((p) => p.lat != null && p.lng != null);
   map = L.map(mapEl).setView(conCoords.length ? [conCoords[0].lat, conCoords[0].lng] : [19.4326, -99.1332], 12);
   L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
   pintar();
  } catch (e) { msg = e.message; }
  finally { loading = false; }
 });
 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Mapa de pacientes — Agencia Gerontológica</title></svelte:head>

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
   <h1>Mapa de pacientes</h1>
  </div>
 </a>
 <div>
  <span class="badge">{perfil.email} · {perfil.rol === 'admin' ? 'Directivo' : 'Empleado'}</span>
  <a class="ghost link" href="/mis-pacientes">Mis pacientes</a>
  <a class="ghost link" href="/visitas">Mis visitas</a>
  <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="layout">
 <section class="card mapa-card">
  <div class="map-wrap" bind:this={mapEl}></div>
  <p class="muted small">Solo domicilios de tus pacientes asignados. Toca un marcador para ver la dirección.</p>
  {#if msg}<p class="error">{msg}</p>{/if}
 </section>

 <section class="card">
  <h2>Domicilios ({pacientes.length})</h2>
  <table>
   <thead><tr><th>Paciente</th><th>Dirección</th><th></th></tr></thead>
   <tbody>
   {#each pacientes as p (p.id)}
    <tr>
     <td>{p.nombre} {p.apellido}{#if p.contacto_emergencia}<br/><small class="muted">Emergencia: {p.contacto_emergencia}</small>{/if}</td>
     <td>{p.direccion || '—'}{#if p.lat == null}<br/><small class="muted">Sin coordenadas — se ubica por dirección</small>{/if}</td>
     <td><button class="mini" onclick={() => comoLlegar(p)}>Cómo llegar</button></td>
    </tr>
   {:else}<tr><td colspan="3" class="muted">Sin pacientes asignados</td></tr>{/each}
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
.center { text-align: center; max-width: 420px; margin: 4rem auto; }
.muted { color: oklch(0.45 0.03 225); font-size:.9rem; }
.small { font-size:.78rem; }
.error { color: oklch(0.55 0.2 27); font-size:.85rem; }
.link { padding:.4rem.8rem; border: 1px solid oklch(0.55 0.05 222); border-radius: 8px; text-decoration: none; color: #f2eee2; }
.layout { display: grid; grid-template-columns: 1fr 380px; gap: 1rem; padding: 1rem; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
.mapa-card { display: flex; flex-direction: column; }
.map-wrap { height: 65vh; min-height: 380px; border-radius: 10px; overflow: hidden; }
.map-wrap :global(.leaflet-container) { height: 100%; width: 100%; }
:global(.marker-div) { background: transparent; border: none; }
h2 { margin-top: 0; font-size: 1.05rem; }
table { width: 100%; border-collapse: collapse; font-size:.85rem; }
th, td { text-align: left; padding:.5rem .4rem; border-bottom: 1px solid oklch(0.93 0.025 140); }
button { padding:.5rem .9rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; }
button.mini { padding:.25rem .6rem; font-size:.75rem; }
button.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.55 0.05 222); }
</style>
