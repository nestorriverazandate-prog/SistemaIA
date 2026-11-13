<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';
 import { env } from '$env/dynamic/public';

 let user = $state(null); // { email } si hay sesión
 let perfil = $state(null);
 let loading = $state(true);
 let authError = $state('');
 let googleBtn;

 let pacientes = $state([]);
 let perfiles = $state([]);
 let stats = $state(null);
 let notifs = $state([]);
 let notifAbiertas = $state(false);
 let notifTimer = null;
 let notifEs = null;
 let formError = $state('');
 let formOk = $state('');
 let saving = $state(false);

 let form = $state({
 nombre: '', apellido: '', edad: '', telefono: '', email: '',
 direccion: '', tipo_servicio: '', descripcion: '', fecha_solicitud: '', fecha_inicio: '', fecha_termino: '',
 lat: null, lng: null
 });

 function usarMiUbicacion() {
 if (!navigator.geolocation) { formError = 'GPS no soportado'; return; }
 navigator.geolocation.getCurrentPosition(
 (pos) => {
 form.lat = pos.coords.latitude;
 form.lng = pos.coords.longitude;
 formError = '';
 },
 () => { formError = 'No se pudo obtener la ubicación'; },
 { enableHighAccuracy: true, timeout: 10000 }
 );
 }

 const esAdmin = $derived(perfil?.rol === 'admin');
 const ROLES = [
 { valor: 'paciente', etiqueta: 'Paciente' },
 { valor: 'staff', etiqueta: 'Trabajador' },
 { valor: 'familiar', etiqueta: 'Familiar' },
 { valor: 'cuidador', etiqueta: 'Cuidador' },
 { valor: 'admin', etiqueta: 'Directivo' }
 ];
 const etiquetaRol = (r) => ROLES.find((x) => x.valor === r)?.etiqueta || r;
 const aprobado = $derived(perfil?.estado === 'aprobado' || esAdmin);

 async function entrar(data) {
 setToken(data.token);
 user = { email: data.perfil?.email || email };
 perfil = data.perfil || null;
 password = '';
 if (aprobado) await cargar();
 }

 async function cargar() {
 if (!aprobado) return;
 try {
 const [p, s] = await Promise.all([api.pacientes(), api.stats().catch(() => null)]);
 pacientes = p.pacientes;
 stats = s;
 if (esAdmin) {
 const r = await api.perfiles();
 perfiles = r.perfiles;
 cargarPaquetes();
 } else {
 const v = await api.visitas().catch(() => ({ visitas: [] }));
 misVisitas = v.visitas || [];
 empForm.telefono = perfil?.telefono || '';
 empForm.domicilio = perfil?.domicilio || '';
 }
 } catch (e) {
 formError = e.message;
 }
 }

 async function guardarMiPerfil() {
 empError = ''; empMsg = '';
 empSaving = true;
 try {
 await api.actualizarPerfil(perfil.id, empForm);
 perfil = { ...perfil, ...empForm };
 empMsg = 'Datos actualizados';
 } catch (e) { empError = e.message; }
 finally { empSaving = false; }
 }

 let authMode = $state('login'); // 'login' | 'registro' | 'verificar' | 'recuperar' | 'restablecer'
 let email = $state('');
 let password = $state('');
 let password2 = $state('');
 let codigo = $state('');
 let verifEmail = $state('');
 let authLoading = $state(false);
 let authInfo = $state('');

 async function onGoogleCredential(resp) {
 authError = '';
 authLoading = true;
 try {
 await entrar(await api.google(resp.credential));
 } catch (err) {
 authError = err.message;
 } finally {
 authLoading = false;
 }
 }

 function renderGoogleButton() {
 const clientId = env.PUBLIC_GOOGLE_CLIENT_ID;
 if (!clientId ||!googleBtn || user) return;
 const s = document.createElement('script');
 s.src = 'https://accounts.google.com/gsi/client';
 s.onload = () => {
 window.google.accounts.id.initialize({
 client_id: clientId,
 callback: onGoogleCredential
 });
 window.google.accounts.id.renderButton(googleBtn, { theme: 'outline', size: 'large', width: 320 });
 };
 document.head.appendChild(s);
 }

 async function loginPassword(e) {
 e.preventDefault();
 authError = '';
 authInfo = '';
 authLoading = true;
 try {
 const data = authMode === 'registro'
? await api.register(email, password, email.split('@')[0])
: await api.login(email, password);
 if (data.requiere_verificacion) {
 verifEmail = data.email || email;
 codigo = '';
 authMode = 'verificar';
 authError = '';
 authInfo = data.dev_codigo
 ? `Modo desarrollo — tu código es: ${data.dev_codigo}`
 : `Te enviamos un código de 6 dígitos a ${verifEmail}`;
 return;
 }
 await entrar(data);
 } catch (err) {
 if (err?.data?.requiere_verificacion) {
 verifEmail = err.data.email || email;
 codigo = '';
 authMode = 'verificar';
 authError = '';
 authInfo = `Verifica tu correo: te enviamos un código a ${verifEmail}`;
 } else {
 authError = err.message;
 }
 } finally {
 authLoading = false;
 }
 }

 async function verificarCodigo(e) {
 e.preventDefault();
 authError = '';
 authInfo = '';
 authLoading = true;
 try {
 const data = await api.verificar(verifEmail || email, codigo);
 await entrar(data);
 } catch (err) {
 authError = err.message;
 } finally {
 authLoading = false;
 }
 }

 async function reenviar() {
 authError = '';
 authInfo = '';
 authLoading = true;
 try {
 const data = await api.reenviarCodigo(verifEmail || email);
 authInfo = data.dev_codigo
 ? `Modo desarrollo — nuevo código: ${data.dev_codigo}`
 : 'Te enviamos un código nuevo a tu correo';
 } catch (err) {
 authError = err.message;
 } finally {
 authLoading = false;
 }
 }

 async function recuperarClave(e) {
 e.preventDefault();
 authError = '';
 authInfo = '';
 authLoading = true;
 try {
 const data = await api.recuperar(email);
 verifEmail = email;
 codigo = '';
 password = '';
 password2 = '';
 authMode = 'restablecer';
 authInfo = data.dev_codigo
 ? `Modo desarrollo — tu código es: ${data.dev_codigo}`
 : `Te enviamos un código a ${email}`;
 } catch (err) {
 authError = err.message;
 } finally {
 authLoading = false;
 }
 }

 async function restablecerClave(e) {
 e.preventDefault();
 authError = '';
 authInfo = '';
 if (password !== password2) { authError = 'Las contraseñas no coinciden'; return; }
 authLoading = true;
 try {
 await api.restablecer(verifEmail, codigo, password);
 authMode = 'login';
 email = verifEmail;
 password = '';
 authInfo = 'Contraseña actualizada. Ya puedes iniciar sesión.';
 } catch (err) {
 authError = err.message;
 } finally {
 authLoading = false;
 }
 }

 async function logout() {
 setToken(null);
 if (notifTimer) clearInterval(notifTimer);
 notifTimer = null;
 if (notifEs) { notifEs.close(); notifEs = null; }
 notifs = [];
 user = null;
 perfil = null;
 pacientes = [];
 perfiles = [];
 }

 let editandoId = $state(null);
 let misVisitas = $state([]);
 const visitasHoy = $derived(misVisitas.filter((v) => String(v.fecha) === new Date().toISOString().slice(0, 10)));
 let empForm = $state({ telefono: '', domicilio: '' });
 let empMsg = $state('');
 let empError = $state('');
 let empSaving = $state(false);
 const formVacio = { nombre: '', apellido: '', edad: '', telefono: '', email: '', direccion: '', tipo_servicio: '', descripcion: '', fecha_solicitud: '', fecha_inicio: '', fecha_termino: '', lat: null, lng: null };

 function editar(p) {
 form = {
 nombre: p.nombre || '', apellido: p.apellido || '', edad: p.cedula || '',
 telefono: p.telefono || '', email: p.email || '', direccion: p.direccion || '',
 tipo_servicio: p.tipo_servicio || '', descripcion: p.descripcion || '',
 fecha_solicitud: p.fecha_solicitud ? String(p.fecha_solicitud).slice(0, 10) : '',
 fecha_inicio: p.fecha_inicio ? String(p.fecha_inicio).slice(0, 10) : '',
 fecha_termino: p.fecha_termino ? String(p.fecha_termino).slice(0, 10) : '',
 lat: p.lat ?? null, lng: p.lng ?? null
 };
 editandoId = p.id;
 formError = ''; formOk = '';
 document.getElementById('form-paciente')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
 }

 function cancelarEdicion() {
 editandoId = null;
 form = { ...formVacio };
 formError = ''; formOk = '';
 }

 async function eliminar(p) {
 if (!confirm(`¿Eliminar a ${p.nombre} ${p.apellido}?`)) return;
 formError = ''; formOk = '';
 try {
 await api.eliminarPaciente(p.id);
 formOk = 'Paciente eliminado.';
 await cargar();
 } catch (e) { formError = e.message; }
 }

 async function crear(e) {
 e.preventDefault();
 formError = '';
 formOk = '';
 saving = true;
 try {
 if (editandoId) {
 await api.actualizarPaciente(editandoId, form);
 formOk = 'Paciente actualizado.';
 } else {
 await api.crearPaciente(form);
 formOk = 'Paciente registrado (Supabase + Drive).';
 }
 cancelarEdicion();
 await cargar();
 } catch (err) {
 formError = err.message;
 } finally {
 saving = false;
 }
 }

 async function cambiarEstado(id, estado) {
 try { await api.estadoPaciente(id, estado); await cargar(); }
 catch (e) { formError = e.message; }
 }

 async function cambiarPerfil(id, body) {
 try { await api.actualizarPerfil(id, body); await cargar(); }
 catch (e) { formError = e.message; }
 }

 // Expediente laboral
 let expId = $state(null);
 let expForm = $state({});
 function editarExpediente(u) {
 expId = u.id;
 expForm = {
 telefono: u.telefono || '', domicilio: u.domicilio || '', profesion: u.profesion || '',
 especialidad: u.especialidad || '', id_laboral: u.id_laboral || '',
 fecha_contratacion: u.fecha_contratacion ? String(u.fecha_contratacion).slice(0, 10) : '',
 estado_laboral: u.estado_laboral || 'activo'
 };
 }
 async function guardarExpediente() {
 formError = ''; formOk = '';
 try {
 await api.actualizarPerfil(expId, expForm);
 formOk = 'Expediente actualizado';
 expId = null;
 await cargar();
 } catch (e) { formError = e.message; }
 }

 // Paquetes / servicios
 let paquetes = $state([]);
 let formPaquete = $state({ nombre: '', descripcion: '', precio: '', duracion_min: 60 });
 async function cargarPaquetes() {
 try { const r = await api.paquetes(); paquetes = r.paquetes || []; } catch { /* tabla puede no existir aún */ }
 }
 async function crearPaquete(e) {
 e.preventDefault();
 formError = ''; formOk = '';
 try {
 await api.crearPaquete(formPaquete);
 formOk = 'Paquete creado';
 formPaquete = { nombre: '', descripcion: '', precio: '', duracion_min: 60 };
 await cargarPaquetes();
 } catch (err) { formError = err.message; }
 }
 async function togglePaquete(p) {
 try { await api.actualizarPaquete(p.id, { activo: !p.activo }); await cargarPaquetes(); }
 catch (e) { formError = e.message; }
 }

 const noLeidas = $derived(notifs.filter(n => !n.leida).length);

 async function cargarNotifs() {
 try {
 const { notificaciones } = await api.notificaciones();
 notifs = notificaciones;
 } catch { /* silencioso */ }
 }

 async function marcarLeida(n) {
 try { await api.leerNotificacion(n.id); await cargarNotifs(); } catch {}
 }

 async function marcarTodas() {
 try { await api.leerTodas(); await cargarNotifs(); } catch {}
 }

 // Si el navegador restaura la página desde bfcache (botón atrás),
 // recargar para revalidar la sesión en vez de mostrar login obsoleto
 function onPageShow(e) { if (e.persisted) window.location.reload(); }
 window.addEventListener('pageshow', onPageShow);

 onMount(async () => {
 // Sesión previa por token
 if (getToken()) {
 try {
 const { user: me } = await api.me();
 user = { email: me.email };
 perfil = me.perfil;
 if (aprobado) { await cargar(); await cargarNotifs(); notifTimer = setInterval(cargarNotifs, 15000);
 // Notificaciones en tiempo real vía SSE
 notifEs = new EventSource('/api/eventos');
 notifEs.onmessage = (e) => { try { if (JSON.parse(e.data).tipo === 'notificacion') cargarNotifs(); } catch {} };
 }
 } catch (e) {
 // Solo cerrar sesión si el token es realmente inválido; errores de red no desloguean
 if (e?.message === 'Sesión expirada') setToken(null);
 else authError = 'No se pudo conectar con el servidor. Intenta de nuevo.';
 }
 }
 loading = false;
 renderGoogleButton();
 return () => { window.removeEventListener('pageshow', onPageShow); if (notifEs) notifEs.close(); };
 });
</script>

<svelte:head><title>Sistema IA - Pacientes</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !user}
 <main class="card">
 <img class="logo-login" src="/logo.png" alt="Agencia Gerontológica Integral" />
 <p class="agency-login">Agencia Gerontológica Integral</p>
 <h1>{authMode === 'login' ? 'Iniciar sesión': authMode === 'registro' ? 'Crear cuenta' : authMode === 'verificar' ? 'Verifica tu correo' : authMode === 'recuperar' ? 'Recuperar contraseña' : 'Nueva contraseña'}</h1>
 {#if authMode === 'verificar'}
 <p class="muted">Ingresa el código de 6 dígitos que enviamos a <strong>{verifEmail}</strong>.</p>
 {:else if authMode === 'recuperar'}
 <p class="muted">Escribe tu correo y te enviaremos un código para restablecer tu contraseña.</p>
 {:else if authMode === 'restablecer'}
 <p class="muted">Ingresa el código enviado a <strong>{verifEmail}</strong> y tu nueva contraseña.</p>
 {:else}
 <p class="muted">Tu cuenta quedará <strong>pendiente de aprobación</strong> por un administrador.</p>
 {/if}

 {#if authMode === 'login' || authMode === 'registro'}
 <div bind:this={googleBtn} class="google-btn"></div>
 {#if !env.PUBLIC_GOOGLE_CLIENT_ID}
 <p class="muted small">Google no configurado (falta PUBLIC_GOOGLE_CLIENT_ID)</p>
 {/if}

 <div class="divider"><span>o con email</span></div>
 {/if}

 {#if authInfo}<p class="ok auth-msg">{authInfo}</p>{/if}
 {#if authError}<p class="error auth-msg">{authError}</p>{/if}

 {#if authMode === 'verificar'}
 <form onsubmit={verificarCodigo}>
 <label>Código de verificación <input bind:value={codigo} required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="000000" /></label>
 <button disabled={authLoading}>{authLoading? 'Verificando…': 'Verificar'}</button>
 </form>
 <div class="btns" style="margin-top:.6rem">
 <button type="button" class="ghost" onclick={reenviar} disabled={authLoading}>Reenviar código</button>
 <button type="button" class="ghost" onclick={() => { authMode = 'login'; authError = ''; authInfo = ''; }}>Volver</button>
 </div>
 {:else if authMode === 'recuperar'}
 <form onsubmit={recuperarClave}>
 <label>Email <input type="email" bind:value={email} required autocomplete="email" /></label>
 <button disabled={authLoading}>{authLoading? 'Enviando…': 'Enviar código'}</button>
 </form>
 <p class="switch"><a href="#" onclick={(e) =>{ e.preventDefault(); authMode = 'login'; authError = ''; authInfo = ''; }}>← Volver a iniciar sesión</a></p>
 {:else if authMode === 'restablecer'}
 <form onsubmit={restablecerClave}>
 <label>Código <input bind:value={codigo} required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="000000" /></label>
 <label>Nueva contraseña <input type="password" bind:value={password} required minlength="6" autocomplete="new-password" /></label>
 <label>Confirmar contraseña <input type="password" bind:value={password2} required minlength="6" autocomplete="new-password" /></label>
 <button disabled={authLoading}>{authLoading? 'Guardando…': 'Cambiar contraseña'}</button>
 </form>
 <div class="btns" style="margin-top:.6rem">
 <button type="button" class="ghost" onclick={recuperarClave} disabled={authLoading}>Reenviar código</button>
 <button type="button" class="ghost" onclick={() => { authMode = 'login'; authError = ''; authInfo = ''; }}>Volver</button>
 </div>
 {:else}
 <form onsubmit={loginPassword}>
 <label>Email <input type="email" bind:value={email} required autocomplete="email" /></label>
 <label>Contraseña <input type="password" bind:value={password} required minlength="6" autocomplete={authMode === 'login'? 'current-password': 'new-password'} /></label>
 <button disabled={authLoading}>{authLoading? 'Procesando…': authMode === 'login'? 'Entrar': 'Registrarse'}</button>
 </form>

 <p class="switch">
 {#if authMode === 'login'}
 ¿No tienes cuenta? <a href="#" onclick={(e) =>{ e.preventDefault(); authMode = 'registro'; authError = ''; authInfo = ''; }}>Regístrate</a>
 {:else}
 ¿Ya tienes cuenta? <a href="#" onclick={(e) =>{ e.preventDefault(); authMode = 'login'; authError = ''; authInfo = ''; }}> Inicia sesión</a>
 {/if}
 </p>
 {#if authMode === 'login'}
 <p class="switch"><a href="#" onclick={(e) =>{ e.preventDefault(); authMode = 'recuperar'; authError = ''; authInfo = ''; }}>¿Olvidaste tu contraseña?</a></p>
 {/if}
 {/if}
 </main>
{:else if !perfil}
 <main class="card center"><p class="error">{authError || 'No se pudo cargar tu perfil'}</p><button class="ghost" onclick={logout}>Salir</button></main>
{:else if perfil.estado === 'pendiente'}
 <main class="card center">
 <h1>Cuenta pendiente de aprobación</h1>
 <p class="muted">Hola {perfil.email}. Un administrador debe aprobar tu cuenta antes de poder registrar pacientes.</p>
 <button class="ghost" onclick={logout}>Cerrar sesión</button>
 </main>
{:else if perfil.estado === 'rechazado'}
 <main class="card center">
 <h1>Cuenta rechazada</h1>
 <p class="muted">Tu cuenta ({perfil.email}) fue rechazada. Contacta al administrador.</p>
 <button class="ghost" onclick={logout}>Cerrar sesión</button>
 </main>
{:else if perfil.rol === 'admin'}
 <header>
 <div class="brand">
 <img src="/logo.png" alt="Agencia Gerontológica Integral" />
 <div class="brand-text">
 <span class="agency">Agencia Gerontológica Integral</span>
 <h1>Administración de Pacientes</h1>
 </div>
 </div>
 <div>
 <span class="badge">{perfil.email} · {etiquetaRol(perfil.rol)}</span>
 {#if stats}<span class="badge">Worker {stats.worker} · {stats.requests} req</span>{/if}
 <a class="ghost link" href="/visitas">Visitas</a>
 <a class="ghost link" href="/mapa">Mapa</a>
 <div class="notif-wrap">
 <button class="ghost bell" onclick={() => (notifAbiertas = !notifAbiertas)}>
 Notificaciones{#if noLeidas}<span class="notif-count">{noLeidas}</span>{/if}
 </button>
 {#if notifAbiertas}
 <div class="notif-panel">
 <div class="notif-head"><strong>Notificaciones</strong><button class="mini-link" onclick={marcarTodas}>Marcar todas</button></div>
 {#each notifs as n (n.id)}
 <div class="notif-item" class:noleida={!n.leida} onclick={() => marcarLeida(n)}>
 <small>{new Date(n.created_at).toLocaleString()}</small>
 <div>{n.mensaje}</div>
 <span class="notif-tipo">{n.tipo}</span>
 </div>
 {:else}<p class="muted">Sin notificaciones</p>{/each}
 </div>
 {/if}
 </div>
 <button class="ghost" onclick={cargar}>Actualizar</button>
 <button class="ghost" onclick={logout}>Salir</button>
 </div>
 </header>

 <main class="grid">
 <section class="card" id="form-paciente">
 <h2>{editandoId ? 'Editar paciente' : 'Nuevo paciente / solicitud de servicio'}</h2>
 <form onsubmit={crear}>
 <div class="row">
 <label>Nombre <input bind:value={form.nombre} required /></label>
 <label>Apellidos <input bind:value={form.apellido} required /></label>
 </div>
 <div class="row">
 <label>Edad del adulto mayor <input bind:value={form.edad} type="number" min="60" max="120" /></label>
 <label>Teléfono <input bind:value={form.telefono} /></label>
 <label>Email <input bind:value={form.email} type="email" /></label>
 </div>
 <label>Dirección <input bind:value={form.direccion} /></label>
 <div class="row">
 <label>Tipo de servicio <input bind:value={form.tipo_servicio} placeholder="Consulta, examen…" /></label>
 <label>Fecha de solicitud <input bind:value={form.fecha_solicitud} type="date" /></label>
 </div>
 <div class="row">
 <label>Fecha de inicio del tratamiento <input bind:value={form.fecha_inicio} type="date" /></label>
 <label>Fecha de término del tratamiento <input bind:value={form.fecha_termino} type="date" /></label>
 </div>
 <label>Descripción <textarea bind:value={form.descripcion} rows="3"></textarea></label>
 <div class="geo-row">
 <button type="button" class="ghost" onclick={usarMiUbicacion}>Usar mi ubicación GPS</button>
 {#if form.lat != null}<span class="ok small">Coordenadas: {form.lat.toFixed(5)}, {form.lng.toFixed(5)}</span>{/if}
 </div>
 {#if formError}<p class="error">{formError}</p>{/if}
 {#if formOk}<p class="ok">{formOk}</p>{/if}
 <div class="btns">
 <button disabled={saving}>{saving? 'Guardando…': editandoId? 'Guardar cambios': 'Registrar'}</button>
 {#if editandoId}<button type="button" class="ghost" onclick={cancelarEdicion}>Cancelar</button>{/if}
 </div>
 </form>
 </section>

 <section class="card">
 <h2>Pacientes ({pacientes.length})</h2>
 <table>
 <thead>
 <tr><th>Paciente</th><th>Edad</th><th>Servicio</th><th>Estado</th><th></th><th></th></tr>
 </thead>
 <tbody>
 {#each pacientes as p (p.id)}
 <tr>
 <td>{p.nombre} {p.apellido}</td>
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
 <button class="mini" onclick={() => editar(p)}>Editar</button>
 <button class="mini danger" onclick={() => eliminar(p)}>Eliminar</button>
 </td>
 </tr>
 {:else}
 <tr><td colspan="6">Sin registros</td></tr>
 {/each}
 </tbody>
 </table>
 </section>

 {#if esAdmin}
 <section class="card wide">
 <h2>Usuarios registrados ({perfiles.length})</h2>
 <table>
 <thead><tr><th>Email</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
 <tbody>
 {#each perfiles as u (u.id)}
 <tr>
 <td>{u.email}</td>
 <td>{u.nombre || '—'}</td>
 <td>
 <select class="rol-select" value={u.rol} onchange={(e) => cambiarPerfil(u.id, { rol: e.target.value })}>
 {#each ROLES as r}<option value={r.valor}>{r.etiqueta}</option>{/each}
 </select>
 </td>
 <td><span class="estado estado-{u.estado === 'aprobado'? 'completado': u.estado === 'rechazado'? 'cancelado': 'pendiente'}">{u.estado}</span></td>
 <td class="acciones">
 {#if u.estado!== 'aprobado'}
 <button class="mini" onclick={() => cambiarPerfil(u.id, { estado: 'aprobado' })}>Aprobar</button>
 {/if}
 {#if u.estado!== 'rechazado'}
 <button class="mini ghost" onclick={() => cambiarPerfil(u.id, { estado: 'rechazado' })}>Rechazar</button>
 {/if}
 <button class="mini ghost" onclick={() => editarExpediente(u)}>Expediente</button>
 </td>
 </tr>
 {:else}
 <tr><td colspan="5">Sin usuarios</td></tr>
 {/each}
 </tbody>
 </table>

 {#if expId}
 <h3>Expediente laboral</h3>
 <form class="exp-form" onsubmit={(e) => { e.preventDefault(); guardarExpediente(); }}>
 <div class="row">
 <label>Teléfono <input bind:value={expForm.telefono} /></label>
 <label>Domicilio <input bind:value={expForm.domicilio} /></label>
 <label>Profesión <input bind:value={expForm.profesion} /></label>
 <label>Especialidad <input bind:value={expForm.especialidad} /></label>
 </div>
 <div class="row">
 <label>ID laboral <input bind:value={expForm.id_laboral} /></label>
 <label>Fecha de contratación <input bind:value={expForm.fecha_contratacion} type="date" /></label>
 <label>Estado laboral
 <select bind:value={expForm.estado_laboral}>
 <option value="activo">activo</option>
 <option value="inactivo">inactivo</option>
 <option value="suspendido">suspendido</option>
 </select></label>
 </div>
 <div class="btns">
 <button>Guardar expediente</button>
 <button type="button" class="ghost" onclick={() => (expId = null)}>Cancelar</button>
 </div>
 </form>
 {/if}
 </section>

 <section class="card wide">
 <h2>Paquetes y servicios ({paquetes.length})</h2>
 <table>
 <thead><tr><th>Nombre</th><th>Descripción</th><th>Precio</th><th>Duración</th><th>Estado</th><th></th></tr></thead>
 <tbody>
 {#each paquetes as p (p.id)}
 <tr>
 <td>{p.nombre}</td>
 <td>{p.descripcion || '—'}</td>
 <td>{p.precio != null ? '$' + Number(p.precio).toFixed(2) : '—'}</td>
 <td>{p.duracion_min != null ? p.duracion_min + ' min' : '—'}</td>
 <td>{p.activo ? 'activo' : 'inactivo'}</td>
 <td><button class="mini ghost" onclick={() => togglePaquete(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button></td>
 </tr>
 {:else}<tr><td colspan="6" class="muted">Sin paquetes — crea el primero abajo</td></tr>{/each}
 </tbody>
 </table>
 <h3>Nuevo paquete</h3>
 <form class="exp-form" onsubmit={crearPaquete}>
 <div class="row">
 <label>Nombre <input bind:value={formPaquete.nombre} required /></label>
 <label>Precio <input bind:value={formPaquete.precio} type="number" min="0" step="0.01" /></label>
 <label>Duración (min) <input bind:value={formPaquete.duracion_min} type="number" min="15" /></label>
 </div>
 <label>Descripción <textarea bind:value={formPaquete.descripcion} rows="2"></textarea></label>
 <button>Crear paquete</button>
 </form>
 </section>
 {/if}
 </main>
{:else}
 <!-- ===== Panel del empleado ===== -->
 <header>
 <div class="brand">
 <img src="/logo.png" alt="Agencia Gerontológica Integral" />
 <div class="brand-text">
 <span class="agency">Agencia Gerontológica Integral</span>
 <h1>Panel del empleado</h1>
 </div>
 </div>
 <div>
 <span class="badge">{perfil.email} · empleado</span>
 <a class="ghost link" href="/visitas">Mis visitas</a>
 <button class="ghost" onclick={logout}>Salir</button>
 </div>
 </header>

 <main class="grid">
 <section class="card">
 <h2>Hola, {perfil.nombre || perfil.email}</h2>
 <p class="muted">
 {#if perfil.profesion}{perfil.profesion}{/if}
 {#if perfil.especialidad} · {perfil.especialidad}{/if}
 {#if perfil.estado_laboral} · {perfil.estado_laboral}{/if}
 </p>

 <h3>Mis datos de contacto</h3>
 <form onsubmit={(e) => { e.preventDefault(); guardarMiPerfil(); }}>
 <label>Teléfono <input bind:value={empForm.telefono} type="tel" /></label>
 <label>Domicilio <input bind:value={empForm.domicilio} /></label>
 {#if empError}<p class="error">{empError}</p>{/if}
 {#if empMsg}<p class="ok">{empMsg}</p>{/if}
 <button disabled={empSaving}>{empSaving? 'Guardando…': 'Guardar'}</button>
 <p class="muted small">Los cambios de datos institucionales requieren autorización del directivo.</p>
 </form>
 </section>

 <section class="card">
 <h2>Mis visitas</h2>
 <div class="stats-mini">
 <span class="badge">{visitasHoy.filter((v) => v.estado === 'programada').length} programadas</span>
 <span class="badge">{visitasHoy.filter((v) => v.estado === 'en_curso').length} en curso</span>
 <span class="badge">{visitasHoy.filter((v) => v.estado === 'finalizada').length} finalizadas</span>
 </div>
 <table>
 <thead><tr><th>Fecha</th><th>Hora</th><th>Paciente</th><th>Estado</th></tr></thead>
 <tbody>
 {#each visitasHoy.slice(0, 8) as v (v.id)}
 <tr>
 <td>{v.fecha}</td><td>{v.hora_programada || '—'}</td>
 <td>{v.pacientes?.nombre} {v.pacientes?.apellido}</td>
 <td><span class="estado estado-{v.estado}">{v.trabajador_estado || v.estado.replace('_', ' ')}</span></td>
 </tr>
 {:else}<tr><td colspan="4" class="muted">Sin visitas hoy</td></tr>{/each}
 </tbody>
 </table>
 <a class="ghost link" href="/visitas" style="display:inline-block;margin-top:.6rem">Abrir Mis visitas →</a>
 </section>

 <section class="card">
 <h2>Pacientes asignados ({pacientes.length})</h2>
 <table>
 <thead><tr><th>Nombre</th><th>Edad</th><th>Dirección</th><th>Teléfono</th></tr></thead>
 <tbody>
 {#each pacientes as p (p.id)}
 <tr>
 <td>{p.nombre} {p.apellido}</td>
 <td>{p.cedula ? p.cedula + ' años' : '—'}</td>
 <td>{p.direccion || '—'}</td>
 <td>{p.telefono || '—'}</td>
 </tr>
 {:else}<tr><td colspan="4" class="muted">Sin pacientes asignados</td></tr>{/each}
 </tbody>
 </table>
 </section>

 <section class="card">
 <h2>Notificaciones</h2>
 {#each notifs.slice(0, 6) as n (n.id)}
 <div class="notif-item" class:noleida={!n.leida} onclick={() => marcarLeida(n)}>
 <small>{new Date(n.created_at).toLocaleString()}</small>
 <div>{n.mensaje}</div>
 </div>
 {:else}<p class="muted">Sin notificaciones</p>{/each}
 </section>
 </main>
{/if}

<style>
:global(body) { margin: 0; font-family: system-ui, sans-serif; background: oklch(0.985 0.007 85); color: oklch(0.27 0.035 225); }
 header { display: flex; justify-content: space-between; align-items: center; padding: .8rem 2rem; background: oklch(0.3 0.05 222); color: #f2eee2; border-bottom: 3px solid oklch(0.7 0.1 78); flex-wrap: wrap; gap:.5rem; }
 .brand { display: flex; align-items: center; gap: .8rem; }
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
