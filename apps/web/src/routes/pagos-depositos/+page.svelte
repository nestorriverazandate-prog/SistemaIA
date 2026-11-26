<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';
 import { sesion } from '$lib/sesion.svelte.js';

 let perfil = $state(null);
 let loading = $state(true);
 let grupos = $state([]);
 let cuentasPago = $state([]);
 let comprobantes = $state([]);
 let error = $state('');
 let compForm = $state({ paciente_id: '', monto: '', fecha_deposito: new Date().toISOString().slice(0, 10), metodo: 'transferencia', referencia: '' });
 let compArchivo = $state(null);
 let compEnviando = $state(false);
 let compMsg = $state('');
 let compErr = $state('');
 let copiado = $state('');

 const esAdmin = $derived(sesion.user?.perfil?.rol === 'admin' || perfil?.rol === 'admin');

 function fmtFecha(f) { return f ? new Date(f.length === 10 ? f + 'T12:00:00' : f).toLocaleDateString('es-MX', { dateStyle: 'medium' }) : '—'; }
 function copiar(txt, cual) { navigator.clipboard?.writeText(txt).then(() => { copiado = cual; setTimeout(() => (copiado = ''), 1500); }); }
 function onCompArchivo(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) { compErr = 'El archivo no debe superar 8 MB'; return; }
  const rd = new FileReader();
  rd.onload = () => (compArchivo = rd.result);
  rd.readAsDataURL(f);
 }
 async function cargar() {
  try {
   const [mf, pr, cr] = await Promise.all([
    api.misFamiliares().catch(() => ({ pacientes: [] })),
    api.misPagos().catch(() => ({ cuentas: [] })),
    api.comprobantes().catch(() => ({ comprobantes: [] }))
   ]);
   grupos = mf.pacientes || [];
   cuentasPago = pr.cuentas || [];
   comprobantes = cr.comprobantes || [];
  } catch (e) { error = e.message; }
 }
 async function enviarComprobante() {
  compErr = ''; compMsg = '';
  if (!compForm.paciente_id || !Number(compForm.monto) || !compForm.referencia.trim()) {
   compErr = 'Completa paciente, monto y referencia de la operación'; return;
  }
  compEnviando = true;
  try {
   await api.enviarComprobante({ ...compForm, monto: Number(compForm.monto), comprobante: compArchivo });
   compMsg = 'Tu comprobante ha sido enviado correctamente. Nuestro equipo administrativo verificará tu pago y recibirás una notificación cuando haya sido validado.';
   compForm = { paciente_id: '', monto: '', fecha_deposito: new Date().toISOString().slice(0, 10), metodo: 'transferencia', referencia: '' };
   compArchivo = null;
   await cargar();
  } catch (e) { compErr = e.message; }
  finally { compEnviando = false; }
 }
 async function verComp(c) {
  try { const r = await api.comprobanteUrl(c.id); window.open(r.url, '_blank'); }
  catch (e) { error = e.message; }
 }
 function estadoComp(e) { return e === 'aprobado' ? 'Aprobado' : e === 'rechazado' ? 'Rechazado' : 'Pendiente de revisión'; }
 function imprimirRecibo(cuenta, pago) {
  const w = window.open('', '_blank', 'width=640,height=760');
  w.document.write(`<html><head><title>Recibo ${pago.recibo_folio || ''}</title><style>
   body{font-family:Georgia,serif;max-width:560px;margin:32px auto;padding:0 20px;color:#222}
   .head{text-align:center;border-bottom:3px solid #c9a227;padding-bottom:12px}
   .head h1{font-size:1.15rem;margin:0;color:#234}.head p{margin:4px 0 0;font-size:.75rem;color:#666}
   .logo{height:52px}
   .recibo{border:2px dashed #c9a227;border-radius:12px;padding:18px;margin:18px 0}
   table{width:100%;border-collapse:collapse;font-size:.85rem}td{padding:6px 4px;border-bottom:1px solid #eee}
   .total{font-size:1.05rem;font-weight:700;color:#14663f}
   .folio{text-align:center;font-size:.72rem;color:#8a6d1f;letter-spacing:.1em;margin-top:10px}
   .foot{text-align:center;font-size:.68rem;color:#888;margin-top:18px}
   @media print{body{margin:0}}
  </style></head><body>
  <div class="head"><img class="logo" src="${window.location.origin}/logo.png"/><h1>Agencia Gerontológica Integral</h1><p>Recibo de pago oficial</p></div>
  <div class="recibo">
   <table>
    <tr><td><b>Paciente:</b></td><td>${cuenta.paciente.nombre}</td></tr>
    <tr><td><b>Paquete:</b></td><td>${cuenta.paquete || '—'}</td></tr>
    <tr><td><b>Fecha de pago:</b></td><td>${fmtFecha(pago.fecha)}</td></tr>
    <tr><td><b>Monto:</b></td><td class="total">$${Number(pago.monto).toFixed(2)}</td></tr>
    <tr><td><b>Método:</b></td><td>${pago.metodo || '—'}</td></tr>
    <tr><td><b>Periodo:</b></td><td>${pago.periodo || '—'}</td></tr>
    ${pago.comprobante_ref ? `<tr><td><b>Referencia:</b></td><td>${pago.comprobante_ref}</td></tr>` : ''}
   </table>
   <div class="folio">FOLIO ${pago.recibo_folio || '—'}</div>
  </div>
  <div class="foot">Documento generado por la plataforma AGI · ${new Date().toLocaleString('es-MX')}</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script>
  </body></html>`);
  w.document.close();
 }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
   await cargar();
  } catch { setToken(null); }
  finally { loading = false; }
 });
</script>

<svelte:head><title>Pagos y depósitos — AGI</title></svelte:head>

{#if loading}
 <div class="wrap center"><p>Cargando…</p></div>
{:else if !perfil}
 <div class="wrap center"><h1>Acceso restringido</h1><p class="muted">Inicia sesión para continuar.</p><a href="/">Volver</a></div>
{:else}
<div class="wrap">
 <header class="dir-head">
  <div>
   <h1>Pagos y depósitos</h1>
   <p class="sub">Realiza tu pago por transferencia o depósito y envía tu comprobante</p>
  </div>
 </header>
 {#if error}<div class="err">{error}</div>{/if}
 {#if esAdmin}
  <div class="card"><p>Como directivo, la validación de comprobantes se realiza en <a href="/finanzas">Control financiero → Comprobantes</a>.</p></div>
 {:else}
  {#if !grupos.length}
   <div class="card center"><p class="muted">Aún no tienes adultos mayores vinculados. El directivo debe autorizar la vinculación con tu cuenta para poder registrar pagos.</p></div>
  {:else}
   <!-- 1. Datos bancarios -->
   <section class="card bank-card">
    <div class="bank-head">
     <div class="bank-logo">BBVA</div>
     <div>
      <strong>Datos bancarios para realizar tu pago</strong>
      <p class="muted small">Banco BBVA · Verifica los datos bancarios antes de realizar tu depósito o transferencia</p>
     </div>
    </div>
    <div class="bank-datos">
     <div class="bank-row"><span>Titular de la cuenta</span><b>NESTOR RIVERA ZANDATE</b><button class="mini ghost" onclick={() => copiar('NESTOR RIVERA ZANDATE', 'titular')}>{copiado === 'titular' ? 'Copiado' : 'Copiar'}</button></div>
     <div class="bank-row"><span>Número de tarjeta</span><b class="tarjeta">4152 3144 7451 1436</b><button class="mini ghost" onclick={() => copiar('4152 3144 7451 1436', 'tarjeta')}>{copiado === 'tarjeta' ? 'Copiado' : 'Copiar'}</button></div>
    </div>
   </section>

   <!-- 2. Registrar pago -->
   <section class="card">
    <h2>Registrar un pago</h2>
    <form class="comp-form" onsubmit={(e) => { e.preventDefault(); enviarComprobante(); }}>
     <div class="frow">
      <label>Adulto mayor *
       <select bind:value={compForm.paciente_id} required>
        <option value="">Selecciona…</option>
        {#each grupos as g (g.paciente.id)}<option value={g.paciente.id}>{g.paciente.nombre} {g.paciente.apellido}{g.paquete?.nombre ? ' · ' + g.paquete.nombre : ''}</option>{/each}
       </select>
      </label>
      <label>Cantidad depositada *<input type="number" step="0.01" min="0.01" bind:value={compForm.monto} required placeholder="0.00" /></label>
      <label>Fecha del depósito<input type="date" bind:value={compForm.fecha_deposito} required /></label>
     </div>
     <div class="frow">
      <label>Método de pago *
       <select bind:value={compForm.metodo} required><option value="transferencia">Transferencia</option><option value="deposito">Depósito bancario</option></select>
      </label>
      <label class="grow">Número de referencia o folio *<input bind:value={compForm.referencia} required maxlength="100" placeholder="Folio de la operación" /></label>
      <label>Comprobante (JPG, PNG o PDF)
       <input type="file" accept="image/*,application/pdf" onchange={onCompArchivo} />
       {#if compArchivo}<span class="ok small">Archivo adjunto ✓</span>{/if}
      </label>
     </div>
     {#if compErr}<p class="err small">{compErr}</p>{/if}
     {#if compMsg}<p class="ok-msg small">{compMsg}</p>{/if}
     <button class="btn-main" disabled={compEnviando}>{compEnviando ? 'Enviando…' : 'Enviar comprobante de pago'}</button>
    </form>
   </section>

   <!-- 3. Estado de cuenta -->
   <section class="card">
    <h2>Estado de cuenta</h2>
    {#if !cuentasPago.length}
     <p class="muted">No tienes pagos registrados por ahora.</p>
    {:else}
     {#each cuentasPago as c (c.paciente.id)}
      <div class="pago-cuenta">
       <div class="pago-head">
        <div><strong>{c.paciente.nombre}</strong> {#if c.paquete}<span class="muted small">· {c.paquete} (${Number(c.precio_mensual).toFixed(2)}/mes)</span>{/if}</div>
        <span class="estado" class:pend={c.adeudo > 0}>{c.adeudo > 0 ? 'Saldo $' + Number(c.adeudo).toFixed(2) : 'Al corriente'}</span>
       </div>
       {#if c.proximo_vencimiento}<p class="muted small">Próximo vencimiento: {fmtFecha(c.proximo_vencimiento)}{#if c.ultimo_pago} · Último pago: {fmtFecha(c.ultimo_pago)}{/if}</p>{/if}
      </div>
     {/each}
    {/if}
   </section>

   <!-- 4. Historial de comprobantes -->
   {#if comprobantes.length}
    <section class="card">
     <h2>Historial de comprobantes enviados</h2>
     <div class="tabla-wrap">
      <table class="tabla">
       <thead><tr><th>Enviado</th><th>Paciente</th><th>Monto</th><th>Método</th><th>Referencia</th><th>Estado</th><th></th></tr></thead>
       <tbody>
        {#each comprobantes as c (c.id)}
         <tr>
          <td>{new Date(c.created_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
          <td>{c.pacientes?.nombre} {c.pacientes?.apellido}</td>
          <td>${Number(c.monto).toFixed(2)}</td>
          <td>{c.metodo === 'deposito' ? 'Depósito' : 'Transferencia'}</td>
          <td class="muted small">{c.referencia || '—'}</td>
          <td><span class="estado" class:ok={c.estado === 'aprobado'} class:pend={c.estado === 'pendiente'} class:rech={c.estado === 'rechazado'}>{estadoComp(c.estado)}</span>
           {#if c.motivo_rechazo}<br /><span class="muted small">Motivo: {c.motivo_rechazo}</span>{/if}
           {#if c.revisado_at}<br /><span class="muted small">{fmtFecha(c.revisado_at)}</span>{/if}
          </td>
          <td>{#if c.comprobante_path}<button class="mini ghost" onclick={() => verComp(c)}>Ver</button>{/if}</td>
         </tr>
        {/each}
       </tbody>
      </table>
     </div>
    </section>
   {/if}

   <!-- Historial de pagos aprobados -->
   {#if cuentasPago.some((c) => c.pagos?.length)}
    <section class="card">
     <h2>Historial de pagos</h2>
     {#each cuentasPago as c (c.paciente.id)}
      {#if c.pagos?.length}
       <h3 class="sub-h">{c.paciente.nombre}</h3>
       <div class="tabla-wrap">
        <table class="tabla">
         <thead><tr><th>Fecha</th><th>Periodo</th><th>Monto</th><th>Método</th><th>Referencia</th><th>Estado</th><th>Folio</th><th></th></tr></thead>
         <tbody>
          {#each c.pagos as p (p.id)}
           <tr>
            <td>{fmtFecha(p.fecha)}</td><td>{p.periodo || '—'}</td><td>${Number(p.monto).toFixed(2)}</td>
            <td>{p.metodo || '—'}</td><td class="muted small">{p.comprobante_ref || p.notas || '—'}</td>
            <td><span class="estado" class:ok={p.estado === 'pagado'} class:pend={p.estado === 'pendiente'}>{p.estado === 'pagado' ? 'Aprobado' : 'Pendiente'}</span></td>
            <td class="muted small">{p.recibo_folio || '—'}</td>
            <td>{#if p.estado === 'pagado'}<button class="mini ghost" onclick={() => imprimirRecibo(c, p)}>Recibo</button>{/if}</td>
           </tr>
          {/each}
         </tbody>
        </table>
       </div>
      {/if}
     {/each}
    </section>
   {/if}
  {/if}
 {/if}
</div>
{/if}

<style>
 .wrap { max-width: 960px; margin: 0 auto; padding: 26px 24px 60px; }
 .center { text-align: center; padding: 60px 20px; color: #4a5a68; }
 .dir-head { margin-bottom: 18px; }
 .dir-head h1 { margin: 0; font-size: 24px; color: #0d3a5c; }
 .sub { margin: 4px 0 0; color: #7a8694; font-size: 13px; }
 .err { background: #fdecea; color: #c0392b; padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 14px; }
 .err.small, .ok-msg.small, .ok.small { font-size: .78rem; }
 .ok-msg { color: #14663f; }
 .card { background: #fff; border: 1px solid #e9e4d8; border-radius: 16px; padding: 20px; box-shadow: 0 2px 10px rgba(13,58,92,.05); margin-bottom: 18px; }
 .card h2 { margin: 0 0 14px; font-size: 16px; color: #0d3a5c; }
 .sub-h { font-size: .85rem; font-weight: 700; color: #234; margin: .9rem 0 .4rem; }
 .muted { color: #7a8694; font-size: .82rem; }
 .bank-card { border: 1.5px solid #b9cdea; background: linear-gradient(135deg, #f4f8fd, #eef3fa); }
 .bank-head { display: flex; gap: .8rem; align-items: center; margin-bottom: .6rem; }
 .bank-logo { background: #0b3d91; color: #fff; font-weight: 800; font-size: .8rem; letter-spacing: .05em; padding: .45rem .7rem; border-radius: 8px; }
 .bank-datos { display: flex; flex-direction: column; gap: .35rem; }
 .bank-row { display: flex; align-items: center; gap: .6rem; font-size: .85rem; flex-wrap: wrap; }
 .bank-row span { color: #555; min-width: 150px; }
 .bank-row b.tarjeta { font-size: 1.05rem; letter-spacing: .06em; color: #0d3a5c; }
 .comp-form { display: flex; flex-direction: column; gap: .6rem; }
 .frow { display: flex; gap: .6rem; flex-wrap: wrap; }
 .frow label { display: flex; flex-direction: column; gap: .2rem; font-size: .72rem; font-weight: 700; color: #444; text-transform: uppercase; letter-spacing: .03em; }
 .frow label.grow { flex: 1; min-width: 200px; }
 .frow input, .frow select { padding: .5rem .6rem; border: 1px solid #ddd6c4; border-radius: 8px; font-size: .85rem; min-width: 140px; }
 .btn-main { align-self: flex-start; padding: 10px 18px; border: none; border-radius: 10px; background: #0d3a5c; color: #fff; font-size: .85rem; font-weight: 700; cursor: pointer; }
 .btn-main:disabled { opacity: .6; }
 .pago-cuenta { border: 1px solid #eee8d8; border-radius: 10px; padding: .6rem .8rem; margin: .5rem 0; }
 .pago-head { display: flex; justify-content: space-between; align-items: center; gap: .6rem; }
 .estado { align-self: flex-start; font-size: .7rem; padding: .1rem .5rem; border-radius: 999px; background: #e5f5ec; color: #14663f; white-space: nowrap; }
 .estado.pend { background: #fff3cd; color: #664d03; }
 .estado.rech { background: #f8d7da; color: #842029; }
 .tabla-wrap { overflow-x: auto; }
 .tabla { width: 100%; border-collapse: collapse; font-size: 12.5px; }
 .tabla th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: #8a94a0; padding: 8px 10px; border-bottom: 2px solid #efe9da; }
 .tabla td { padding: 9px 10px; border-bottom: 1px solid #f3efe4; color: #33414d; vertical-align: top; }
 .mini { padding: 4px 9px; border: none; border-radius: 7px; font-size: 11px; font-weight: 700; cursor: pointer; background: #eef5fb; color: #0d5c8a; }
 .mini.ghost { background: #fff; border: 1px solid #ddd6c4; }
</style>
