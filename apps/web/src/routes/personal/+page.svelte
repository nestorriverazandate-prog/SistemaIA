<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';

 let perfil = $state(null);
 let loading = $state(true);
 let authError = $state('');
 let formError = $state('');
 let formOk = $state('');

 const ADMIN_EMAIL = 'nestorriverazandate@gmail.com';
 const ROLES = [
 { valor: 'paciente', etiqueta: 'Paciente' },
 { valor: 'staff', etiqueta: 'Trabajador' },
 { valor: 'familiar', etiqueta: 'Familiar' },
 { valor: 'cuidador', etiqueta: 'Cuidador' },
 { valor: 'admin', etiqueta: 'Directivo' }
 ];
 const opcionesRol = (u) => u.email === ADMIN_EMAIL ? ROLES.filter((r) => r.valor === 'admin') : ROLES.filter((r) => r.valor !== 'admin');

 // ===== Directorio y expedientes del personal =====
 let directorio = $state([]);
 let dirBusqueda = $state('');
 let dirFiltroEstado = $state('');
 let dirFiltroArea = $state('');
 let dirSel = $state(null);
 let dirForm = $state({});
 let dirContactos = $state([]);
 let dirHistorial = $state([]);
 let dirVerHistorial = $state(false);
 let dirNueva = $state(false);
 let dirNuevo = $state({ nombre: '', email: '', password: '', rol: 'staff', profesion: '', telefono: '' });

 const DIR_CAMPOS = {
 personal: [
 ['nombre', 'Nombre completo'], ['fecha_nacimiento', 'Fecha de nacimiento', 'date'], ['sexo', 'Sexo'],
 ['curp', 'CURP'], ['codigo_postal', 'Código postal'], ['domicilio', 'Domicilio particular'], ['telefono', 'Teléfono personal']
 ],
 profesional: [
 ['profesion', 'Profesión o licenciatura'], ['especialidad', 'Especialidad'], ['cedula_profesional', 'Cédula profesional'],
 ['institucion', 'Institución educativa de egreso'], ['cursos', 'Cursos, diplomados y certificaciones'],
 ['experiencia_anos', 'Años de experiencia'], ['experiencia_previa', 'Experiencia laboral previa'],
 ['areas', 'Áreas de competencia'], ['servicios_autorizados', 'Servicios autorizados']
 ],
 laboral: [
 ['puesto', 'Puesto en la agencia'], ['tipo_contrato', 'Tipo de contrato'], ['horario', 'Horario laboral'],
 ['dias_disponibles', 'Días disponibles'], ['zona', 'Zona de trabajo'], ['sueldo', 'Sueldo / modalidad de pago'],
 ['disponibilidad', 'Disponibilidad'], ['id_laboral', 'Número de identificación laboral'],
 ['fecha_contratacion', 'Fecha de contratación', 'date']
 ]
 };
 const DIR_TITULOS = { personal: 'A. Datos personales', profesional: 'B. Información profesional', laboral: 'C. Información laboral' };
 const CONTACTO_VACIO = { nombre: '', parentesco: '', telefono: '', telefono_alt: '', email: '', domicilio: '', observaciones: '', principal: false };

 const estadoLaboralDe = (t) => t.estado_laboral || 'activo';
 const dirFiltrados = $derived(directorio.filter((t) => {
 const q = dirBusqueda.trim().toLowerCase();
 if (q && ![t.nombre, t.profesion, t.especialidad, t.areas, t.puesto].some((v) => (v || '').toLowerCase().includes(q))) return false;
 if (dirFiltroEstado && estadoLaboralDe(t) !== dirFiltroEstado) return false;
 if (dirFiltroArea) {
 const area = dirFiltroArea.toLowerCase();
 if (!(t.profesion || '').toLowerCase().includes(area) && !(t.areas || '').toLowerCase().includes(area)) return false;
 }
 return true;
}));
 const dirAreas = $derived([...new Set(directorio.flatMap((t) => [t.profesion, t.areas]).filter(Boolean))].sort());
 const dirStats = $derived({
 activos: directorio.filter((t) => estadoLaboralDe(t) === 'activo').length,
 inactivos: directorio.filter((t) => estadoLaboralDe(t) === 'inactivo').length,
 suspendidos: directorio.filter((t) => estadoLaboralDe(t) === 'suspendido').length
 });

 async function cargarDirectorio() {
 try { const r = await api.directorio(); directorio = r.trabajadores || []; } catch { /* silencioso */ }
 }
 function abrirExpediente(t) {
 dirSel = t;
 dirForm = { ...t };
 dirContactos = (Array.isArray(t.contactos_emergencia) ? t.contactos_emergencia : []).map((c) => ({ ...CONTACTO_VACIO, ...c }));
 if (dirContactos.length && !dirContactos.some((c) => c.principal)) dirContactos[0].principal = true;
 dirHistorial = []; dirVerHistorial = false;
 api.historialPerfil(t.id).then((r) => { dirHistorial = r.historial || []; }).catch(() => {});
 }
 function cerrarExpediente() { dirSel = null; dirForm = {}; dirContactos = []; dirHistorial = []; }
 function agregarContacto() { if (dirContactos.length < 2) dirContactos = [...dirContactos, { ...CONTACTO_VACIO, principal: dirContactos.length === 0 }]; }
 function quitarContacto(i) {
 dirContactos = dirContactos.filter((_, idx) => idx !== i);
 if (dirContactos.length && !dirContactos.some((c) => c.principal)) dirContactos[0].principal = true;
 }
 function marcarPrincipal(i) { dirContactos = dirContactos.map((c, idx) => ({ ...c, principal: idx === i })); }

 async function guardarExpedienteDir() {
 formError = ''; formOk = '';
 try {
 const body = { estado_laboral: dirForm.estado_laboral || 'activo', contactos_emergencia: dirContactos };
 for (const campos of Object.values(DIR_CAMPOS)) for (const [f] of campos) body[f] = dirForm[f] ?? '';
 const { perfil } = await api.actualizarPerfil(dirSel.id, body);
 dirSel = perfil;
 const idx = directorio.findIndex((x) => x.id === perfil.id);
 if (idx >= 0) directorio[idx] = perfil;
 formOk = 'Expediente guardado';
 api.historialPerfil(perfil.id).then((r) => { dirHistorial = r.historial || []; }).catch(() => {});
 } catch (e) { formError = e.message; }
 }
 async function cambiarEstadoLaboral(t, valor) {
 try {
 const { perfil } = await api.actualizarPerfil(t.id, { estado_laboral: valor });
 const idx = directorio.findIndex((x) => x.id === t.id);
 if (idx >= 0) directorio[idx] = perfil;
 if (dirSel?.id === t.id) dirSel = perfil;
 } catch (e) { formError = e.message; }
 }
 async function eliminarTrabajador(t) {
 if (!confirm(`¿Eliminar a ${t.nombre || t.email}? Se borrará su cuenta de acceso. Esta acción no se puede deshacer.`)) return;
 formError = ''; formOk = '';
 try {
 await api.eliminarTrabajador(t.id);
 directorio = directorio.filter((x) => x.id !== t.id);
 if (dirSel?.id === t.id) cerrarExpediente();
 formOk = 'Trabajador eliminado';
 } catch (e) { formError = e.message; }
 }
 async function agregarTrabajador(e) {
 e.preventDefault();
 formError = ''; formOk = '';
 try {
 const { trabajador } = await api.crearTrabajador(dirNuevo);
 directorio = [...directorio, trabajador].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
 dirNuevo = { nombre: '', email: '', password: '', rol: 'staff', profesion: '', telefono: '' };
 dirNueva = false;
 formOk = 'Trabajador registrado — ya puede iniciar sesión';
 } catch (err) { formError = err.message; }
 }
 const fmtFecha = (v) => v ? String(v).slice(0, 10) : '—';

 onMount(async () => {
 if (!getToken()) { loading = false; return; }
 try {
 const { user: me } = await api.me();
 perfil = me.perfil;
 } catch { setToken(null); }
 loading = false;
 if (perfil?.rol === 'admin') cargarDirectorio();
 });

 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Personal — Agencia Gerontológica</title></svelte:head>

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
 <h1>Directorio y expedientes del personal</h1>
 </div>
 </a>
 <div>
 <span class="badge">{perfil.email} · Directivo</span>
 <a class="ghost link" href="/">Inicio</a>
 <a class="ghost link" href="/visitas">Visitas</a>
 <a class="ghost link" href="/mapa">Mapa</a>
 <a class="ghost link" href="/pacientes">Pacientes</a>
 <a class="ghost link" href="/paquetes">Paquetes</a>
 <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="grid">
 <!-- ===== Directorio y expedientes del personal ===== -->
 <section class="card wide" id="directorio">
 <div class="dir-header">
 <h2>Directorio y expedientes del personal ({directorio.length})</h2>
 <button class="mini" onclick={() => { dirNueva = !dirNueva; dirSel = null; }}>Agregar trabajador</button>
 </div>
 <div class="dir-stats">
 <span class="chip chip-activo">Activos: {dirStats.activos}</span>
 <span class="chip chip-inactivo">Inactivos: {dirStats.inactivos}</span>
 <span class="chip chip-suspendido">Suspendidos: {dirStats.suspendidos}</span>
 </div>
 <div class="row dir-filtros">
 <input placeholder="Buscar por nombre, profesión, especialidad…" bind:value={dirBusqueda} />
 <select bind:value={dirFiltroEstado}>
 <option value="">Todos los estados</option>
 <option value="activo">activo</option>
 <option value="inactivo">inactivo</option>
 <option value="suspendido">suspendido</option>
 </select>
 <select bind:value={dirFiltroArea}>
 <option value="">Todas las áreas</option>
 {#each dirAreas as a}<option value={a}>{a}</option>{/each}
 </select>
 </div>

 {#if dirNueva}
 <h3>Registrar nuevo trabajador</h3>
 <form class="exp-form" onsubmit={agregarTrabajador}>
 <div class="row">
 <label>Nombre completo <input bind:value={dirNuevo.nombre} required /></label>
 <label>Email <input type="email" bind:value={dirNuevo.email} required /></label>
 <label>Contraseña inicial <input type="password" bind:value={dirNuevo.password} required minlength="6" /></label>
 </div>
 <div class="row">
 <label>Rol
 <select bind:value={dirNuevo.rol}>
 <option value="staff">Trabajador</option>
 <option value="paciente">Paciente</option>
 <option value="familiar">Familiar</option>
 <option value="cuidador">Cuidador</option>
 </select></label>
 <label>Profesión <input bind:value={dirNuevo.profesion} /></label>
 <label>Teléfono <input bind:value={dirNuevo.telefono} /></label>
 </div>
 <p class="muted small">Se creará la cuenta de acceso (ya aprobada) y el trabajador podrá iniciar sesión de inmediato.</p>
 <div class="btns">
 <button>Registrar trabajador</button>
 <button type="button" class="ghost" onclick={() => (dirNueva = false)}>Cancelar</button>
 </div>
 </form>
 {/if}

 <table>
 <thead><tr><th></th><th>Nombre</th><th>Profesión / especialidad</th><th>Teléfono</th><th>Email</th><th>Estado laboral</th><th>Ingreso</th><th></th></tr></thead>
 <tbody>
 {#each dirFiltrados as t (t.id)}
 <tr class:dir-selected={dirSel?.id === t.id}>
 <td>{#if t.avatar_url}<img class="dir-avatar" src={t.avatar_url} alt="" />{:else}<span class="dir-avatar dir-avatar-empty">{(t.nombre || t.email || '?').charAt(0).toUpperCase()}</span>{/if}</td>
 <td>{t.nombre || '—'}</td>
 <td>{[t.profesion, t.especialidad].filter(Boolean).join(' · ') || '—'}</td>
 <td>{t.telefono || '—'}</td>
 <td>{t.email}</td>
 <td>
 <select value={estadoLaboralDe(t)} onchange={(e) => cambiarEstadoLaboral(t, e.target.value)}>
 <option value="activo">activo</option>
 <option value="inactivo">inactivo</option>
 <option value="suspendido">suspendido</option>
 </select>
 </td>
 <td>{fmtFecha(t.fecha_contratacion)}</td>
 <td class="acciones">
 <button class="mini" onclick={() => abrirExpediente(t)}>Expediente</button>
 {#if t.email !== ADMIN_EMAIL}
 <button class="mini danger" onclick={() => eliminarTrabajador(t)}>Eliminar</button>
 {/if}
 </td>
 </tr>
 {:else}<tr><td colspan="8" class="muted">Sin trabajadores{dirBusqueda || dirFiltroEstado || dirFiltroArea ? ' con esos filtros' : ''}</td></tr>{/each}
 </tbody>
 </table>

 {#if dirSel}
 <div class="expediente">
 <div class="expediente-head">
 <h3>Expediente — {dirSel.nombre || dirSel.email}</h3>
 <div>
 <button class="mini" onclick={() => window.print()}>Imprimir / PDF</button>
 <button class="mini ghost" onclick={() => { dirVerHistorial = !dirVerHistorial; }}>Historial</button>
 <button class="mini danger" onclick={() => eliminarTrabajador(dirSel)}>Eliminar</button>
 <button class="mini ghost" onclick={cerrarExpediente}>Cerrar</button>
 </div>
 </div>
 <form class="exp-form" onsubmit={(e) => { e.preventDefault(); guardarExpedienteDir(); }}>
 {#each Object.entries(DIR_CAMPOS) as [seccion, campos]}
 <h4>{DIR_TITULOS[seccion]}</h4>
 <div class="row">
 {#each campos as [f, label, tipo]}
 <label>{label} <input bind:value={dirForm[f]} type={tipo || 'text'} /></label>
 {/each}
 </div>
 {/each}
 <h4>Estado laboral</h4>
 <div class="row">
 <label>Estado
 <select bind:value={dirForm.estado_laboral}>
 <option value="activo">activo</option>
 <option value="inactivo">inactivo</option>
 <option value="suspendido">suspendido</option>
 </select></label>
 <label>Rol
 <select bind:value={dirForm.rol} disabled={dirSel.email === ADMIN_EMAIL}>
 {#each opcionesRol(dirSel) as r}<option value={r.valor}>{r.etiqueta}</option>{/each}
 </select></label>
 <label>Disponibilidad en agenda <input bind:value={dirForm.disponibilidad} placeholder="Ej. mañanas, tiempo completo" /></label>
 </div>

 <h4>Contacto de emergencia</h4>
 {#each dirContactos as c, i}
 <div class="contacto-card">
 <div class="row">
 <label>Nombre <input bind:value={c.nombre} /></label>
 <label>Parentesco / relación <input bind:value={c.parentesco} placeholder="Ej. hija, vecino" /></label>
 <label>Teléfono principal <input bind:value={c.telefono} type="tel" /></label>
 {#if c.telefono}<a class="mini ghost" href="tel:{c.telefono}">Llamar</a>{/if}
 </div>
 <div class="row">
 <label>Teléfono alternativo <input bind:value={c.telefono_alt} type="tel" /></label>
 <label>Email (opcional) <input bind:value={c.email} type="email" /></label>
 <label>Domicilio (opcional) <input bind:value={c.domicilio} /></label>
 </div>
 <div class="row">
 <label>Observaciones <input bind:value={c.observaciones} /></label>
 <label class="check"><input type="radio" checked={c.principal} onchange={() => marcarPrincipal(i)} /> Contacto principal</label>
 <button type="button" class="mini danger" onclick={() => quitarContacto(i)}>Quitar</button>
 </div>
 </div>
 {/each}
 {#if dirContactos.length < 2}
 <button type="button" class="mini ghost" onclick={agregarContacto}>Agregar contacto de emergencia ({dirContactos.length}/2)</button>
 {/if}

 {#if dirVerHistorial}
 <h4>Historial de modificaciones</h4>
 {#if dirHistorial.length}
 <table class="historial">
 <thead><tr><th>Fecha</th><th>Campo</th><th>Cambió de</th><th>a</th><th>Por</th></tr></thead>
 <tbody>
 {#each dirHistorial as h (h.id)}
 <tr>
 <td>{fmtFecha(h.created_at)}</td>
 <td>{h.campo}</td>
 <td class="muted">{h.valor_anterior}</td>
 <td>{h.valor_nuevo}</td>
 <td class="muted">{h.actor}</td>
 </tr>
 {/each}
 </tbody>
 </table>
 {:else}<p class="muted small">Sin cambios registrados aún.</p>{/if}
 {/if}

 <div class="btns">
 <button>Guardar expediente</button>
 </div>
 </form>
 </div>
 {/if}
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
.logo-login { display: block; width: 96px; height: 96px; object-fit: cover; margin: 0 auto 1rem; border-radius: 16px; background: #f2eee2; padding: 6px; }
.agency-login { text-align: center; font-size: .78rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: oklch(0.7 0.1 78); margin: -0.5rem 0 1rem; }
.badge { font-size:.75rem; background: oklch(0.42 0.068 218); color: #f2eee2; padding:.3rem.6rem; border-radius: 999px; }
.stats-mini { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: .8rem; }
.stats-mini .badge { background: oklch(0.66 0.055 145); color: oklch(0.27 0.035 225); }
h3 { font-size: .95rem; margin: 1rem 0 .5rem; }
.exp-form { display: flex; flex-direction: column; gap: .7rem; margin-top: .8rem; border-top: 1px solid oklch(0.93 0.025 140); padding-top: .8rem; }
.grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 1.5rem; padding: 1.5rem 2rem; max-width: 1200px; margin: 0 auto; }
.wide { grid-column: 1 / -1; }
 @media (max-width: 900px) {.grid { grid-template-columns: 1fr; } }
.card { background: #fff; border-radius: 12px; padding: 1.25rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
 main.card { max-width: 420px; margin: 4rem auto; }
.center { text-align: center; }
.muted { color: oklch(0.45 0.03 225); font-size:.9rem; }
.divider { display: flex; align-items: center; gap:.75rem; color: oklch(0.55 0.03 225); font-size:.8rem; margin:.9rem 0; }
.divider::before,.divider::after { content: ''; flex: 1; border-top: 1px solid oklch(0.9 0.018 85); }
.switch { font-size:.85rem; color: oklch(0.45 0.03 225); text-align: center; margin:.9rem 0 0; }
.switch a { color: oklch(0.42 0.068 218); }
.google-btn { display: flex; justify-content: center; margin-bottom:.25rem; }
.auth-msg { margin:.5rem 0; }
.small { font-size:.78rem; }
 h2 { margin-top: 0; font-size: 1.05rem; }
 form { display: flex; flex-direction: column; gap:.75rem; }
.row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:.75rem; }
.dir-header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.dir-header h2 { margin: 0; }
.dir-stats { display: flex; gap: .5rem; flex-wrap: wrap; margin: .6rem 0; }
.chip { padding: .25rem .7rem; border-radius: 999px; font-size: .82rem; font-weight: 600; }
.chip-activo { background: oklch(0.92 0.06 150); color: oklch(0.4 0.08 150); }
.chip-inactivo { background: oklch(0.92 0.02 85); color: oklch(0.45 0.03 85); }
.chip-suspendido { background: oklch(0.92 0.05 40); color: oklch(0.45 0.1 40); }
.dir-filtros { margin: .6rem 0; }
.dir-avatar { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; display: inline-flex; align-items: center; justify-content: center; background: oklch(0.9 0.04 80); color: oklch(0.4 0.06 250); font-weight: 700; font-size: .9rem; }
.dir-selected td { background: oklch(0.96 0.02 140); }
.expediente { margin-top: 1rem; border: 1px solid oklch(0.88 0.03 140); border-radius: 12px; padding: 1rem; background: oklch(0.985 0.008 140); }
.expediente-head { display: flex; justify-content: space-between; align-items: center; gap: .75rem; flex-wrap: wrap; margin-bottom: .5rem; }
.expediente-head h3 { margin: 0; }
.expediente-head > div { display: flex; gap: .4rem; flex-wrap: wrap; }
.expediente h4 { margin: 1rem 0 .4rem; color: oklch(0.38 0.07 250); font-size: .95rem; }
.contacto-card { border: 1px solid oklch(0.9 0.03 140); border-radius: 10px; padding: .6rem .8rem; margin-bottom: .6rem; background: #fff; }
.check { display: flex; align-items: center; gap: .4rem; font-weight: 500; }
.historial { font-size: .82rem; margin-top: .5rem; }
 label { display: flex; flex-direction: column; gap:.25rem; font-size:.85rem; font-weight: 600; }
 input, textarea, select { padding:.55rem.65rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
 button { padding:.6rem 1rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; }
 button:hover:not(:disabled) { background: oklch(0.36 0.068 218); }
 button:disabled { opacity:.6; cursor: default; }
 button.ghost, button.mini.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.45 0.03 225); }
 header button.ghost, header a.ghost { color: #f2eee2; border-color: oklch(0.55 0.05 222); }
 .link { padding:.4rem.8rem; border: 1px solid oklch(0.45 0.03 225); border-radius: 8px; text-decoration: none; }
 .notif-wrap { position: relative; }
 .bell { position: relative; }
 .notif-count { background: #b91c1c; color: #fff; border-radius: 999px; font-size: .7rem; padding: .05rem .4rem; margin-left: .3rem; }
 .notif-panel { position: absolute; right: 0; top: 110%; width: 340px; max-height: 380px; overflow: auto; background: #fff; color: oklch(0.27 0.035 225); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.25); padding: .6rem; z-index: 50; }
 .notif-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: .4rem; }
 .mini-link { background: none; border: 0; color: oklch(0.42 0.068 218); font-size: .78rem; cursor: pointer; text-decoration: underline; }
 .notif-item { padding: .5rem .4rem; border-bottom: 1px solid oklch(0.93 0.025 140); cursor: pointer; font-size: .82rem; }
 .notif-item.noleida { background: oklch(0.93 0.025 140); border-radius: 6px; }
 .notif-item small { color: oklch(0.55 0.03 225); }
 .notif-tipo { font-size: .68rem; background: oklch(0.94 0.025 80); border-radius: 999px; padding: .1rem .45rem; margin-left: .3rem; text-transform: uppercase; }
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
</style>
