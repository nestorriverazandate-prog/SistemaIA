<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';

 let perfil = $state(null);
 let loading = $state(true);
 let items = $state([]);
 let resumen = $state({ verde: 0, amarillo: 0, rojo: 0, alertas_abiertas: 0 });
 let error = $state('');
 let filtroColor = $state('');
 let filtroMotivo = $state('');
 let revModal = $state(null);   // alerta a revisar
 let revAcciones = $state('');
 let revSaving = $state(false);

 const COLORES = { verde: { label: 'Verde — al corriente', cls: 'verde' }, amarillo: { label: 'Amarillo — preventivo', cls: 'amarillo' }, rojo: { label: 'Rojo — prioritario', cls: 'rojo' } };

 const filtrados = $derived(items.filter((i) => {
  if (filtroColor && i.color !== filtroColor) return false;
  if (filtroMotivo && !i.motivos.some((m) => m.nivel === filtroMotivo)) return false;
  return true;
 }));

 async function cargar() {
  try {
   const r = await api.semaforo();
   items = r.items || [];
   resumen = r.resumen || resumen;
  } catch (e) { error = e.message; }
 }

 function abrirRevision(i) {
  revAcciones = '';
  revModal = { item: i, alerta: i.alerta_abierta || i.alertas?.[0] || null };
 }
 async function confirmarRevision() {
  if (!revModal?.alerta) return;
  revSaving = true; error = '';
  try {
   await api.revisarAlerta(revModal.alerta.id, revAcciones);
   revModal = null;
   await cargar();
  } catch (e) { error = e.message; }
  finally { revSaving = false; }
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

<svelte:head><title>Semáforo de bienestar — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil || perfil.rol !== 'admin'}
 <main class="card center"><h1>Acceso restringido</h1><p class="muted">Esta sección es exclusiva del directivo.</p><a class="ghost link" href="/">Volver</a></main>
{:else}
<header>
 <a class="brand" href="/">
  <img src="/logo.png" alt="Agencia Gerontológica Integral" />
  <div class="brand-text">
   <span class="agency">Agencia Gerontológica Integral</span>
   <h1>Semáforo de bienestar</h1>
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

<main class="layout">
 {#if error}<p class="error">{error}</p>{/if}

 <section class="resumen">
  <div class="res-card verde"><strong>{resumen.verde}</strong><span>Verde — al corriente</span></div>
  <div class="res-card amarillo"><strong>{resumen.amarillo}</strong><span>Amarillo — preventivo</span></div>
  <div class="res-card rojo"><strong>{resumen.rojo}</strong><span>Rojo — prioritario</span></div>
  <div class="res-card alerta"><strong>{resumen.alertas_abiertas}</strong><span>Alertas abiertas</span></div>
 </section>

 <section class="card">
  <div class="filtros">
   <select bind:value={filtroColor}>
    <option value="">Todos los colores</option>
    <option value="verde">Verde</option>
    <option value="amarillo">Amarillo</option>
    <option value="rojo">Rojo</option>
   </select>
   <select bind:value={filtroMotivo}>
    <option value="">Todos los motivos</option>
    <option value="rojo">Motivo rojo</option>
    <option value="amarillo">Motivo amarillo</option>
   </select>
   <span class="muted">{filtrados.length} paciente(s)</span>
  </div>

  <table>
   <thead><tr><th>Semáforo</th><th>Paciente</th><th>Motivos / alertas</th><th>Última actividad</th><th></th></tr></thead>
   <tbody>
   {#each filtrados as i (i.paciente.id)}
    <tr>
     <td><span class="dot {i.color}"></span> <span class="sem-label {i.color}">{COLORES[i.color].label}</span></td>
     <td><strong>{i.paciente.nombre} {i.paciente.apellido}</strong><br/><small class="muted">{i.paciente.direccion || '—'}</small></td>
     <td>
      {#if i.alerta_abierta}
       <span class="alerta-chip">⚠ {i.alerta_abierta.motivo} · {String(i.alerta_abierta.created_at).slice(0, 10)}</span>
      {/if}
      {#each i.motivos.slice(0, 3) as m}
       <div class="motivo {m.nivel}">• {m.texto}{#if m.fecha} <small>({String(m.fecha).slice(0, 10)})</small>{/if}</div>
      {/each}
      {#if !i.motivos.length}<span class="muted">Sin alertas — seguimiento al corriente</span>{/if}
     </td>
     <td class="muted">{i.stats.ultimaNotaDias != null ? `Nota hace ${i.stats.ultimaNotaDias}d` : 'Sin notas'}<br/>{i.stats.visitas} visitas · {i.stats.notas} notas</td>
     <td>{#if i.alerta_abierta}<button class="mini" onclick={() => abrirRevision(i)}>Revisar</button>{/if}</td>
    </tr>
   {:else}<tr><td colspan="5" class="muted">Sin pacientes</td></tr>{/each}
   </tbody>
  </table>
 </section>
</main>

{#if revModal}
 <div class="overlay" role="presentation" onclick={() => revModal = null}>
 <div class="sheet" onclick={(e) => e.stopPropagation()}>
  <h3>Revisar alerta — {revModal.item.paciente.nombre} {revModal.item.paciente.apellido}</h3>
  <p class="alerta-chip">{revModal.alerta?.motivo || 'Alerta'}</p>
  <label>Acciones tomadas / resolución
   <textarea bind:value={revAcciones} rows="4" placeholder="Describe las acciones realizadas para atender esta alerta…"></textarea>
  </label>
  <div class="btns">
   <button onclick={confirmarRevision} disabled={revSaving}>{revSaving ? 'Guardando…' : 'Marcar como revisada'}</button>
   <button class="ghost" onclick={() => revModal = null}>Cancelar</button>
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
.layout { padding: 1rem 2rem; max-width: 1200px; margin: 0 auto; }
.muted { color: oklch(0.45 0.03 225); font-size:.85rem; }
.error { color: oklch(0.55 0.2 27); }
.link { padding:.4rem.8rem; border: 1px solid oklch(0.55 0.05 222); border-radius: 8px; text-decoration: none; color: #f2eee2; }
.resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: .8rem; margin-bottom: 1rem; }
.res-card { border-radius: 12px; padding: 1rem; text-align: center; color: #fff; }
.res-card strong { display: block; font-size: 1.8rem; }
.res-card span { font-size: .78rem; }
.res-card.verde { background: #1e8e5a; } .res-card.amarillo { background: #d9a404; } .res-card.rojo { background: #c0392b; } .res-card.alerta { background: #5b4a8a; }
.filtros { display: flex; gap: .6rem; align-items: center; margin-bottom: .8rem; flex-wrap: wrap; }
.filtros select { padding: .45rem .6rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; }
table { width: 100%; border-collapse: collapse; font-size:.85rem; }
th, td { text-align: left; padding:.55rem .5rem; border-bottom: 1px solid oklch(0.93 0.025 140); vertical-align: top; }
.dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; }
.dot.verde { background: #1e8e5a; } .dot.amarillo { background: #d9a404; } .dot.rojo { background: #c0392b; }
.sem-label { font-size: .75rem; font-weight: 700; }
.sem-label.verde { color: #1e8e5a; } .sem-label.amarillo { color: #9a7b00; } .sem-label.rojo { color: #c0392b; }
.motivo { font-size: .8rem; margin-top: .2rem; }
.motivo.rojo { color: #c0392b; } .motivo.amarillo { color: #8a6d00; }
.alerta-chip { display: inline-block; background: #fdecea; color: #c0392b; border: 1px solid #f5c6c0; border-radius: 8px; padding: .2rem .5rem; font-size: .75rem; margin-bottom: .3rem; }
button { padding:.5rem .9rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; }
button.mini { padding:.25rem .6rem; font-size:.75rem; }
button.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.45 0.03 225); }
.overlay { position: fixed; inset: 0; background: oklch(0.2 0.03 260 / .5); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 1rem; }
.sheet { background: #fff; border-radius: 16px; padding: 1.5rem; max-width: 480px; width: 100%; }
.sheet h3 { margin-top: 0; }
.sheet label { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; font-weight: 600; }
.sheet textarea { padding: .55rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
.btns { display: flex; gap: .5rem; margin-top: .8rem; }
</style>
