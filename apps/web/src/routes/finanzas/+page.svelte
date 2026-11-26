<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { sesion } from '$lib/sesion.svelte.js';
  import Icon from '$lib/Icon.svelte';

  const esAdmin = $derived(sesion.user?.perfil?.rol === 'admin');
  let tab = $state('panel');
  let loading = $state(true);
  let error = $state('');
  const d = $state({ resumen: null, movs: [], categorias: null, cxc: null, presupuestos: [], ejecucion: [], rentabilidad: null, alertas: [], pacientes: [], comprobantes: [] });

  const hoy = new Date().toISOString().slice(0, 10);
  const mesIni = hoy.slice(0, 7) + '-01';
  let desde = $state(mesIni);
  let hasta = $state(hoy);

  async function cargar() {
    loading = true; error = '';
    try {
      const [res, movs, cxc, pres, ejec, rent, alerts, pacs, comps] = await Promise.all([
        api.finResumen(`?desde=${desde}&hasta=${hasta}`).catch(() => null),
        api.finMovimientos('?anulado=todos').catch(() => ({ movimientos: [] })),
        api.finCuentas().catch(() => null),
        api.finPresupuestos().catch(() => ({ presupuestos: [] })),
        api.finEjecucion().catch(() => ({ ejecucion: [] })),
        api.finRentabilidad().catch(() => null),
        api.finAlertas().catch(() => ({ alertas: [] })),
        api.pacientes().catch(() => ({ pacientes: [] })),
        api.comprobantes().catch(() => ({ comprobantes: [] }))
      ]);
      d.resumen = res; d.movs = movs.movimientos || []; d.categorias = movs.categorias || null;
      d.cxc = cxc; d.presupuestos = pres.presupuestos || []; d.ejecucion = ejec.ejecucion || [];
      d.rentabilidad = rent; d.alertas = alerts.alertas || []; d.pacientes = pacs.pacientes || [];
      d.comprobantes = comps.comprobantes || [];
    } catch (e) { error = e.message || 'Error al cargar'; }
    loading = false;
  }
  onMount(cargar);

  const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
  const num2 = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const tabs = [
    ['panel', 'Panel'], ['movimientos', 'Movimientos'], ['comprobantes', 'Comprobantes'], ['por-cobrar', 'Por cobrar'],
    ['presupuestos', 'Presupuestos'], ['rentabilidad', 'Rentabilidad'], ['reportes', 'Reportes']
  ];

  // ---- Formulario de movimiento ----
  let showForm = $state(false);
  const mov = $state({ tipo: 'egreso', categoria: 'nomina', concepto: '', descripcion: '', monto: '', cantidad: 1, metodo_pago: '', fecha: hoy, responsable: '', paciente_id: '', comprobante_ref: '' });
  let comprobante = $state(null); // dataURL
  let guardando = $state(false);
  async function guardarMovimiento() {
    if (!mov.concepto.trim() || !Number(mov.monto)) { error = 'Concepto y monto son obligatorios'; return; }
    guardando = true; error = '';
    try {
      await api.finCrearMovimiento({ ...mov, monto: Number(mov.monto), cantidad: Number(mov.cantidad) || 1, paciente_id: mov.paciente_id || null, comprobante });
      showForm = false; comprobante = null;
      Object.assign(mov, { concepto: '', descripcion: '', monto: '', responsable: '', paciente_id: '', comprobante_ref: '' });
      await cargar();
    } catch (e) { error = e.message || 'Error al guardar'; }
    guardando = false;
  }
  function onComprobante(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => (comprobante = rd.result);
    rd.readAsDataURL(f);
  }
  async function anularMovimiento(m) {
    const motivo = prompt(`Motivo de anulación de "${m.concepto}":`);
    if (!motivo) return;
    try { await api.finActualizarMovimiento(m.id, { anular: true, motivo }); await cargar(); }
    catch (e) { error = e.message; }
  }
  async function verComprobante(m) {
    try { const r = await api.finComprobante(m.id); window.open(r.url, '_blank'); }
    catch (e) { error = e.message; }
  }

  // ---- Presupuesto ----
  let showPres = $state(false);
  const pres = $state({ periodo: 'mensual', categoria: 'nomina', monto_limite: '', departamento: '', notas: '' });
  async function guardarPresupuesto() {
    if (!pres.categoria || pres.monto_limite === '') return;
    try {
      await api.finCrearPresupuesto({ ...pres, monto_limite: Number(pres.monto_limite) });
      showPres = false; await cargar();
    } catch (e) { error = e.message; }
  }
  async function eliminarPresupuesto(id) {
    if (!confirm('¿Eliminar este presupuesto?')) return;
    try { await api.finEliminarPresupuesto(id); await cargar(); } catch (e) { error = e.message; }
  }

  // ---- Reportes ----
  async function descargar(tipo) {
    try { await api.finReporte(`?tipo=${tipo}&desde=${desde}&hasta=${hasta}`); }
    catch (e) { error = e.message; }
  }

  // ---- Recordatorio de pago ----
  let recordando = $state('');
  async function recordarPago(pagoId) {
    recordando = pagoId;
    try { const r = await api.recordatorioPago(pagoId); alert(`Recordatorio enviado a ${r.notificados} familiar(es)${r.sms !== 'omitido' ? ` · SMS: ${r.sms}` : ''}`); }
    catch (e) { error = e.message; }
    recordando = '';
  }

  // ---- Comprobantes de pago del familiar ----
  async function verComprobanteComp(c) {
    try { const r = await api.comprobanteUrl(c.id); window.open(r.url, '_blank'); }
    catch (e) { error = e.message; }
  }
  async function aprobarComp(c) {
    if (!confirm(`¿Aprobar el pago de $${Number(c.monto).toLocaleString('es-MX')} reportado por ${c.perfiles?.nombre || 'el familiar'}?\n\nVerifica primero que el dinero sí aparezca en la cuenta BBVA.`)) return;
    try { await api.validarComprobante(c.id, { accion: 'aprobar' }); await cargar(); }
    catch (e) { error = e.message; }
  }
  async function rechazarComp(c) {
    const motivo = prompt('Motivo del rechazo (el familiar lo verá en su perfil):');
    if (!motivo) return;
    try { await api.validarComprobante(c.id, { accion: 'rechazar', motivo }); await cargar(); }
    catch (e) { error = e.message; }
  }

  const catLabel = (c) => d.categorias?.labels?.[c] || c || '—';
  const movsFiltrados = $derived(d.movs);
  const catOptions = $derived(mov.tipo === 'egreso' ? (d.categorias?.egreso || []) : (d.categorias?.ingreso || []));
</script>

<svelte:head><title>Control financiero — AGI</title></svelte:head>

<div class="wrap">
  <header class="dir-head">
    <div>
      <h1>Control financiero</h1>
      <p class="sub">Centro de inteligencia financiera · {new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}</p>
    </div>
    <div class="head-filtros">
      <label>Desde <input type="date" bind:value={desde} onchange={cargar} /></label>
      <label>Hasta <input type="date" bind:value={hasta} onchange={cargar} /></label>
    </div>
  </header>

  {#if error}<div class="err">{error}</div>{/if}

  {#if !loading && !esAdmin}
    <div class="card center"><h2>Acceso restringido</h2><p class="muted">El módulo financiero es exclusivo del directivo.</p><a class="btn-sec" href="/direccion">Volver</a></div>
  {:else}
    <nav class="tabs">
      {#each tabs as [k, label]}
        <button class="tab" class:on={tab === k} onclick={() => (tab = k)}>{label}</button>
      {/each}
    </nav>

    {#if loading}
      <div class="card center"><p>Cargando información financiera…</p></div>
    {:else if tab === 'panel'}
      <!-- ============ PANEL / DASHBOARD ============ -->
      {#if d.alertas.length}
        <section class="card alertas-card">
          <h2>Inteligencia financiera</h2>
          <ul class="alertas">
            {#each d.alertas as a}
              <li class={a.severidad}><span class="sev">{a.severidad === 'alta' ? '!' : a.severidad === 'media' ? '▲' : 'i'}</span>{a.mensaje}</li>
            {/each}
          </ul>
        </section>
      {/if}

      <section class="kpis">
        <div class="kpi"><span class="kpi-ico verde"><Icon name="check" size={20} /></span><div><b>{fmt$(d.resumen?.ingresos_total)}</b><span>Ingresos del periodo</span><em>familiar {fmt$(d.resumen?.ingresos_familiares)} + otros {fmt$(d.resumen?.otros_ingresos)}</em></div></div>
        <div class="kpi"><span class="kpi-ico rojo"><Icon name="dollar" size={20} /></span><div><b>{fmt$(d.resumen?.egresos)}</b><span>Egresos del periodo</span><em>{d.movs.filter((m) => m.tipo === 'egreso' && !m.anulado).length} movimientos</em></div></div>
        <div class="kpi"><span class="kpi-ico azul"><Icon name="chart" size={20} /></span><div><b class:neg={d.resumen?.utilidad < 0}>{fmt$(d.resumen?.utilidad)}</b><span>Utilidad neta</span><em>rentabilidad {d.resumen?.rentabilidad_pct ?? 0}%</em></div></div>
        <div class="kpi"><span class="kpi-ico dorado"><Icon name="clock" size={20} /></span><div><b>{fmt$(d.resumen?.por_cobrar)}</b><span>Por cobrar</span><em>{d.resumen?.pagos_pendientes ?? 0} pagos pendientes</em></div></div>
        <div class="kpi"><span class="kpi-ico rojo"><Icon name="alert" size={20} /></span><div><b>{d.resumen?.cuentas_vencidas ?? 0}</b><span>Cuentas vencidas</span><em>{fmt$(d.resumen?.monto_vencido)}</em></div></div>
        <div class="kpi"><span class="kpi-ico verde"><Icon name="check" size={20} /></span><div><b>{fmt$(d.resumen?.comparativo?.ingresos_ant ? d.resumen.comparativo.ingresos_ant : 0)}</b><span>Ingresos mes anterior</span><em>{d.resumen && d.resumen.comparativo.ingresos_var >= 0 ? '+' : ''}{fmt$(d.resumen?.comparativo?.ingresos_var)}</em></div></div>
      </section>

      <div class="grid2">
        <section class="card">
          <div class="card-head"><h2>Egresos por categoría</h2></div>
          {#each d.resumen?.egresos_por_categoria || [] as c}
            <div class="cat-row">
              <span>{c.etiqueta}</span>
              <div class="cat-bar"><div style="width:{Math.min(100, (c.monto / Math.max(d.resumen?.egresos || 1, 1)) * 100)}%"></div></div>
              <b>{fmt$(c.monto)}</b>
            </div>
          {:else}<p class="muted">Sin egresos en el periodo</p>{/each}
        </section>
        <section class="card">
          <div class="card-head"><h2>Ingresos vs egresos · 6 meses</h2></div>
          <div class="chart">
            {#each d.resumen?.mensual || [] as m}
              {@const max = Math.max(...(d.resumen?.mensual || []).map((x) => Math.max(x.ingresos, x.egresos)), 1)}
              <div class="col" title="{m.mes}: ing {fmt$(m.ingresos)} / egr {fmt$(m.egresos)}">
                <div class="bars">
                  <div class="bar ing" style="height:{(m.ingresos / max) * 100}%"></div>
                  <div class="bar egr" style="height:{(m.egresos / max) * 100}%"></div>
                </div>
                <span class="lbl">{m.mes.slice(5)}/{m.mes.slice(2, 4)}</span>
              </div>
            {/each}
          </div>
          <div class="leyenda"><span><i class="ing"></i>Ingresos</span><span><i class="egr"></i>Egresos</span></div>
        </section>
      </div>

      <div class="grid2">
        <section class="card">
          <div class="card-head"><h2>Estado anual</h2></div>
          <table class="tabla">
            <thead><tr><th>Mes</th><th>Ingresos</th><th>Egresos</th><th>Utilidad</th></tr></thead>
            <tbody>
              {#each d.resumen?.anual || [] as m}
                <tr><td>{m.mes}</td><td class="pos">{fmt$(m.ingresos)}</td><td class="neg">{fmt$(m.egresos)}</td><td class={m.ingresos - m.egresos >= 0 ? 'pos' : 'neg'}>{fmt$(m.ingresos - m.egresos)}</td></tr>
              {/each}
            </tbody>
          </table>
        </section>
        <section class="card">
          <div class="card-head"><h2>Comparativo vs mes anterior</h2></div>
          <div class="fin">
            <div class="fin-row"><span>Ingresos</span><b>{fmt$(d.resumen?.comparativo?.ingresos_ant)} → {fmt$(d.resumen?.ingresos_total)}</b></div>
            <div class="fin-row"><span>Egresos</span><b>{fmt$(d.resumen?.comparativo?.egresos_ant)} → {fmt$(d.resumen?.egresos)}</b></div>
            <div class="fin-row total"><span>Variación ingresos</span><b class={d.resumen?.comparativo?.ingresos_var >= 0 ? 'pos' : 'neg'}>{d.resumen && d.resumen.comparativo.ingresos_var >= 0 ? '+' : ''}{fmt$(d.resumen?.comparativo?.ingresos_var)}</b></div>
          </div>
        </section>
      </div>

    {:else if tab === 'movimientos'}
      <!-- ============ MOVIMIENTOS ============ -->
      <section class="card">
        <div class="card-head">
          <h2>Movimientos financieros</h2>
          <button class="btn-sec" onclick={() => (showForm = !showForm)}>{showForm ? 'Cancelar' : '+ Nuevo movimiento'}</button>
        </div>
        {#if showForm}
          <form class="form-mov" onsubmit={(e) => { e.preventDefault(); guardarMovimiento(); }}>
            <div class="frow">
              <label>Tipo
                <select bind:value={mov.tipo} onchange={() => { const cats = mov.tipo === 'egreso' ? d.categorias?.egreso : d.categorias?.ingreso; mov.categoria = cats?.[0] || ''; }}>
                  <option value="egreso">Egreso</option><option value="ingreso">Otro ingreso</option>
                </select>
              </label>
              <label>Categoría
                <select bind:value={mov.categoria}>{#each catOptions as c}<option value={c}>{catLabel(c)}</option>{/each}</select>
              </label>
              <label>Fecha <input type="date" bind:value={mov.fecha} required /></label>
            </div>
            <div class="frow">
              <label class="grow">Concepto *<input bind:value={mov.concepto} required maxlength="200" placeholder="Ej. Nómina quincena, compra de insumos…" /></label>
              <label>Monto *<input type="number" step="0.01" min="0.01" bind:value={mov.monto} required /></label>
              <label>Cantidad <input type="number" step="0.01" min="0" bind:value={mov.cantidad} /></label>
            </div>
            <div class="frow">
              <label>Método de pago
                <select bind:value={mov.metodo_pago}><option value="">—</option><option>Efectivo</option><option>Transferencia</option><option>Depósito</option><option>Tarjeta</option><option>Otro</option></select>
              </label>
              <label>Responsable <input bind:value={mov.responsable} maxlength="200" /></label>
              <label>Paciente (opcional)
                <select bind:value={mov.paciente_id}><option value="">— Ninguno —</option>{#each d.pacientes as p}<option value={p.id}>{p.nombre} {p.apellido}</option>{/each}</select>
              </label>
            </div>
            <div class="frow">
              <label class="grow">Descripción <input bind:value={mov.descripcion} maxlength="1000" /></label>
              <label>Ref. comprobante <input bind:value={mov.comprobante_ref} maxlength="200" placeholder="Folio/CLABE/referencia" /></label>
              <label>Comprobante <input type="file" accept="image/*,application/pdf" onchange={onComprobante} />{#if comprobante}<span class="ok-text">Adjunto ✓</span>{/if}</label>
            </div>
            <button class="btn-sec" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar movimiento'}</button>
          </form>
        {/if}
        <div class="tabla-wrap">
          <table class="tabla">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Concepto</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {#each movsFiltrados as m}
                <tr class:anulado={m.anulado}>
                  <td>{m.fecha}</td>
                  <td><span class="chip {m.tipo}">{m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</span></td>
                  <td>{catLabel(m.categoria)}</td>
                  <td>{m.concepto}{#if m.pacientes} <small>· {m.pacientes.nombre} {m.pacientes.apellido}</small>{/if}{#if m.anulado} <small class="neg">(anulado: {m.motivo_anulacion})</small>{/if}</td>
                  <td class={m.tipo === 'ingreso' ? 'pos' : 'neg'}>{fmt$(num2(m.monto) * num2(m.cantidad || 1))}</td>
                  <td>{m.anulado ? 'Anulado' : 'Vigente'}</td>
                  <td class="acc">
                    {#if m.comprobante_path}<button class="mini" onclick={() => verComprobante(m)}>Ver</button>{/if}
                    {#if !m.anulado}<button class="mini danger" onclick={() => anularMovimiento(m)}>Anular</button>{/if}
                  </td>
                </tr>
              {:else}<tr><td colspan="7" class="vacio">Sin movimientos. Los <b>pagos de familiares</b> se registran en Pacientes → expediente → Pagos; aquí van egresos y otros ingresos.</td></tr>{/each}
            </tbody>
          </table>
        </div>
      </section>

    {:else if tab === 'comprobantes'}
      <!-- ============ COMPROBANTES DE PAGO ============ -->
      <section class="card">
        <div class="card-head">
          <h2>Comprobantes de pago enviados por familiares</h2>
          <span class="muted">Verifica el depósito en BBVA antes de aprobar</span>
        </div>
        <div class="tabla-wrap">
          <table class="tabla">
            <thead><tr><th>Enviado</th><th>Familiar</th><th>Paciente</th><th>Paquete</th><th>Monto</th><th>Método</th><th>Referencia</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              {#each d.comprobantes as c}
                <tr>
                  <td>{new Date(c.created_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td><b>{c.perfiles?.nombre || '—'}</b></td>
                  <td>{c.pacientes?.nombre} {c.pacientes?.apellido}</td>
                  <td>{c.paquetes?.nombre || '—'}</td>
                  <td><b>{fmt$(c.monto)}</b></td>
                  <td>{c.metodo === 'deposito' ? 'Depósito' : 'Transferencia'}<br /><small>{c.fecha_deposito}</small></td>
                  <td>{c.referencia || '—'}</td>
                  <td>
                    <span class="chip {c.estado === 'aprobado' ? 'ok' : c.estado === 'rechazado' ? 'rojo' : 'amarillo'}">{c.estado === 'aprobado' ? 'Aprobado' : c.estado === 'rechazado' ? 'Rechazado' : 'Pendiente'}</span>
                    {#if c.motivo_rechazo}<br /><small class="neg">{c.motivo_rechazo}</small>{/if}
                    {#if c.revisado_at}<br /><small>por {c.revisado_por} · {new Date(c.revisado_at).toLocaleDateString('es-MX')}</small>{/if}
                  </td>
                  <td class="acc">
                    {#if c.comprobante_path}<button class="mini" onclick={() => verComprobanteComp(c)}>Ver comprobante</button>{/if}
                    {#if c.estado === 'pendiente'}
                      <button class="mini ok" onclick={() => aprobarComp(c)}>Aprobar</button>
                      <button class="mini danger" onclick={() => rechazarComp(c)}>Rechazar</button>
                    {/if}
                  </td>
                </tr>
              {:else}<tr><td colspan="9" class="vacio">Sin comprobantes enviados</td></tr>{/each}
            </tbody>
          </table>
        </div>
      </section>

    {:else if tab === 'por-cobrar'}
      <!-- ============ CUENTAS POR COBRAR ============ -->
      <section class="card">
        <div class="card-head"><h2>Cuentas por cobrar</h2><span class="muted">{d.cxc?.cuentas?.length ?? 0} cuentas</span></div>
        {#if d.cxc}
          <div class="kpis small">
            <div class="kpi sm"><div><b>{fmt$(d.cxc.totales.cartera)}</b><span>Cartera total</span></div></div>
            <div class="kpi sm"><div><b class="neg">{fmt$(d.cxc.totales.vencida)}</b><span>Vencida (rojo)</span></div></div>
            <div class="kpi sm"><div><b class="warn-t">{fmt$(d.cxc.totales.por_vencer)}</b><span>Por vencer (amarillo)</span></div></div>
            <div class="kpi sm"><div><b>{d.cxc.totales.al_corriente}</b><span>Al corriente (verde)</span></div></div>
          </div>
          <div class="tabla-wrap">
            <table class="tabla">
              <thead><tr><th>Paciente / familiar</th><th>Paquete</th><th>Precio</th><th>Pagado</th><th>Adeudo</th><th>Atraso</th><th>Semáforo</th><th></th></tr></thead>
              <tbody>
                {#each d.cxc.cuentas as c}
                  <tr>
                    <td><b>{c.nombre}</b><br /><small>{c.proximo_vencimiento ? 'Vence ' + c.proximo_vencimiento : ''}</small></td>
                    <td>{c.paquete || '—'}</td>
                    <td>{fmt$(c.precio_mensual)}</td>
                    <td class="pos">{fmt$(c.pagado_periodo)}</td>
                    <td class="neg">{fmt$(c.adeudo_total)}</td>
                    <td>{c.dias_atraso > 0 ? c.dias_atraso + ' días' : '—'}</td>
                    <td><span class="sem {c.semaforo}"></span> {c.semaforo === 'rojo' ? 'Vencido' : c.semaforo === 'amarillo' ? 'Por vencer' : 'Al corriente'}</td>
                    <td class="acc">
                      {#each c.historial.filter((h) => h.estado === 'pendiente').slice(0, 3) as h}
                        <button class="mini" disabled={recordando === h.id} onclick={() => recordarPago(h.id)}>{recordando === h.id ? '…' : 'Recordar'}</button>
                      {/each}
                    </td>
                  </tr>
                {:else}<tr><td colspan="8" class="vacio">Sin cuentas por cobrar</td></tr>{/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

    {:else if tab === 'presupuestos'}
      <!-- ============ PRESUPUESTOS ============ -->
      <section class="card">
        <div class="card-head">
          <h2>Presupuestos</h2>
          <button class="btn-sec" onclick={() => (showPres = !showPres)}>{showPres ? 'Cancelar' : '+ Nuevo presupuesto'}</button>
        </div>
        {#if showPres}
          <form class="form-mov" onsubmit={(e) => { e.preventDefault(); guardarPresupuesto(); }}>
            <div class="frow">
              <label>Periodo
                <select bind:value={pres.periodo}><option value="mensual">Mensual</option><option value="trimestral">Trimestral</option><option value="anual">Anual</option></select>
              </label>
              <label>Categoría de gasto
                <select bind:value={pres.categoria}>{#each d.categorias?.egreso || [] as c}<option value={c}>{catLabel(c)}</option>{/each}</select>
              </label>
              <label>Monto límite *<input type="number" step="0.01" min="0" bind:value={pres.monto_limite} required /></label>
            </div>
            <div class="frow">
              <label class="grow">Departamento <input bind:value={pres.departamento} maxlength="120" placeholder="Ej. Operaciones, Administración…" /></label>
              <label class="grow">Notas <input bind:value={pres.notas} maxlength="500" /></label>
            </div>
            <button class="btn-sec">Guardar presupuesto</button>
          </form>
        {/if}
        <h3 class="sub2">Ejecución del periodo en curso</h3>
        <div class="tabla-wrap">
          <table class="tabla">
            <thead><tr><th>Periodo</th><th>Categoría</th><th>Límite</th><th>Gastado</th><th>% usado</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {#each d.ejecucion as e}
                <tr>
                  <td>{e.periodo} · desde {e.fecha_inicio}</td>
                  <td>{catLabel(e.categoria)}</td>
                  <td>{fmt$(e.monto_limite)}</td>
                  <td>{fmt$(e.gasto_real)}</td>
                  <td><div class="mini-bar"><div class:e-excedido={e.estado === 'excedido'} class:e-alerta={e.estado === 'alerta'} style="width:{Math.min(100, e.porcentaje)}%"></div></div> {e.porcentaje}%</td>
                  <td><span class="chip {e.estado}">{e.estado === 'excedido' ? 'Excedido' : e.estado === 'alerta' ? 'Al límite' : 'OK'}</span></td>
                  <td><button class="mini danger" onclick={() => eliminarPresupuesto(e.id)}>Quitar</button></td>
                </tr>
              {:else}<tr><td colspan="7" class="vacio">Sin presupuestos. Crea el primero para controlar gastos por categoría.</td></tr>{/each}
            </tbody>
          </table>
        </div>
        {#if d.presupuestos.length}
          <h3 class="sub2">Historial de presupuestos</h3>
          <ul class="lista">
            {#each d.presupuestos.slice(0, 10) as p}
              <li><div class="li-main"><b>{catLabel(p.categoria)}</b><span>{p.periodo} · desde {p.fecha_inicio}{p.departamento ? ' · ' + p.departamento : ''}</span></div><em>{fmt$(p.monto_limite)}</em></li>
            {/each}
          </ul>
        {/if}
      </section>

    {:else if tab === 'rentabilidad'}
      <!-- ============ RENTABILIDAD POR PAQUETE ============ -->
      <section class="card">
        <div class="card-head"><h2>Rentabilidad por paquete</h2><span class="muted">costos operativos prorrateados por ingresos</span></div>
        <div class="tabla-wrap">
          <table class="tabla">
            <thead><tr><th>Paquete</th><th>Precio</th><th>Pacientes</th><th>Ingresos</th><th>Costos asignados</th><th>Utilidad bruta</th><th>Margen</th></tr></thead>
            <tbody>
              {#each d.rentabilidad?.paquetes || [] as p}
                <tr>
                  <td><b>{p.nombre}</b></td>
                  <td>{fmt$(p.precio)}</td>
                  <td>{p.pacientes}</td>
                  <td class="pos">{fmt$(p.ingresos)}</td>
                  <td class="neg">{fmt$(p.costos_asignados)}</td>
                  <td class={p.utilidad_bruta >= 0 ? 'pos' : 'neg'}>{fmt$(p.utilidad_bruta)}</td>
                  <td><span class="chip {p.evaluacion}">{p.margen_pct}% · {p.evaluacion === 'rentable' ? 'Rentable' : p.evaluacion === 'moderado' ? 'Moderado' : 'Baja'}</span></td>
                </tr>
              {:else}<tr><td colspan="7" class="vacio">Sin paquetes registrados</td></tr>{/each}
            </tbody>
          </table>
        </div>
      </section>

    {:else if tab === 'reportes'}
      <!-- ============ REPORTES ============ -->
      <section class="card">
        <div class="card-head"><h2>Reportes financieros</h2></div>
        <p class="muted">Los reportes se descargan en CSV (abre directo en Excel). Periodo: {desde} → {hasta}</p>
        <div class="reportes">
          <button class="btn-sec" onclick={() => descargar('movimientos')}>Movimientos (ingresos y egresos)</button>
          <button class="btn-sec" onclick={() => descargar('resumen')}>Estado de resultados</button>
          <button class="btn-sec" onclick={() => descargar('cuentas-por-cobrar')}>Cuentas por cobrar</button>
        </div>
        <p class="muted" style="margin-top:14px">Para PDF: abre el reporte en Excel → Archivo → Imprimir → "Guardar como PDF".</p>
      </section>
    {/if}
  {/if}
</div>

<style>
  .wrap { max-width: 1180px; margin: 0 auto; padding: 26px 24px 60px; }
  .dir-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; flex-wrap: wrap; gap: 12px; }
  .dir-head h1 { margin: 0; font-size: 24px; color: #0d3a5c; }
  .sub { margin: 4px 0 0; color: #7a8694; font-size: 13px; }
  .head-filtros { display: flex; gap: 10px; align-items: center; font-size: 12px; color: #4a5a68; }
  .head-filtros input { padding: 7px 10px; border: 1px solid #ddd6c4; border-radius: 8px; font-size: 12.5px; }
  .err { background: #fdecea; color: #c0392b; padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 14px; }
  .btn-sec { padding: 9px 16px; border: none; border-radius: 10px; background: #0d3a5c; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-block; }
  .btn-sec:hover { background: #14507c; }
  .btn-sec:disabled { opacity: .6; }
  .center { text-align: center; padding: 60px 20px; color: #4a5a68; }
  .muted { font-size: 12px; color: #8a94a0; }
  .ok-text { color: #1e8e5a; font-size: 12px; font-weight: 700; }

  .tabs { display: flex; gap: 6px; margin-bottom: 18px; flex-wrap: wrap; }
  .tab { padding: 9px 16px; border: 1px solid #e3ddcd; background: #fff; border-radius: 10px; font-size: 13px; font-weight: 700; color: #4a5a68; cursor: pointer; }
  .tab.on { background: #0d3a5c; color: #fff; border-color: #0d3a5c; }

  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin-bottom: 18px; }
  .kpi { display: flex; align-items: center; gap: 13px; padding: 16px; background: #fff; border: 1px solid #e9e4d8; border-radius: 14px; }
  .kpi.sm { padding: 12px 14px; }
  .kpis.small { margin-bottom: 14px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
  .kpi-ico { width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; }
  .kpi-ico.verde { background: linear-gradient(135deg, #1e8e5a, #14663f); }
  .kpi-ico.rojo { background: linear-gradient(135deg, #c0392b, #96281b); }
  .kpi-ico.azul { background: linear-gradient(135deg, #0d5c8a, #0d3a5c); }
  .kpi-ico.dorado { background: linear-gradient(135deg, #d4af37, #b8932f); }
  .kpi b { display: block; font-size: 22px; color: #0d3a5c; line-height: 1.1; }
  .kpi b.neg { color: #c0392b; }
  .kpi b.warn-t, .kpis .warn-t { color: #c96a1e; }
  .kpi span { font-size: 11px; font-weight: 700; color: #4a5a68; text-transform: uppercase; letter-spacing: .04em; }
  .kpi em { display: block; font-style: normal; font-size: 11px; color: #8a94a0; margin-top: 2px; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
  .card { background: #fff; border: 1px solid #e9e4d8; border-radius: 16px; padding: 20px; box-shadow: 0 2px 10px rgba(13,58,92,.05); margin-bottom: 18px; }
  .alertas-card { border-left: 4px solid #d4af37; }
  .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 10px; flex-wrap: wrap; }
  .card-head h2 { margin: 0; font-size: 15px; color: #0d3a5c; }
  .sub2 { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: #8a7a4e; margin: 18px 0 10px; }

  .alertas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .alertas li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; font-size: 13px; background: #f6f9fb; }
  .alertas li.alta { background: #fdecea; color: #96281b; }
  .alertas li.media { background: #fdf6e7; color: #8a5a10; }
  .alertas li.info { background: #eef5fb; color: #14507c; }
  .sev { font-weight: 800; }

  .cat-row { display: flex; align-items: center; gap: 12px; padding: 7px 0; font-size: 13px; }
  .cat-row span { width: 160px; flex-shrink: 0; color: #4a5a68; }
  .cat-row b { width: 90px; text-align: right; color: #0d3a5c; flex-shrink: 0; }
  .cat-bar { flex: 1; height: 8px; background: #f0ece0; border-radius: 5px; overflow: hidden; }
  .cat-bar div { height: 100%; background: linear-gradient(90deg, #0d5c8a, #d4af37); border-radius: 5px; }

  .chart { display: flex; align-items: flex-end; gap: 8px; height: 160px; padding-top: 8px; }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 6px; }
  .bars { display: flex; align-items: flex-end; gap: 3px; height: 120px; }
  .bar { width: 12px; border-radius: 4px 4px 2px 2px; min-height: 2px; }
  .bar.ing { background: linear-gradient(180deg, #1e8e5a, #14663f); }
  .bar.egr { background: linear-gradient(180deg, #c0392b, #96281b); }
  .lbl { font-size: 9.5px; color: #9aa5b1; white-space: nowrap; }
  .leyenda { display: flex; gap: 16px; font-size: 12px; color: #4a5a68; margin-top: 8px; }
  .leyenda i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; }
  .leyenda .ing { background: #1e8e5a; } .leyenda .egr { background: #c0392b; }

  .fin { display: flex; flex-direction: column; gap: 10px; }
  .fin-row { display: flex; justify-content: space-between; font-size: 13.5px; color: #4a5a68; }
  .fin-row b { color: #0d3a5c; }
  .fin-row b.pos, .pos { color: #1e8e5a; }
  .fin-row b.neg, .neg { color: #c0392b; }
  .fin-row.total { border-top: 1px solid #eee8d8; padding-top: 10px; font-weight: 700; color: #0d3a5c; }

  .tabla-wrap { overflow-x: auto; }
  .tabla { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .tabla th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: #8a94a0; padding: 8px 10px; border-bottom: 2px solid #efe9da; }
  .tabla td { padding: 9px 10px; border-bottom: 1px solid #f3efe4; color: #33414d; vertical-align: top; }
  .tabla tr.anulado td { opacity: .55; text-decoration: line-through; }
  .tabla td.vacio { text-align: center; color: #9aa5b1; padding: 24px; }
  .tabla td.acc { white-space: nowrap; }
  .tabla small { color: #8a94a0; }
  .mini { padding: 4px 9px; border: none; border-radius: 7px; font-size: 11px; font-weight: 700; cursor: pointer; background: #eef5fb; color: #0d5c8a; margin-right: 4px; }
  .mini.danger { background: #fdecea; color: #c0392b; }
  .mini.ok { background: #e5f5ec; color: #14663f; }
  .mini:disabled { opacity: .5; }

  .chip { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 800; text-transform: uppercase; }
  .chip.ingreso { background: #e5f5ec; color: #14663f; }
  .chip.egreso { background: #fdecea; color: #96281b; }
  .chip.rojo, .chip.excedido { background: #fdecea; color: #96281b; }
  .chip.amarillo, .chip.alerta { background: #fdf3e0; color: #8a5a10; }
  .chip.verde, .chip.ok, .chip.rentable { background: #e5f5ec; color: #14663f; }
  .chip.moderado { background: #fdf3e0; color: #8a5a10; }
  .chip.baja_rentabilidad { background: #fdecea; color: #96281b; }

  .sem { display: inline-block; width: 11px; height: 11px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
  .sem.verde { background: #1e8e5a; } .sem.amarillo { background: #e0a03c; } .sem.rojo { background: #c0392b; }

  .form-mov { background: #f8f6f0; border: 1px solid #e9e4d8; border-radius: 12px; padding: 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 12px; }
  .frow { display: flex; gap: 12px; flex-wrap: wrap; }
  .frow label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; font-weight: 700; color: #4a5a68; text-transform: uppercase; letter-spacing: .03em; }
  .frow label.grow { flex: 1; min-width: 200px; }
  .frow input, .frow select { padding: 8px 10px; border: 1px solid #ddd6c4; border-radius: 8px; font-size: 13px; font-weight: 500; color: #0d3a5c; background: #fff; min-width: 140px; }
  .frow input:focus, .frow select:focus { outline: 2px solid #0d5c8a55; border-color: #0d5c8a; }

  .lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .lista li { display: flex; align-items: center; gap: 11px; padding: 10px 0; border-bottom: 1px solid #f3efe4; }
  .lista li:last-child { border-bottom: none; }
  .li-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .li-main b { font-size: 13px; color: #0d3a5c; }
  .li-main span { font-size: 11.5px; color: #8a94a0; }
  .lista em { font-style: normal; font-size: 13px; font-weight: 800; color: #0d3a5c; }

  .mini-bar { width: 90px; height: 8px; background: #f0ece0; border-radius: 5px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 8px; }
  .mini-bar div { height: 100%; background: #1e8e5a; border-radius: 5px; }
  .mini-bar div.e-alerta { background: #e0a03c; }
  .mini-bar div.e-excedido { background: #c0392b; }

  .reportes { display: flex; flex-direction: column; gap: 10px; max-width: 420px; }
  .reportes .btn-sec { text-align: center; }

  @media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } .kpis { grid-template-columns: repeat(2, 1fr); } }
</style>
