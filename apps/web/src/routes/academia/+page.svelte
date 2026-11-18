<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';

  let perfil = $state(null);
  let loading = $state(true);
  let error = $state('');
  let tab = $state('mis');
  let subTab = $state('cursos');
  let catalogo = $state({ cursos: [], areas: [] });
  let mio = $state(null);
  let cursoDetalle = $state(null);
  let detalleLoading = $state(false);
  let unidadesHechas = $state(new Set());
  let evaluacion = $state(null);
  let respuestas = $state({});
  let resultado = $state(null);
  let enviando = $state(false);

  // Admin
  let adminCursos = $state([]);
  let adminStats = $state(null);
  let adminSeguimiento = $state([]);
  let adminEvaluaciones = $state([]);
  let adminEventos = $state(null);
  let formCurso = $state({ titulo: '', area: 'gerontologia', nivel: 'basico', horas: 1, descripcion: '', obligatorio: false, estado: 'publicado', video_url: '', material_url: '', instructor: '', max_intentos: 3, calificacion_minima: 70, modalidad: 'virtual', etiqueta: '', profesiones: '', justificacion: '', objetivos: '', temario: '', bibliografia: '', revisor: '', vigencia_anios: 2 });
  let editandoCurso = $state(null);
  let nuevaUnidad = $state({ titulo: '', contenido: '', orden: 1 });
  let nuevoProtocolo = $state({ nombre: '', version: '', descripcion: '', contenido_url: '', responsable: '' });
  let nuevoEvento = $state({ nombre: '', fecha: '', hora: '', duracion: '', instructor: '', modalidad: 'virtual', ubicacion: '', descripcion: '' });
  let asignando = $state({ curso_id: '', modo: 'todos', empleado_id: '', filtro: '' });
  let busqueda = $state('');
  let filtroNivel = $state('');
  let filtroModalidad = $state('');
  let filtroEstado = $state('');
  let filtroOblig = $state('');
  let areaSel = $state('');
  let msg = $state('');
  let comp = $state({ empleado_id: '', competencia: '', dimension: 'conocimientos', nivel: 3, notas: '' });

  const AREAS = {
    gerontologia: { nombre: 'Gerontología y envejecimiento', icono: '🌱', desc: 'Ciencia del envejecimiento, valoración integral y atención centrada en la persona' },
    cuidados: { nombre: 'Cuidados básicos e integrales', icono: '🤝', desc: 'Higiene, movilización, alimentación y cuidado de la vida diaria' },
    enfermedades: { nombre: 'Enfermedades y patologías geriátricas', icono: '🩺', desc: 'Manejo de condiciones crónicas y síndromes del adulto mayor' },
    fisioterapia: { nombre: 'Fisioterapia y rehabilitación', icono: '🏃', desc: 'Ejercicio terapéutico, marcha, equilibrio y funcionalidad' },
    salud_mental: { nombre: 'Salud mental y estimulación', icono: '🧠', desc: 'Bienestar emocional, cognición y acompañamiento' },
    nutricion: { nombre: 'Nutrición y alimentación geriátrica', icono: '🍎', desc: 'Requerimientos, evaluación y seguridad alimentaria' },
    enfermeria: { nombre: 'Enfermería y atención clínica', icono: '💉', desc: 'Valoración, vigilancia, medicamentos y cuidados clínicos' },
    emergencias: { nombre: 'Primeros auxilios y emergencias', icono: '🚨', desc: 'RCP, DEA, reconocimiento de urgencias y activación' },
    paliativos: { nombre: 'Cuidados paliativos', icono: '🕊️', desc: 'Confort, dignidad y acompañamiento al final de la vida' },
    etica: { nombre: 'Ética y trato humanizado', icono: '⚖️', desc: 'Derechos, confidencialidad y prevención del maltrato' },
    cuidador: { nombre: 'Desarrollo del cuidador', icono: '💪', desc: 'Perfil profesional, autocuidado y habilidades del cuidador' },
    administracion: { nombre: 'Administración y gestión', icono: '📋', desc: 'Gestión de servicios, calidad, riesgos y expedientes' },
    talleres: { nombre: 'Talleres prácticos', icono: '🛠️', desc: 'Simulación presencial: movilización, RCP, cognición y caídas' }
  };
  const NIVELES = { basico: 'Básico', intermedio: 'Intermedio', avanzado: 'Avanzado' };
  const ESTADOS = { asignado: 'Asignado', en_proceso: 'En proceso', aprobado: 'Aprobado', reprobado: 'Reprobado' };
  const ETIQUETAS = { formacion_basica: 'Formación básica', especializacion: 'Especialización', actualizacion: 'Actualización', obligatoria: 'Obligatoria', taller: 'Taller práctico' };

  const esAdmin = $derived(perfil?.rol === 'admin');
  const esStaff = $derived(['staff', 'cuidador', 'admin'].includes(perfil?.rol));

  async function cargar() {
    loading = true;
    try {
      const me = await api.raw('/api/me');
      perfil = me.user?.perfil || me.perfil;
      if (!esStaff) { loading = false; return; }
      const [cat, mi] = await Promise.all([api.raw('/api/academia/catalogo'), api.raw('/api/academia/mio')]);
      catalogo = cat;
      mio = mi;
      unidadesHechas = new Set();
      if (esAdmin) {
        const [ac, st, seg, ev, evts] = await Promise.all([
          api.raw('/api/academia/admin/cursos'), api.raw('/api/academia/admin/stats'),
          api.raw('/api/academia/admin/seguimiento'), api.raw('/api/academia/admin/evaluaciones'), api.raw('/api/academia/admin/eventos')
        ]);
        adminCursos = ac.cursos; adminStats = st; adminSeguimiento = seg.empleados;
        adminEvaluaciones = ev.evaluaciones; adminEventos = evts;
      }
    } catch (e) { error = e.message; }
    loading = false;
  }

  onMount(cargar);

  async function abrirCurso(curso) {
    detalleLoading = true; cursoDetalle = null; resultado = null; respuestas = {};
    const d = await api.raw('/api/academia/cursos/' + curso.id);
    cursoDetalle = d;
    unidadesHechas = new Set(d.inscripcion?.unidades_completadas || []);
    detalleLoading = false;
  }

  async function cerrarDetalle() { cursoDetalle = null; resultado = null; }

  async function inscribir(cursoId) {
    await api.raw('/api/academia/inscribir', { method: 'POST', body: JSON.stringify({ curso_id: cursoId }) });
    await cargar(); abrirCurso({ id: cursoId });
  }

  async function completarUnidad(unidadId) {
    await api.raw('/api/academia/progreso', { method: 'POST', body: JSON.stringify({ curso_id: cursoDetalle.curso.id, unidad_id: unidadId }) });
    unidadesHechas = new Set([...unidadesHechas, unidadId]);
    await cargar();
  }

  function iniciarEvaluacion() {
    evaluacion = cursoDetalle.preguntas;
    respuestas = {};
  }

  async function enviarEvaluacion() {
    enviando = true;
    try {
      const r = await api.raw('/api/academia/evaluar', { method: 'POST', body: JSON.stringify({ curso_id: cursoDetalle.curso.id, respuestas }) });
      resultado = r;
      evaluacion = null;
      await cargar();
    } catch (e) { alert(e.message); }
    enviando = false;
  }

  function areaNombre(a) { return AREAS[a]?.nombre || a; }
  function fmtFecha(f) { return f ? new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }

  // Admin acciones
  async function guardarCurso() {
    const payload = { ...formCurso, horas: Number(formCurso.horas) || 1 };
    if (editandoCurso) payload.id = editandoCurso.id;
    await api.raw('/api/academia/admin/curso', { method: 'POST', body: JSON.stringify(payload) });
    editandoCurso = null; formCurso = { titulo: '', area: 'gerontologia', nivel: 'basico', horas: 1, descripcion: '', obligatorio: false, estado: 'publicado', video_url: '', material_url: '', instructor: '', max_intentos: 3, calificacion_minima: 70, modalidad: 'virtual', etiqueta: '', profesiones: '', justificacion: '', objetivos: '', temario: '', bibliografia: '', revisor: '', vigencia_anios: 2 };
    await cargar(); msg = 'Curso guardado';
  }
  function editarCurso(c) { editandoCurso = c; formCurso = { ...c }; subTab = 'cursos'; }
  async function eliminarCurso(c) { if (confirm('¿Eliminar "' + c.titulo + '"?')) { await api.raw('/api/academia/admin/curso', { method: 'POST', body: JSON.stringify({ id: c.id, estado: 'archivado' }) }); await cargar(); } }
  async function agregarUnidad() {
    if (!nuevaUnidad.titulo || !cursoDetalle?.curso) return;
    await api.raw('/api/academia/admin/unidad', { method: 'POST', body: JSON.stringify({ ...nuevaUnidad, curso_id: cursoDetalle.curso.id }) });
    nuevaUnidad = { titulo: '', contenido: '', orden: 1 };
    await abrirCurso({ id: cursoDetalle.curso.id });
  }
  async function asignar() {
    await api.raw('/api/academia/admin/asignar', { method: 'POST', body: JSON.stringify(asignando) });
    msg = 'Asignación realizada'; asignando = { curso_id: '', modo: 'todos', empleado_id: '', filtro: '' };
    await cargar();
  }
  async function guardarProtocolo() { await api.raw('/api/academia/admin/protocolo', { method: 'POST', body: JSON.stringify(nuevoProtocolo) }); nuevoProtocolo = { nombre: '', version: '', descripcion: '', contenido_url: '', responsable: '' }; await cargar(); msg = 'Protocolo guardado'; }
  async function guardarEvento() { await api.raw('/api/academia/admin/evento', { method: 'POST', body: JSON.stringify(nuevoEvento) }); nuevoEvento = { nombre: '', fecha: '', hora: '', duracion: '', instructor: '', modalidad: 'virtual', ubicacion: '', descripcion: '' }; await cargar(); msg = 'Evento guardado'; }
  async function sembrar() { const r = await api.raw('/api/academia/admin/sembrar', { method: 'POST', body: JSON.stringify({}) }); msg = `Catálogo cargado: ${r.cursos_creados} cursos nuevos`; await cargar(); }
  async function marcarAsistencia(ev, empId, presente) {
    await api.raw('/api/academia/admin/asistencia', { method: 'POST', body: JSON.stringify({ evento_id: ev.id, asistencias: [{ empleado_id: empId, presente }] }) });
  }
  async function guardarComp() {
    await api.raw('/api/academia/admin/competencia', { method: 'POST', body: JSON.stringify(comp) });
    comp = { empleado_id: '', competencia: '', dimension: 'conocimientos', nivel: 3, notas: '' };
    msg = 'Competencia registrada';
  }
</script>

<svelte:head><title>Academia — AGI</title></svelte:head>

<div class="academia">
  {#if loading}
    <div class="center"><div class="spinner"></div><p>Cargando academia...</p></div>
  {:else if error}
    <div class="card error-box">{error}</div>
  {:else if !esStaff}
    <div class="card"><h2>Acceso restringido</h2><p>La academia es solo para el equipo de la agencia.</p></div>
  {:else}
    <div class="academia-header">
      <div class="logo-academia"><img src="/logo.png" alt="AGI" /><div><h1>Academia de Profesionales Gerontológicos</h1><p>Formación continua para la excelencia en el cuidado del adulto mayor</p></div></div>
      <div class="academia-nav">
        <button class:active={tab === 'mis'} onclick={() => tab = 'mis'}>Mi Formación</button>
        <button class:active={tab === 'catalogo'} onclick={() => tab = 'catalogo'}>Catálogo</button>
        {#if esAdmin}
          <button class:active={tab === 'admin'} onclick={() => tab = 'admin'}>Administración</button>
        {/if}
        <a href="/" class="btn-sec">← Volver</a>
      </div>
    </div>

    {#if msg}<div class="msg-ok">{msg}</div>{/if}

    <!-- ================= MI FORMACIÓN ================= -->
    {#if tab === 'mis'}
      {#if mio}
        <div class="resumen-grid">
          <div class="kpi"><span class="kpi-num">{mio.resumen.horas}h</span><span class="kpi-label">Horas de formación</span></div>
          <div class="kpi"><span class="kpi-num">{mio.resumen.aprobados}</span><span class="kpi-label">Cursos aprobados</span></div>
          <div class="kpi"><span class="kpi-num">{mio.resumen.pendientes}</span><span class="kpi-label">En proceso</span></div>
          <div class="kpi {mio.resumen.obligatorios_pendientes > 0 ? 'kpi-alert' : ''}"><span class="kpi-num">{mio.resumen.obligatorios_pendientes}</span><span class="kpi-label">Obligatorios pendientes</span></div>
          <div class="kpi"><span class="kpi-num">{mio.resumen.constancias}</span><span class="kpi-label">Constancias</span></div>
        </div>

        <div class="mis-tabs">
          <button class:active={subTab === 'cursos'} onclick={() => subTab = 'cursos'}>Mis cursos</button>
          <button class:active={subTab === 'constancias'} onclick={() => subTab = 'constancias'}>Constancias</button>
          <button class:active={subTab === 'protocolos'} onclick={() => subTab = 'protocolos'}>Protocolos ({mio.protocolos.filter(p => !p.leido).length} pendientes)</button>
          <button class:active={subTab === 'calendario'} onclick={() => subTab = 'calendario'}>Calendario</button>
          <button class:active={subTab === 'evaluaciones'} onclick={() => subTab = 'evaluaciones'}>Evaluaciones</button>
        </div>

        {#if subTab === 'cursos'}
          {#if (mio.inscripciones || []).length === 0}
            <div class="card vacio"><p>Aún no tienes cursos asignados. Explora el <b>Catálogo</b> para inscribirte.</p></div>
          {:else}
            <div class="cursos-grid">
              {#each mio.inscripciones as ins (ins.id)}
                <div class="curso-card {ins.estado}">
                  <div class="curso-top">
                    <span class="badge-area">{areaNombre(ins.academia_cursos?.area)}</span>
                    {#if ins.academia_cursos?.obligatorio}<span class="badge-obligatorio">OBLIGATORIO</span>{/if}
                  </div>
                  <h3>{ins.academia_cursos?.titulo || 'Curso'}</h3>
                  <p class="curso-meta">{ins.academia_cursos?.horas || 0}h · {NIVELES[ins.academia_cursos?.nivel] || ''} · {ins.academia_cursos?.instructor || ''}</p>
                  <div class="progreso-bar"><div class="progreso-fill" style="width:{ins.progreso || 0}%"></div></div>
                  <div class="curso-footer">
                    <span class="estado {ins.estado}">{ESTADOS[ins.estado]}</span>
                    <span class="pct">{ins.progreso || 0}%</span>
                    {#if ins.calificacion != null}<span class="calif">{ins.calificacion}%</span>{/if}
                  </div>
                  <button class="btn-mini" onclick={() => abrirCurso({ id: ins.curso_id })}>Abrir curso →</button>
                </div>
              {/each}
            </div>
          {/if}
        {/if}

        {#if subTab === 'constancias'}
          {#if (mio.constancias || []).length === 0}
            <div class="card vacio"><p>Aún no tienes constancias. Aprueba un curso para generar la tuya.</p></div>
          {:else}
            <div class="cursos-grid">
              {#each mio.constancias as c (c.id)}
                <div class="curso-card aprobado">
                  <span class="badge-area">🏆 Constancia</span>
                  <h3>{c.academia_cursos?.titulo || 'Curso'}</h3>
                  <p class="curso-meta">{c.horas || c.academia_cursos?.horas || 0}h · Calificación: {c.calificacion}%</p>
                  <p class="folio">Folio: {c.folio}</p>
                  <a class="btn-mini" href="/constancia?f={c.folio}" target="_blank">Ver constancia PDF →</a>
                </div>
              {/each}
            </div>
          {/if}
        {/if}

        {#if subTab === 'protocolos'}
          <div class="cursos-grid">
            {#each mio.protocolos as p (p.id)}
              <div class="curso-card {p.leido ? 'aprobado' : ''}">
                <span class="badge-area">{p.leido ? '✓ Leído' : 'Pendiente'}</span>
                <h3>{p.nombre}</h3>
                <p class="curso-meta">v{p.version || '1.0'} · {p.responsable || 'Academia AGI'} · Actualizado {fmtFecha((p.updated_at || '').slice(0, 10))}</p>
                {#if p.descripcion}<p class="desc">{p.descripcion}</p>{/if}
                <div class="btns">
                  {#if p.contenido_url}<a class="btn-mini" href={p.contenido_url} target="_blank">Ver documento</a>{/if}
                  {#if !p.leido}<button class="btn-mini btn-ok" onclick={async () => { await api.raw('/api/academia/lectura', { method: 'POST', body: JSON.stringify({ protocolo_id: p.id }) }); await cargar(); }}>Confirmar lectura</button>{/if}
                </div>
              </div>
            {/each}
            {#if !mio.protocolos?.length}<div class="card vacio"><p>No hay protocolos publicados aún.</p></div>{/if}
          </div>
        {/if}

        {#if subTab === 'calendario'}
          <div class="cursos-grid">
            {#each mio.eventos as ev (ev.id)}
              <div class="curso-card">
                <span class="badge-area">{ev.modalidad === 'presencial' ? 'Presencial' : 'Virtual'}</span>
                <h3>{ev.nombre}</h3>
                <p class="curso-meta">📅 {fmtFecha(ev.fecha)} {ev.hora ? '· ' + ev.hora : ''} {ev.duracion ? '· ' + ev.duracion : ''}</p>
                <p class="curso-meta">{ev.instructor ? 'Instructor: ' + ev.instructor : ''} {ev.ubicacion ? '· ' + ev.ubicacion : ''}</p>
                {#if ev.descripcion}<p class="desc">{ev.descripcion}</p>{/if}
              </div>
            {/each}
            {#if !mio.eventos?.length}<div class="card vacio"><p>No hay capacitaciones programadas.</p></div>{/if}
          </div>
        {/if}

        {#if subTab === 'evaluaciones'}
          <div class="tabla-wrap"><table>
            <thead><tr><th>Curso</th><th>Calificación</th><th>Intentos</th><th>Fecha</th><th>Estado</th></tr></thead>
            <tbody>
              {#each mio.evaluaciones as ev (ev.id)}
                <tr>
                  <td>{ev.academia_cursos?.titulo || '—'}</td>
                  <td><b>{ev.calificacion}%</b></td>
                  <td>{ev.intentos}</td>
                  <td>{new Date(ev.created_at).toLocaleDateString('es-MX')}</td>
                  <td>{ev.calificacion >= 70 ? '✓ Aprobado' : '✗ Reprobado'}</td>
                </tr>
              {/each}
              {#if !mio.evaluaciones?.length}<tr><td colspan="5" class="vacio">Sin evaluaciones registradas</td></tr>{/if}
            </tbody>
          </table></div>
        {/if}
      {:else}
        <div class="card vacio"><p>No se pudo cargar tu información académica.</p></div>
      {/if}
    {/if}

    <!-- ================= CATÁLOGO ================= -->
    {#if tab === 'catalogo'}
      {@const cursosFiltrados = catalogo.cursos.filter(c =>
        (!areaSel || c.area === areaSel) &&
        (!busqueda || (c.titulo||'').toLowerCase().includes(busqueda.toLowerCase()) || (c.descripcion||'').toLowerCase().includes(busqueda.toLowerCase())) &&
        (!filtroNivel || c.nivel === filtroNivel) &&
        (!filtroModalidad || c.modalidad === filtroModalidad) &&
        (!filtroOblig || (filtroOblig === 'oblig' ? c.obligatorio : !c.obligatorio)) &&
        (!filtroEstado || (filtroEstado === 'asignado' ? c.mi_estado : filtroEstado === 'disponible' ? !c.mi_estado || c.mi_estado === 'reprobado' : c.mi_estado === 'aprobado'))
      )}
      {@const recomendados = catalogo.cursos.filter(c =>
        !c.mi_estado && (c.profesiones || []).some(p => String(perfil?.profesion || perfil?.puesto || '').toLowerCase().includes(String(p).toLowerCase()))
      ).slice(0, 6)}

      {#if !areaSel}
        <div class="buscador-bar">
          <input class="buscador" placeholder="🔍 Buscar curso por nombre, tema o especialidad..." bind:value={busqueda} />
          <select bind:value={filtroNivel}><option value="">Todos los niveles</option><option value="basico">Básico</option><option value="intermedio">Intermedio</option><option value="avanzado">Avanzado</option></select>
          <select bind:value={filtroModalidad}><option value="">Toda modalidad</option><option value="virtual">Virtual</option><option value="presencial">Presencial</option><option value="hibrido">Híbrido</option></select>
          <select bind:value={filtroOblig}><option value="">Obligatorios y opcionales</option><option value="oblig">Solo obligatorios</option><option value="opcional">Solo opcionales</option></select>
          <select bind:value={filtroEstado}><option value="">Todos los estados</option><option value="disponible">Disponibles</option><option value="asignado">Asignados</option><option value="aprobado">Concluidos</option></select>
        </div>

        {#if recomendados.length && !busqueda}
          <div class="card recomendados">
            <h3>🎯 Recomendados para ti{perfil?.profesion ? ' — ' + perfil.profesion : ''}</h3>
            <div class="cursos-grid">
              {#each recomendados as c (c.id)}
                <div class="curso-card catalogo-card">
                  <div class="curso-top"><span class="badge-area">{areaNombre(c.area)}</span>{#if c.etiqueta}<span class="badge-etiq etiq-{c.etiqueta}">{ETIQUETAS[c.etiqueta] || c.etiqueta}</span>{/if}</div>
                  <h3>{c.titulo}</h3>
                  <p class="curso-meta">{c.horas}h · {c.modalidad === 'presencial' ? 'Presencial' : c.modalidad === 'hibrido' ? 'Híbrido' : 'Virtual'} · {NIVELES[c.nivel]}</p>
                  <button class="btn-mini" onclick={() => abrirCurso(c)}>Ver curso</button>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        {#if busqueda || filtroNivel || filtroModalidad || filtroOblig || filtroEstado}
          <h2 class="area-titulo">Resultados de búsqueda ({cursosFiltrados.length})</h2>
          <div class="cursos-grid">
            {#each cursosFiltrados.slice(0, 24) as c (c.id)}
              <div class="curso-card catalogo-card">
                <div class="curso-top"><span class="badge-area">{areaNombre(c.area)}</span>{#if c.obligatorio}<span class="badge-obligatorio">OBLIGATORIO</span>{/if}{#if c.mi_estado}<span class="estado {c.mi_estado}">{ESTADOS[c.mi_estado]}</span>{/if}</div>
                <h3>{c.titulo}</h3>
                <p class="curso-meta">{c.horas}h · {NIVELES[c.nivel]} · {c.modalidad === 'presencial' ? 'Presencial' : c.modalidad === 'hibrido' ? 'Híbrido' : 'Virtual'}</p>
                <div class="btns"><button class="btn-mini" onclick={() => abrirCurso(c)}>Ver curso</button>{#if !c.mi_estado || c.mi_estado === 'reprobado'}<button class="btn-mini btn-ok" onclick={() => inscribir(c.id)}>Inscribirme</button>{/if}</div>
              </div>
            {/each}
            {#if !cursosFiltrados.length}<div class="card vacio"><p>Sin resultados con esos filtros.</p></div>{/if}
          </div>
        {:else}
          <div class="categorias-grid">
            {#each catalogo.areas as area (area)}
              {@const cursosArea = catalogo.cursos.filter(c => c.area === area)}
              {@const info = AREAS[area] || { nombre: area, icono: '📚', desc: '' }}
              <button class="categoria-card" onclick={() => { areaSel = area; busqueda = ''; }}>
                <div class="cat-icono">{info.icono}</div>
                <h3>{info.nombre}</h3>
                <p>{info.desc}</p>
                <div class="cat-meta"><span class="cat-count">{cursosArea.length} cursos</span><span class="cat-link">Explorar →</span></div>
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <button class="btn-sec volver-cat" onclick={() => areaSel = ''}>← Todas las categorías</button>
        <h2 class="area-titulo">{AREAS[areaSel]?.icono} {areaNombre(areaSel)} — {catalogo.cursos.filter(c=>c.area===areaSel).length} cursos</h2>
        <div class="cursos-grid">
          {#each catalogo.cursos.filter(c=>c.area===areaSel) as curso (curso.id)}
            <div class="curso-card catalogo-card">
              <div class="curso-top">
                <span class="badge-nivel nivel-{curso.nivel}">{NIVELES[curso.nivel]}</span>
                {#if curso.etiqueta}<span class="badge-etiq etiq-{curso.etiqueta}">{ETIQUETAS[curso.etiqueta] || curso.etiqueta}</span>{/if}
                {#if curso.mi_estado}<span class="estado {curso.mi_estado}">{ESTADOS[curso.mi_estado]}</span>{/if}
              </div>
              <h3>{curso.titulo}</h3>
              <p class="curso-meta">{curso.horas}h · {curso.modalidad === 'presencial' ? '📍 Presencial' : curso.modalidad === 'hibrido' ? '🔀 Híbrido' : '💻 Virtual'} · {curso.instructor || 'Academia AGI'}</p>
              {#if curso.descripcion}<p class="desc">{curso.descripcion}</p>{/if}
              <div class="btns">
                <button class="btn-mini" onclick={() => abrirCurso(curso)}>Ver curso</button>
                {#if !curso.mi_estado || curso.mi_estado === 'reprobado'}<button class="btn-mini btn-ok" onclick={() => inscribir(curso.id)}>Inscribirme</button>{/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <!-- ================= ADMINISTRACIÓN ================= -->
    {#if tab === 'admin' && esAdmin}
      <div class="admin-tabs">
        <button class:active={subTab === 'cursos'} onclick={() => subTab = 'cursos'}>Cursos</button>
        <button class:active={subTab === 'asignar'} onclick={() => subTab = 'asignar'}>Asignar</button>
        <button class:active={subTab === 'seguimiento'} onclick={() => subTab = 'seguimiento'}>Seguimiento</button>
        <button class:active={subTab === 'evaluaciones'} onclick={() => subTab = 'evaluaciones'}>Evaluaciones</button>
        <button class:active={subTab === 'competencias'} onclick={() => subTab = 'competencias'}>Competencias</button>
        <button class:active={subTab === 'eventos'} onclick={() => subTab = 'eventos'}>Calendario</button>
        <button class:active={subTab === 'protocolos'} onclick={() => subTab = 'protocolos'}>Protocolos</button>
        <button class:active={subTab === 'stats'} onclick={() => subTab = 'stats'}>Estadísticas</button>
      </div>

      {#if subTab === 'cursos'}
        <div class="card">
          <h3>{editandoCurso ? 'Editar curso' : 'Nuevo curso'}</h3>
          <div class="form-grid">
            <input placeholder="Título del curso" bind:value={formCurso.titulo} />
            <select bind:value={formCurso.area}>{#each Object.entries(AREAS) as [k, v]}<option value={k}>{v.nombre}</option>{/each}</select>
            <select bind:value={formCurso.nivel}>{#each Object.entries(NIVELES) as [k, v]}<option value={k}>{v}</option>{/each}</select>
            <input type="number" placeholder="Horas" bind:value={formCurso.horas} />
            <input placeholder="Instructor" bind:value={formCurso.instructor} />
            <input type="number" placeholder="Calificación mínima (%)" bind:value={formCurso.calificacion_minima} />
            <input type="number" placeholder="Máx. intentos" bind:value={formCurso.max_intentos} />
            <select bind:value={formCurso.modalidad}><option value="virtual">Virtual</option><option value="presencial">Presencial</option><option value="hibrido">Híbrido</option></select>
            <select bind:value={formCurso.etiqueta}><option value="">Sin etiqueta</option><option value="formacion_basica">Formación básica</option><option value="especializacion">Especialización</option><option value="actualizacion">Actualización</option><option value="obligatoria">Obligatoria</option><option value="taller">Taller práctico</option></select>
            <input placeholder="Profesiones recomendadas (separadas por coma)" bind:value={formCurso.profesiones} />
            <input type="number" placeholder="Vigencia contenido (años)" bind:value={formCurso.vigencia_anios} />
            <select bind:value={formCurso.estado}><option value="borrador">Borrador</option><option value="publicado">Publicado</option><option value="archivado">Archivado</option></select>
            <input placeholder="URL video (YouTube, etc.)" bind:value={formCurso.video_url} />
            <input placeholder="Título del video" bind:value={formCurso.video_titulo} />
            <input placeholder="URL material PDF" bind:value={formCurso.material_url} />
            <input placeholder="Nombre del material" bind:value={formCurso.material_nombre} />
          </div>
          <textarea placeholder="Descripción del curso" bind:value={formCurso.descripcion} rows="2"></textarea>
          <div class="form-grid">
            <input placeholder="Justificación" bind:value={formCurso.justificacion} />
            <input placeholder="Objetivo general" bind:value={formCurso.objetivos} />
            <input placeholder="Temario" bind:value={formCurso.temario} />
            <input placeholder="Bibliografía / referencias" bind:value={formCurso.bibliografia} />
            <input placeholder="Revisor/aprobador del material" bind:value={formCurso.revisor} />
          </div>
          <label class="check"><input type="checkbox" bind:checked={formCurso.obligatorio} /> Curso obligatorio</label>
          <div class="btns"><button class="btn-ok" onclick={guardarCurso}>{editandoCurso ? 'Guardar cambios' : 'Crear curso'}</button>{#if editandoCurso}<button class="btn-sec" onclick={() => editandoCurso = null}>Cancelar</button>{/if}<button class="btn-sec" onclick={sembrar}>Cargar catálogo inicial</button></div>
        </div>
        <div class="tabla-wrap"><table>
          <thead><tr><th>Curso</th><th>Área</th><th>Hrs</th><th>Estado</th><th>Inscritos</th><th>Aprobados</th><th>Promedio</th><th></th></tr></thead>
          <tbody>
            {#each adminCursos as c (c.id)}
              <tr>
                <td><b>{c.titulo}</b>{#if c.obligatorio} <span class="badge-obligatorio">OBL.</span>{/if}</td>
                <td>{areaNombre(c.area)}</td><td>{c.horas}</td>
                <td>{c.estado}</td>
                <td>{c.stats.inscritos}</td><td>{c.stats.aprobados}</td>
                <td>{c.stats.califs.length ? Math.round(c.stats.califs.reduce((a,b)=>a+b,0)/c.stats.califs.length) : '—'}</td>
                <td class="acciones">
                  <button class="btn-mini" onclick={() => abrirCurso(c)}>Ver/Editar</button>
                  <button class="btn-mini" onclick={() => editarCurso(c)}>Editar</button>
                  <button class="btn-mini btn-danger" onclick={() => eliminarCurso(c)}>Archivar</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table></div>
      {/if}

      {#if subTab === 'asignar'}
        <div class="card">
          <h3>Asignar curso a empleados</h3>
          <div class="form-grid">
            <select bind:value={asignando.curso_id}><option value="">— Selecciona curso —</option>{#each adminCursos.filter(c=>c.estado==='publicado') as c}<option value={c.id}>{c.titulo}</option>{/each}</select>
            <select bind:value={asignando.modo}><option value="todos">Todos los empleados</option><option value="empleado">Empleado específico</option><option value="area">Por área/puesto (contiene)</option></select>
            {#if asignando.modo === 'empleado'}<select bind:value={asignando.empleado_id}><option value="">— Empleado —</option>{#each adminSeguimiento as e}<option value={e.id}>{e.nombre} ({e.profesion || e.rol})</option>{/each}</select>{/if}
            {#if asignando.modo === 'area'}<input placeholder="Ej: fisioterapeuta, cuidador..." bind:value={asignando.filtro} />{/if}
          </div>
          <button class="btn-ok" onclick={asignar} disabled={!asignando.curso_id}>Asignar</button>
        </div>
      {/if}

      {#if subTab === 'seguimiento'}
        <div class="tabla-wrap"><table>
          <thead><tr><th>Empleado</th><th>Puesto</th><th>Cursos</th><th>Aprobados</th><th>Pendientes</th><th>Horas</th><th>Promedio</th><th>Cumplimiento</th><th>Oblig. pend.</th></tr></thead>
          <tbody>
            {#each adminSeguimiento as e (e.id)}
              <tr>
                <td><b>{e.nombre}</b></td><td>{e.profesion || e.puesto || e.rol}</td>
                <td>{e.cursos_total}</td><td>{e.cursos_aprobados}</td><td>{e.cursos_pendientes}</td>
                <td>{e.horas}h</td><td>{e.promedio ?? '—'}</td>
                <td><div class="progreso-bar sm"><div class="progreso-fill" style="width:{e.pct}%"></div></div> {e.pct}%</td>
                <td>{#if e.obligatorios_pendientes > 0}<b class="alerta">{e.obligatorios_pendientes}</b>{:else}0{/if}</td>
              </tr>
            {/each}
            {#if !adminSeguimiento.length}<tr><td colspan="9" class="vacio">Sin empleados</td></tr>{/if}
          </tbody>
        </table></div>
      {/if}

      {#if subTab === 'evaluaciones'}
        <div class="card"><p>{adminEvaluaciones.filter(e => (e.pendientes_revision||[]).length).length} evaluaciones con preguntas abiertas pendientes de revisión.</p></div>
        <div class="tabla-wrap"><table>
          <thead><tr><th>Empleado</th><th>Curso</th><th>Calificación</th><th>Intentos</th><th>Fecha</th><th>Pendientes</th></tr></thead>
          <tbody>
            {#each adminEvaluaciones as ev (ev.id)}
              <tr>
                <td>{ev.perfiles?.nombre || '—'}</td><td>{ev.academia_cursos?.titulo || '—'}</td>
                <td><b>{ev.calificacion}%</b></td><td>{ev.intentos}</td>
                <td>{new Date(ev.created_at).toLocaleDateString('es-MX')}</td>
                <td>{#if (ev.pendientes_revision||[]).length}<span class="alerta">{ev.pendientes_revision.length} abiertas</span>{:else}—{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table></div>
      {/if}

      {#if subTab === 'competencias'}
        <div class="card">
          <h3>Matriz de competencias — registrar evaluación</h3>
          <p class="desc">Nivel: 1 Inicial · 2 En desarrollo · 3 Competente · 4 Competente avanzado</p>
          {@render CompetenciaForm({ empleados: adminSeguimiento })}
        </div>
        <div class="card">
          <h3>Ver competencias por empleado</h3>
          <select id="sel-emp-comp" onchange={(e) => { window._empComp = e.target.value; }}>
            <option value="">— Selecciona empleado —</option>
            {#each adminSeguimiento as e}<option value={e.id}>{e.nombre}</option>{/each}
          </select>
          <button class="btn-mini" onclick={async () => { const id = document.getElementById('sel-emp-comp').value; if (id) { const r = await api.raw('/api/academia/mio?empleado_id=' + id); alert(JSON.stringify(r.competencias || [], null, 2)); } }}>Ver competencias</button>
        </div>
      {/if}

      {#if subTab === 'eventos'}
        <div class="card">
          <h3>Programar capacitación</h3>
          <div class="form-grid">
            <input placeholder="Nombre" bind:value={nuevoEvento.nombre} />
            <input type="date" bind:value={nuevoEvento.fecha} />
            <input type="time" bind:value={nuevoEvento.hora} />
            <input placeholder="Duración (ej: 2h)" bind:value={nuevoEvento.duracion} />
            <input placeholder="Instructor" bind:value={nuevoEvento.instructor} />
            <select bind:value={nuevoEvento.modalidad}><option value="virtual">Virtual</option><option value="presencial">Presencial</option><option value="híbrido">Híbrido</option></select>
            <input placeholder="Ubicación/enlace" bind:value={nuevoEvento.ubicacion} />
          </div>
          <textarea placeholder="Descripción" bind:value={nuevoEvento.descripcion} rows="2"></textarea>
          <button class="btn-ok" onclick={guardarEvento}>Programar</button>
        </div>
        {#each adminEventos?.eventos || [] as ev (ev.id)}
          <div class="card evento-card">
            <h3>{ev.nombre}</h3>
            <p class="curso-meta">{fmtFecha(ev.fecha)} {ev.hora || ''} · {ev.modalidad} · {ev.instructor || ''} · {ev.ubicacion || ''}</p>
            <details><summary>Asistencia ({(adminEventos.asistencia || []).filter(a => a.evento_id === ev.id && a.presente).length} presentes)</summary>
              <div class="asistencia-list">
                {#each adminEventos.empleados as emp (emp.id)}
                  {@const asist = (adminEventos.asistencia || []).find(a => a.evento_id === ev.id && a.empleado_id === emp.id)}
                  <label class="check"><input type="checkbox" checked={asist?.presente || false} onchange={(e) => marcarAsistencia(ev, emp.id, e.target.checked)} /> {emp.nombre} ({emp.profesion || ''})</label>
                {/each}
              </div>
            </details>
          </div>
        {/each}
      {/if}

      {#if subTab === 'protocolos'}
        <div class="card">
          <h3>Nuevo/actualizar protocolo</h3>
          <div class="form-grid">
            <input placeholder="Nombre del protocolo" bind:value={nuevoProtocolo.nombre} />
            <input placeholder="Versión (ej: 2.0)" bind:value={nuevoProtocolo.version} />
            <input placeholder="Responsable" bind:value={nuevoProtocolo.responsable} />
            <input placeholder="URL del documento" bind:value={nuevoProtocolo.contenido_url} />
          </div>
          <textarea placeholder="Descripción" bind:value={nuevoProtocolo.descripcion} rows="2"></textarea>
          <button class="btn-ok" onclick={guardarProtocolo}>Publicar protocolo</button>
        </div>
        {#each mio?.protocolos || [] as p (p.id)}
          <div class="card"><h3>{p.nombre} <small>v{p.version || '1.0'}</small></h3><p class="desc">{p.descripcion || ''}</p></div>
        {/each}
      {/if}

      {#if subTab === 'stats'}
        {#if adminStats}
          <div class="resumen-grid">
            <div class="kpi"><span class="kpi-num">{adminStats.cursos_publicados}</span><span class="kpi-label">Cursos publicados</span></div>
            <div class="kpi"><span class="kpi-num">{adminStats.inscripciones}</span><span class="kpi-label">Inscripciones</span></div>
            <div class="kpi"><span class="kpi-num">{adminStats.aprobados}</span><span class="kpi-label">Aprobados</span></div>
            <div class="kpi"><span class="kpi-num">{adminStats.horas_totales}h</span><span class="kpi-label">Horas totales</span></div>
            <div class="kpi"><span class="kpi-num">{adminStats.promedio_general ?? '—'}</span><span class="kpi-label">Promedio general</span></div>
            <div class="kpi"><span class="kpi-num">{adminStats.constancias}</span><span class="kpi-label">Constancias</span></div>
          </div>
          <div class="card"><h3>Cursos por participación</h3>
            <div class="tabla-wrap"><table>
              <thead><tr><th>Curso</th><th>Inscritos</th><th>Aprobados</th><th>% Aprobación</th><th>Promedio</th></tr></thead>
              <tbody>{#each adminStats.por_curso as c}<tr><td>{c.titulo}</td><td>{c.inscritos}</td><td>{c.aprobados}</td><td>{c.inscritos ? Math.round(c.aprobados/c.inscritos*100) : 0}%</td><td>{c.promedio ?? '—'}</td></tr>{/each}</tbody>
            </table></div>
          </div>
        {/if}
      {/if}
    {/if}

    <!-- ======== DETALLE DE CURSO (modal) ======== -->
    {#if cursoDetalle}
      <div class="modal-back" onclick={(e) => { if (e.target === e.currentTarget) cerrarDetalle(); }}>
        <div class="modal">
          {#if detalleLoading}<div class="center"><div class="spinner"></div></div>
          {:else}
            <div class="modal-head">
              <h2>{cursoDetalle.curso.titulo}</h2>
              <button class="btn-sec" onclick={cerrarDetalle}>✕</button>
            </div>
            <p class="curso-meta">{areaNombre(cursoDetalle.curso.area)} · {NIVELES[cursoDetalle.curso.nivel]} · {cursoDetalle.curso.horas}h · {cursoDetalle.curso.obligatorio ? 'OBLIGATORIO' : 'Complementario'} · Instructor: {cursoDetalle.curso.instructor || 'Academia AGI'}</p>
            <p class="curso-meta">{cursoDetalle.curso.modalidad === 'presencial' ? '📍 Presencial' : cursoDetalle.curso.modalidad === 'hibrido' ? '🔀 Híbrido' : '💻 Virtual'} · {cursoDetalle.curso.etiqueta ? (ETIQUETAS[cursoDetalle.curso.etiqueta] || cursoDetalle.curso.etiqueta) : ''} · Vigencia del contenido: {cursoDetalle.curso.vigencia_anios || 2} años</p>
            {#if cursoDetalle.curso.descripcion}<p>{cursoDetalle.curso.descripcion}</p>{/if}
            {#if cursoDetalle.curso.justificacion}<div class="ficha-item"><b>Justificación:</b> {cursoDetalle.curso.justificacion}</div>{/if}
            {#if cursoDetalle.curso.objetivos}<div class="ficha-item"><b>Objetivos:</b> {cursoDetalle.curso.objetivos}</div>{/if}
            {#if cursoDetalle.curso.temario}<div class="ficha-item"><b>Temario:</b> {cursoDetalle.curso.temario}</div>{/if}
            {#if cursoDetalle.curso.bibliografia}<div class="ficha-item"><b>Bibliografía y referencias:</b> {cursoDetalle.curso.bibliografia}</div>{/if}
            {#if cursoDetalle.curso.revisor}<div class="ficha-item"><b>Revisado por:</b> {cursoDetalle.curso.revisor}</div>{/if}
            {#if cursoDetalle.curso.profesiones?.length}<div class="ficha-item"><b>Dirigido a:</b> {cursoDetalle.curso.profesiones.join(', ')}</div>{/if}

            {#if cursoDetalle.curso.video_url}
              <div class="card video-box">
                <h4>{cursoDetalle.curso.video_titulo || 'Video de capacitación'}</h4>
                {#if cursoDetalle.curso.video_url.includes('youtube') || cursoDetalle.curso.video_url.includes('youtu.be')}
                  {@const vid = cursoDetalle.curso.video_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)?.[1]}
                  {#if vid}<iframe src="https://www.youtube.com/embed/{vid}" allowfullscreen></iframe>{:else}<a href={cursoDetalle.curso.video_url} target="_blank" class="btn-mini">Ver video</a>{/if}
                {:else}
                  <a href={cursoDetalle.curso.video_url} target="_blank" class="btn-mini">▶ Ver video</a>
                {/if}
              </div>
            {/if}

            {#if cursoDetalle.curso.material_url}
              <a class="btn-mini" href={cursoDetalle.curso.material_url} target="_blank">📄 {cursoDetalle.curso.material_nombre || 'Material de estudio'}</a>
            {/if}

            {#if cursoDetalle.unidades?.length}
              <h4>Unidades del curso</h4>
              {#each cursoDetalle.unidades as u, i (u.id)}
                {@const hecha = unidadesHechas.has(u.id)}
                <div class="unidad {hecha ? 'hecha' : ''}">
                  <div class="unidad-head">
                    <span>Unidad {i + 1}: {u.titulo}</span>
                    {#if hecha}<span class="check-ok">✓ Completada</span>
                    {:else if cursoDetalle.inscripcion}<button class="btn-mini btn-ok" onclick={() => completarUnidad(u.id)}>Marcar completada</button>{/if}
                  </div>
                  {#if u.contenido}<p class="desc">{u.contenido}</p>{/if}
                </div>
              {/each}
            {/if}

            {#if cursoDetalle.preguntas?.length}
              <h4>Evaluación ({cursoDetalle.preguntas.length} preguntas · aprueba con {cursoDetalle.curso.calificacion_minima}%)</h4>
              {#if cursoDetalle.inscripcion}
                <p class="curso-meta">Intentos usados: {cursoDetalle.inscripcion.intentos || 0} / {cursoDetalle.curso.max_intentos} · Calificación: {cursoDetalle.inscripcion.calificacion ?? '—'}%</p>
              {/if}
              {#if !evaluacion && !resultado}
                {#if !cursoDetalle.inscripcion}
                  <button class="btn-ok" onclick={() => inscribir(cursoDetalle.curso.id)}>Inscribirme para evaluar</button>
                {:else if cursoDetalle.inscripcion.estado === 'aprobado'}
                  <div class="msg-ok">✓ Curso aprobado{cursoDetalle.inscripcion.calificacion ? ' con ' + cursoDetalle.inscripcion.calificacion + '%' : ''}</div>
                {:else if (cursoDetalle.inscripcion.intentos || 0) >= cursoDetalle.curso.max_intentos}
                  <div class="msg-error">Sin intentos restantes. Contacta al directivo.</div>
                {:else}
                  <button class="btn-ok" onclick={iniciarEvaluacion}>Iniciar evaluación</button>
                {/if}
              {/if}

              {#if resultado}
                <div class="resultado {resultado.aprobado ? 'ok' : 'fail'}">
                  <h3>{resultado.aprobado ? '✓ Aprobado' : '✗ No aprobado'}</h3>
                  <p>Calificación: <b>{resultado.calificacion}%</b> · Intentos: {resultado.intentos}/{resultado.max_intentos}</p>
                  {#if resultado.pendientes_revision}<p>{resultado.pendientes_revision} pregunta(s) abiertas pendientes de revisión por el directivo.</p>{/if}
                  <button class="btn-mini" onclick={cerrarDetalle}>Cerrar</button>
                </div>
              {/if}

              {#if evaluacion}
                <div class="evaluacion-form">
                  {#each evaluacion as p, i (p.id)}
                    <div class="pregunta">
                      <p><b>{i + 1}.</b> {p.pregunta}</p>
                      {#if p.tipo === 'abierta'}
                        <textarea placeholder="Tu respuesta..." bind:value={respuestas[p.id]} rows="2"></textarea>
                      {:else if p.tipo === 'verdadero_falso'}
                        <label class="radio"><input type="radio" name={p.id} value="Verdadero" bind:group={respuestas[p.id]} /> Verdadero</label>
                        <label class="radio"><input type="radio" name={p.id} value="Falso" bind:group={respuestas[p.id]} /> Falso</label>
                      {:else}
                        {#each p.opciones || [] as op}
                          <label class="radio"><input type="radio" name={p.id} value={op} bind:group={respuestas[p.id]} /> {op}</label>
                        {/each}
                      {/if}
                    </div>
                  {/each}
                  <div class="btns">
                    <button class="btn-ok" onclick={enviarEvaluacion} disabled={enviando}>{enviando ? 'Evaluando...' : 'Enviar evaluación'}</button>
                    <button class="btn-sec" onclick={() => evaluacion = null}>Cancelar</button>
                  </div>
                </div>
              {/if}
            {:else}
              <div class="msg-error">Este curso aún no tiene evaluación.</div>
            {/if}

            {#if esAdmin && cursoDetalle.curso}
              <details class="admin-curso-edit">
                <summary>✏️ Gestionar unidades y preguntas (admin)</summary>
                <h4>Nueva unidad</h4>
                <input placeholder="Título unidad" bind:value={nuevaUnidad.titulo} />
                <textarea placeholder="Contenido" bind:value={nuevaUnidad.contenido} rows="2"></textarea>
                <button class="btn-mini" onclick={agregarUnidad}>+ Agregar unidad</button>
                <p class="desc">Las preguntas se agregan editando el curso — contacta soporte para carga masiva.</p>
              </details>
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

{#snippet CompetenciaForm({ empleados })}
  <div class="form-grid">
    <select bind:value={comp.empleado_id}><option value="">— Empleado —</option>{#each empleados as e}<option value={e.id}>{e.nombre}</option>{/each}</select>
    <input placeholder="Competencia" bind:value={comp.competencia} />
    <select bind:value={comp.dimension}><option value="conocimientos">Conocimientos</option><option value="habilidades">Habilidades</option><option value="actitudes">Actitudes</option><option value="etica">Ética</option></select>
    <select bind:value={comp.nivel}><option value={1}>1 Inicial</option><option value={2}>2 En desarrollo</option><option value={3}>3 Competente</option><option value={4}>4 Avanzado</option></select>
    <input placeholder="Notas" bind:value={comp.notas} />
  </div>
  <button class="btn-ok" onclick={guardarComp}>Registrar competencia</button>
{/snippet}

<style>
  .academia { max-width: 1200px; margin: 0 auto; padding: 1rem; }
  .academia-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; }
  .logo-academia { display: flex; align-items: center; gap: 1rem; }
  .logo-academia img { width: 60px; height: 60px; border-radius: 12px; }
  .logo-academia h1 { font-size: 1.4rem; margin: 0; color: #1e3a5f; }
  .logo-academia p { margin: 0; color: #666; font-size: .9rem; }
  .academia-nav { display: flex; gap: .5rem; flex-wrap: wrap; }
  .academia-nav button, .academia-nav .btn-sec { padding: .5rem 1rem; border: none; border-radius: 8px; background: #e8eef5; color: #1e3a5f; cursor: pointer; font-weight: 600; }
  .academia-nav button.active { background: #1e3a5f; color: #fff; }
  .resumen-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .kpi { background: #fff; border-radius: 12px; padding: 1rem; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .kpi-num { display: block; font-size: 1.8rem; font-weight: 800; color: #1e3a5f; }
  .kpi-label { font-size: .8rem; color: #666; }
  .kpi-alert .kpi-num { color: #dc2626; }
  .mis-tabs, .admin-tabs { display: flex; gap: .5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .mis-tabs button, .admin-tabs button { padding: .5rem 1rem; border: none; border-radius: 8px; background: #e8eef5; color: #1e3a5f; cursor: pointer; font-weight: 600; }
  .mis-tabs button.active, .admin-tabs button.active { background: #1e3a5f; color: #fff; }
  .cursos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; }
  .curso-card { background: #fff; border-radius: 12px; padding: 1.2rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .curso-card.aprobado { border-left: 4px solid #16a34a; }
  .curso-card.reprobado { border-left: 4px solid #dc2626; }
  .curso-top { display: flex; gap: .4rem; flex-wrap: wrap; margin-bottom: .5rem; }
  .badge-area { background: #dbeafe; color: #1e40af; padding: .15rem .6rem; border-radius: 20px; font-size: .75rem; font-weight: 600; }
  .badge-obligatorio { background: #fee2e2; color: #dc2626; padding: .15rem .6rem; border-radius: 20px; font-size: .7rem; font-weight: 700; }
  .badge-nivel { padding: .15rem .6rem; border-radius: 20px; font-size: .75rem; font-weight: 600; background: #f3f4f6; }
  .nivel-basico { background: #dcfce7; color: #166534; }
  .nivel-intermedio { background: #fef9c3; color: #854d0e; }
  .nivel-avanzado { background: #fee2e2; color: #991b1b; }
  .curso-card h3 { margin: .3rem 0; font-size: 1.05rem; }
  .curso-meta { font-size: .8rem; color: #666; margin: .2rem 0; }
  .desc { font-size: .85rem; color: #555; }
  .folio { font-family: monospace; font-size: .8rem; color: #666; }
  .estado { font-size: .75rem; font-weight: 700; padding: .15rem .6rem; border-radius: 20px; }
  .estado.aprobado { background: #dcfce7; color: #166534; }
  .estado.reprobado { background: #fee2e2; color: #991b1b; }
  .estado.en_proceso { background: #dbeafe; color: #1e40af; }
  .estado.asignado { background: #f3f4f6; color: #4b5563; }
  .progreso-bar { height: 6px; background: #e5e7eb; border-radius: 3px; margin: .5rem 0; overflow: hidden; }
  .progreso-fill { height: 100%; background: #2563eb; border-radius: 3px; transition: width .3s; }
  .progreso-bar.sm { height: 5px; }
  .curso-footer { display: flex; gap: .8rem; align-items: center; font-size: .8rem; }
  .calif { color: #2563eb; font-weight: 700; }
  .pct { color: #666; margin-left: auto; }
  .btns { display: flex; gap: .5rem; margin-top: .6rem; flex-wrap: wrap; }
  .btn-mini { padding: .4rem .8rem; border: none; border-radius: 8px; background: #2563eb; color: #fff; cursor: pointer; font-size: .8rem; font-weight: 600; text-decoration: none; display: inline-block; }
  .btn-ok { background: #16a34a; }
  .btn-sec { background: #e5e7eb; color: #374151; }
  .btn-danger { background: #fee2e2; color: #dc2626; }
  .area-bloque { margin-bottom: 2rem; }
  .area-titulo { font-size: 1.2rem; color: #1e3a5f; margin-bottom: .8rem; }
  .card { background: #fff; border-radius: 12px; padding: 1.2rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 1rem; }
  .card h3 { margin-top: 0; }
  .vacio { text-align: center; color: #666; padding: 2rem; }
  .tabla-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th, td { padding: .6rem .5rem; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #f8fafc; font-weight: 700; color: #1e3a5f; }
  .acciones { display: flex; gap: .3rem; }
  .alerta { color: #dc2626; }
  .form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: .7rem; margin-bottom: .8rem; }
  .form-grid input, .form-grid select, textarea, input, select { padding: .55rem .7rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: .9rem; width: 100%; box-sizing: border-box; }
  .check { display: flex; align-items: center; gap: .5rem; margin: .5rem 0; }
  .check input { width: auto; }
  .msg-ok { background: #dcfce7; color: #166534; padding: .7rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-weight: 600; }
  .msg-error { background: #fee2e2; color: #991b1b; padding: .7rem 1rem; border-radius: 8px; margin-bottom: 1rem; }
  .error-box { background: #fee2e2; color: #991b1b; }
  .modal-back { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 1rem; }
  .modal { background: #fff; border-radius: 16px; max-width: 700px; width: 100%; max-height: 90vh; overflow-y: auto; padding: 1.5rem; }
  .modal-head { display: flex; justify-content: space-between; align-items: start; }
  .modal h2 { margin-top: 0; color: #1e3a5f; }
  .video-box iframe { width: 100%; aspect-ratio: 16/9; border: none; border-radius: 8px; margin-top: .5rem; }
  .unidad { border: 1px solid #eee; border-radius: 8px; padding: .7rem; margin-bottom: .6rem; }
  .unidad.hecha { background: #f0fdf4; }
  .unidad-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
  .check-ok { color: #16a34a; font-size: .8rem; }
  .pregunta { margin-bottom: 1rem; padding: .8rem; background: #f8fafc; border-radius: 8px; }
  .radio { display: flex; align-items: center; gap: .5rem; margin: .3rem 0; }
  .radio input { width: auto; }
  .evaluacion-form { margin-top: 1rem; }
  .resultado { padding: 1rem; border-radius: 10px; margin: 1rem 0; }
  .resultado.ok { background: #dcfce7; }
  .resultado.fail { background: #fee2e2; }
  .evento-card details { margin-top: .5rem; }
  .asistencia-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: .3rem; margin-top: .5rem; }
  .admin-curso-edit { margin-top: 1rem; border-top: 1px solid #eee; padding-top: .8rem; }
  .admin-curso-edit summary { cursor: pointer; font-weight: 600; color: #1e3a5f; }
  .center { text-align: center; padding: 3rem; }
  .spinner { width: 40px; height: 40px; border: 4px solid #e5e7eb; border-top-color: #2563eb; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .categorias-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
  .categoria-card { background: #fff; border-radius: 14px; padding: 1.4rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); border: none; cursor: pointer; text-align: left; transition: transform .15s, box-shadow .15s; }
  .categoria-card:hover { transform: translateY(-3px); box-shadow: 0 6px 20px rgba(30,58,95,.15); }
  .cat-icono { font-size: 2rem; margin-bottom: .5rem; }
  .categoria-card h3 { margin: .3rem 0; color: #1e3a5f; font-size: 1.05rem; }
  .categoria-card p { font-size: .82rem; color: #666; margin: .3rem 0 .8rem; min-height: 2.4em; }
  .cat-meta { display: flex; justify-content: space-between; align-items: center; }
  .cat-count { background: #e8eef5; color: #1e3a5f; padding: .2rem .7rem; border-radius: 20px; font-size: .75rem; font-weight: 700; }
  .cat-link { color: #2563eb; font-size: .8rem; font-weight: 600; }
  .buscador-bar { display: flex; gap: .6rem; flex-wrap: wrap; margin-bottom: 1.2rem; }
  .buscador { flex: 1; min-width: 220px; }
  .buscador-bar select { width: auto; min-width: 140px; }
  .badge-etiq { padding: .15rem .6rem; border-radius: 20px; font-size: .7rem; font-weight: 700; }
  .etiq-formacion_basica { background: #dbeafe; color: #1e40af; }
  .etiq-especializacion { background: #ede9fe; color: #5b21b6; }
  .etiq-actualizacion { background: #fef9c3; color: #854d0e; }
  .etiq-obligatoria { background: #fee2e2; color: #dc2626; }
  .etiq-taller { background: #fce7f3; color: #9d174d; }
  .volver-cat { margin-bottom: 1rem; }
  .recomendados { border-left: 4px solid #2563eb; }
  .ficha-item { font-size: .88rem; color: #444; margin: .5rem 0; padding: .5rem .7rem; background: #f8fafc; border-radius: 8px; }
  .ficha-item b { color: #1e3a5f; }
</style>
