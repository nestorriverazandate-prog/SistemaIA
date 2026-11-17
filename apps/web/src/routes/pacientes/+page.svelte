<script>
 import { onMount } from 'svelte';
 import { api, getToken, setToken } from '$lib/api';
 import QRCode from 'qrcode';
 import FotoCamara from '$lib/FotoCamara.svelte';

 let perfil = $state(null);
 let loading = $state(true);
 let pacientes = $state([]);
 let semaforos = $state({}); // paciente_id -> color
 let formError = $state('');
 let formOk = $state('');

 let qrModal = $state(null);
 let qrImg = $state('');
 let qrToken = $state('');
 let generandoQRs = $state(false);

 async function cargar() {
  const p = await api.pacientes();
  pacientes = p.pacientes;
  api.semaforo().then((r) => {
   const m = {};
   for (const i of r.items || []) m[i.paciente.id] = i.color;
   semaforos = m;
  }).catch(() => {});
 }

 async function abrirQR(p) {
  formError = ''; formOk = '';
  let token = p.qr_token;
  if (!token) {
   token = `AGI-${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
   try {
    const { paciente } = await api.actualizarPaciente(p.id, { qr_token: token });
    if (!paciente.qr_token) { formError = 'El QR no se pudo guardar: falta ejecutar supabase/TODO-EN-UNO.sql en Supabase'; return; }
    const idx = pacientes.findIndex((x) => x.id === p.id);
    if (idx >= 0) pacientes[idx] = paciente;
   } catch (e) { formError = e.message; return; }
  }
  qrToken = token;
  qrImg = await QRCode.toDataURL(`${window.location.origin}/registrar?t=${token}`, { width: 320, margin: 2 });
  qrModal = p;
 }
 async function imprimirTodosQR() {
  formError = ''; formOk = '';
  generandoQRs = true;
  try {
   let sinGuardar = 0;
   for (const p of pacientes) {
    if (!p.qr_token) {
     const token = `AGI-${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
     const { paciente } = await api.actualizarPaciente(p.id, { qr_token: token });
     if (!paciente.qr_token) { sinGuardar++; continue; }
     const idx = pacientes.findIndex((x) => x.id === p.id);
     if (idx >= 0) pacientes[idx] = paciente;
    }
   }
   if (sinGuardar) formError = `${sinGuardar} paciente(s) sin QR guardado: ejecuta supabase/TODO-EN-UNO.sql en Supabase`;
   const items = [];
   for (const p of pacientes) {
    if (!p.qr_token) continue;
    const img = await QRCode.toDataURL(`${window.location.origin}/registrar?t=${p.qr_token}`, { width: 200, margin: 1 });
    items.push({ img, nombre: `${p.nombre || ''} ${p.apellido || ''}`.trim(), token: p.qr_token });
   }
   if (!items.length) { formError = 'No hay pacientes para generar QR'; return; }
   const w = window.open('', '_blank', 'width=900,height=700');
   const tarjetas = items.map((it) => `
    <div class="card-qr">
    <img src="/logo.png" class="logo" alt="" />
    <img src="${it.img}" alt="QR" />
    <strong>${it.nombre}</strong>
    <span>ID: ${it.token}</span>
    <p>Código de identificación del domicilio.<br/>Exclusivo para el registro de visitas del personal autorizado.</p>
    </div>`).join('');
   w.document.write(`<html><head><title>QR domicilios</title><style>
    body{font-family:system-ui;margin:16px}h1{font-size:18px;color:#234;text-align:center}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
    .card-qr{border:1px solid #ccc;border-radius:10px;padding:10px;text-align:center;page-break-inside:avoid}
    .card-qr img.qr, .card-qr img[alt="QR"]{width:140px;height:140px;image-rendering:pixelated}
    .logo{height:36px}.card-qr strong{display:block;font-size:13px;margin-top:4px}
    .card-qr span{font-size:10px;color:#666}.card-qr p{font-size:9px;color:#777;margin-top:4px}
    @media print{body{margin:0}.grid{gap:10px}}
    </style></head><body>
    <h1>Agencia Gerontológica Integral — Códigos QR de domicilios</h1>
    <div class="grid">${tarjetas}</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script>
    </body></html>`);
   w.document.close();
   formOk = `${items.length} códigos QR listos para imprimir`;
  } catch (e) { formError = e.message; }
  finally { generandoQRs = false; }
 }
 function cerrarQR() { qrModal = null; qrImg = ''; qrToken = ''; }
 function descargarQR() {
  const a = document.createElement('a');
  a.href = qrImg; a.download = `qr-domicilio-${qrModal?.id || 'paciente'}.png`; a.click();
 }
 function imprimirQR() {
  const w = window.open('', '_blank', 'width=480,height=640');
  w.document.write(`<html><head><title>QR domicilio</title>
  <style>body{font-family:system-ui;text-align:center;padding:24px}img{width:280px}h2{color:#234}p{color:#567;font-size:13px}</style></head>
  <body><img src="/logo.png" style="height:64px" alt="Agencia Gerontológica Integral"/>
  <h2>Agencia Gerontológica Integral</h2>
  <img src="${qrImg}" alt="QR"/><p><strong>${qrModal?.nombre || ''} ${qrModal?.apellido || ''}</strong><br>ID: ${qrToken}</p>
  <p>Código de identificación del domicilio. Exclusivo para el registro de visitas del personal autorizado.</p>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
 }

 async function eliminar(p) {
  if (!confirm(`¿Eliminar a ${p.nombre} ${p.apellido}?`)) return;
  formError = ''; formOk = '';
  try { await api.eliminarPaciente(p.id); formOk = 'Paciente eliminado.'; await cargar(); }
  catch (e) { formError = e.message; }
 }
 async function cambiarEstado(id, estado) {
  try { await api.estadoPaciente(id, estado); await cargar(); }
  catch (e) { formError = e.message; }
 }

 // ---------- Expediente del paciente ----------
 let exp = $state(null);          // { paciente, visitas, notas, evidencias }
 let expLoading = $state(false);
 let expFoto = $state('');
 let paquetes = $state([]);
 let trabajadoresExp = $state([]);
 let expForm = $state({});
 let expMsg = $state('');
 let expErr = $state('');
 let fProf = $state('');
 let fDesde = $state('');
 let fHasta = $state('');
 // Filtros de la línea de tiempo "Evolución"
 let tDesde = $state('');
 let tHasta = $state('');
 let tProf = $state('');
 let tDisc = $state('');
 let evUrls = $state({});
 // Familiares vinculados al paciente (directivo)
 let vinculos = $state([]);
 let familiares = $state([]);
 let vincSel = $state('');
 let vincMsg = $state('');
 let camVisible = $state(false);

 async function abrirExpediente(p) {
  expErr = ''; expMsg = ''; expFoto = ''; fProf = ''; fDesde = ''; fHasta = '';
  expForm = {
   paquete_id: p.paquete_id || '',
   frecuencia_visitas: p.frecuencia_visitas || '',
   profesional_asignado: p.profesional_asignado || '',
   diagnostico: p.diagnostico || '',
   antecedentes: p.antecedentes || '',
   objetivos: p.objetivos || '',
   fecha_contratacion: p.fecha_contratacion || ''
  };
  exp = { paciente: p, visitas: [], notas: [], evidencias: [] };
  expLoading = true;
  try {
   if (!paquetes.length) paquetes = (await api.paquetes()).paquetes || [];
   if (!trabajadoresExp.length) trabajadoresExp = ((await api.trabajadores().catch(() => ({ trabajadores: [] }))).trabajadores || []).filter((t) => t.estado !== 'suspendido' && t.estado !== 'inactivo');
   const [exped, foto] = await Promise.all([
    api.expedientePaciente(p.id),
    api.fotoPaciente(p.id).then((r) => r.url).catch(() => '')
   ]);
   exp = exped;
   expFoto = foto || '';
   // URLs firmadas de evidencias para la línea de tiempo (máx. 60)
   evUrls = {};
   vincMsg = '';
   for (const e of (exped.evidencias || []).slice(0, 60)) {
    api.evidenciaUrl(e.id).then((r) => { evUrls = { ...evUrls, [e.id]: r.url }; }).catch(() => {});
   }
   // Familiares: lista de cuentas tipo familiar + vínculos del paciente
   try {
    const [vr, fr] = await Promise.all([api.vinculos(), api.perfiles().catch(() => ({ perfiles: [] }))]);
    vinculos = (vr.vinculos || []).filter((v) => v.paciente_id === p.id);
    familiares = (fr.perfiles || []).filter((u) => u.rol === 'familiar');
   } catch { vinculos = []; familiares = []; }
  } catch (e) { expErr = e.message; }
  finally { expLoading = false; }
 }
 function cerrarExpediente() { exp = null; expFoto = ''; vinculos = []; familiares = []; vincSel = ''; vincMsg = ''; }
 function familiarNombre(id) {
  const f = familiares.find((x) => x.id === id);
  return f ? (f.nombre || f.email) : id;
 }

 async function guardarExpediente() {
  expErr = ''; expMsg = '';
  try {
   const body = { ...expForm };
   if (!body.paquete_id) delete body.paquete_id;
   const { paciente } = await api.actualizarPaciente(exp.paciente.id, body);
   exp.paciente = { ...exp.paciente, ...paciente };
   const idx = pacientes.findIndex((x) => x.id === paciente.id);
   if (idx >= 0) pacientes[idx] = { ...pacientes[idx], ...paciente };
   expMsg = 'Expediente actualizado.';
  } catch (e) { expErr = e.message; }
 }

 async function setFotoExp(dataUrl) {
  expErr = ''; expMsg = '';
  try {
   const { paciente } = await api.actualizarPaciente(exp.paciente.id, { foto: dataUrl });
   exp.paciente = { ...exp.paciente, ...paciente };
   expFoto = dataUrl; // vista previa inmediata
   const fresh = await api.fotoPaciente(exp.paciente.id).then((r) => r.url).catch(() => '');
   if (fresh) expFoto = fresh;
   expMsg = 'Fotografía actualizada.';
  } catch (err) { expErr = err.message; }
 }
 function onFotoExp(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!/^image\//.test(file.type)) { expErr = 'El archivo debe ser una imagen'; return; }
  const r = new FileReader();
  r.onload = () => setFotoExp(r.result);
  r.readAsDataURL(file);
 }

 async function quitarFotoExp() {
  if (!confirm('¿Quitar la fotografía del paciente?')) return;
  try {
   const { paciente } = await api.actualizarPaciente(exp.paciente.id, { foto: null });
   exp.paciente = { ...exp.paciente, ...paciente };
   expFoto = '';
  } catch (e) { expErr = e.message; }
 }

 // Datos derivados del expediente
 const stats = $derived.by(() => {
  if (!exp) return null;
  const visitas = exp.visitas || [];
  const notas = exp.notas || [];
  const totalSesiones = visitas.length;
  const completadas = visitas.filter((v) => v.estado === 'completada' || v.salida).length;
  const pendientes = visitas.filter((v) => !v.salida).length;
  const conNota = new Set(notas.map((n) => n.visita_id).filter(Boolean)).size;
  const avance = totalSesiones ? Math.round((conNota / totalSesiones) * 100) : 0;
  const profs = [...new Set(notas.map((n) => n.especialidad || n.profesion || 'General'))];
  return { totalSesiones, completadas, pendientes, conNota, avance, profs, evidencias: (exp.evidencias || []).length };
 });

 const historialFiltrado = $derived.by(() => {
  if (!exp) return [];
  const notasPorVisita = new Map();
  for (const n of exp.notas || []) if (n.visita_id) notasPorVisita.set(n.visita_id, [...(notasPorVisita.get(n.visita_id) || []), n]);
  let items = (exp.visitas || []).map((v) => ({
   ...v,
   notas: notasPorVisita.get(v.id) || [],
   prof: v.perfiles?.nombre || v.perfiles?.email || 'Personal'
  }));
  if (fProf) items = items.filter((v) => (v.perfiles?.especialidad || v.perfiles?.profesion || 'General') === fProf || (v.notas[0]?.especialidad || 'General') === fProf);
  if (fDesde) items = items.filter((v) => String(v.fecha || '') >= fDesde);
  if (fHasta) items = items.filter((v) => String(v.fecha || '') <= fHasta + 'T23:59');
  return items.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
 });

 function fmtFecha(f) { return f ? new Date(f).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }

 // Línea de tiempo cronológica de intervenciones
 const timeline = $derived.by(() => {
  if (!exp) return [];
  const vById = new Map((exp.visitas || []).map((v) => [v.id, v]));
  let items = (exp.notas || []).map((n) => {
   const v = n.visita_id ? vById.get(n.visita_id) : null;
   return {
    n, v,
    fecha: v?.fecha || String(n.created_at || '').slice(0, 10),
    hora: v?.hora_programada || '',
    prof: v?.perfiles?.nombre || v?.perfiles?.email || 'Personal',
    disc: n.especialidad || v?.perfiles?.especialidad || v?.perfiles?.profesion || 'General',
    tipo: n.sesion || 'Atención'
   };
  }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.n.created_at || '').localeCompare(String(a.n.created_at || '')));
  if (tDesde) items = items.filter((i) => String(i.fecha) >= tDesde);
  if (tHasta) items = items.filter((i) => String(i.fecha) <= tHasta);
  if (tProf) items = items.filter((i) => i.prof === tProf);
  if (tDisc) items = items.filter((i) => i.disc === tDisc);
  return items;
 });
 const tProfs = $derived([...new Set((exp?.notas || []).map((n) => {
  const v = (exp.visitas || []).find((x) => x.id === n.visita_id);
  return v?.perfiles?.nombre || v?.perfiles?.email || 'Personal';
 }))].sort());
 const tDiscs = $derived([...new Set((exp?.notas || []).map((n) => n.especialidad || 'General'))].sort());
 const evPorNotaTl = $derived.by(() => {
  const m = new Map();
  for (const e of exp?.evidencias || []) m.set(e.nota_id, [...(m.get(e.nota_id) || []), e]);
  return m;
 });
 function fmtSoloFecha(f) { return f ? new Date(f.length === 10 ? f + 'T12:00:00' : f).toLocaleDateString('es-EC', { dateStyle: 'medium' }) : '—'; }

 function datosPacienteHTML(p, fotoUrl) {
  return `
  <div class="pac-head">
   ${fotoUrl ? `<img class="pac-foto" src="${fotoUrl}" alt="" />` : '<div class="pac-foto vacio">Sin foto</div>'}
   <div>
    <h2>${p.nombre || ''} ${p.apellido || ''}</h2>
    <p><strong>Edad:</strong> ${p.cedula ? p.cedula + ' años' : '—'} · <strong>Teléfono:</strong> ${p.telefono || '—'}<br/>
    <strong>Dirección:</strong> ${p.direccion || '—'}<br/>
    <strong>Diagnóstico / motivo:</strong> ${p.diagnostico || p.descripcion || 'Sin información registrada'}<br/>
    <strong>Contacto de emergencia:</strong> ${p.contacto_emergencia || '—'} ${p.telefono_emergencia ? '· ' + p.telefono_emergencia : ''}</p>
   </div>
  </div>`;
 }

 function abrirImpresion(html, titulo) {
  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(`<html><head><title>${titulo}</title><style>
   body{font-family:Georgia,serif;color:#222;max-width:800px;margin:24px auto;padding:0 16px}
   .logo{height:60px}.brand{display:flex;align-items:center;gap:12px;border-bottom:3px solid #c9a227;padding-bottom:12px}
   .brand h1{font-size:1.2rem;margin:0;color:#234}
   .pac-head{display:flex;gap:16px;margin:16px 0}
   .pac-foto{width:110px;height:110px;object-fit:cover;border-radius:10px;border:1px solid #ccc}
   .pac-foto.vacio{display:flex;align-items:center;justify-content:center;background:#eee;color:#888;font-size:.75rem}
   h2{margin:0 0 6px;font-size:1.15rem}
   table{width:100%;border-collapse:collapse;font-size:.82rem;margin-top:12px}
   th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}
   th{background:#f4f1e8}
   .nota{border:1px solid #ddd;border-radius:8px;padding:10px;margin:10px 0;background:#faf9f5}
   .nota h4{margin:0 0 6px;font-size:.9rem;color:#234}
   .ev{display:inline-block;margin:6px 8px 0 0;text-align:center}
   .ev img{width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #ccc}
   .ev span{display:block;font-size:.68rem;color:#666;max-width:120px}
   .footer{margin-top:24px;font-size:.72rem;color:#777;border-top:1px solid #ccc;padding-top:8px}
   @media print{body{margin:0}}
  </style></head><body>
  <div class="brand"><img class="logo" src="${window.location.origin}/logo.png" alt=""/><h1>Agencia Gerontológica Integral</h1></div>
  ${html}
  <div class="footer">Documento generado por la plataforma — ${new Date().toLocaleString('es-EC')}</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script>
  </body></html>`);
  w.document.close();
 }

 async function vincularFamiliar() {
  if (!vincSel || !exp) return;
  vincMsg = '';
  try {
   await api.vincularFamiliar(exp.paciente.id, vincSel);
   const vr = await api.vinculos();
   vinculos = (vr.vinculos || []).filter((v) => v.paciente_id === exp.paciente.id);
   vincSel = '';
   vincMsg = 'Familiar vinculado.';
  } catch (e) { vincMsg = e.message; }
 }
 async function desvincularFamiliar(v) {
  if (!confirm('¿Quitar el acceso del familiar a este paciente?')) return;
  try {
   await api.desvincularFamiliar(v.id, false);
   vinculos = vinculos.filter((x) => x.id !== v.id);
  } catch (e) { vincMsg = e.message; }
 }

 async function imprimirPaquete() {
  if (!exp) return;
  const p = exp.paciente;
  const pkg = paquetes.find((x) => x.id === p.paquete_id) || null;
  const html = `
   <h3 style="margin-top:18px">PAQUETE CONTRATADO</h3>
   ${datosPacienteHTML(p, expFoto)}
   <table>
    <tr><th>Paquete</th><td>${pkg ? pkg.nombre : (p.tipo_servicio || 'Sin información registrada')}</td></tr>
    <tr><th>Precio mensual</th><td>${pkg?.precio != null ? '$' + Number(pkg.precio).toFixed(2) : 'Sin información registrada'}</td></tr>
    <tr><th>Servicios incluidos</th><td>${pkg?.servicios || pkg?.descripcion || 'Sin información registrada'}</td></tr>
    <tr><th>Duración / frecuencia</th><td>${p.frecuencia_visitas || (pkg?.duracion_min ? Math.round(pkg.duracion_min / 60) + ' h por sesión' : 'Sin información registrada')}</td></tr>
    <tr><th>Disciplinas profesionales</th><td>${pkg?.servicios ? 'Ver servicios incluidos' : 'Sin información registrada'}</td></tr>
    <tr><th>Profesional / responsable asignado</th><td>${p.profesional_asignado || 'Sin información registrada'}</td></tr>
    <tr><th>Fecha de contratación</th><td>${p.fecha_contratacion ? String(p.fecha_contratacion).slice(0, 10) : 'Sin información registrada'}</td></tr>
    <tr><th>Inicio del servicio</th><td>${p.fecha_inicio ? String(p.fecha_inicio).slice(0, 10) : 'Sin información registrada'}</td></tr>
    <tr><th>Vigencia / término</th><td>${p.fecha_termino ? String(p.fecha_termino).slice(0, 10) : 'Sin información registrada'}</td></tr>
   </table>`;
  abrirImpresion(html, `Paquete contratado — ${p.nombre} ${p.apellido}`);
 }

 // Credencial imprimible del paciente (tarjeta con logo y datos)
 function imprimirCredencialPaciente() {
  if (!exp) return;
  const p = exp.paciente;
  const w = window.open('', '_blank', 'width=640,height=820');
  w.document.write(`<html><head><title>Credencial — ${p.nombre} ${p.apellido}</title><style>
   body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f1e8}
   .cred{width:340px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.18);border:1px solid #d8d2c0}
   .cred-top{background:#234;height:14px}
   .cred-body{padding:20px;text-align:center}
   .logo{height:54px}
   .cred-foto{width:110px;height:110px;border-radius:50%;object-fit:cover;border:3px solid #c9a227;margin:10px auto;display:block;background:#eee}
   .cred-foto.vacio{display:flex;align-items:center;justify-content:center;color:#999;font-size:2rem}
   .agencia{font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:#8a6d1f;font-weight:700}
   .paciente-label{font-size:.6rem;letter-spacing:.15em;text-transform:uppercase;color:#888;margin-top:4px}
   .nombre{font-size:1.2rem;font-weight:700;color:#222;margin:8px 0 2px}
   .datos{font-size:.72rem;color:#444;text-align:left;background:#faf8f0;border-radius:10px;padding:10px 12px;line-height:1.7}
   .datos b{color:#234}
   .cred-bot{background:#234;color:#f2eee2;font-size:.62rem;padding:8px;text-align:center;letter-spacing:.08em}
   @media print{body{background:#fff}.cred{box-shadow:none}}
  </style></head><body>
  <div class="cred">
   <div class="cred-top"></div>
   <div class="cred-body">
    <img class="logo" src="${window.location.origin}/logo.png" alt="Agencia Gerontológica Integral"/>
    <div class="agencia">Agencia Gerontológica Integral</div>
    <div class="paciente-label">Credencial de paciente</div>
    ${expFoto ? `<img class="cred-foto" src="${expFoto}" alt=""/>` : '<div class="cred-foto vacio">👤</div>'}
    <div class="nombre">${p.nombre || ''} ${p.apellido || ''}</div>
    <div class="datos">
     <b>Nombre:</b> ${p.nombre || ''} ${p.apellido || ''}<br/>
     <b>Edad:</b> ${p.cedula ? p.cedula + ' años' : '—'}<br/>
     <b>Teléfono:</b> ${p.telefono || '—'}<br/>
     <b>Emergencia:</b> ${p.contacto_emergencia || '—'}${p.telefono_emergencia ? ' · ' + p.telefono_emergencia : ''}<br/>
     <b>Dirección:</b> ${p.direccion || '—'}
    </div>
   </div>
   <div class="cred-bot">ADULTO MAYOR BAJO ATENCIÓN — USO INTERNO</div>
  </div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script>
  </body></html>`);
  w.document.close();
 }

 async function imprimirHistorial() {
  if (!exp) return;
  const p = exp.paciente;
  const items = historialFiltrado.slice().reverse(); // cronológico
  const evPorNota = new Map();
  for (const e of exp.evidencias || []) evPorNota.set(e.nota_id, [...(evPorNota.get(e.nota_id) || []), e]);
  let cuerpo = '';
  if (!items.length) cuerpo = '<p>Sin información registrada</p>';
  for (const v of items) {
   const prof = v.perfiles?.nombre || 'Personal';
   const disc = v.perfiles?.especialidad || v.perfiles?.profesion || v.notas[0]?.especialidad || 'General';
   for (const n of v.notas.length ? v.notas : [{ actividades: '', observaciones: '', evolucion: '', recomendaciones: '', material: '', incidencias: '', sesion: '', especialidad: disc }]) {
    const evs = evPorNota.get(n.id) || [];
    let imgs = '';
    for (const e of evs) {
     try {
      const { url } = await api.evidenciaUrl(e.id);
      imgs += `<div class="ev"><img src="${url}" alt=""/><span>${e.descripcion || e.nombre_archivo || ''}</span></div>`;
     } catch { /* sin acceso */ }
    }
    cuerpo += `<div class="nota">
     <h4>${fmtFecha(v.fecha)} · ${prof} · ${n.especialidad || disc}${n.sesion ? ' · ' + n.sesion : ''}</h4>
     ${n.actividades ? `<p><strong>Actividades:</strong> ${n.actividades}</p>` : ''}
     ${n.observaciones ? `<p><strong>Observaciones:</strong> ${n.observaciones}</p>` : ''}
     ${n.evolucion ? `<p><strong>Evolución:</strong> ${n.evolucion}</p>` : ''}
     ${n.recomendaciones ? `<p><strong>Recomendaciones:</strong> ${n.recomendaciones}</p>` : ''}
     ${n.incidencias ? `<p><strong>Incidencias:</strong> ${n.incidencias}</p>` : ''}
     ${n.material ? `<p><strong>Material:</strong> ${n.material}</p>` : ''}
     ${imgs}
    </div>`;
   }
  }
  const html = `
   <h3 style="margin-top:18px">HISTORIAL DE EVOLUCIÓN</h3>
   ${datosPacienteHTML(p, expFoto)}
   <p><strong>Diagnóstico / motivo:</strong> ${p.diagnostico || p.descripcion || 'Sin información registrada'}<br/>
   <strong>Objetivos:</strong> ${p.objetivos || 'Sin información registrada'}<br/>
   <strong>Antecedentes:</strong> ${p.antecedentes || 'Sin información registrada'}</p>
   ${cuerpo}`;
  abrirImpresion(html, `Historial de evolución — ${p.nombre} ${p.apellido}`);
 }

 onMount(async () => {
  if (!getToken()) { loading = false; return; }
  try {
   const { user: me } = await api.me();
   perfil = me.perfil;
  } catch { setToken(null); }
  loading = false;
  if (perfil?.rol === 'admin') cargar().catch((e) => { formError = e.message; });
 });
 function logout() { setToken(null); window.location.href = '/'; }
</script>

<svelte:head><title>Pacientes — Agencia Gerontológica</title></svelte:head>

{#if loading}
 <main class="card center"><p>Cargando…</p></main>
{:else if !perfil || perfil.rol !== 'admin'}
 <main class="card center">
 <h1>Acceso restringido</h1>
 <p class="muted">Esta sección es exclusiva del directivo.</p>
 <a class="ghost link" href="/">Volver al inicio</a>
 </main>
{:else}
<header>
 <a class="brand" href="/">
 <img src="/logo.png" alt="Agencia Gerontológica Integral" />
 <div class="brand-text">
 <span class="agency">Agencia Gerontológica Integral</span>
 <h1>Pacientes</h1>
 </div>
 </a>
 <div>
 <span class="badge">{perfil.email} · Directivo</span>
 <a class="ghost link" href="/visitas">Visitas</a>
 <a class="ghost link" href="/mapa">Mapa</a>
 <a class="ghost link" href="/personal">Personal</a>
 <a class="ghost link" href="/pacientes">Pacientes</a>
 <a class="ghost link" href="/seguimiento">Seguimiento</a>
 <a class="ghost link" href="/paquetes">Paquetes</a>
 <button class="ghost" onclick={logout}>Salir</button>
 </div>
</header>

<main class="grid">
 {#if formError}<p class="error">{formError}</p>{/if}
 {#if formOk}<p class="ok">{formOk}</p>{/if}

 <section class="card wide">
 <h2>Pacientes ({pacientes.length})
 <a class="mini ghost" href="/">+ Nuevo paciente</a>
 <button class="mini ghost" onclick={imprimirTodosQR} disabled={generandoQRs}>{generandoQRs ? 'Generando…' : 'Imprimir todos los QR'}</button>
 </h2>
 <table>
 <thead>
 <tr><th>Paciente</th><th>Edad</th><th>Servicio</th><th>Estado</th><th></th><th></th></tr>
 </thead>
 <tbody>
 {#each pacientes as p (p.id)}
 <tr>
 <td><span class="sem-dot {semaforos[p.id] || ''}"></span>{p.nombre} {p.apellido}{#if p.contacto_emergencia}<br/><small class="muted">Emergencia: {p.contacto_emergencia}{p.telefono_emergencia ? ` · ${p.telefono_emergencia}` : ''}</small>{/if}</td>
 <td>{p.cedula ? p.cedula + ' años' : '—'}</td>
 <td>{p.tipo_servicio || '—'}{#if p.fecha_inicio || p.fecha_termino}<br/><small class="muted">Inicio: {p.fecha_inicio ? String(p.fecha_inicio).slice(0, 10) : '—'} · Fin: {p.fecha_termino ? String(p.fecha_termino).slice(0, 10) : '—'}</small>{/if}</td>
 <td><span class="estado estado-{p.estado}">{p.estado}</span></td>
 <td>
 <select value={p.estado} onchange={(e) => cambiarEstado(p.id, e.target.value)}>
 <option value="pendiente">pendiente</option>
 <option value="en_proceso">en_proceso</option>
 <option value="completado">completado</option>
 <option value="cancelado">cancelado</option>
 </select>
 </td>
 <td class="acciones">
 <button class="mini" onclick={() => abrirExpediente(p)}>Expediente</button>
 <button class="mini" onclick={() => { window.location.href = `/?editar=${p.id}`; }}>Editar</button>
 <button class="mini" onclick={() => abrirQR(p)}>QR</button>
 <button class="mini danger" onclick={() => eliminar(p)}>Eliminar</button>
 </td>
 </tr>
 {:else}
 <tr><td colspan="6">Sin registros</td></tr>
 {/each}
 </tbody>
 </table>
 </section>
</main>

{#if qrModal}
 <div class="qr-overlay" onclick={cerrarQR} role="presentation">
 <div class="qr-sheet" onclick={(e) => e.stopPropagation()}>
 <img class="qr-logo" src="/logo.png" alt="Agencia Gerontológica Integral" />
 <h3>Código QR del domicilio</h3>
 <p class="muted">{qrModal.nombre} {qrModal.apellido}</p>
 {#if qrImg}<img class="qr-img" src={qrImg} alt="Código QR" />{/if}
 <p class="qr-id">ID: {qrToken}</p>
 <p class="muted small">Código de identificación del domicilio. Exclusivo para el registro de visitas del personal autorizado.</p>
 <div class="btns">
 <button class="mini" onclick={descargarQR}>Descargar PNG</button>
 <button class="mini" onclick={imprimirQR}>Imprimir / PDF</button>
 <button class="mini ghost" onclick={cerrarQR}>Cerrar</button>
 </div>
 </div>
 </div>
{/if}
{/if}

{#if exp}
 <div class="exp-overlay" role="presentation" onclick={cerrarExpediente}>
 <div class="exp-sheet" onclick={(e) => e.stopPropagation()}>
  <div class="exp-head">
   <div class="exp-id">
    {#if expFoto}<img class="exp-foto" src={expFoto} alt="" />{:else}<div class="exp-foto vacio">Sin foto</div>{/if}
    <div>
     <h3>{exp.paciente.nombre} {exp.paciente.apellido}</h3>
     <p class="muted">{exp.paciente.cedula ? exp.paciente.cedula + ' años · ' : ''}{exp.paciente.telefono || '—'} · {exp.paciente.direccion || '—'}</p>
    </div>
   </div>
   <div class="exp-acciones">
    <a class="mini link" href="/expediente?id={exp.paciente.id}&tab=valoracion">🩺 Valoración</a>
    <a class="mini link" href="/expediente?id={exp.paciente.id}">📋 Expediente multidisciplinario</a>
    <button class="mini ghost" onclick={cerrarExpediente}>✕ Cerrar</button>
   </div>
  </div>

  {#if expErr}<p class="error">{expErr}</p>{/if}
  {#if expMsg}<p class="ok">{expMsg}</p>{/if}
  {#if expLoading}<p class="muted">Cargando expediente…</p>{/if}

  <div class="exp-grid">
   <section class="exp-col">
    <h4>Fotografía del paciente</h4>
    <div class="foto-row">
     <label class="mini ghost foto-btn">{expFoto ? 'Cambiar foto' : 'Subir foto'}
      <input type="file" accept="image/jpeg,image/png" class="hidden" onchange={onFotoExp} />
     </label>
     <button type="button" class="mini ghost foto-btn" onclick={() => camVisible = true}>📷 Tomar foto</button>
     {#if expFoto}<button class="mini danger" onclick={quitarFotoExp}>Quitar</button>{/if}
    </div>
    <p class="muted small">JPG o PNG. Visible solo para personal autorizado.</p>

    <h4>Paquete contratado</h4>
    <label class="exp-label">Paquete
     <select bind:value={expForm.paquete_id}>
      <option value="">— Sin paquete —</option>
      {#each paquetes as pk (pk.id)}
       <option value={pk.id}>{pk.nombre} — ${Number(pk.precio || 0).toFixed(2)}/mes</option>
      {/each}
     </select>
    </label>
    <label class="exp-label">Frecuencia de visitas / sesiones
     <input bind:value={expForm.frecuencia_visitas} placeholder="Ej: 3 veces por semana, 1 h por sesión" />
    </label>
    <label class="exp-label">Profesional / responsable asignado
     <select bind:value={expForm.profesional_asignado}>
      <option value="">— Seleccionar empleado —</option>
      {#each trabajadoresExp as t}
       <option value={t.nombre ? `${t.nombre}${t.profesion ? ' — ' + t.profesion : ''}` : t.email}>{t.nombre || t.email}{t.profesion ? ' — ' + t.profesion : ''}</option>
      {/each}
      {#if expForm.profesional_asignado && !trabajadoresExp.some((t) => expForm.profesional_asignado === (t.nombre ? `${t.nombre}${t.profesion ? ' — ' + t.profesion : ''}` : t.email))}
       <option value={expForm.profesional_asignado}>{expForm.profesional_asignado} (actual)</option>
      {/if}
     </select>
    </label>
    <label class="exp-label">Diagnóstico / motivo de atención
     <textarea bind:value={expForm.diagnostico} rows="2"></textarea>
    </label>
    <label class="exp-label">Antecedentes relevantes
     <textarea bind:value={expForm.antecedentes} rows="2"></textarea>
    </label>
    <label class="exp-label">Objetivos de intervención
     <textarea bind:value={expForm.objetivos} rows="2"></textarea>
    </label>
    <button class="mini" onclick={guardarExpediente}>Guardar expediente</button>

    <h4>Familiares responsables vinculados</h4>
    {#if vinculos.length}
     <div class="vinc-list">
      {#each vinculos as v (v.id)}
       <div class="vinc-item">
        <span>{v.familiar_id ? familiarNombre(v.familiar_id) : 'Familiar'}</span>
        <button class="mini danger" onclick={() => desvincularFamiliar(v)}>Quitar</button>
       </div>
      {/each}
     </div>
    {:else}<p class="muted small">Sin familiares vinculados</p>{/if}
    <div class="vinc-add">
     <select bind:value={vincSel}>
      <option value="">Seleccionar cuenta de familiar…</option>
      {#each familiares as f (f.id)}
       {#if !vinculos.some((v) => v.familiar_id === f.id)}
        <option value={f.id}>{f.nombre || f.email} ({f.email})</option>
       {/if}
      {/each}
     </select>
     <button class="mini" onclick={vincularFamiliar} disabled={!vincSel}>Vincular</button>
    </div>
    {#if vincMsg}<p class="muted small">{vincMsg}</p>{/if}
    <p class="muted small">El familiar solo ve la información autorizada de este paciente en su portal.</p>
   </section>

   <section class="exp-col">
    <h4>Seguimiento y evolución</h4>
    {#if stats}
    <div class="stat-chips">
     <span class="chip">Sesiones: {stats.totalSesiones}</span>
     <span class="chip">Completadas: {stats.completadas}</span>
     <span class="chip warn">Pendientes: {stats.pendientes}</span>
     <span class="chip">Con nota: {stats.conNota}</span>
     <span class="chip ok">Avance: {stats.avance}%</span>
     <span class="chip">Evidencias: {stats.evidencias}</span>
    </div>
    <div class="filtros">
     <select bind:value={fProf}><option value="">Todas las disciplinas</option>{#each stats.profs as pr}<option value={pr}>{pr}</option>{/each}</select>
     <input type="date" bind:value={fDesde} title="Desde" />
     <input type="date" bind:value={fHasta} title="Hasta" />
    </div>
    {/if}

    <div class="exp-acciones">
     <button class="mini" onclick={imprimirCredencialPaciente}>🪪 Credencial</button>
     <button class="mini" onclick={imprimirPaquete}>Imprimir paquete contratado</button>
     <button class="mini" onclick={imprimirHistorial}>Imprimir historial de evolución</button>
    </div>

    <div class="historial">
     {#each historialFiltrado as v (v.id)}
      <div class="h-item">
       <strong>{fmtFecha(v.fecha)} · {v.hora_programada || ''}</strong>
       <span class="muted"> · {v.perfiles?.nombre || 'Personal'}{v.perfiles?.especialidad ? ' · ' + v.perfiles.especialidad : ''} · {v.estado}</span>
       {#if v.notas.length}
        {#each v.notas as n (n.id)}
         <div class="h-nota">
          {#if n.especialidad || n.sesion}<span class="muted small">{[n.especialidad, n.sesion].filter(Boolean).join(' · ')}</span>{/if}
          {#if n.actividades}<p><strong>Actividades:</strong> {n.actividades}</p>{/if}
          {#if n.evolucion}<p><strong>Evolución:</strong> {n.evolucion}</p>{/if}
          {#if n.observaciones}<p><strong>Observaciones:</strong> {n.observaciones}</p>{/if}
          {#if n.recomendaciones}<p><strong>Recomendaciones:</strong> {n.recomendaciones}</p>{/if}
         </div>
        {/each}
       {:else}
        <p class="muted small">Sin nota de evolución registrada</p>
       {/if}
      </div>
     {:else}
      <p class="muted">Sin información registrada</p>
     {/each}
    </div>
   </section>
  </div>

  <!-- ===== Línea de tiempo: Evolución ===== -->
  <section class="tl-section">
   <div class="tl-head">
    <h4>Evolución — línea de tiempo de intervenciones</h4>
    <button class="mini" onclick={imprimirHistorial}>Imprimir / PDF</button>
   </div>
   <div class="filtros">
    <input type="date" bind:value={tDesde} title="Desde" />
    <input type="date" bind:value={tHasta} title="Hasta" />
    <select bind:value={tProf}><option value="">Todos los profesionales</option>{#each tProfs as pr}<option value={pr}>{pr}</option>{/each}</select>
    <select bind:value={tDisc}><option value="">Todas las disciplinas</option>{#each tDiscs as d}<option value={d}>{d}</option>{/each}</select>
   </div>
   <div class="timeline">
    {#each timeline as it (it.n.id)}
     <div class="tl-item">
      <div class="tl-dot"></div>
      <div class="tl-card">
       <div class="tl-meta">
        <strong>{fmtSoloFecha(it.fecha)}{it.hora ? ' · ' + it.hora : ''}</strong>
        <span class="muted"> · {it.prof} · {it.disc} · {it.tipo}</span>
       </div>
       {#if it.n.actividades}<p><strong>Actividades:</strong> {it.n.actividades}</p>{/if}
       {#if it.n.evolucion}<p><strong>Evolución:</strong> {it.n.evolucion}</p>{/if}
       {#if it.n.observaciones}<p><strong>Observaciones:</strong> {it.n.observaciones}</p>{/if}
       {#if it.n.recomendaciones}<p><strong>Recomendaciones:</strong> {it.n.recomendaciones}</p>{/if}
       {#if it.n.incidencias}<p class="incidencia"><strong>⚠ Incidencia:</strong> {it.n.incidencias}</p>{/if}
       {#if it.n.revisado}<span class="revisado-badge">✓ Revisado{it.n.revisado_por ? ' por ' + it.n.revisado_por : ''}</span>{/if}
       {#if (evPorNotaTl.get(it.n.id) || []).length}
        <div class="tl-evs">
         {#each evPorNotaTl.get(it.n.id) as e (e.id)}
          {#if evUrls[e.id]}<img class="tl-ev" src={evUrls[e.id]} alt={e.descripcion || ''} title={e.descripcion || ''} />{/if}
         {/each}
        </div>
       {/if}
      </div>
     </div>
    {:else}
     <p class="muted">Sin información registrada</p>
    {/each}
   </div>
  </section>
 </div>
 </div>
{/if}

<style>
:global(body) { margin: 0; font-family: system-ui, sans-serif; background: oklch(0.985 0.007 85); color: oklch(0.27 0.035 225); }
header { display: flex; justify-content: space-between; align-items: center; padding: .8rem 2rem; background: oklch(0.3 0.05 222); color: #f2eee2; border-bottom: 3px solid oklch(0.7 0.1 78); flex-wrap: wrap; gap:.5rem; }
.brand { display: flex; align-items: center; gap: .8rem; text-decoration: none; color: inherit; }
.brand-text { display: flex; flex-direction: column; }
.agency { font-size: .72rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: oklch(0.7 0.1 78); }
header img { height: 44px; width: 44px; object-fit: cover; border-radius: 10px; background: #f2eee2; padding: 2px; }
header h1 { font-size: 1.05rem; margin: 0; }
header div:not(.brand) { display: flex; gap:.5rem; align-items: center; flex-wrap: wrap; }
.badge { font-size:.75rem; background: oklch(0.42 0.068 218); color: #f2eee2; padding:.3rem.6rem; border-radius: 999px; }
.card { background: #fff; border-radius: 12px; padding: 1.25rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
main.card { max-width: 420px; margin: 4rem auto; }
.center { text-align: center; }
.muted { color: oklch(0.45 0.03 225); font-size:.9rem; }
.small { font-size:.78rem; }
h2 { margin-top: 0; font-size: 1.05rem; }
form { display: flex; flex-direction: column; gap:.75rem; }
.row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:.75rem; }
.grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 1.5rem; padding: 1.5rem 2rem; max-width: 1200px; margin: 0 auto; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
label { display: flex; flex-direction: column; gap:.25rem; font-size:.85rem; font-weight: 600; }
input, textarea, select { padding:.55rem.65rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; }
button { padding:.6rem 1rem; border: 0; border-radius: 8px; background: oklch(0.42 0.068 218); color: #f2eee2; font-weight: 600; cursor: pointer; }
button:hover:not(:disabled) { background: oklch(0.36 0.068 218); }
button:disabled { opacity:.6; cursor: default; }
button.ghost, button.mini.ghost { background: transparent; color: inherit; border: 1px solid oklch(0.45 0.03 225); }
header button.ghost, header a.ghost { color: #f2eee2; border-color: oklch(0.55 0.05 222); }
.link { padding:.4rem.8rem; border: 1px solid oklch(0.45 0.03 225); border-radius: 8px; text-decoration: none; }
.geo-row { display: flex; gap: .6rem; align-items: center; }
.geo-row .ghost { margin: 0; }
button.mini { padding:.25rem.6rem; font-size:.75rem; margin-right:.35rem; }
.acciones { white-space: nowrap; }
.btns { display: flex; gap: .5rem; }
.btns button { flex: 0 0 auto; }
.btns button.ghost { color: oklch(0.45 0.03 225); border: 1px solid oklch(0.45 0.03 225); }
button.mini.danger { background: oklch(0.55 0.2 27); }
.error { color: oklch(0.55 0.2 27); font-size:.85rem; }
.ok { color: oklch(0.45 0.08 160); font-size:.85rem; }
table { width: 100%; border-collapse: collapse; font-size:.85rem; }
th, td { text-align: left; padding:.5rem.4rem; border-bottom: 1px solid oklch(0.93 0.025 140); }
.estado { padding:.15rem.5rem; border-radius: 999px; font-size:.75rem; background: oklch(0.94 0.025 80); }
.estado-pendiente { background: oklch(0.94 0.025 80); }
.estado-en_proceso { background: oklch(0.93 0.025 140); }
.estado-completado,.estado-aprobado { background: #d1e7dd; }
.estado-cancelado,.estado-rechazado { background: #f8d7da; }
.sem-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: .35rem; vertical-align: middle; }
.sem-dot.verde { background: #1e8e5a; } .sem-dot.amarillo { background: #d9a404; } .sem-dot.rojo { background: #c0392b; }
.qr-overlay { position: fixed; inset: 0; background: oklch(0.2 0.03 260 / .45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 1rem; }
.qr-sheet { background: #fff; border-radius: 16px; padding: 1.5rem; max-width: 380px; width: 100%; text-align: center; box-shadow: 0 10px 40px oklch(0.2 0.03 260 / .3); }
.qr-logo { height: 56px; }
.qr-img { width: 240px; height: 240px; image-rendering: pixelated; margin: .8rem auto; display: block; }
.qr-id { font-family: monospace; font-size: .8rem; color: oklch(0.5 0.03 85); word-break: break-all; }
.exp-overlay { position: fixed; inset: 0; background: oklch(0.2 0.03 260 / .5); display: flex; align-items: flex-start; justify-content: center; z-index: 60; padding: 1.5rem 1rem; overflow-y: auto; }
.exp-sheet { background: #fff; border-radius: 16px; padding: 1.25rem; max-width: 980px; width: 100%; box-shadow: 0 10px 40px oklch(0.2 0.03 260 / .3); }
.exp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; border-bottom: 1px solid oklch(0.93 0.025 140); padding-bottom: .75rem; }
.exp-head h3 { margin: 0; }
.exp-id { display: flex; gap: .9rem; align-items: center; }
.exp-foto { width: 72px; height: 72px; object-fit: cover; border-radius: 12px; border: 1px solid oklch(0.86 0.02 85); }
.exp-foto.vacio { display: flex; align-items: center; justify-content: center; background: oklch(0.95 0.02 85); color: oklch(0.5 0.03 85); font-size: .7rem; }
.exp-grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 1.5rem; margin-top: 1rem; }
@media (max-width: 800px) { .exp-grid { grid-template-columns: 1fr; } }
.exp-col h4 { margin: 1rem 0 .5rem; font-size: .95rem; color: oklch(0.3 0.05 222); }
.exp-label { display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; font-weight: 600; margin-bottom: .6rem; }
.exp-label input, .exp-label select, .exp-label textarea { padding: .45rem .55rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-weight: 400; }
.foto-row { display: flex; gap: .5rem; align-items: center; }
.foto-btn { position: relative; overflow: hidden; }
.hidden { position: absolute; opacity: 0; width: 1px; height: 1px; }
.stat-chips { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: .6rem; }
.chip { font-size: .72rem; background: oklch(0.94 0.025 140); border-radius: 999px; padding: .2rem .6rem; }
.chip.ok { background: #d1e7dd; } .chip.warn { background: #fff3cd; }
.filtros { display: flex; gap: .5rem; margin-bottom: .6rem; flex-wrap: wrap; }
.filtros select, .filtros input { padding: .4rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .8rem; }
.exp-acciones { display: flex; gap: .5rem; margin-bottom: .8rem; flex-wrap: wrap; }
.historial { max-height: 55vh; overflow-y: auto; }
.h-item { border-bottom: 1px solid oklch(0.93 0.025 140); padding: .6rem 0; font-size: .85rem; }
.h-nota { margin: .4rem 0 .4rem .8rem; padding-left: .6rem; border-left: 2px solid oklch(0.7 0.1 78); }
.h-nota p { margin: .15rem 0; font-size: .82rem; }
.tl-section { margin-top: 1.5rem; border-top: 2px solid oklch(0.93 0.025 140); padding-top: 1rem; }
.tl-head { display: flex; justify-content: space-between; align-items: center; }
.tl-head h4 { margin: 0; }
.tl-section .filtros { margin: .7rem 0; }
.timeline { position: relative; padding-left: 1.4rem; max-height: 60vh; overflow-y: auto; }
.timeline::before { content: ''; position: absolute; left: 7px; top: 6px; bottom: 6px; width: 2px; background: oklch(0.8 0.05 220); }
.tl-item { position: relative; margin-bottom: .9rem; }
.tl-dot { position: absolute; left: -1.4rem; top: 6px; width: 14px; height: 14px; border-radius: 50%; background: oklch(0.42 0.068 218); border: 3px solid #fff; box-shadow: 0 0 0 1px oklch(0.8 0.05 220); }
.tl-card { background: oklch(0.985 0.008 140); border: 1px solid oklch(0.92 0.02 140); border-radius: 10px; padding: .7rem .9rem; font-size: .85rem; }
.tl-meta { margin-bottom: .3rem; }
.tl-card p { margin: .15rem 0; }
.tl-card .incidencia { color: oklch(0.55 0.2 27); }
.revisado-badge { display: inline-block; font-size: .7rem; background: #d1e7dd; color: #0f5132; border-radius: 999px; padding: .1rem .5rem; margin-top: .3rem; }
.tl-evs { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .4rem; }
.tl-ev { width: 90px; height: 68px; object-fit: cover; border-radius: 6px; border: 1px solid oklch(0.86 0.02 85); cursor: pointer; }
.vinc-list { display: flex; flex-direction: column; gap: .35rem; margin-bottom: .5rem; }
.vinc-item { display: flex; justify-content: space-between; align-items: center; background: oklch(0.97 0.02 85); border: 1px solid oklch(0.9 0.02 85); border-radius: 8px; padding: .35rem .6rem; font-size: .82rem; }
.vinc-add { display: flex; gap: .4rem; }
.vinc-add select { flex: 1; padding: .4rem .5rem; border: 1px solid oklch(0.86 0.02 85); border-radius: 8px; font: inherit; font-size: .8rem; }
</style>

<FotoCamara bind:visible={camVisible} onCapture={setFotoExp} />
