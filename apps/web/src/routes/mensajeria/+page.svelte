<script>
  import { onMount, onDestroy } from 'svelte';
  import { api, getToken } from '$lib/api';

  let me = $state(null);
  let esAdmin = $state(false);
  let conversaciones = $state([]);
  let comunicados = $state([]);
  let totalNoLeidos = $state(0);
  let actual = $state(null);        // { partner } | 'comunicados'
  let mensajes = $state([]);
  let texto = $state('');
  let adjunto = $state(null);       // dataURL
  let adjuntoNombre = $state('');
  let buscando = $state('');
  let error = $state('');
  let loading = $state(true);
  let enviando = $state(false);
  let chatEl, listaEl, fileInput;
  let pollConv = null, pollMsg = null, es = null;

  const CONVS_FILTRO = $derived(
    conversaciones.filter((c) =>
      !buscando ||
      (c.perfil?.nombre || '').toLowerCase().includes(buscando.toLowerCase()) ||
      (c.perfil?.email || '').toLowerCase().includes(buscando.toLowerCase())
    )
  );

  function miId() { return me?.user?.id || me?.id; }
  function esMio(m) { return m.emisor_id === miId(); }
  function fmtHora(iso) { return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); }
  function fmtFechaMsg(iso) {
    const d = new Date(iso);
    if (new Date().toDateString() === d.toDateString()) return fmtHora(iso);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' }) + ' ' + fmtHora(iso);
  }
  function fotoUrl(p) { return p?.foto_path ? `/api/perfiles/${p.id}/foto?t=${Date.now()}` : null; }
  function nombreConv(c) { return c.partner === 'directivo' ? 'Directivo' : (c.perfil?.nombre || c.perfil?.email || 'Usuario'); }
  function rolLabel(r) { return { admin: 'Directivo', staff: 'Trabajador', paciente: 'Paciente', familiar: 'Familiar', cuidador: 'Cuidador' }[r] || r || ''; }
  const hoy = new Date().toDateString();

  async function cargarConversaciones() {
    try {
      const d = await api.raw('/api/chat/conversaciones');
      conversaciones = d.conversaciones || [];
      comunicados = d.comunicados || [];
      totalNoLeidos = d.totalNoLeidos || 0;
      error = '';
    } catch (e) { error = e.message; }
    loading = false;
  }

  async function abrir(conv) {
    actual = conv;
    mensajes = [];
    if (window.innerWidth < 800 && listaEl) listaEl.style.display = 'none';
    await cargarMensajes();
  }

  function volverALista() {
    actual = null;
    if (listaEl) listaEl.style.display = '';
  }

  async function cargarMensajes() {
    if (!actual) return;
    const con = actual === 'comunicados' ? 'comunicados' : (actual.partner === 'directivo' ? 'directivo' : actual.partner);
    try {
      const d = await api.raw(`/api/chat/mensajes?con=${con}`);
      mensajes = d.mensajes || [];
      adjuntosCargar();
      scrollAbajo();
      cargarConversaciones();
    } catch {}
  }

  // resolver URLs firmadas de adjuntos
  async function adjuntosCargar() {
    for (const m of mensajes) {
      if (m.adjunto_path && !m._url) {
        try {
          const d = await api.raw(`/api/chat/adjunto?p=${encodeURIComponent(m.adjunto_path)}`);
          m._url = d.url;
        } catch { m._url = null; }
      }
    }
    mensajes = [...mensajes];
  }

  function scrollAbajo() { setTimeout(() => { if (chatEl) chatEl.scrollTop = chatEl.scrollHeight; }, 30); }

  function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { error = 'El archivo no puede superar 8 MB'; return; }
    const r = new FileReader();
    r.onload = () => { adjunto = r.result; adjuntoNombre = f.name; };
    r.readAsDataURL(f);
  }

  async function enviar() {
    const cuerpo = texto.trim();
    if ((!cuerpo && !adjunto) || enviando) return;
    enviando = true; error = '';
    try {
      const body = { cuerpo: cuerpo || '', adjunto: adjunto || undefined };
      if (actual && actual !== 'comunicados') {
        if (actual.partner === 'directivo') body.receptor_id = undefined; // el API resuelve al admin
        else body.receptor_id = actual.partner;
      } else if (esAdmin && actual === 'comunicados') {
        body.audiencia = 'todos';
      } else if (actual === 'comunicados') {
        // no-admin no puede escribir en comunicados
        return;
      }
      await api.raw('/api/chat/mensajes', { method: 'POST', body: JSON.stringify(body) });
      texto = ''; adjunto = null; adjuntoNombre = '';
      await cargarMensajes();
    } catch (e) { error = e.message; }
    enviando = false;
  }

  // Comunicado del directivo con selector de audiencia
  let audComun = $state('todos');
  let textoComun = $state('');
  async function enviarComunicado() {
    const cuerpo = textoComun.trim();
    if (!cuerpo) return;
    try {
      await api.raw('/api/chat/mensajes', { method: 'POST', body: JSON.stringify({ audiencia: audComun, cuerpo }) });
      textoComun = '';
      cargarConversaciones();
      if (actual === 'comunicados') cargarMensajes();
    } catch (e) { error = e.message; }
  }

  async function toggle(partner, campo) {
    const conv = conversaciones.find((c) => c.partner === partner);
    const val = !(conv?.estado?.[campo]);
    conv.estado = { ...(conv?.estado || {}), [campo]: val };
    conversaciones = [...conversaciones];
    try { await api.raw('/api/chat/estado', { method: 'POST', body: JSON.stringify({ partner, [campo]: val }) }); } catch {}
  }

  async function reportar(m) {
    if (!confirm('¿Reportar este mensaje como inapropiado?')) return;
    try { await api.raw('/api/chat/reportar', { method: 'POST', body: JSON.stringify({ mensaje_id: m.id }) }); } catch {}
  }

  const esConversacionAbierta = $derived(actual && actual !== 'comunicados');
  const tituloActual = $derived.by(() => {
    if (!actual) return '';
    if (actual === 'comunicados') return '📢 Comunicados';
    const c = conversaciones.find((x) => x.partner === actual.partner);
    return nombreConv({ partner: actual.partner, perfil: c?.perfil || actual.perfil });
  });

  onMount(async () => {
    if (!getToken()) { window.location.href = '/'; return; }
    me = await api.raw('/api/me').catch(() => null);
    esAdmin = me?.user?.perfil?.rol === 'admin' || me?.perfil?.rol === 'admin';
    await cargarConversaciones();
    // abrir conversación pasada por ?con=ID
    const con = new URLSearchParams(window.location.search).get('con');
    if (con) {
      const conv = conversaciones.find((c) => c.partner === con);
      if (conv) abrir(conv);
      else if (con === 'comunicados') abrir('comunicados');
      else if (con === 'directivo') abrir(conversaciones[0] || 'directivo');
    }
    pollConv = setInterval(cargarConversaciones, 15000);
    pollMsg = setInterval(() => { if (actual) cargarMensajes(); }, 4000);
    es = new EventSource('/api/eventos');
    es.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data);
        if (d.tipo === 'chat') { cargarConversaciones(); if (actual) cargarMensajes(); }
        else if (d.tipo === 'notificacion') cargarConversaciones();
      } catch {}
    };
  });
  onDestroy(() => {
    if (pollConv) clearInterval(pollConv);
    if (pollMsg) clearInterval(pollMsg);
    if (es) es.close();
  });
</script>

<svelte:head><title>Mensajería — AGI</title></svelte:head>

<div class="wrap">
  {#if loading}<div class="center">Cargando…</div>{/if}
  {#if error}<div class="alert-error">{error}</div>{/if}

  <div class="layout">
    <!-- Lista de conversaciones -->
    <aside class="lista" bind:this={listaEl}>
      <div class="lista-head">
        <div>
          <h2>💬 Mensajería</h2>
          <p class="sub">{totalNoLeidos ? `${totalNoLeidos} sin leer` : 'Centro de comunicación'}</p>
        </div>
        <a class="btn-home" href="/" title="Inicio">⌂</a>
      </div>
      <input class="buscador" placeholder="Buscar conversación…" bind:value={buscando} />

      {#if actual !== 'comunicados'}
        <button class="conv comunicados-item" class:sel={actual === 'comunicados'} onclick={() => abrir('comunicados')}>
          <div class="avatar sys">📢</div>
          <div class="conv-info">
            <b>Comunicados</b>
            <span class="mut">{esAdmin ? 'Envío a grupos' : 'Avisos de la agencia'}</span>
          </div>
        </button>
      {/if}

      {#each CONVS_FILTRO as c}
        {@const p = c.perfil}
        <button class="conv" class:sel={actual?.partner === c.partner} class:archivada={c.estado?.archivada} onclick={() => abrir(c)}>
          {#if fotoUrl(p)}<img class="avatar" src={fotoUrl(p)} alt="" />{:else}<div class="avatar">👤</div>{/if}
          <div class="conv-info">
            <div class="conv-top">
              <b>{nombreConv(c)}</b>
              {#if c.estado?.importante}<span title="Importante">⭐</span>{/if}
            </div>
            <span class="mut">{rolLabel(p?.rol)}{p?.email ? ' · ' + p.email : ''}</span>
            {#if c.ultimo}<span class="preview">{c.ultimo.cuerpo?.slice(0, 40)}{c.ultimo.cuerpo?.length > 40 ? '…' : ''}</span>{/if}
          </div>
          {#if c.noLeidos}<span class="badge-nl">{c.noLeidos}</span>{/if}
        </button>
      {:else}
        {#if esAdmin}
          <p class="mut pad">{buscando ? 'Sin resultados.' : 'No hay conversaciones aún. Elige un usuario para escribirle.'}</p>
        {/if}
      {/each}

      {#if esAdmin}
        <div class="nuevo">
          <p class="sub"><b>Nuevo mensaje</b></p>
          <select id="sel-destino" class="sel-destino">
            <option value="">Escribe a…</option>
            {#each conversaciones as c}
              <option value={c.partner}>{nombreConv(c)}</option>
            {/each}
          </select>
          <button class="btn-nuevo" onclick={() => {
            const sel = document.getElementById('sel-destino');
            const c = conversaciones.find((x) => x.partner === sel.value);
            if (c) abrir(c);
          }}>Abrir chat</button>
        </div>
      {/if}
    </aside>

    <!-- Conversación / comunicados -->
    {#if actual}
      <section class="conversacion">
        <header class="chat-header">
          <button class="volver" onclick={volverALista}>←</button>
          {#if esConversacionAbierta}
            {@const c = conversaciones.find((x) => x.partner === actual.partner)}
            {@const p = c?.perfil}
            {#if fotoUrl(p)}<img class="foto" src={fotoUrl(p)} alt="" />{:else}<div class="foto avatar">👤</div>{/if}
            <div class="chat-id">
              <b>{tituloActual}</b>
              <span class="mut2">{rolLabel(p?.rol)}{p?.telefono ? ' · ' + p.telefono : ''}</span>
            </div>
            <div class="chat-acc">
              {#if esAdmin}
                <button class="acc" title={c?.estado?.importante ? 'Quitar importante' : 'Marcar importante'} onclick={() => toggle(actual.partner, 'importante')}>{c?.estado?.importante ? '⭐' : '☆'}</button>
                <button class="acc" title={c?.estado?.archivada ? 'Desarchivar' : 'Archivar'} onclick={() => toggle(actual.partner, 'archivada')}>{c?.estado?.archivada ? '📤' : '📁'}</button>
              {/if}
              {#if p?.telefono}<a class="btn-call" href="tel:{p.telefono}">📞</a>{/if}
            </div>
          {:else}
            <div class="chat-id"><b>📢 Comunicados de la agencia</b></div>
          {/if}
          <a class="btn-home" href="/" title="Inicio">⌂ Inicio</a>
        </header>

        <div class="mensajes" bind:this={chatEl}>
          {#each mensajes as m}
            {@const mio = esMio(m)}
            <div class="msg-wrap" class:mio>
              <div class="burbuja" class:mia={mio} class:importante={m.importante}>
                {#if !mio && !actual?.audiencia}<div class="remitente">{m.emisor_nombre || 'Contacto'}</div>{/if}
                {#if m.adjunto_path && m._url}
                  {#if m._url.match(/\.(png|jpe?g|gif|webp)/i)}
                    <a href={m._url} target="_blank"><img class="adj-img" src={m._url} alt="adjunto" /></a>
                  {:else}
                    <a class="adj-file" href={m._url} target="_blank">📎 Archivo adjunto</a>
                  {/if}
                {/if}
                {#if m.cuerpo && m.cuerpo !== '[archivo]'}<div class="texto">{m.cuerpo}</div>{/if}
                <div class="hora">
                  {fmtFechaMsg(m.created_at)}
                  {#if mio}<span class="ticks" class:leido={m.leido}>{m.leido ? '✓✓' : '✓'}</span>{/if}
                  {#if !mio}<button class="reportar" title="Reportar" onclick={() => reportar(m)}>⚑</button>{/if}
                </div>
              </div>
            </div>
          {:else}
            <p class="mut center-pad">{actual === 'comunicados' ? 'Sin comunicados.' : 'Sin mensajes. Escribe el primero.'}</p>
          {/each}
        </div>

        {#if esAdmin && actual === 'comunicados'}
          <div class="comunicado-box">
            <div class="com-row">
              <select bind:value={audComun}>
                <option value="todos">Todos</option>
                <option value="empleados">Empleados</option>
                <option value="familiares">Familiares</option>
              </select>
              <input placeholder="Escribe un comunicado…" bind:value={textoComun} onkeydown={(e) => e.key === 'Enter' && enviarComunicado()} />
              <button class="btn-enviar" onclick={enviarComunicado}>📢</button>
            </div>
          </div>
        {:else if actual !== 'comunicados' || !esAdmin}
          {#if adjunto}
            <div class="adj-preview">
              📎 {adjuntoNombre}
              <button onclick={() => { adjunto = null; adjuntoNombre = ''; }}>✕</button>
            </div>
          {/if}
          <div class="entrada">
            <input type="file" bind:this={fileInput} style="display:none" onchange={onFile} accept="image/*,.pdf,.doc,.docx,.txt" />
            <button class="btn-adj" title="Adjuntar foto o archivo" onclick={() => fileInput?.click()}>📎</button>
            <input placeholder={actual === 'comunicados' ? 'Los comunicados los envía el directivo' : 'Escribe un mensaje…'} bind:value={texto} disabled={actual === 'comunicados' && !esAdmin} onkeydown={(e) => e.key === 'Enter' && enviar()} />
            <button class="btn-enviar" onclick={enviar} disabled={enviando}>➤</button>
          </div>
        {/if}
      </section>
    {:else}
      <section class="vacio">
        <div class="vacio-card">
          <div class="vacio-icon">💬</div>
          <h3>{esAdmin ? 'Centro de Mensajería' : 'Mensajes con el directivo'}</h3>
          <p class="mut">{esAdmin ? 'Selecciona una conversación de la lista o escribe a un usuario nuevo.' : 'Tu conversación con el directivo aparece aquí. También recibirás los comunicados de la agencia.'}</p>
          {#if totalNoLeidos}<p class="badge-nl big">{totalNoLeidos} sin leer</p>{/if}
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .wrap { height: 100vh; display: flex; flex-direction: column; background: #efeae2; font-family: inherit; }
  .center { padding: 2rem; text-align: center; color: #6b7280; }
  .alert-error { background: #fee2e2; color: #b91c1c; padding: .6rem 1rem; margin: .5rem; border-radius: 10px; }
  .layout { flex: 1; display: flex; min-height: 0; }

  .lista { width: 320px; background: #fff; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; flex-shrink: 0; }
  .lista-head { display: flex; align-items: center; justify-content: space-between; padding: .9rem 1rem .4rem; }
  .lista-head h2 { margin: 0; font-size: 1.05rem; color: #075e54; }
  .sub, .mut { color: #8696a0; font-size: .78rem; }
  .btn-home { background: #075e54; color: #fff; text-decoration: none; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: .95rem; }
  .buscador { margin: 0 .8rem .6rem; padding: .55rem .9rem; border: none; border-radius: 8px; background: #f0f2f5; font-size: .9rem; outline: none; }
  .lista { overflow-y: auto; }
  .conv { display: flex; align-items: center; gap: .7rem; width: 100%; padding: .7rem .9rem; border: none; background: none; cursor: pointer; text-align: left; border-bottom: 1px solid #f3f4f6; }
  .conv:hover { background: #f5f6f6; }
  .conv.sel { background: #e9edef; }
  .conv.archivada { opacity: .55; }
  .conv-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .conv-top { display: flex; justify-content: space-between; align-items: center; }
  .conv-info b { font-size: .92rem; color: #111b21; }
  .preview { font-size: .8rem; color: #667781; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .avatar { width: 46px; height: 46px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: #dfe5e7; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; }
  .avatar.sys { background: #dcfce7; }
  .badge-nl { background: #25d366; color: #fff; border-radius: 999px; min-width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: .75rem; font-weight: 800; padding: 0 6px; }
  .badge-nl.big { font-size: 1rem; padding: .3rem .9rem; }
  .pad { padding: .8rem; }
  .nuevo { padding: .8rem; border-top: 1px solid #e5e7eb; }
  .sel-destino { width: 100%; padding: .5rem; border-radius: 8px; border: 1px solid #d1d5db; margin-bottom: .5rem; font-size: .85rem; }
  .btn-nuevo { width: 100%; background: #075e54; color: #fff; border: none; border-radius: 8px; padding: .55rem; font-weight: 700; cursor: pointer; }

  .conversacion { flex: 1; display: flex; flex-direction: column; min-width: 0; background: #efeae2; }
  .chat-header { background: #075e54; color: #fff; display: flex; align-items: center; gap: .7rem; padding: .6rem 1rem; flex-shrink: 0; }
  .volver { display: none; background: none; border: none; color: #fff; font-size: 1.3rem; cursor: pointer; }
  .foto { width: 38px; height: 38px; }
  .chat-id { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .chat-id b { font-size: .95rem; }
  .mut2 { color: #c8e6c9; font-size: .75rem; }
  .chat-acc { display: flex; align-items: center; gap: .4rem; }
  .acc { background: rgba(255,255,255,.15); border: none; color: #fff; border-radius: 8px; width: 34px; height: 34px; cursor: pointer; font-size: .95rem; }
  .btn-call { background: #fff; color: #075e54; text-decoration: none; border-radius: 999px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: .9rem; }
  .btn-home { background: rgba(255,255,255,.15); color: #fff; text-decoration: none; font-size: .78rem; font-weight: 700; padding: .4rem .7rem; border-radius: 999px; white-space: nowrap; }

  .mensajes { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: .35rem; }
  .msg-wrap { display: flex; }
  .msg-wrap.mio { justify-content: flex-end; }
  .burbuja { max-width: 70%; padding: .45rem .75rem; border-radius: 10px; background: #fff; font-size: .9rem; box-shadow: 0 1px 1px rgba(0,0,0,.08); position: relative; }
  .burbuja.mia { background: #d9fdd3; }
  .burbuja.importante { border-left: 3px solid #f59e0b; }
  .remitente { font-size: .72rem; font-weight: 700; color: #075e54; margin-bottom: 2px; }
  .texto { white-space: pre-wrap; word-break: break-word; }
  .hora { font-size: .66rem; color: #8696a0; text-align: right; margin-top: 2px; display: flex; justify-content: flex-end; align-items: center; gap: 4px; }
  .ticks.leido { color: #34b7f1; }
  .reportar { background: none; border: none; cursor: pointer; font-size: .7rem; opacity: .5; padding: 0 2px; }
  .reportar:hover { opacity: 1; }
  .adj-img { max-width: 240px; max-height: 240px; border-radius: 8px; display: block; margin-bottom: 4px; }
  .adj-file { display: inline-block; background: #f0f2f5; padding: .4rem .7rem; border-radius: 8px; font-size: .82rem; color: #075e54; text-decoration: none; margin-bottom: 4px; }
  .center-pad { text-align: center; padding: 2rem 1rem; }

  .comunicado-box { background: #fff; border-top: 1px solid #e5e7eb; padding: .6rem .8rem; }
  .com-row { display: flex; gap: .5rem; }
  .com-row select { padding: .55rem; border-radius: 8px; border: 1px solid #d1d5db; font-size: .85rem; }
  .com-row input { flex: 1; padding: .55rem .9rem; border: 1px solid #d1d5db; border-radius: 999px; font-size: .9rem; outline: none; }
  .adj-preview { background: #fef9c3; padding: .5rem .9rem; font-size: .85rem; display: flex; justify-content: space-between; align-items: center; }
  .adj-preview button { background: none; border: none; cursor: pointer; font-size: 1rem; }
  .entrada { display: flex; gap: .5rem; padding: .6rem .8rem; background: #f0f2f5; align-items: center; }
  .entrada input[type=text], .entrada input:not([type]) { flex: 1; padding: .65rem 1rem; border: none; border-radius: 999px; font-size: .95rem; outline: none; }
  .btn-adj { background: none; border: none; font-size: 1.3rem; cursor: pointer; padding: .3rem; }
  .btn-enviar { width: 44px; height: 44px; border-radius: 50%; border: none; cursor: pointer; background: #075e54; color: #fff; font-size: 1.05rem; flex-shrink: 0; }
  .btn-enviar:disabled { opacity: .5; }

  .vacio { flex: 1; display: flex; align-items: center; justify-content: center; }
  .vacio-card { text-align: center; max-width: 380px; padding: 2rem; }
  .vacio-icon { font-size: 3rem; margin-bottom: .8rem; }
  .vacio-card h3 { color: #111b21; margin: 0 0 .5rem; }

  @media (max-width: 800px) {
    .lista { position: absolute; inset: 0 auto 0 0; z-index: 5; width: 88%; max-width: 340px; box-shadow: 4px 0 24px rgba(0,0,0,.2); }
    .volver { display: block; }
    .burbuja { max-width: 88%; }
    .chat-header .btn-home span, .btn-home { font-size: .75rem; }
  }
</style>
