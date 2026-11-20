<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { sesion } from '$lib/sesion.svelte.js';
  import Icon from '$lib/Icon.svelte';

  const esAdmin = $derived(sesion.user?.perfil?.rol === 'admin');
  let loading = $state(true);
  const d = $state({
    dash: null, pacientes: [], trabajadores: [], visitas: [], pagos: [], emergencias: [], notifs: []
  });

  onMount(async () => {
    const [dash, pacs, dir, vis, pags, ems, nots] = await Promise.all([
      api.dashboard().catch(() => null),
      api.pacientes().catch(() => ({ pacientes: [] })),
      api.directorio().catch(() => ({ trabajadores: [] })),
      api.visitas('?desde=' + new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10)).catch(() => ({ visitas: [] })),
      api.pagos().catch(() => ({ pagos: [] })),
      api.raw('/api/emergencias').catch(() => ({ emergencias: [] })),
      api.notificaciones().catch(() => ({ notificaciones: [] }))
    ]);
    d.dash = dash;
    d.pacientes = pacs.pacientes || [];
    d.trabajadores = dir.trabajadores || [];
    d.visitas = vis.visitas || [];
    d.pagos = pags.pagos || [];
    d.emergencias = ems.emergencias || [];
    d.notifs = nots.notificaciones || [];
    loading = false;
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const mesActual = hoy.slice(0, 7);

  const kpis = $derived.by(() => {
    const activos = d.pacientes.filter((p) => !['baja', 'cancelado', 'inactivo'].includes(p.estado)).length;
    const nuevosMes = d.pacientes.filter((p) => (p.created_at || '').startsWith(mesActual)).length;
    const empActivos = d.trabajadores.filter((t) => !['inactivo', 'suspendido'].includes(t.estado_laboral)).length;
    const vsHoy = d.visitas.filter((v) => v.fecha === hoy);
    const programadas = vsHoy.filter((v) => v.estado === 'programada').length;
    const enCurso = vsHoy.filter((v) => v.estado === 'en_curso').length;
    const finalizadasMes = d.visitas.filter((v) => (v.estado === 'finalizada' || v.estado === 'completada') && (v.fecha || '').startsWith(mesActual)).length;
    const pendientes = d.pacientes.filter((p) => p.estado === 'pendiente').length;
    const alertas = d.emergencias.filter((e) => ['activa', 'confirmada', 'en_gestion', 'atendida'].includes(e.estado)).length;
    return { activos, nuevosMes, empActivos, programadas, enCurso, finalizadasMes, pendientes, alertas };
  });

  // Visitas por día — últimos 14 días
  const porDia = $derived.by(() => {
    const dias = [];
    for (let i = 13; i >= 0; i--) {
      const f = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      dias.push({ f, n: d.visitas.filter((v) => v.fecha === f && v.estado !== 'cancelada').length });
    }
    return dias;
  });
  const maxDia = $derived(Math.max(1, ...porDia.map((x) => x.n)));

  // Finanzas del mes
  const finanzas = $derived.by(() => {
    const delMes = d.pagos.filter((p) => (p.fecha || '').startsWith(mesActual));
    const cobrados = delMes.filter((p) => p.estado !== 'pendiente').reduce((a, p) => a + Number(p.monto || 0), 0);
    const pendiente = delMes.filter((p) => p.estado === 'pendiente').reduce((a, p) => a + Number(p.monto || 0), 0);
    return { cobrados, pendiente, total: delMes.length };
  });

  const recientes = $derived(
    [...d.visitas]
      .filter((v) => v.estado === 'finalizada' || v.estado === 'completada')
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
      .slice(0, 6)
  );
  const alertas = $derived(
    d.emergencias
      .filter((e) => ['activa', 'confirmada', 'en_gestion', 'atendida'].includes(e.estado))
      .slice(0, 5)
  );

  const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
</script>

<svelte:head><title>Dashboard dirección — AGI</title></svelte:head>

<div class="wrap">
  <header class="dir-head">
    <div>
      <h1>Resumen ejecutivo</h1>
      <p class="sub">{new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · Vista de dirección</p>
    </div>
    <a class="btn-sec" href="/centro">Centro de inteligencia</a>
  </header>

  {#if loading}
    <div class="card center"><p>Cargando indicadores…</p></div>
  {:else if !esAdmin}
    <div class="card center"><h2>Acceso restringido</h2><p class="muted">Esta sección es exclusiva del directivo.</p><a class="btn-sec" href="/">Volver al inicio</a></div>
  {:else}
    <!-- KPIs -->
    <section class="kpis">
      <a class="kpi" href="/pacientes">
        <span class="kpi-ico azul"><Icon name="users" size={20} /></span>
        <div><b>{kpis.activos}</b><span>Pacientes activos</span><em>+{kpis.nuevosMes} este mes</em></div>
      </a>
      <a class="kpi" href="/personal">
        <span class="kpi-ico verde"><Icon name="idcard" size={20} /></span>
        <div><b>{kpis.empActivos}</b><span>Empleados activos</span><em>en nómina</em></div>
      </a>
      <a class="kpi" href="/agenda">
        <span class="kpi-ico dorado"><Icon name="calendar" size={20} /></span>
        <div><b>{kpis.programadas + kpis.enCurso}</b><span>Visitas hoy</span><em>{kpis.enCurso} en curso</em></div>
      </a>
      <a class="kpi" href="/visitas">
        <span class="kpi-ico azul"><Icon name="clipboard" size={20} /></span>
        <div><b>{kpis.finalizadasMes}</b><span>Servicios del mes</span><em>completados</em></div>
      </a>
      <a class="kpi" href="/pacientes">
        <span class="kpi-ico naranja"><Icon name="edit" size={20} /></span>
        <div><b>{kpis.pendientes}</b><span>Solicitudes pendientes</span><em>por procesar</em></div>
      </a>
      <a class="kpi {(kpis.alertas ? 'alerta' : '')}" href="/emergencias">
        <span class="kpi-ico rojo"><Icon name="siren" size={20} /></span>
        <div><b>{kpis.alertas}</b><span>Alertas de emergencia</span><em>{kpis.alertas ? 'requieren atención' : 'sin activas'}</em></div>
      </a>
    </section>

    <div class="grid2">
      <!-- Gráfica visitas -->
      <section class="card">
        <div class="card-head">
          <h2>Visitas · últimos 14 días</h2>
          <a href="/visitas" class="ver">Ver todas</a>
        </div>
        <div class="chart">
          {#each porDia as dia}
            <div class="col" title="{dia.f}: {dia.n} visitas">
              <div class="bar" style="height:{Math.max(4, (dia.n / maxDia) * 100)}%"></div>
              <span class="lbl">{new Date(dia.f + 'T12:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
            </div>
          {/each}
        </div>
        <p class="muted chart-sum">{porDia.reduce((a, x) => a + x.n, 0)} visitas registradas en el periodo · {d.dash?.tiempo_promedio_min ? `promedio ${d.dash.tiempo_promedio_min} min por visita hoy` : ''}</p>
      </section>

      <!-- Finanzas -->
      <section class="card">
        <div class="card-head">
          <h2>Resumen financiero · {new Date().toLocaleDateString('es-MX', { month: 'long' })}</h2>
          <a href="/paquetes" class="ver">Paquetes y cobros</a>
        </div>
        <div class="fin">
          <div class="fin-row"><span>Cobrado este mes</span><b class="ok">{fmt$(finanzas.cobrados)}</b></div>
          <div class="fin-row"><span>Pendiente por cobrar</span><b class="warn">{fmt$(finanzas.pendiente)}</b></div>
          <div class="fin-row total"><span>Total de pagos</span><b>{finanzas.total}</b></div>
        </div>
        <div class="fin-bar">
          <div class="fin-fill ok" style="width:{finanzas.total ? Math.round((finanzas.cobrados / Math.max(finanzas.cobrados + finanzas.pendiente, 1)) * 100) : 0}%"></div>
          <div class="fin-fill warn" style="width:{finanzas.total ? Math.round((finanzas.pendiente / Math.max(finanzas.cobrados + finanzas.pendiente, 1)) * 100) : 0}%"></div>
        </div>
        <p class="muted chart-sum">{finanzas.total ? `${Math.round((finanzas.cobrados / Math.max(finanzas.cobrados + finanzas.pendiente, 1)) * 100)}% cobrado` : 'Sin pagos registrados este mes'}</p>
      </section>
    </div>

    <div class="grid2">
      <!-- Actividad reciente -->
      <section class="card">
        <div class="card-head">
          <h2>Actividad reciente</h2>
          <a href="/visitas" class="ver">Historial</a>
        </div>
        <ul class="lista">
          {#each recientes as v}
            <li>
              <span class="dot ok"></span>
              <div class="li-main">
                <b>{v.pacientes?.nombre || ''} {v.pacientes?.apellido || ''}</b>
                <span>{v.perfiles?.nombre || 'Equipo'} · {v.fecha} {v.hora_programada || ''}</span>
              </div>
              <em>{v.estado}</em>
            </li>
          {:else}
            <li class="vacio">Sin visitas completadas recientes</li>
          {/each}
        </ul>
      </section>

      <!-- Alertas -->
      <section class="card">
        <div class="card-head">
          <h2>Alertas importantes</h2>
          <a href="/emergencias" class="ver">Centro de emergencias</a>
        </div>
        {#if alertas.length}
          <ul class="lista">
            {#each alertas as e}
              <li>
                <span class="dot rojo"></span>
                <div class="li-main">
                  <b>{e.perfiles?.nombre || 'Empleado'}</b>
                  <span>{e.estado} · {new Date(e.created_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <a class="mini danger" href="/emergencias">Ver</a>
              </li>
            {/each}
          </ul>
        {/if}
        <div class="sub-head">Notificaciones sin leer ({d.notifs.filter((n) => !n.leida).length})</div>
        <ul class="lista">
          {#each d.notifs.filter((n) => !n.leida).slice(0, 4) as n}
            <li>
              <span class="dot dorado"></span>
              <div class="li-main"><span>{n.mensaje}</span></div>
            </li>
          {:else}
            <li class="vacio">Sin notificaciones pendientes</li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
</div>

<style>
  .wrap { max-width: 1180px; margin: 0 auto; padding: 26px 24px 60px; }
  .dir-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 22px; }
  .dir-head h1 { margin: 0; font-size: 24px; color: #0d3a5c; }
  .sub { margin: 4px 0 0; color: #7a8694; font-size: 13px; }
  .btn-sec {
    padding: 9px 16px; border-radius: 10px; background: #0d3a5c; color: #fff;
    font-size: 13px; font-weight: 700; text-decoration: none;
  }
  .btn-sec:hover { background: #14507c; }

  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin-bottom: 18px; }
  .kpi {
    display: flex; align-items: center; gap: 13px; padding: 16px;
    background: #fff; border: 1px solid #e9e4d8; border-radius: 14px;
    text-decoration: none; transition: box-shadow .15s, transform .15s;
  }
  .kpi:hover { box-shadow: 0 8px 22px rgba(13, 58, 92, .12); transform: translateY(-1px); }
  .kpi.alerta { border-color: #e8b4b0; }
  .kpi-ico {
    width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; color: #fff;
  }
  .kpi-ico.azul { background: linear-gradient(135deg, #0d5c8a, #0d3a5c); }
  .kpi-ico.verde { background: linear-gradient(135deg, #1e8e5a, #14663f); }
  .kpi-ico.dorado { background: linear-gradient(135deg, #d4af37, #b8932f); }
  .kpi-ico.naranja { background: linear-gradient(135deg, #e08a3c, #c96a1e); }
  .kpi-ico.rojo { background: linear-gradient(135deg, #c0392b, #96281b); }
  .kpi b { display: block; font-size: 24px; color: #0d3a5c; line-height: 1.1; }
  .kpi span { font-size: 11.5px; font-weight: 700; color: #4a5a68; text-transform: uppercase; letter-spacing: .04em; }
  .kpi em { display: block; font-style: normal; font-size: 11px; color: #8a94a0; margin-top: 2px; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
  .card {
    background: #fff; border: 1px solid #e9e4d8; border-radius: 16px;
    padding: 20px; box-shadow: 0 2px 10px rgba(13, 58, 92, .05);
  }
  .center { text-align: center; padding: 60px 20px; color: #4a5a68; }
  .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .card-head h2 { margin: 0; font-size: 15px; color: #0d3a5c; }
  .ver { font-size: 12px; font-weight: 700; color: #0d5c8a; text-decoration: none; }
  .muted { font-size: 12px; color: #8a94a0; }

  .chart { display: flex; align-items: flex-end; gap: 6px; height: 150px; padding-top: 8px; }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 6px; }
  .bar { width: 100%; max-width: 26px; border-radius: 6px 6px 3px 3px; background: linear-gradient(180deg, #0d5c8a, #0d3a5c); transition: height .3s; }
  .col:nth-child(14) .bar, .col:nth-child(7n) .bar { background: linear-gradient(180deg, #d4af37, #b8932f); }
  .lbl { font-size: 9.5px; color: #9aa5b1; white-space: nowrap; }
  .chart-sum { margin: 12px 0 0; }

  .fin { display: flex; flex-direction: column; gap: 10px; }
  .fin-row { display: flex; justify-content: space-between; font-size: 13.5px; color: #4a5a68; }
  .fin-row b { color: #0d3a5c; }
  .fin-row b.ok { color: #1e8e5a; }
  .fin-row b.warn { color: #c96a1e; }
  .fin-row.total { border-top: 1px solid #eee8d8; padding-top: 10px; font-weight: 700; color: #0d3a5c; }
  .fin-bar { display: flex; height: 10px; border-radius: 6px; overflow: hidden; margin-top: 14px; background: #f0ece0; }
  .fin-fill.ok { background: #1e8e5a; }
  .fin-fill.warn { background: #e0a03c; }

  .sub-head { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: #8a7a4e; margin: 16px 0 8px; }
  .lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .lista li { display: flex; align-items: center; gap: 11px; padding: 10px 0; border-bottom: 1px solid #f3efe4; }
  .lista li:last-child { border-bottom: none; }
  .lista li.vacio { color: #9aa5b1; font-size: 13px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .dot.ok { background: #1e8e5a; }
  .dot.rojo { background: #c0392b; }
  .dot.dorado { background: #d4af37; }
  .li-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .li-main b { font-size: 13px; color: #0d3a5c; }
  .li-main span { font-size: 11.5px; color: #8a94a0; }
  .lista em { font-style: normal; font-size: 11px; color: #6b7a89; }
  .mini { padding: 5px 10px; border-radius: 8px; font-size: 11px; font-weight: 700; text-decoration: none; }
  .mini.danger { background: #fdecea; color: #c0392b; }

  @media (max-width: 900px) {
    .grid2 { grid-template-columns: 1fr; }
    .kpis { grid-template-columns: repeat(2, 1fr); }
  }
</style>
