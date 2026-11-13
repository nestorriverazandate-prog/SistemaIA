<script>
 import { onMount, onDestroy } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';
 import { Html5Qrcode } from 'html5-qrcode';

 let perfil = $state(null);
 let loading = $state(true);
 let escaneando = $state(false);
 let procesando = $state(false);
 let scanner = null;
 let tokenActual = $state('');
 let domicilio = $state(null);
 let visita = $state(null);
 let resultado = $state(null);
 let error = $state('');
 let tokenManual = $state('');
 let sesion = $state('');
 let especialidad = $state('');

 const SESIONES = ['Atención general', 'Higiene y cuidado personal', 'Compañía y estimulación', 'Alimentación', 'Rehabilitación / ejercicios', 'Signos vitales y medicación', 'Otro'];

 const esSalida = $derived(!!(visita?.llegada_at && !visita?.salida_at));

 function tokenDe(texto) {
 const m = /AGI-[0-9A-F]{16}/i.exec(texto || '');
 return (m ? m[0] : String(texto || '')).trim().toUpperCase();
 }

 async function iniciarEscaner() {
 error = ''; resultado = null; domicilio = null; visita = null;
 escaneando = true;
 try {
 scanner = new Html5Qrcode('lector-qr');
 await scanner.start(
 { facingMode: 'environment' },
 { fps: 10, qrbox: { width: 220, height: 220 } },
 async (texto) => { await alEscanear(texto); },
 () => {}
 );
 } catch (e) {
 escaneando = false;
 error = 'No se pudo acceder a la cámara. Revisa los permisos o escribe el código manualmente.';
 }
 }

 async function detenerEscaner() {
 try { if (scanner) await scanner.stop(); } catch {}
 try { if (scanner) scanner.clear(); } catch {}
 scanner = null;
 escaneando = false;
 }

 async function alEscanear(texto) {
 const token = tokenDe(texto);
 if (!token || token === tokenActual) return;
 await detenerEscaner();
 tokenActual = token;
 await consultarDomicilio();
 }

 async function consultarDomicilio() {
 procesando = true; error = '';
 try {
 const r = await api.qrPaciente(tokenActual);
 domicilio = r.domicilio;
 visita = r.visita;
 if (!visita) error = 'Este código es válido, pero no tienes una visita asignada a este domicilio.';
 } catch (e) {
 error = e.message || 'Código QR inválido';
 } finally { procesando = false; }
 }

 function obtenerGps() {
 return new Promise((resolve) => {
 if (!navigator.geolocation) return resolve(null);
 navigator.geolocation.getCurrentPosition(
 (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy }),
 () => resolve(null),
 { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
 );
 });
 }

 async function registrar() {
 if (!visita) return;
 procesando = true; error = ''; resultado = null;
 try {
 const gps = await obtenerGps();
 const body = { token: tokenActual };
 if (gps) { body.lat = gps.lat; body.lng = gps.lng; body.precision = gps.precision; }
 if (sesion) body.sesion = sesion;
 if (especialidad) body.especialidad = especialidad;
 const r = await api.qrCheckin(body);
 resultado = r;
 } catch (e) {
 error = e.message || 'Error al registrar';
 } finally { procesando = false; }
 }

 function reiniciar() {
 tokenActual = ''; domicilio = null; visita = null; resultado = null; error = ''; tokenManual = '';
 }

 onMount(async () => {
 if (!getToken()) { loading = false; return; }
 try { const { user: me } = await api.me(); perfil = me.perfil; especialidad = me.perfil?.especialidad || ''; }
 catch { setToken(null); }
 loading = false;
 });
 onDestroy(() => { detenerEscaner(); });
</script>

<svelte:head><title>Registrar visita — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil}
 <main class="card center"><h1>Inicia sesión</h1><a class="ghost link" href="/">Ir al login</a></main>
{:else}
<header>
 <div class="brand">
 <img src="/logo.png" alt="Agencia Gerontológica Integral" />
 <div class="brand-text">
 <span class="agency">Agencia Gerontológica Integral</span>
 <h1>Registrar visita domiciliaria</h1>
 </div>
 </div>
 <div>
 <span class="badge">{perfil.email}</span>
 <a class="ghost link" href="/">Inicio</a>
 <a class="ghost link" href="/visitas">Mis visitas</a>
 <button class="ghost" onclick={() => { setToken(null); window.location.href = '/'; }}>Salir</button>
 </div>
</header>

<main class="card qr-card">
 {#if resultado}
 <div class="resultado {resultado.tipo === 'llegada' ? 'ok' : 'info'}">
 <h2>{resultado.tipo === 'llegada' ? 'Entrada registrada' : 'Salida registrada'}</h2>
 {#if resultado.tipo === 'salida'}<p>Tiempo de permanencia: <strong>{resultado.duracion_min} min</strong></p>{/if}
 <p class="muted">
 {#if resultado.gps_valido === true}Ubicación verificada dentro del radio del domicilio.{/if}
 {#if resultado.gps_valido === false}Ubicación fuera del radio — quedó pendiente de validación.{/if}
 {#if resultado.gps_valido == null && resultado.distancia_m == null}Sin señal GPS — incidencia registrada para validación.{/if}
 </p>
 <button onclick={reiniciar}>Registrar otra visita</button>
 </div>
 {:else if domicilio}
 <h2>{domicilio.nombre}</h2>
 <div class="paciente-card">
 <p><strong>Edad:</strong> {domicilio.edad ? domicilio.edad + ' años' : '—'}</p>
 <p><strong>Dirección:</strong> {domicilio.direccion || 'Sin dirección registrada'}</p>
 <p><strong>Teléfono:</strong> {domicilio.telefono || '—'}</p>
 <p><strong>Servicio:</strong> {domicilio.tipo_servicio || '—'}</p>
 {#if domicilio.contacto_emergencia}
 <p><strong>Emergencia:</strong> {domicilio.contacto_emergencia}{domicilio.telefono_emergencia ? ` · ${domicilio.telefono_emergencia}` : ''}</p>
 {/if}
 </div>
 {#if visita}
 <p>
 Estado de la visita: <strong>{visita.estado === 'en_curso' ? 'en atención' : 'programada'}</strong>
 {#if visita.hora_programada}· Horario: {visita.hora_programada}{/if}
 </p>
 <div class="sesion-row">
 <label>Sesión que realizarás
 <select bind:value={sesion}>
 <option value="">Seleccionar…</option>
 {#each SESIONES as s}<option value={s}>{s}</option>{/each}
 </select>
 </label>
 <label>Especialidad
 <input bind:value={especialidad} placeholder="Ej. enfermería, terapia física" />
 </label>
 </div>
 <button class="big-btn" disabled={procesando} onclick={registrar}>
 {procesando ? 'Registrando…' : esSalida ? 'REGISTRAR SALIDA' : 'REGISTRAR ENTRADA'}
 </button>
 <p class="muted small">Se guardará fecha, hora, ubicación GPS, sesión y especialidad.</p>
 {:else}
 <p class="error">{error || 'No tienes visita asignada a este domicilio.'}</p>
 <button class="ghost" onclick={reiniciar}>Escanear otro código</button>
 {/if}
 {:else}
 <h2>Escanea el código QR del domicilio</h2>
 <p class="muted">Apunta la cámara al código pegado en la vivienda del adulto mayor.</p>
 {#if escaneando}
 <div id="lector-qr" class="lector"></div>
 <button class="ghost" onclick={detenerEscaner}>Detener cámara</button>
 {:else}
 <button class="big-btn" onclick={iniciarEscaner}>Escanear código QR</button>
 {/if}
 <div class="manual">
 <label>Código manual
 <input bind:value={tokenManual} placeholder="AGI-XXXXXXXXXXXXXXXX" />
 </label>
 <button class="ghost" disabled={procesando || !tokenManual.trim()} onclick={async () => { tokenActual = tokenDe(tokenManual); await consultarDomicilio(); }}>Consultar</button>
 </div>
 {/if}
 {#if error && domicilio}{/if}
 {#if error && !domicilio}<p class="error">{error}</p>{/if}
 {#if procesando && !domicilio}<p class="muted">Consultando…</p>{/if}
</main>
{/if}

<style>
 header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; padding: 1rem 1.25rem; background: oklch(0.99 0.01 90); border-bottom: 1px solid oklch(0.9 0.02 85); }
 .brand { display: flex; align-items: center; gap: .8rem; }
 .brand img { height: 52px; width: auto; }
 .brand-text { display: flex; flex-direction: column; }
 .agency { font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; color: oklch(0.55 0.1 80); font-weight: 700; }
 h1 { margin: 0; font-size: 1.15rem; color: oklch(0.35 0.06 250); }
 .badge { background: oklch(0.93 0.03 85); padding: .3rem .7rem; border-radius: 999px; font-size: .82rem; }
 .link { text-decoration: none; }
 .ghost { background: transparent; border: 1px solid oklch(0.8 0.03 85); color: oklch(0.4 0.05 250); padding: .45rem .9rem; border-radius: 8px; cursor: pointer; font: inherit; text-decoration: none; display: inline-block; }
 .ghost:hover { background: oklch(0.95 0.02 85); }
 main.qr-card { max-width: 560px; margin: 2rem auto; padding: 1.5rem; }
 .card { background: #fff; border-radius: 14px; box-shadow: 0 2px 14px oklch(0.3 0.03 260 / .08); }
 .center { text-align: center; padding: 2rem; max-width: 480px; margin: 3rem auto; }
 h2 { color: oklch(0.35 0.06 250); }
 .muted { color: oklch(0.5 0.03 85); }
 .small { font-size: .82rem; }
 .error { color: oklch(0.5 0.18 25); font-weight: 600; }
 .ok { color: oklch(0.4 0.12 150); }
 .info { color: oklch(0.4 0.08 250); }
 .resultado { text-align: center; padding: 1rem; border-radius: 12px; }
 .resultado.ok { background: oklch(0.94 0.05 150); }
 .resultado.info { background: oklch(0.94 0.04 250); }
 .big-btn { display: block; width: 100%; margin: 1.2rem 0 .6rem; padding: .9rem; font-size: 1.05rem; font-weight: 700; border: none; border-radius: 10px; background: oklch(0.42 0.08 250); color: #fff; cursor: pointer; }
 .big-btn:disabled { opacity: .6; cursor: wait; }
 .lector { width: 100%; max-width: 340px; margin: 1rem auto; border-radius: 12px; overflow: hidden; }
 .manual { display: flex; gap: .5rem; align-items: end; margin-top: 1.2rem; border-top: 1px solid oklch(0.92 0.02 85); padding-top: 1rem; }
 .paciente-card { background: oklch(0.97 0.015 140); border: 1px solid oklch(0.9 0.03 140); border-radius: 10px; padding: .8rem 1rem; margin: .8rem 0; text-align: left; }
 .paciente-card p { margin: .25rem 0; font-size: .9rem; }
 .sesion-row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin: 1rem 0; }
 .sesion-row label { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; color: oklch(0.45 0.04 85); }
 .sesion-row select, .sesion-row input { padding: .55rem .65rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
 .manual label { flex: 1; display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; color: oklch(0.45 0.04 85); }
 .manual input { padding: .55rem .65rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
 button { font: inherit; }
</style>
