<script>
  import { onMount, onDestroy } from 'svelte';
  import { api, getToken } from '$lib/api';

  let visible = $state(false);
  let fase = $state('idle'); // idle | confirmar | activa | enviando | error
  let silenciosa = $state(false);
  let emergencia = $state(null);
  let paciente = $state(null);
  let error = $state('');
  let motivo = $state('');
  let watchId = $state(null);
  let ultimoEnvio = 0;
  let me = $state(null);
  let estadoEmergencia = $state('activa');
  let empleadoConfirmo = $state(false);
  let pollEmergencia = null;

  function posActual() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  }

  async function buscarVisitaActiva() {
    try {
      const data = await api.raw('/api/visitas');
      const lista = data.visitas || data || [];
      return (lista || []).find((v) =>
        v.estado === 'activa' || v.estado === 'en_curso' || v.estado === 'en_progreso'
      ) || null;
    } catch { return null; }
  }

  async function activar() {
    fase = 'enviando'; error = '';
    try {
      const gps = await posActual();
      const visita = await buscarVisitaActiva();
      const body = {
        lat: gps?.lat ?? null, lng: gps?.lng ?? null,
        paciente_id: visita?.paciente_id || null,
        visita_id: visita?.id || null,
        servicio: visita?.tipo_servicio || visita?.servicio || null,
        silenciosa
      };
      const res = await api.raw('/api/emergencias', { method: 'POST', body: JSON.stringify(body) });
      emergencia = res.emergencia;
      paciente = res.paciente;
      fase = 'activa';
      estadoEmergencia = 'activa';
      empleadoConfirmo = false;
      iniciarSeguimientoGps();
      iniciarPollingEstado();
    } catch (e) {
      error = e.message || 'No se pudo activar la emergencia';
      fase = 'error';
    }
  }

  function iniciarSeguimientoGps() {
    if (!navigator.geolocation || watchId != null) return;
    watchId = navigator.geolocation.watchPosition(
      async (p) => {
        const ahora = Date.now();
        if (ahora - ultimoEnvio < 12000 || !emergencia?.id) return;
        ultimoEnvio = ahora;
        try {
          await api.raw(`/api/emergencias/${emergencia.id}/ubicacion`, {
            method: 'POST',
            body: JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude })
          });
        } catch {}
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }

  async function cancelar() {
    if (!emergencia?.id) return;
    try {
      await api.raw(`/api/emergencias/${emergencia.id}/cancelar`, {
        method: 'POST', body: JSON.stringify({ motivo: motivo || 'Activación accidental' })
      });
    } catch {}
    detenerGps();
    if (pollEmergencia) { clearInterval(pollEmergencia); pollEmergencia = null; }
    fase = 'idle'; emergencia = null; paciente = null; motivo = ''; estadoEmergencia = 'activa'; empleadoConfirmo = false;
  }

  function detenerGps() {
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  async function confirmarRecepcion() {
    if (!emergencia?.id) return;
    try {
      await api.raw(`/api/emergencias/${emergencia.id}/confirmar-recepcion`, { method: 'POST', body: '{}' });
      empleadoConfirmo = true;
    } catch {}
  }

  function iniciarPollingEstado() {
    if (pollEmergencia) clearInterval(pollEmergencia);
    pollEmergencia = setInterval(async () => {
      if (!emergencia?.id || fase !== 'activa') return;
      try {
        const d = await api.raw('/api/emergencias');
        const actual = (d.emergencias || []).find((e) => e.id === emergencia.id);
        if (!actual) return;
        estadoEmergencia = actual.estado;
        empleadoConfirmo = !!actual.empleado_confirmo_at;
        if (!['activa', 'confirmada', 'en_gestion', 'atendida'].includes(actual.estado)) {
          detenerGps();
          if (pollEmergencia) { clearInterval(pollEmergencia); pollEmergencia = null; }
          setTimeout(() => { fase = 'idle'; emergencia = null; paciente = null; estadoEmergencia = 'activa'; }, 4000);
        }
      } catch {}
    }, 8000);
  }

  const ETIQUETAS = {
    activa: '🚨 ALERTA ACTIVADA — esperando respuesta del directivo',
    confirmada: '✔ DIRECTIVO ENTERADO — está gestionando la ayuda',
    en_gestion: '🛠 AYUDA EN GESTIÓN',
    atendida: '🤝 EMERGENCIA ATENDIDA',
    cerrada: '🔒 EMERGENCIA CERRADA'
  };

  onMount(async () => {
    visible = !!getToken();
    if (!visible) return;
    try { me = await api.raw('/api/me'); } catch {}
  });
  onDestroy(() => { detenerGps(); if (pollEmergencia) clearInterval(pollEmergencia); });
</script>

{#if visible}
<div class="panic-fab">
  {#if fase === 'idle' || fase === 'error'}
    <button class="btn-panic" onclick={() => { fase = 'confirmar'; error = ''; }}>
      🚨 BOTÓN DE PÁNICO
    </button>
    {#if fase === 'error'}<span class="err">{error}</span>{/if}
  {:else if fase === 'confirmar'}
    <div class="panel">
      <strong>¿Activar emergencia?</strong>
      <p class="sub">Se alertará al directivo con tu ubicación{paciente ? ' y paciente' : ''}.</p>
      <label class="sil"><input type="checkbox" bind:checked={silenciosa} /> Modo silencioso</label>
      <div class="acciones">
        <button class="btn-rojo" onclick={activar}>ACTIVAR AHORA</button>
        <button class="btn-gris" onclick={() => (fase = 'idle')}>Cancelar</button>
      </div>
      <p class="nota911">En peligro inmediato llama al <b>911</b>. Esto no sustituye la emergencia nacional.</p>
    </div>
  {:else if fase === 'enviando'}
    <div class="panel enviando">Enviando alerta…</div>
  {:else if fase === 'activa'}
    <div class="panel activa">
      <strong>🚨 EMERGENCIA ACTIVA</strong>
      <p class="sub estado-linea">{ETIQUETAS[estadoEmergencia] || '🚨 ALERTA ACTIVADA'}</p>
      {#if ['confirmada','en_gestion'].includes(estadoEmergencia) && !empleadoConfirmo}
        <div class="aviso-enterado">
          <p><b>TU ALERTA DE EMERGENCIA HA SIDO RECIBIDA.</b></p>
          <p>El directivo ya está enterado de tu situación y está gestionando la ayuda correspondiente.</p>
          <p>Mantén la calma, busca un lugar seguro si es posible y permanece atento a las indicaciones y comunicaciones del directivo.</p>
          <p><b>NO ESTÁS SOLO. ESTAMOS ATENDIENDO TU EMERGENCIA.</b></p>
          <button class="btn-rojo" onclick={confirmarRecepcion}>✔ CONFIRMAR QUE RECIBÍ EL AVISO</button>
        </div>
      {:else if empleadoConfirmo}
        <p class="sub">✔ Confirmaste recepción del aviso del directivo.</p>
      {/if}
      {#if paciente}<p class="sub">Paciente: <b>{paciente.nombre} {paciente.apellido || ''}</b></p>{/if}
      <div class="acciones">
        <a class="btn-llamar" href="tel:911">Llamar 911</a>
        <input class="motivo" placeholder="Motivo (si es falsa alarma)" bind:value={motivo} />
        <button class="btn-gris" onclick={cancelar}>Cancelar emergencia</button>
      </div>
    </div>
  {/if}
</div>
{/if}

<style>
  .panic-fab {
    position: fixed; left: 16px; bottom: 16px; z-index: 9990;
    display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
  }
  .btn-panic {
    background: linear-gradient(135deg, #c0392b, #e74c3c);
    color: #fff; border: none; border-radius: 999px;
    padding: 14px 22px; font-weight: 800; font-size: 15px; letter-spacing: .5px;
    cursor: pointer; box-shadow: 0 4px 18px rgba(231,76,60,.55);
    animation: pulso 1.6s infinite;
  }
  .btn-panic:hover { filter: brightness(1.08); }
  @keyframes pulso {
    0%,100% { box-shadow: 0 4px 18px rgba(231,76,60,.55); }
    50% { box-shadow: 0 4px 30px rgba(231,76,60,.95); }
  }
  .panel {
    background: #fff; border: 2px solid #e74c3c; border-radius: 14px;
    padding: 14px 16px; width: 290px; box-shadow: 0 8px 30px rgba(0,0,0,.25);
    color: #222; font-size: 14px;
  }
  .panel.activa { border-color: #c0392b; background: #fff5f5; }
  .panel.enviando { text-align: center; color: #c0392c; font-weight: 700; }
  .sub { margin: 6px 0; color: #555; font-size: 13px; }
  .sil { display: flex; align-items: center; gap: 8px; margin: 10px 0; font-size: 13px; cursor: pointer; }
  .acciones { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .btn-rojo {
    background: #c0392b; color: #fff; border: none; border-radius: 10px;
    padding: 12px; font-weight: 800; font-size: 15px; cursor: pointer;
  }
  .btn-gris {
    background: #eee; color: #333; border: none; border-radius: 10px;
    padding: 10px; font-weight: 600; cursor: pointer;
  }
  .btn-llamar {
    background: #16a085; color: #fff; text-align: center; border-radius: 10px;
    padding: 10px; font-weight: 700; text-decoration: none;
  }
  .motivo { padding: 8px; border: 1px solid #ccc; border-radius: 8px; font-size: 13px; }
  .nota911 { font-size: 11px; color: #888; margin-top: 8px; }
  .estado-linea { font-weight: 700; color: #c0392b; }
  .aviso-enterado {
    background: #ecfdf5; border: 1px solid #16a085; border-radius: 10px;
    padding: 10px; margin: 8px 0; font-size: 13px; color: #065f46;
  }
  .aviso-enterado p { margin: 5px 0; }
  .err { color: #c0392b; font-size: 12px; font-weight: 600; }
  @media (max-width: 600px) {
    .panic-fab { left: 10px; bottom: 10px; }
    .panel { width: min(290px, calc(100vw - 20px)); }
  }
</style>
