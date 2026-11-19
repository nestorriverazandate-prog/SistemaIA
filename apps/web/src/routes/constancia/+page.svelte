<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';

  let folio = '';
  let constancia = $state(null);
  let perfil = $state(null);
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    folio = new URLSearchParams(location.search).get('f') || '';
    try {
      const me = await api.raw('/api/me');
      perfil = me.user?.perfil || me.user?.perfil;
      const mio = await api.raw('/api/academia/mio');
      const c = (mio.constancias || []).find(x => x.folio === folio);
      if (!c) { error = 'Constancia no encontrada'; }
      else {
        const ins = (mio.inscripciones || []).find(i => i.curso_id === c.curso_id);
        const curso = c.academia_cursos || ins?.academia_cursos;
        const emp = me.empleados?.find?.(e => e.id === c.empleado_id);
        const { data: perfilEmp } = await api.raw('/api/perfiles').catch(() => ({ data: [] }));
        const p = (perfilEmp?.perfiles || perfilEmp || []).find?.(x => x.id === c.empleado_id) || me.user?.perfil;
        constancia = { ...c, curso, empleado: p || me.user?.perfil };
      }
    } catch (e) { error = e.message; }
    loading = false;
  });
</script>

<svelte:head><title>Constancia {folio} — AGI</title></svelte:head>

{#if loading}
  <div class="center"><div class="spinner"></div></div>
{:else if error}
  <div class="card error">{error}</div>
{:else if constancia}
  <div class="constancia">
    <div class="head">
      <img src="/logo.png" alt="AGI" />
      <div><h1>Agencia Gerontológica Multidisciplinaria</h1><h2>Academia de Profesionales Gerontológicos</h2></div>
    </div>
    <h3 class="titulo">CONSTANCIA DE CAPACITACIÓN</h3>
    <p class="texto">Se hace constar que</p>
    <p class="nombre">{constancia.empleado?.nombre || '—'}</p>
    <p class="texto">ha concluido satisfactoriamente el curso</p>
    <p class="curso">{constancia.curso?.titulo || '—'}</p>
    <div class="datos">
      <div><span>Horas de capacitación</span><b>{constancia.horas || constancia.curso?.horas || '—'} h</b></div>
      <div><span>Calificación obtenida</span><b>{constancia.calificacion ?? '—'}%</b></div>
      <div><span>Fecha de finalización</span><b>{constancia.completado_at ? new Date(constancia.completado_at).toLocaleDateString('es-MX') : new Date(constancia.created_at).toLocaleDateString('es-MX')}</b></div>
      <div><span>Folio de verificación</span><b class="folio">{constancia.folio}</b></div>
    </div>
    <p class="nota">Esta constancia acredita la participación en una capacitación interna de la agencia y no constituye una certificación oficial ni acreditación de SEP.</p>
    <div class="firma">
      <div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data={encodeURIComponent('https://verificar-constancia.vercel.app/?f=' + constancia.folio)}" alt="QR" /></div>
      <div class="linea"></div>
      <p>Responsable Académico<br /><small>Academia de Profesionales Gerontológicos</small></p>
    </div>
    <div class="acciones"><button onclick={() => window.print()}> Imprimir / Guardar PDF</button><a href="/academia">← Volver a la academia</a></div>
  </div>
{/if}

<style>
  .center { text-align: center; padding: 4rem; }
  .spinner { width: 40px; height: 40px; border: 4px solid #e5e7eb; border-top-color: #2563eb; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error { max-width: 500px; margin: 2rem auto; padding: 1rem; background: #fee2e2; color: #991b1b; border-radius: 10px; }
  .constancia { max-width: 800px; margin: 2rem auto; background: #fff; border: 2px solid #1e3a5f; border-radius: 16px; padding: 3rem; font-family: Georgia, serif; }
  .head { display: flex; align-items: center; gap: 1rem; border-bottom: 2px solid #1e3a5f; padding-bottom: 1rem; }
  .head img { width: 70px; height: 70px; border-radius: 12px; }
  .head h1 { font-size: 1.2rem; margin: 0; color: #1e3a5f; }
  .head h2 { font-size: .95rem; margin: .2rem 0 0; color: #666; font-weight: normal; }
  .titulo { text-align: center; color: #1e3a5f; letter-spacing: 3px; margin: 2rem 0; }
  .texto { text-align: center; color: #555; }
  .nombre { text-align: center; font-size: 1.6rem; font-weight: bold; color: #1e3a5f; margin: .5rem 0; }
  .curso { text-align: center; font-size: 1.3rem; color: #2563eb; margin: .5rem 0 1.5rem; }
  .datos { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1.5rem 0; }
  .datos div { background: #f8fafc; padding: .8rem; border-radius: 8px; text-align: center; }
  .datos span { display: block; font-size: .75rem; color: #666; }
  .datos b { font-size: 1.1rem; color: #1e3a5f; }
  .folio { font-family: monospace; }
  .nota { font-size: .8rem; color: #888; text-align: center; font-style: italic; }
  .firma { display: flex; align-items: flex-end; justify-content: space-between; margin-top: 3rem; gap: 2rem; }
  .qr img { width: 90px; height: 90px; }
  .linea { flex: 1; border-top: 1px solid #333; margin: 0 1rem; }
  .firma p { text-align: center; font-weight: bold; }
  .acciones { text-align: center; margin-top: 2rem; }
  .acciones button { padding: .7rem 1.5rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 1rem; }
  .acciones a { display: block; margin-top: .8rem; color: #2563eb; }
  @media print {
    .acciones { display: none; }
    .constancia { border: none; margin: 0; }
  }
</style>
