<script>
  import { onMount, onDestroy } from 'svelte';
  import { api, getToken } from '$lib/api';

  let me = $state(null);
  let esAdmin = $state(false);
  let emergencias = $state([]);
  let actual = $state(null);       // emergencia abierta en el chat
  let mensajes = $state([]);
  let texto = $state('');
  let escribiendo = $state('');
  let loading = $state(true);
  let error = $state('');
  let listaEl;
  let chatEl;
  let pollMsg = null;
  let pollEmerg = null;
  let es = null;
  let ultimoEscribiendo = 0;
  let yaAbrió = $state(false);

  const RAPIDOS_ADMIN = [
    '¿Te encuentras en un lugar seguro?',
    '¿Puedes hablar por teléfono?',
    '¿Qué está sucediendo?',
    '¿Necesitas asistencia médica?',
    '¿Ya solicitaste apoyo de emergencias?',
    'Estoy dando seguimiento a tu situación.'
  ];
  const RAPIDOS_EMPLEADO = [
    'Necesito ayuda inmediatamente.',
    'No me encuentro en un lugar seguro.',
    'Necesito que me llamen.',
    'La situación está empeorando.',
    'Ya me encuentro en un lugar seguro.',
    'Necesito asistencia médica.'
  ];

  const ACTIVAS = ['activa', 'confirmada', 'en_gestion', 'atendida'];
  const ESTADOS = {
    activa: ' ALERTA ACTIVADA', confirmada: ' DIRECTIVO ENTERADO',
    en_gestion: ' AYUDA EN GESTIÓN', atendida: ' EMERGENCIA ATENDIDA',
    cerrada: ' CERRADA', cancelada: 'CANCELADA'
  };

  function fmtHora(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtFecha(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const hoy = new Date().toDateString() === d.toDateString();
    return hoy ? fmtHora(iso) : d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' }) + ' ' + fmtHora(iso);
  }
  function fotoUrl(p) { return p?.foto_path ? `/api/perfiles/${p.id}/foto?t=${Date.now()}` : null; }
  function miId() { return me?.user?.id || me?.id; }
  function esMio(m) { return m.remitente_id === miId(); }
  function nombreRemitente(m) {
    if (esMio(m)) return 'Tú';
    return m.perfiles?.nombre || 'Contacto';
  }
  const rapidos = $derived(esAdmin ? RAPIDOS_ADMIN : RAPIDOS_EMPLEADO);

  async function cargarEmergencias() {
    try {
      const d = await api.raw('/api/emergencias');
      emergencias = (d.emergencias || []).filter((e) => ACTIVAS.includes(e.estado));
      if (!actual && emergencias.length && !yaAbrió) {
        const q = new URLSearchParams(window.location.search).get('e');
        actual = emergencias.find((e) => e.id === q) || emergencias[0];
        yaAbrió = true;
        await cargarMensajes();
      } else if (actual) {
        const sigue = emergencias.find((e) => e.id === actual.id);
        if (sigue) actual = sigue;
      }
      error = '';
    } catch (e) { error = e.message; }
    loading = false;
  }

  async function cargarMensajes() {
    if (!actual?.id) return;
    try {
      const d = await api.raw(`/api/emergencias/${actual.id}/mensajes`);
      mensajes = d.mensajes || [];
      scrollAbajo();
    } catch {}
  }

  async function abrir(e) {
    actual = e;
    yaAbrió = true;
    if (window.innerWidth < 800 && listaEl) listaEl.style.display = 'none';
    await cargarMensajes();
  }
  function volverALista() {
    actual = null;
    if (listaEl) listaEl.style.display = '';
  }

  async function enviar(t) {
    const msg = (t ?? texto).trim();
    if (!msg || !actual?.id) return;
    texto = '';
    try {
      await api.raw(`/api/emergencias/${actual.id}/mensajes`, { method: 'POST', body: JSON.stringify({ mensaje: msg }) });
      await cargarMensajes();
    } catch (err) { error = err.message; }
  }

  function alEscribir() {
    const ahora = Date.now();
    if (ahora - ultimoEscribiendo < 2500 || !actual?.id) return;
    ultimoEscribiendo = ahora;
    api.raw(`/api/emergencias/${actual.id}/escribiendo`, { method: 'POST', body: '{}' }).catch(() => {});
  }

  function scrollAbajo() {
    setTimeout(() => { if (chatEl) chatEl.scrollTop = chatEl.scrollHeight; }, 30);
  }

  onMount(async () => {
    if (!getToken()) { window.location.href = '/'; return; }
    me = await api.raw('/api/me').catch(() => null);
    esAdmin = me?.user?.perfil?.rol === 'admin' || me?.perfil?.rol === 'admin';
    await cargarEmergencias();
    pollMsg = setInterval(cargarMensajes, 3000);
    pollEmerg = setInterval(cargarEmergencias, 10000);
    es = new EventSource('/api/eventos');
    es.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data);
        if (d.tipo === 'emergencia') cargarEmergencias();
        else if (d.tipo === 'escribiendo' && d.datos?.emergencia_id === actual?.id && d.datos?.nombre !== (me?.user?.perfil?.nombre || me?.user?.email)) {
          escribiendo = d.datos.nombre;
          setTimeout(() => { escribiendo = ''; }, 3000);
        }
      } catch {}
    };
  });
  onDestroy(() => {
    if (pollMsg) clearInterval(pollMsg);
    if (pollEmerg) clearInterval(pollEmerg);
    if (es) es.close();
  });
</script>

<svelte:head><title>Chat de Emergencia — AGI</title></svelte:head>

<div class="chat-wrap">
  {#if loading}<div class="center">Cargando…</div>{/if}
  {#if error}<div class="alert-error">{error}</div>{/if}

  <div class="layout" class:solo={!!actual}>
    <!-- Lista de emergencias activas -->
    <aside class="lista" bind:this={listaEl}>
      <div class="lista-top">
        <h2> CHAT DE EMERGENCIA</h2>
        <a class="btn-home2" href="/" title="Volver al inicio"> Inicio</a>
      </div>
      <p class="sub">Conversaciones activas ({emergencias.length})</p>
      {#each emergencias as e}
        <button class="item" class:sel={actual?.id === e.id} onclick={() => abrir(e)}>
          <div class="item-head">
            {#if fotoUrl(e.perfiles)}<img src={fotoUrl(e.perfiles)} alt="" />{:else}<div class="avatar"></div>{/if}
            <div>
              <b>{e.perfiles?.nombre || 'Empleado'}</b>
              <div class="mut">{e.pacientes ? e.pacientes.nombre + ' ' + (e.pacientes.apellido || '') : 'Sin paciente'}</div>
            </div>
          </div>
          <span class="estado {e.estado}">{ESTADOS[e.estado] || e.estado}</span>
        </button>
      {:else}
        <p class="mut pad">No hay emergencias activas. El chat se habilita solo cuando alguien activa el botón de pánico.</p>
      {/each}
    </aside>

    <!-- Conversación -->
    {#if actual}
      {@const emp = actual.perfiles}
      {@const pac = actual.pacientes}
      <section class="conversacion">
        <header class="chat-header">
          <button class="volver" onclick={volverALista}>←</button>
          <div class="chat-id">
            {#if fotoUrl(emp)}<img class="foto" src={fotoUrl(emp)} alt="" />{:else}<div class="foto avatar"></div>{/if}
            <div>
              <b>{emp?.nombre || 'Empleado'}</b>
              <div class="mut">
                {pac ? `Paciente: ${pac.nombre} ${pac.apellido || ''}` : ''}
                {pac?.direccion ? ` · ${pac.direccion}` : ''}
              </div>
            </div>
          </div>
          <div class="chat-meta">
            <a class="btn-home" href="/" title="Volver al inicio"> Inicio</a>
            <span class="estado {actual.estado}">{ESTADOS[actual.estado] || actual.estado}</span>
            {#if esAdmin && emp?.telefono}
              <a class="btn-call" href="tel:{emp.telefono}"> Llamar</a>
            {:else}
              <a class="btn-call" href="tel:911"> 911</a>
            {/if}
          </div>
        </header>

        <div class="mensajes" bind:this={chatEl}>
          {#each mensajes as m}
            <div class="msg-wrap" class:mio={esMio(m)}>
              <div class="burbuja" class:mia={esMio(m)}>
                {#if !esMio(m)}<div class="remitente">{nombreRemitente(m)}</div>{/if}
                <div class="texto">{m.mensaje}</div>
                <div class="hora">
                  {fmtFecha(m.created_at)}
                  {#if esMio(m)}
                    <span class="ticks" class:leido={m.leido}>{m.leido ? 'Leído' : m.entregado ? 'Entregado' : 'Enviado'}</span>
                  {/if}
                </div>
              </div>
            </div>
          {:else}
            <p class="mut center-pad">Sin mensajes. Escribe el primero — el otro participante será notificado al instante.</p>
          {/each}
          {#if escribiendo}
            <div class="escribiendo"><i></i><i></i><i></i> <span>{escribiendo} está escribiendo…</span></div>
          {/if}
        </div>

        <div class="rapidos">
          {#each rapidos as r}
            <button class="rapido" onclick={() => enviar(r)}>{r}</button>
          {/each}
        </div>

        <div class="entrada">
          <input
            placeholder="Escribe un mensaje de emergencia…"
            bind:value={texto}
            oninput={alEscribir}
            onkeydown={(ev) => ev.key === 'Enter' && enviar()}
          />
          <button class="btn-enviar" onclick={() => enviar()}>Enviar</button>
        </div>
        <p class="nota911"> En peligro inmediato llama al 911. Este chat no sustituye la emergencia nacional.</p>
      </section>
    {/if}
  </div>
</div>

<style>
  .chat-wrap { height: 100vh; display: flex; flex-direction: column; background: #f3f4f6; font-family: inherit; }
  .center { padding: 2rem; text-align: center; color: #6b7280; }
  .alert-error { background: #fee2e2; color: #b91c1c; padding: .7rem 1rem; margin: .5rem; border-radius: 10px; }
  .layout { flex: 1; display: flex; min-height: 0; }
  .lista {
    width: 300px; background: #fff; border-right: 1px solid #e5e7eb;
    overflow-y: auto; padding: .8rem; flex-shrink: 0;
  }
  .lista h2 { font-size: .95rem; color: #c0392b; margin: 0 0 .3rem; }
  .sub, .mut { color: #6b7280; font-size: .78rem; }
  .lista-top { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
  .btn-home, .btn-home2 {
    background: #fff; color: #c0392b; text-decoration: none; font-weight: 800;
    font-size: .78rem; padding: .45rem .8rem; border-radius: 999px; white-space: nowrap;
    border: 1px solid #fecaca;
  }
  .btn-home2 { background: #fef2f2; }
  .btn-home:hover, .btn-home2:hover { background: #fee2e2; }
  .pad { padding: .8rem; }
  .center-pad { text-align: center; padding: 2rem 1rem; }
  .item {
    display: block; width: 100%; text-align: left; border: 1px solid #e5e7eb;
    border-radius: 12px; padding: .7rem; margin-bottom: .5rem; background: #fff; cursor: pointer;
  }
  .item.sel { border-color: #e74c3c; background: #fef2f2; }
  .item-head { display: flex; gap: .6rem; align-items: center; }
  .item img, .foto, .avatar {
    width: 42px; height: 42px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
  }
  .avatar { display: flex; align-items: center; justify-content: center; background: #f3f4f6; font-size: 1.1rem; }
  .foto { width: 38px; height: 38px; }
  .estado { display: inline-block; margin-top: .4rem; font-size: .68rem; font-weight: 800; padding: 2px 8px; border-radius: 999px; color: #fff; background: #e74c3c; }
  .estado.confirmada { background: #e67e22; }
  .estado.en_gestion { background: #b45309; }
  .estado.atendida { background: #16a085; }
  .estado.cerrada, .estado.cancelada { background: #6b7280; }

  .conversacion { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .chat-header {
    background: linear-gradient(135deg, #c0392b, #e74c3c); color: #fff;
    display: flex; align-items: center; gap: .8rem; padding: .7rem 1rem; flex-shrink: 0;
  }
  .volver { display: none; background: none; border: none; color: #fff; font-size: 1.3rem; cursor: pointer; }
  .chat-id { display: flex; align-items: center; gap: .6rem; flex: 1; min-width: 0; }
  .chat-id b { font-size: .95rem; }
  .chat-id .mut { color: #fecaca; }
  .chat-meta { display: flex; align-items: center; gap: .6rem; }
  .chat-header .estado { background: rgba(255,255,255,.2); }
  .btn-call {
    background: #fff; color: #c0392b; text-decoration: none; font-weight: 800;
    font-size: .8rem; padding: .45rem .8rem; border-radius: 999px; white-space: nowrap;
  }

  .mensajes { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: .4rem; }
  .msg-wrap { display: flex; }
  .msg-wrap.mio { justify-content: flex-end; }
  .burbuja { max-width: 75%; padding: .5rem .8rem; border-radius: 14px; background: #fff; border: 1px solid #e5e7eb; font-size: .92rem; }
  .burbuja.mia { background: #dcfce7; border-color: #86efac; }
  .remitente { font-size: .72rem; font-weight: 700; color: #6b7280; margin-bottom: 2px; }
  .texto { white-space: pre-wrap; word-break: break-word; }
  .hora { font-size: .68rem; color: #9ca3af; text-align: right; margin-top: 2px; }
  .ticks.leido { color: #2563eb; }
  .escribiendo { color: #6b7280; font-size: .8rem; padding: .3rem .8rem; display: flex; align-items: center; gap: 4px; }
  .escribiendo i { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; animation: rebote 1.2s infinite; }
  .escribiendo i:nth-child(2) { animation-delay: .2s; }
  .escribiendo i:nth-child(3) { animation-delay: .4s; }
  @keyframes rebote { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }

  .rapidos { display: flex; gap: .4rem; padding: .4rem .8rem; overflow-x: auto; flex-shrink: 0; }
  .rapido {
    white-space: nowrap; border: 1px solid #fca5a5; background: #fff; color: #b91c1c;
    border-radius: 999px; padding: .35rem .7rem; font-size: .78rem; cursor: pointer;
  }
  .rapido:hover { background: #fef2f2; }
  .entrada { display: flex; gap: .5rem; padding: .6rem .8rem; background: #fff; border-top: 1px solid #e5e7eb; flex-shrink: 0; }
  .entrada input { flex: 1; padding: .7rem .9rem; border: 1px solid #d1d5db; border-radius: 999px; font-size: .95rem; outline: none; }
  .entrada input:focus { border-color: #e74c3c; }
  .btn-enviar {
    width: 46px; height: 46px; border-radius: 50%; border: none; cursor: pointer;
    background: #c0392b; color: #fff; font-size: 1.1rem; flex-shrink: 0;
  }
  .nota911 { font-size: .7rem; color: #9ca3af; text-align: center; padding: .3rem; background: #fff; margin: 0; }

  @media (max-width: 800px) {
    .lista { position: absolute; inset: 0 auto 0 0; z-index: 5; width: 85%; max-width: 320px; box-shadow: 4px 0 20px rgba(0,0,0,.15); }
    .volver { display: block; }
    .solo .lista { display: none; }
    .solo .conversacion { width: 100%; }
    .burbuja { max-width: 85%; }
  }
</style>
