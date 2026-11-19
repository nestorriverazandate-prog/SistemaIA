<script>
  import { onMount, onDestroy } from 'svelte';
  import { api, getToken } from '$lib/api';

  let me = $state(null);
  let esAdmin = $state(false);
  let miId = $state(null);
  let conversaciones = $state([]);
  let comunicados = $state([]);
  let directorio = $state([]);
  let totalNoLeidos = $state(0);
  let actual = $state(null);
  let mensajes = $state([]);
  let texto = $state('');
  let adjunto = $state(null);
  let adjuntoNombre = $state('');
  let buscando = $state('');
  let error = $state('');
  let loading = $state(true);
  let enviando = $state(false);
  let chatEl, listaEl, fileInput;
  let pollConv = null, pollMsg = null, es = null;

  const q = $derived(buscando.trim().toLowerCase());

  const CONVS_FILTRO = $derived(
    conversaciones.filter((c) =>
      !q ||
      (c.perfil?.nombre || '').toLowerCase().includes(q) ||
      (c.perfil?.email || '').toLowerCase().includes(q) ||
      rolLabel(c.perfil?.rol).toLowerCase().includes(q)
    )
  );

  const USUARIOS_FILTRO = $derived(
    directorio.filter((u) =>
      !conversaciones.some((c) => c.partner === u.id) &&
      (!q ||
        (u.nombre || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        rolLabel(u.rol).toLowerCase().includes(q) ||
        (u.profesion || '').toLowerCase().includes(q))
    )
  );

  const GRUPOS = [
    { clave: 'empleados', titulo: 'Empleados', roles: ['staff', 'cuidador'] },
    { clave: 'familiares', titulo: 'Familiares', roles: ['familiar'] },
    { clave: 'pacientes', titulo: 'Pacientes', roles: ['paciente'] },
    { clave: 'otros', titulo: 'Otros perfiles', roles: [] }
  ];
  const USUARIOS_POR_GRUPO = $derived.by(() => {
    return GRUPOS.map((g) => ({
      ...g,
      usuarios: USUARIOS_FILTRO.filter((u) => g.roles.includes(u.rol) || (!g.roles.length && !GRUPOS.some((o) => o.roles.includes(u.rol))))
    })).filter((g) => g.usuarios.length);
  });

  function esMio(m) { return m.emisor_id === miId; }
  function fmtHora(iso) { return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); }
  function fmtFechaMsg(iso) {
    const d = new Date(iso);
    if (new Date().toDateString() === d.toDateString()) return fmtHora(iso);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' }) + ' ' + fmtHora(iso);
  }
  function fotoUrl(p) { return p?.foto_path ? `/api/perfiles/${p.id}/foto?t=${Date.now()}` : null; }
  function nombreDe(p) { return p?.nombre || p?.email || 'Usuario'; }
  function perfilDe(partner) {
    if (partner === 'directivo') return { nombre: 'Directivo', rol: 'admin' };
    return directorio.find((u) => u.id === partner)
      || conversaciones.find((c) => c.partner === partner)?.perfil
      || (actual && actual !== 'comunicados' && actual.partner === partner ? actual.perfil : null)
      || null;
  }
  function nombreConv(c) {
    if (c?.partner === 'directivo') return 'Directivo';
    return nombreDe(c?.perfil || perfilDe(c?.partner));
  }
  function rolLabel(r) { return { admin: 'Directivo', staff: 'Trabajador', paciente: 'Paciente', familiar: 'Familiar', cuidador: 'Cuidador' }[r] || r || ''; }

  const convActual = $derived(actual && actual !== 'comunicados' ? conversaciones.find((x) => x.partner === actual.partner) : null);
  const perfilActual = $derived(convActual?.perfil || (actual && actual !== 'comunicados' ? (actual.perfil || perfilDe(actual.partner)) : null));
  const tituloActual = $derived.by(() => {
    if (!actual) return '';
    if (actual === 'comunicados') return 'Comunicados';
    return nombreConv({ partner: actual.partner, perfil: perfilActual });
  });

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

  async function cargarDirectorio() {
    if (!esAdmin) return;
    try {
      const d = await api.raw('/api/perfiles');
      directorio = (d.perfiles || []).filter((p) => p.estado === 'aprobado' && p.id !== miId);
    } catch {}
  }

  async function abrir(conv) {
    actual = conv;
    mensajes = [];
    if (window.innerWidth < 800 && listaEl) listaEl.style.display = 'none';
    await cargarMensajes();
  }

  function abrirUsuario(u) {
    const conv = conversaciones.find((c) => c.partner === u.id);
    abrir(conv || { partner: u.id, perfil: u, ultimo: null, noLeidos: 0, estado: null });
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
        if (actual.partner !== 'directivo') body.receptor_id = actual.partner;
      } else if (esAdmin && actual === 'comunicados') {
        body.audiencia = 'todos';
      } else {
        return;
      }
      await api.raw('/api/chat/mensajes', { method: 'POST', body: JSON.stringify(body) });
      texto = ''; adjunto = null; adjuntoNombre = '';
      await cargarMensajes();
      cargarDirectorio();
    } catch (e) { error = e.message; }
    enviando = false;
  }

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
    const conv = conversaciones.find((c) => c.partner === partner) || { partner, estado: {} };
    const val = !(conv?.estado?.[campo]);
    conv.estado = { ...(conv?.estado || {}), [campo]: val };
    try { await api.raw('/api/chat/estado', { method: 'POST', body: JSON.stringify({ partner, [campo]: val }) }); } catch {}
    cargarConversaciones();
  }

  async function reportar(m) {
    if (!confirm('¿Reportar este mensaje como inapropiado?')) return;
    try { await api.raw('/api/chat/reportar', { method: 'POST', body: JSON.stringify({ mensaje_id: m.id }) }); } catch {}
  }

  const esConversacionAbierta = $derived(actual && actual !== 'comunicados');
  const convAbierta = $derived(esConversacionAbierta ? (convActual || { partner: actual.partner, perfil: perfilActual }) : null);

  onMount(async () => {
    if (!getToken()) { window.location.href = '/'; return; }
    me = await api.raw('/api/me').catch(() => null);
    miId = me?.user?.id || me?.id || null;
    esAdmin = me?.user?.perfil?.rol === 'admin' || me?.perfil?.rol === 'admin';
    await cargarConversaciones();
    await cargarDirectorio();
    const con = new URLSearchParams(window.location.search).get('con');
    if (con) {
      const conv = conversaciones.find((c) => c.partner === con);
      if (conv) abrir(conv);
      else if (con === 'comunicados') abrir('comunicados');
      else if (con === 'directivo') abrir(conversaciones[0] || { partner: 'directivo', perfil: null });
      else {
        const u = directorio.find((x) => x.id === con);
        if (u) abrirUsuario(u);
      }
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

<header class="topbar">
  <a class="brand" href="/">
    <img src="/logo.png" alt="Agencia Gerontológica Integral" />
    <div class="brand-text">
      <span class="agency">Agencia Gerontológica Integral</span>
      <h1>Mensajería interna</h1>
    </div>
  </a>
  <div class="top-links">
    {#if esAdmin}<a class="ghost link" href="/emergencias">Emergencias</a>{/if}
    <a class="ghost link" href="/">Inicio</a>
  </div>
</header>

<div class="wrap">
  {#if loading}<div class="center">Cargando…</div>{/if}
  {#if error}<div class="alert-error">{error}</div>{/if}

  <div class="layout">
    <!-- Lista de conversaciones y usuarios -->
    <aside class="lista" bind:this={listaEl}>
      <div class="lista-head">
        <div>
          <h2>Conversaciones</h2>
          <p class="sub">{totalNoLeidos ? `${totalNoLeidos} sin leer` : 'Centro de comunicación'}</p>
        </div>
      </div>
      <input class="buscador" placeholder="Buscar por nombre, correo o puesto…" bind:value={buscando} />

      <button class="conv comunicados-item" class:sel={actual === 'comunicados'} onclick={() => abrir('comunicados')}>
        <div class="avatar sys">C</div>
        <div class="conv-info">
          <b>Comunicados</b>
          <span class="mut">{esAdmin ? 'Envío a grupos' : 'Avisos de la agencia'}</span>
        </div>
      </button>

      {#each CONVS_FILTRO as c}
        {@const p = c.perfil || perfilDe(c.partner)}
        <button class="conv" class:sel={actual?.partner === c.partner} class:archivada={c.estado?.archivada} onclick={() => abrir(c)}>
          {#if fotoUrl(p)}<img class="avatar" src={fotoUrl(p)} alt="" />{:else}<div class="avatar">U</div>{/if}
          <div class="conv-info">
            <div class="conv-top">
              <b>{nombreConv(c)}</b>
              {#if c.estado?.importante}<span class="imp" title="Importante">Importante</span>{/if}
            </div>
            <span class="mut">{rolLabel(p?.rol)}{p?.profesion ? ' · ' + p.profesion : ''}</span>
            {#if c.ultimo}<span class="preview">{c.ultimo.cuerpo?.slice(0, 40)}{c.ultimo.cuerpo?.length > 40 ? '…' : ''}</span>{/if}
          </div>
          {#if c.noLeidos}<span class="badge-nl">{c.noLeidos}</span>{/if}
        </button>
      {:else}
        {#if !q}<p class="mut pad">Sin conversaciones todavía.</p>{/if}
      {/each}

      {#if esAdmin}
        {#each USUARIOS_POR_GRUPO as g}
          <p class="seccion">{g.titulo}</p>
          {#each g.usuarios as u}
            <button class="conv" onclick={() => abrirUsuario(u)}>
              {#if fotoUrl(u)}<img class="avatar" src={fotoUrl(u)} alt="" />{:else}<div class="avatar">U</div>{/if}
              <div class="conv-info">
                <b>{u.nombre || u.email}</b>
                <span class="mut">{rolLabel(u.rol)}{u.profesion ? ' · ' + u.profesion : ''}</span>
              </div>
            </button>
          {/each}
        {/each}
      {/if}
      {#if esAdmin && !USUARIOS_FILTRO.length && !q}
        <p class="mut pad">No hay más usuarios registrados.</p>
      {/if}
      {#if !esAdmin && !CONVS_FILTRO.length && !q}
        <p class="mut pad">Tu conversación con el directivo aparecerá aquí.</p>
      {/if}
    </aside>

    <!-- Conversación / comunicados -->
    {#if actual}
      <section class="conversacion">
        <header class="chat-header">
          <button class="volver" onclick={volverALista}>←</button>
          {#if esConversacionAbierta}
            {@const p = perfilActual}
            {#if fotoUrl(p)}<img class="foto" src={fotoUrl(p)} alt="" />{:else}<div class="foto avatar">U</div>{/if}
            <div class="chat-id">
              <b>{tituloActual}</b>
              <span class="mut2">{rolLabel(p?.rol)}{p?.profesion ? ' · ' + p.profesion : ''}{p?.telefono ? ' · ' + p.telefono : ''}</span>
            </div>
            <div class="chat-acc">
              {#if convActual}
                <button class="acc" title={convActual?.estado?.importante ? 'Quitar importante' : 'Marcar importante'} onclick={() => toggle(actual.partner, 'importante')}>{convActual?.estado?.importante ? 'Quitar importante' : 'Importante'}</button>
                <button class="acc" title={convActual?.estado?.archivada ? 'Desarchivar' : 'Archivar'} onclick={() => toggle(actual.partner, 'archivada')}>{convActual?.estado?.archivada ? 'Desarchivar' : 'Archivar'}</button>
              {/if}
              {#if p?.telefono}<a class="btn-call" href="tel:{p.telefono}">Llamar</a>{/if}
            </div>
          {:else}
            <div class="chat-id"><b>Comunicados de la agencia</b></div>
          {/if}
        </header>

        <div class="mensajes" bind:this={chatEl}>
          {#each mensajes as m}
            {@const mio = esMio(m)}
            <div class="msg-wrap" class:mio>
              <div class="burbuja" class:mia={mio} class:importante={m.importante}>
                {#if !mio && !m.audiencia}<div class="remitente">{m.emisor_nombre || 'Contacto'}</div>{/if}
                {#if m.adjunto_path && m._url}
                  {#if m._url.match(/\.(png|jpe?g|gif|webp)/i)}
                    <a href={m._url} target="_blank"><img class="adj-img" src={m._url} alt="adjunto" /></a>
                  {:else}
                    <a class="adj-file" href={m._url} target="_blank">Archivo adjunto</a>
                  {/if}
                {/if}
                {#if m.cuerpo && m.cuerpo !== '[archivo]'}<div class="texto">{m.cuerpo}</div>{/if}
                <div class="hora">
                  {fmtFechaMsg(m.created_at)}
                  {#if mio}<span class="ticks" class:leido={m.leido}>{m.leido ? 'Leído' : 'Enviado'}</span>{/if}
                  {#if !mio}<button class="reportar" title="Reportar" onclick={() => reportar(m)}>Reportar</button>{/if}
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
              <button class="btn-enviar" onclick={enviarComunicado}>Enviar</button>
            </div>
          </div>
        {:else if actual !== 'comunicados' || !esAdmin}
          {#if adjunto}
            <div class="adj-preview">
              {adjuntoNombre}
              <button onclick={() => { adjunto = null; adjuntoNombre = ''; }}>Quitar</button>
            </div>
          {/if}
          <div class="entrada">
            <input type="file" bind:this={fileInput} style="display:none" onchange={onFile} accept="image/*,.pdf,.doc,.docx,.txt" />
            <button class="btn-adj" title="Adjuntar foto o archivo" onclick={() => fileInput?.click()}>Adjuntar</button>
            <input placeholder={actual === 'comunicados' ? 'Los comunicados los envía el directivo' : 'Escribe un mensaje…'} bind:value={texto} disabled={actual === 'comunicados' && !esAdmin} onkeydown={(e) => e.key === 'Enter' && enviar()} />
            <button class="btn-enviar" onclick={enviar} disabled={enviando}>Enviar</button>
          </div>
        {/if}
      </section>
    {:else}
      <section class="vacio">
        <div class="vacio-card">
          <h3>{esAdmin ? 'Centro de Mensajería' : 'Mensajes con el directivo'}</h3>
          <p class="mut">{esAdmin ? 'Selecciona una conversación o escribe a cualquier usuario de la lista.' : 'Tu conversación con el directivo aparece aquí. También recibirás los comunicados de la agencia.'}</p>
          {#if totalNoLeidos}<p class="badge-nl big">{totalNoLeidos} sin leer</p>{/if}
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; background: oklch(0.985 0.007 85); color: oklch(0.27 0.035 225); }

  .topbar {
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: .5rem;
    padding: .8rem 2rem; background: oklch(0.3 0.05 222); color: #f2eee2;
    border-bottom: 3px solid oklch(0.7 0.1 78);
  }
  .brand { display: flex; align-items: center; gap: .8rem; text-decoration: none; color: inherit; }
  .brand-text { display: flex; flex-direction: column; }
  .agency { font-size: .72rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: oklch(0.7 0.1 78); }
  .topbar img { height: 44px; width: 44px; object-fit: cover; border-radius: 10px; background: #f2eee2; padding: 2px; }
  .topbar h1 { font-size: 1.05rem; margin: 0; color: #f2eee2; }
  .top-links { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  .ghost.link { color: #f2eee2; text-decoration: none; font-size: .85rem; padding: .35rem .8rem; border: 1px solid rgba(242,238,226,.4); border-radius: 999px; }
  .ghost.link:hover { background: rgba(255,255,255,.12); }

  .wrap { height: calc(100vh - 73px); display: flex; flex-direction: column; }
  .center { padding: 2rem; text-align: center; color: #6b7280; }
  .alert-error { background: #fee2e2; color: #b91c1c; padding: .6rem 1rem; margin: .5rem; border-radius: 10px; }
  .layout { flex: 1; display: flex; min-height: 0; }

  .lista {
    width: 330px; background: #fff; border-right: 1px solid oklch(0.9 0.018 85);
    display: flex; flex-direction: column; flex-shrink: 0; overflow-y: auto;
    box-shadow: 2px 0 8px rgba(0,0,0,.04);
  }
  .lista-head { padding: .9rem 1rem .4rem; }
  .lista-head h2 { margin: 0; font-size: 1.05rem; color: oklch(0.3 0.05 222); }
  .sub, .mut { color: #8696a0; font-size: .78rem; }
  .buscador {
    margin: 0 .8rem .6rem; padding: .55rem .9rem; border: 1px solid oklch(0.9 0.018 85);
    border-radius: 8px; background: oklch(0.985 0.007 85); font-size: .9rem; outline: none;
  }
  .buscador:focus { border-color: oklch(0.42 0.068 218); }
  .conv { display: flex; align-items: center; gap: .7rem; width: 100%; padding: .7rem .9rem; border: none; background: none; cursor: pointer; text-align: left; border-bottom: 1px solid #f3f4f6; }
  .conv:hover { background: oklch(0.97 0.01 85); }
  .conv.sel { background: oklch(0.93 0.02 218); }
  .conv.archivada { opacity: .55; }
  .conv-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .conv-top { display: flex; justify-content: space-between; align-items: center; gap: .4rem; }
  .conv-info b { font-size: .92rem; color: oklch(0.27 0.035 225); }
  .imp { font-size: .62rem; font-weight: 800; color: oklch(0.5 0.12 75); background: oklch(0.93 0.06 90); border-radius: 999px; padding: 1px 7px; }
  .preview { font-size: .8rem; color: #667781; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .avatar {
    width: 46px; height: 46px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
    background: oklch(0.9 0.018 85); display: flex; align-items: center; justify-content: center;
    font-size: 1rem; font-weight: 800; color: oklch(0.42 0.068 218);
  }
  .avatar.sys { background: oklch(0.66 0.055 145); color: #fff; }
  .badge-nl {
    background: oklch(0.66 0.055 145); color: #fff; border-radius: 999px;
    min-width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
    font-size: .75rem; font-weight: 800; padding: 0 6px;
  }
  .badge-nl.big { font-size: 1rem; padding: .3rem .9rem; }
  .pad { padding: .8rem; }
  .seccion {
    margin: .9rem .9rem .3rem; font-size: .7rem; font-weight: 800; letter-spacing: .1em;
    text-transform: uppercase; color: oklch(0.55 0.03 225); border-top: 1px solid oklch(0.93 0.015 85); padding-top: .7rem;
  }

  .conversacion { flex: 1; display: flex; flex-direction: column; min-width: 0; background: oklch(0.96 0.012 85); }
  .chat-header {
    background: oklch(0.3 0.05 222); color: #f2eee2;
    border-bottom: 3px solid oklch(0.7 0.1 78);
    display: flex; align-items: center; gap: .7rem; padding: .6rem 1rem; flex-shrink: 0;
  }
  .volver { display: none; background: none; border: none; color: #f2eee2; font-size: 1.3rem; cursor: pointer; }
  .foto { width: 38px; height: 38px; }
  .chat-id { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .chat-id b { font-size: .95rem; color: #f2eee2; }
  .mut2 { color: oklch(0.75 0.03 85); font-size: .75rem; }
  .chat-acc { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; }
  .acc {
    background: rgba(242,238,226,.15); border: 1px solid rgba(242,238,226,.35); color: #f2eee2;
    border-radius: 8px; padding: .35rem .6rem; font-size: .72rem; font-weight: 700; cursor: pointer; white-space: nowrap;
  }
  .acc:hover { background: rgba(242,238,226,.28); }
  .btn-call {
    background: oklch(0.7 0.1 78); color: oklch(0.27 0.035 225); text-decoration: none;
    border-radius: 999px; padding: .4rem .9rem; font-size: .8rem; font-weight: 800; white-space: nowrap;
  }

  .mensajes { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: .35rem; }
  .msg-wrap { display: flex; }
  .msg-wrap.mio { justify-content: flex-end; }
  .burbuja { max-width: 70%; padding: .45rem .75rem; border-radius: 10px; background: #fff; font-size: .9rem; box-shadow: 0 1px 1px rgba(0,0,0,.08); position: relative; }
  .burbuja.mia { background: oklch(0.9 0.03 218); }
  .burbuja.importante { border-left: 3px solid oklch(0.7 0.1 78); }
  .remitente { font-size: .72rem; font-weight: 700; color: oklch(0.42 0.068 218); margin-bottom: 2px; }
  .texto { white-space: pre-wrap; word-break: break-word; }
  .hora { font-size: .66rem; color: #8696a0; text-align: right; margin-top: 2px; display: flex; justify-content: flex-end; align-items: center; gap: 4px; }
  .ticks.leido { color: oklch(0.42 0.068 218); font-weight: 700; }
  .reportar { background: none; border: none; cursor: pointer; font-size: .7rem; color: #8696a0; padding: 0 2px; }
  .reportar:hover { color: #b91c1c; }
  .adj-img { max-width: 240px; max-height: 240px; border-radius: 8px; display: block; margin-bottom: 4px; }
  .adj-file { display: inline-block; background: oklch(0.93 0.015 85); padding: .4rem .7rem; border-radius: 8px; font-size: .82rem; color: oklch(0.42 0.068 218); text-decoration: none; margin-bottom: 4px; font-weight: 700; }
  .center-pad { text-align: center; padding: 2rem 1rem; }

  .comunicado-box { background: #fff; border-top: 1px solid oklch(0.9 0.018 85); padding: .6rem .8rem; }
  .com-row { display: flex; gap: .5rem; }
  .com-row select { padding: .55rem; border-radius: 8px; border: 1px solid #d1d5db; font-size: .85rem; }
  .com-row input { flex: 1; padding: .55rem .9rem; border: 1px solid #d1d5db; border-radius: 999px; font-size: .9rem; outline: none; }
  .com-row input:focus { border-color: oklch(0.42 0.068 218); }
  .adj-preview { background: oklch(0.93 0.06 90); padding: .5rem .9rem; font-size: .85rem; display: flex; justify-content: space-between; align-items: center; }
  .adj-preview button { background: none; border: none; cursor: pointer; font-size: .85rem; color: #b91c1c; font-weight: 700; }
  .entrada { display: flex; gap: .5rem; padding: .6rem .8rem; background: #fff; border-top: 1px solid oklch(0.9 0.018 85); align-items: center; }
  .entrada input[type=text], .entrada input:not([type]) { flex: 1; padding: .65rem 1rem; border: 1px solid #d1d5db; border-radius: 999px; font-size: .95rem; outline: none; }
  .entrada input:focus { border-color: oklch(0.42 0.068 218); }
  .btn-adj { background: none; border: 1px solid #d1d5db; border-radius: 8px; padding: .45rem .7rem; font-size: .8rem; font-weight: 700; cursor: pointer; color: oklch(0.42 0.068 218); white-space: nowrap; }
  .btn-adj:hover { background: oklch(0.93 0.015 85); }
  .btn-enviar {
    padding: .55rem 1.1rem; border-radius: 999px; border: none; cursor: pointer;
    background: oklch(0.42 0.068 218); color: #fff; font-size: .85rem; font-weight: 800; flex-shrink: 0;
  }
  .btn-enviar:disabled { opacity: .5; }

  .vacio { flex: 1; display: flex; align-items: center; justify-content: center; }
  .vacio-card {
    text-align: center; max-width: 420px; padding: 2rem;
    background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.08);
  }
  .vacio-card h3 { color: oklch(0.3 0.05 222); margin: 0 0 .5rem; }

  @media (max-width: 800px) {
    .lista { position: absolute; inset: 73px auto 0 0; z-index: 5; width: 88%; max-width: 340px; box-shadow: 4px 0 24px rgba(0,0,0,.2); }
    .volver { display: block; }
    .burbuja { max-width: 88%; }
    .topbar { padding: .7rem 1rem; }
    .wrap { height: calc(100vh - 66px); }
  }
</style>
