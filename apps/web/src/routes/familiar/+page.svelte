<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';

 let perfil = $state(null);
 let loading = $state(true);
 let grupos = $state([]);
 let error = $state('');
 let msgOk = $state('');
 let sel = $state(null);       // grupo seleccionado (detalle)
 let mensaje = $state('');
 let enviando = $state(false);
 let famForm = $state({ nombre: '', telefono: '' });
 let famMsg = $state('');
 let famErr = $state('');
 let famSaving = $state(false);

 async function guardarMisDatos() {
  famErr = ''; famMsg = '';
  famSaving = true;
  try {
   const { perfil: p } = await api.actualizarPerfil(perfil.id, famForm);
   perfil = { ...perfil, ...p };
   famMsg = 'Datos actualizados';
  } catch (e) { famErr = e.message; }
  finally { famSaving = false; }
 }

 function fmtFecha(f) { return f ? new Date(f.length === 10 ? f + 'T12:00:00' : f).toLocaleDateString('es-EC', { dateStyle: 'medium' }) : '—'; }
 function fmtFechaHora(f) { return f ? new Date(f).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }

 async function cargar() {
  try {
   const r = await api.misFamiliares();
   grupos = r.pacientes || [];
  } catch (e) { error = e.message; }
 }

 async function enviarMsg() {
  if (!mensaje.trim()) return;
  enviando = true; error = '';
  try {
   await api.enviarMensaje(mensaje.trim());
   mensaje = '';
   msgOk = 'Mensaje enviado a la administración.';
   setTimeout(() => msgOk = '', 4000);
  } catch (e) { error = e.message; }
  finally { enviando = false; }
 }

 // Reporte mensual PDF (imprimir)
 function imprimirReporte(g) {
  const p = g.paciente;
  const w = window.open('', '_blank', 'width=900,height=700');
  const visitas = g.historial_visitas.map((v) => `<tr><td>${fmtFecha(v.fecha)}</td><td>${v.hora_programada || '—'}</td><td>${v.estado}</td></tr>`).join('');
  const notas = g.notas.map((n) => `<div class="nota"><h4>${fmtFechaHora(n.created_at)}${n.especialidad ? ' · ' + n.especialidad : ''}</h4>
   ${n.actividades ? `<p><b>Actividades:</b> ${n.actividades}</p>` : ''}
   ${n.evolucion ? `<p><b>Evolución:</b> ${n.evolucion}</p>` : ''}
   ${n.observaciones ? `<p><b>Observaciones:</b> ${n.observaciones}</p>` : ''}
   ${n.recomendaciones ? `<p><b>Recomendaciones:</b> ${n.recomendaciones}</p>` : ''}</div>`).join('');
  w.document.write(`<html><head><title>Reporte — ${p.nombre} ${p.apellido}</title><style>
   body{font-family:Georgia,serif;max-width:800px;margin:24px auto;padding:0 16px;color:#222}
   .logo{height:56px}.brand{display:flex;align-items:center;gap:12px;border-bottom:3px solid #c9a227;padding-bottom:10px}
   h1{font-size:1.1rem;margin:0;color:#234}.ag{font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:#8a6d1f;font-weight:700}
   .pac{display:flex;gap:14px;margin:14px 0;align-items:center}
   .pac img{width:90px;height:90px;border-radius:50%;object-fit:cover;border:2px solid #c9a227}
   table{width:100%;border-collapse:collapse;font-size:.82rem;margin:10px 0}
   th,td{border:1px solid #ccc;padding:5px 8px;text-align:left}th{background:#f4f1e8}
   .nota{border:1px solid #ddd;border-radius:8px;padding:10px;margin:8px 0;background:#faf9f5}
   .nota h4{margin:0 0 5px;font-size:.85rem;color:#234}.nota p{margin:3px 0;font-size:.8rem}
   .footer{margin-top:20px;font-size:.7rem;color:#777;border-top:1px solid #ccc;padding-top:8px}
   @media print{body{margin:0}}
  </style></head><body>
  <div class="brand"><img class="logo" src="${window.location.origin}/logo.png"/><div><h1>Agencia Gerontológica Integral</h1><div class="ag">Reporte de seguimiento</div></div></div>
  <div class="pac">
   ${p.foto_url ? `<img src="${p.foto_url}" alt=""/>` : ''}
   <div><h2 style="margin:0">${p.nombre} ${p.apellido}</h2>
   <p>${p.cedula ? p.cedula + ' años · ' : ''}${p.direccion || ''}<br/>${p.telefono || ''}</p></div>
  </div>
  <p><b>Paquete:</b> ${g.paquete?.nombre || p.tipo_servicio || '—'} — $${Number(g.paquete?.precio || 0).toFixed(2)}/mes<br/>
  <b>Servicios:</b> ${g.paquete?.servicios || g.paquete?.descripcion || '—'}</p>
  <h3>Próximas visitas</h3>
  <table><tr><th>Fecha</th><th>Hora</th><th>Estado</th></tr>${g.proximas_visitas.map((v) => `<tr><td>${fmtFecha(v.fecha)}</td><td>${v.hora_programada || '—'}</td><td>${v.estado}</td></tr>`).join('') || '<tr><td colspan="3">Sin visitas programadas</td></tr>'}</table>
  <h3>Historial de visitas realizadas</h3>
  <table><tr><th>Fecha</th><th>Hora</th><th>Estado</th></tr>${visitas || '<tr><td colspan="3">Sin visitas realizadas</td></tr>'}</table>
  <h3>Reportes de evolución</h3>
  ${notas || '<p>Sin información registrada</p>'}
  <div class="footer">Documento generado por la plataforma — ${new Date().toLocaleString('es-EC')}</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script>
  </body></html>`);
  w.document.close();
 }

 function imprimirCredencial() {
  const w = window.open('', '_blank', 'width=640,height=820');
  const nombre = perfil?.nombre || perfil?.email || 'Familiar';
  w.document.write(`<html><head><title>Credencial familiar</title><style>
   body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f1e8}
   .cred{width:340px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.18)}
   .cred-top{background:#234;height:14px}.cred-body{padding:20px;text-align:center}
   .logo{height:54px}.agencia{font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:#8a6d1f;font-weight:700}
   .cred-foto{width:100px;height:100px;border-radius:50%;background:#234;color:#fff;display:flex;align-items:center;justify-content:center;font-size:2rem;margin:10px auto;border:3px solid #c9a227}
   .nombre{font-size:1.15rem;font-weight:700;color:#222;margin:8px 0 2px}
   .rol{font-size:.8rem;color:#555}
   .datos{font-size:.72rem;color:#444;text-align:left;background:#faf8f0;border-radius:10px;padding:10px 12px;line-height:1.7;margin-top:10px}
   .datos b{color:#234}
   .cred-bot{background:#234;color:#f2eee2;font-size:.62rem;padding:8px;text-align:center;letter-spacing:.08em}
   @media print{body{background:#fff}.cred{box-shadow:none}}
  </style></head><body>
  <div class="cred"><div class="cred-top"></div><div class="cred-body">
   <img class="logo" src="${window.location.origin}/logo.png"/>
   <div class="agencia">Agencia Gerontológica Integral</div>
   <div class="cred-foto">👤</div>
   <div class="nombre">${nombre}</div>
   <div class="rol">Familiar responsable</div>
   <div class="datos">
    <b>Nombre:</b> ${nombre}<br/>
    <b>Correo:</b> ${perfil?.email || '—'}<br/>
    <b>Adultos mayores vinculados:</b> ${grupos.length}<br/>
    <b>Vigencia:</b> ${perfil?.estado === 'aprobado' ? 'Cuenta activa' : 'Pendiente'}
   </div>
  </div><div class="cred-bot">CREDENCIAL DE FAMILIAR RESPONSABLE</div></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script>
  </body></html>`);
  w.document.close();
 }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
   if (perfil?.rol !== 'familiar' && perfil?.rol !== 'admin') { loading = false; return; }
   famForm.nombre = perfil?.nombre || '';
   famForm.telefono = perfil?.telefono || '';
   await cargar();
  } catch { setToken(null); }
  finally { loading = false; }
 });
 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Portal familiar — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil || !['familiar', 'admin'].includes(perfil.rol)}
 <main class="card center"><h1>Acceso restringido</h1><p class="muted">Esta sección es para familiares responsables.</p><a class="ghost link" href="/">Volver</a></main>
{:else}
<header>
 <a class="brand" href="/">
  <img src="/logo.png" alt="Agencia Gerontológica Integral" />
  <div class="brand-text">
   <span class="agency">Agencia Gerontológica Integral</span>
   <h1>Portal familiar</h1>
  </div>
 </a>
 <div>
  <span class="badge">{perfil.email} · Familiar</span>
  <button class="mini ghost" onclick={imprimirCredencial}>🪪 Credencial</button>
  <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="layout">
 {#if error}<p class="error">{error}</p>{/if}
 {#if msgOk}<p class="ok">{msgOk}</p>{/if}

 <section class="card">
  <h2>Mis familiares ({grupos.length})</h2>
  {#if !grupos.length}
   <p class="muted">Aún no tienes adultos mayores vinculados. El directivo debe autorizar la vinculación con tu cuenta.</p>
  {:else}
   <div class="pac-grid">
    {#each grupos as g (g.paciente.id)}
     <button class="pac-card" onclick={() => sel = g}>
      {#if g.paciente.foto_url}<img class="pac-foto" src={g.paciente.foto_url} alt="" />{:else}<div class="pac-foto vacio">{(g.paciente.nombre || '?').charAt(0)}</div>{/if}
      <div class="pac-info">
       <strong>{g.paciente.nombre} {g.paciente.apellido}</strong>
       <span class="muted">{g.paciente.cedula ? g.paciente.cedula + ' años' : ''}</span>
       <span class="muted">{g.paciente.direccion || '—'}</span>
       <span class="pac-meta">
        {g.paquete?.nombre || g.paciente.tipo_servicio || 'Sin paquete'}
        {#if g.proximas_visitas[0]} · Próxima: {fmtFecha(g.proximas_visitas[0].fecha)}{/if}
       </span>
       <span class="estado">{g.historial_visitas.length} visitas realizadas</span>
      </div>
     </button>
    {/each}
   </div>
  {/if}
 </section>

 <section class="card">
  <h2>Mis datos personales</h2>
  <form class="msg-row" onsubmit={(e) => { e.preventDefault(); guardarMisDatos(); }}>
   <input bind:value={famForm.nombre} placeholder="Nombre completo" required />
   <input bind:value={famForm.telefono} placeholder="Teléfono" type="tel" />
   <button disabled={famSaving}>{famSaving ? 'Guardando…' : 'Guardar'}</button>
  </form>
  {#if famErr}<p class="error">{famErr}</p>{/if}
  {#if famMsg}<p class="ok">{famMsg}</p>{/if}
 </section>

 <section class="card">
  <h2>Enviar mensaje a la administración</h2>
  <div class="msg-row">
   <textarea bind:value={mensaje} rows="3" placeholder="Escribe tu consulta o solicitud…"></textarea>
   <button onclick={enviarMsg} disabled={enviando || !mensaje.trim()}>{enviando ? 'Enviando…' : 'Enviar'}</button>
  </div>
  <p class="muted small">Tu mensaje llega como notificación al directivo.</p>
 </section>
</main>

{#if sel}
 <div class="overlay" role="presentation" onclick={() => sel = null}>
 <div class="sheet" onclick={(e) => e.stopPropagation()}>
  <div class="sheet-head">
   <div class="sheet-id">
    {#if sel.paciente.foto_url}<img class="foto" src={sel.paciente.foto_url} alt="" />{:else}<div class="foto vacio">?</div>{/if}
    <div>
     <h3>{sel.paciente.nombre} {sel.paciente.apellido}</h3>
     <p class="muted">{sel.paciente.cedula ? sel.paciente.cedula + ' años · ' : ''}{sel.paciente.direccion || '—'} · {sel.paciente.telefono || '—'}</p>
    </div>
   </div>
   <button class="mini ghost" onclick={() => sel = null}>✕ Cerrar</button>
  </div>

  <div class="acciones">
   <button class="mini" onclick={() => imprimirReporte(sel)}>Descargar reporte mensual (PDF)</button>
   <button class="mini" onclick={imprimirCredencial}>🪪 Credencial familiar</button>
  </div>

  <h4>Paquete contratado</h4>
  <p>{sel.paquete?.nombre || sel.paciente.tipo_servicio || 'Sin información registrada'} — <strong>${Number(sel.paquete?.precio || 0).toFixed(2)}/mes</strong><br/>
  <span class="muted">{sel.paquete?.servicios || sel.paquete?.descripcion || 'Sin información registrada'}</span></p>

  <h4>Próximas visitas</h4>
  {#if sel.proximas_visitas.length}
   <table><thead><tr><th>Fecha</th><th>Hora</th><th>Estado</th></tr></thead><tbody>
   {#each sel.proximas_visitas as v (v.id)}<tr><td>{fmtFecha(v.fecha)}</td><td>{v.hora_programada || '—'}</td><td>{v.estado}</td></tr>{/each}
   </tbody></table>
  {:else}<p class="muted">Sin visitas programadas</p>{/if}

  <h4>Historial de visitas realizadas</h4>
  {#if sel.historial_visitas.length}
   <table><thead><tr><th>Fecha</th><th>Hora</th><th>Estado</th></tr></thead><tbody>
   {#each sel.historial_visitas as v (v.id)}<tr><td>{fmtFecha(v.fecha)}</td><td>{v.hora_programada || '—'}</td><td>{v.estado}</td></tr>{/each}
   </tbody></table>
  {:else}<p class="muted">Sin visitas realizadas</p>{/if}

  <h4>Reportes de evolución</h4>
  {#if sel.notas.length}
   <div class="notas">
    {#each sel.notas as n (n.id)}
     <div class="nota">
      <strong>{fmtFechaHora(n.created_at)}{n.especialidad ? ' · ' + n.especialidad : ''}</strong>
      {#if n.actividades}<p><b>Actividades:</b> {n.actividades}</p>{/if}
      {#if n.evolucion}<p><b>Evolución:</b> {n.evolucion}</p>{/if}
      {#if n.observaciones}<p><b>Observaciones:</b> {n.observaciones}</p>{/if}
      {#if n.recomendaciones}<p><b>Recomendaciones:</b> {n.recomendaciones}</p>{/if}
     </div>
    {/each}
   </div>
  {:else}<p class="muted">Sin información registrada</p>{/if}

  {#if sel.evidencias.length}
   <h4>Fotografías de las sesiones</h4>
   <div class="evs">
    {#each sel.evidencias as e (e.id)}
     <figure><img src={e.url} alt={e.descripcion || ''} /><figcaption>{e.descripcion || ''}</figcaption></figure>
    {/each}
   </div>
  {/if}
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
.layout { padding: 1rem 2rem; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }
.muted { color: oklch(0.45 0.03 225); font-size:.85rem; }
.small { font-size:.78rem; }
.error { color: oklch(0.55 0.2 27); font-size:.85rem; }
.ok { color: oklch(0.45 0.08 160); font-size:.85rem; }
.link { padding:.4rem.8rem; border: 1px solid oklch(0.45 0.03 225); border-radius: 8px; text-decoration: none; }
h2 { margin-top: 0; font-size: 1.05rem; }
.pac-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: .9rem; }
.pac-card { display: flex; gap: .8rem; text-align: left; background: #fff; border: 1px solid oklch(0.9 0.02 85); border-radius: 12px; padding: .8rem; cursor: pointer; font: inherit; color: inherit; }
.pac-card:hover { border-color: oklch(0.42 0.068 218); }
.pac-foto { width: 60px; height: 60px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
.pac-foto.vacio { display: flex; align-items: center; justify-content: center; background: oklch(0.93 0.03 80); font-weight: 700; color: oklch(0.45 0.06 250); }
.pac-info { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
.pac-info strong { font-size: .95rem; }
.pac-meta { font-size: .78rem; color: oklch(0.4 0.06 250); }
.estado { align-self: flex-start; font-size: .7rem; padding: .1rem .5rem; border-radius: 999px; background: oklch(0.94 0.025 140); margin-top: .2rem; }
.msg-row { display: flex; gap: .6rem; align-items: flex-start; }
.msg-row textarea { flex: 1; padding: .55rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
.overlay { position: fixed; inset: 0; background: oklch(0.2 0.03 260 / .5); display: flex; align-items: flex-start; justify-content: center; z-index: 60; padding: 1.5rem 1rem; overflow-y: auto; }
.sheet { background: #fff; border-radius: 16px; padding: 1.25rem; max-width: 760px; width: 100%; }
.sheet-head { display: flex; justify-content: space-between; gap: 1rem; border-bottom: 1px solid oklch(0.93 0.025 140); padding-bottom: .75rem; }
.sheet-id { display: flex; gap: .9rem; align-items: center; }
.sheet-id h3 { margin: 0; }
.foto { width: 64px; height: 64px; border-radius: 10px; object-fit: cover; }
.foto.vacio { display: flex; align-items: center; justify-content: center; background: oklch(0.95 0.02 85); }
.acciones { display: flex; gap: .5rem; margin: .8rem 0; flex-wrap: wrap; }
h4 { margin: 1rem 0 .5rem; font-size: .95rem; color: oklch(0.3 0.05 222); }
table { width: 100%; border-collapse: collapse; font-size: .85rem; }
th, td { text-align: left; padding: .45rem .4rem; border-bottom: 1px solid oklch(0.93 0.025 140); }
.notas { max-height: 40vh; overflow-y: auto; }
.nota { border-bottom: 1px solid oklch(0.93 0.025 140); padding: .6rem 0; font-size: .85rem; }
.nota p { margin: .15rem 0; font-size: .82rem; }
.evs { display: flex; flex-wrap: wrap; gap: .5rem; }
.evs figure { margin: 0; width: 110px; }
.evs img { width: 110px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid oklch(0.86 0.02 85); }
.evs figcaption { font-size: .65rem; color: oklch(0.5 0.03 85); }
button { padding:.5rem .9rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; }
button.mini { padding:.25rem .6rem; font-size:.75rem; }
button.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.55 0.05 222); }
button.mini.ghost { color: oklch(0.45 0.03 225); border-color: oklch(0.45 0.03 225); }
</style>
