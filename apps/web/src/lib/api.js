import { env } from '$env/dynamic/public';

// Vacío = mismo origen (Express sirve frontend + API en un solo servidor)
const API = env.PUBLIC_API_URL || '';

// ---------- Cierre de sesión por inactividad (1 hora) ----------
const IDLE_LIMIT_MS = 60 * 60 * 1000; // 1 hora
if (typeof window !== 'undefined') {
  const touch = () => localStorage.setItem('lastActivity', String(Date.now()));
  touch();
  ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach((ev) =>
    window.addEventListener(ev, touch, { passive: true })
  );
  setInterval(() => {
    const last = Number(localStorage.getItem('lastActivity') || Date.now());
    if (Date.now() - last > IDLE_LIMIT_MS && getToken()) {
      setToken(null);
      if (window.location.pathname !== '/') window.location.href = '/';
    }
  }, 30000);
}

export function getToken() {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
}

export function setToken(t) {
  if (typeof localStorage !== 'undefined') {
    if (t) localStorage.setItem('token', t);
    else localStorage.removeItem('token');
  }
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    setToken(null);
    throw new Error('Sesión expirada');
  }
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  login: (email, password) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email, password, nombre, password2) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, nombre, password2 }) }),
  google: (credential) =>
    request('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  verificar: (email, codigo) =>
    request('/api/auth/verificar', { method: 'POST', body: JSON.stringify({ email, codigo }) }),
  reenviarCodigo: (email) =>
    request('/api/auth/reenviar', { method: 'POST', body: JSON.stringify({ email }) }),
  recuperar: (email) =>
    request('/api/auth/recuperar', { method: 'POST', body: JSON.stringify({ email }) }),
  restablecer: (email, codigo, password) =>
    request('/api/auth/restablecer', { method: 'POST', body: JSON.stringify({ email, codigo, password }) }),
  me: () => request('/api/me'),
  perfiles: (estado) => request(`/api/perfiles${estado ? `?estado=${estado}` : ''}`),
  actualizarPerfil: (id, body) =>
    request(`/api/perfiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  pacientes: () => request('/api/pacientes'),
  crearPaciente: (p) => request('/api/pacientes', { method: 'POST', body: JSON.stringify(p) }),
  estadoPaciente: (id, estado) =>
    request(`/api/pacientes/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado }) }),
  stats: () => request('/api/stats'),
  geocercas: () => request('/api/geocercas'),
  crearGeocerca: (g) => request('/api/geocercas', { method: 'POST', body: JSON.stringify(g) }),
  eliminarGeocerca: (id) => request(`/api/geocercas/${id}`, { method: 'DELETE' }),
  actualizarPaciente: (id, body) =>
    request(`/api/pacientes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  eliminarPaciente: (id) => request(`/api/pacientes/${id}`, { method: 'DELETE' }),
  // Visitas
  trabajadores: () => request('/api/trabajadores'),
  visitas: (params = '') => request(`/api/visitas${params}`),
  crearVisita: (v) => request('/api/visitas', { method: 'POST', body: JSON.stringify(v) }),
  actualizarVisita: (id, body) =>
    request(`/api/visitas/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  pingVisita: (id, lat, lng, trabajador_estado) =>
    request(`/api/visitas/${id}/ping`, { method: 'POST', body: JSON.stringify({ lat, lng, trabajador_estado }) }),
  historial: (params = '') => request(`/api/visitas/historial${params}`),
  solicitarReprogramacion: (id, body) => request(`/api/visitas/${id}/solicitar-reprogramacion`, { method: 'POST', body: JSON.stringify(body) }),
  exportarVisitas: (params = '') => requestBlob(`/api/visitas/export${params}`),
  dashboard: () => request('/api/dashboard'),
  notificaciones: (noLeidas) => request(`/api/notificaciones${noLeidas ? '?no_leidas=1' : ''}`),
  leerNotificacion: (id) => request(`/api/notificaciones/${id}/leida`, { method: 'POST' }),
  leerTodas: () => request('/api/notificaciones/leer-todas', { method: 'POST' }),
  notaVisita: (id, campos) => request(`/api/visitas/${id}/nota`, { method: 'POST', body: JSON.stringify(campos) }),
  notasVisita: (id) => request(`/api/visitas/${id}/notas`),
  seguimiento: () => request('/api/seguimiento'),
  actualizarNota: (id, body) => request(`/api/notas/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  evidenciasNota: (id) => request(`/api/notas/${id}/evidencias`),
  evidenciaArchivo: (id) => request(`/api/evidencias/${id}/archivo`),
  incidenciaGps: (id, descripcion) => request(`/api/visitas/${id}/incidencia-gps`, { method: 'POST', body: JSON.stringify({ descripcion }) }),
  paquetes: () => request('/api/paquetes'),
  crearPaquete: (p) => request('/api/paquetes', { method: 'POST', body: JSON.stringify(p) }),
  actualizarPaquete: (id, p) => request(`/api/paquetes/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  // Directorio y expedientes del personal
  directorio: () => request('/api/directorio'),
  crearTrabajador: (t) => request('/api/trabajadores', { method: 'POST', body: JSON.stringify(t) }),
  historialPerfil: (id) => request(`/api/perfiles/${id}/historial`),
  eliminarTrabajador: (id) => request(`/api/trabajadores/${id}`, { method: 'DELETE' }),
  // Control de asistencia por código QR
  qrPaciente: (token) => request(`/api/qr/${encodeURIComponent(token)}`),
  qrCheckin: (body) => request('/api/visitas/qr-checkin', { method: 'POST', body: JSON.stringify(body) }),
  // Expediente del paciente: foto, paquete contratado e historial de evolución
  fotoPaciente: (id) => request(`/api/pacientes/${id}/foto`),
  fotoPerfil: (id) => request(`/api/perfiles/${id}/foto`),
  misPacientes: () => request('/api/mis-pacientes'),
  semaforo: () => request('/api/semaforo'),
  revisarAlerta: (id, acciones) => request(`/api/alertas/${id}/revisar`, { method: 'POST', body: JSON.stringify({ acciones }) }),
  // Portal del familiar responsable
  misFamiliares: () => request('/api/mis-familiares'),
  vinculos: () => request('/api/vinculos'),
  vincularFamiliar: (paciente_id, familiar_id) => request('/api/vinculos', { method: 'POST', body: JSON.stringify({ paciente_id, familiar_id }) }),
  desvincularFamiliar: (id, activo = false) => request(`/api/vinculos/${id}`, { method: 'PATCH', body: JSON.stringify({ activo }) }),
  enviarMensaje: (texto) => request('/api/mensajes', { method: 'POST', body: JSON.stringify({ texto }) }),
  cerrarNota: (id) => request(`/api/notas/${id}/cerrar`, { method: 'POST' }),
  valoraciones: (pacienteId) => request(`/api/pacientes/${pacienteId}/valoraciones`),
  crearValoracion: (pacienteId, body) => request(`/api/pacientes/${pacienteId}/valoraciones`, { method: 'POST', body: JSON.stringify(body) }),
  eliminarValoracion: (id) => request(`/api/valoraciones/${id}`, { method: 'DELETE' }),
  centro: (params = '') => request(`/api/centro${params}`),
  pagos: (params = '') => request(`/api/pagos${params}`),
  crearPago: (body) => request('/api/pagos', { method: 'POST', body: JSON.stringify(body) }),
  actualizarPago: (id, body) => request(`/api/pagos/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  evaluaciones: (params = '') => request(`/api/evaluaciones${params}`),
  crearEvaluacion: (body) => request('/api/evaluaciones', { method: 'POST', body: JSON.stringify(body) }),
  actualizarEvaluacion: (id, body) => request(`/api/evaluaciones/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  metricasEmpleado: (params) => request(`/api/evaluaciones/metricas?${params}`),
  planesMejora: (params = '') => request(`/api/planes-mejora${params}`),
  crearPlanMejora: (body) => request('/api/planes-mejora', { method: 'POST', body: JSON.stringify(body) }),
  actualizarPlanMejora: (id, body) => request(`/api/planes-mejora/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  capacitaciones: (params = '') => request(`/api/capacitaciones${params}`),
  crearCapacitacion: (body) => request('/api/capacitaciones', { method: 'POST', body: JSON.stringify(body) }),
  encuestas: (params = '') => request(`/api/encuestas${params}`),
  crearEncuesta: (body) => request('/api/encuestas', { method: 'POST', body: JSON.stringify(body) }),
  encuestasPeriodo: (params = '') => request(`/api/encuestas-periodo${params}`),
  responderEncuestaPeriodo: (id, body) => request(`/api/encuestas-periodo/${id}/responder`, { method: 'POST', body: JSON.stringify(body) }),
  generarEncuestasPeriodo: (periodo) => request('/api/encuestas-periodo/generar', { method: 'POST', body: JSON.stringify({ periodo }) }),
  accionEncuestaPeriodo: (id, body) => request(`/api/encuestas-periodo/${id}/accion`, { method: 'PATCH', body: JSON.stringify(body) }),
  estadisticasEncuestas: () => request('/api/encuestas-periodo/estadisticas'),
  observatorioResumen: () => request('/api/observatorio/resumen'),
  obsGuardarZona: (body) => request('/api/observatorio/zona', { method: 'POST', body: JSON.stringify(body) }),
  obsGuardarServicio: (body) => request('/api/observatorio/servicio', { method: 'POST', body: JSON.stringify(body) }),
  obsGuardarNecesidad: (body) => request('/api/observatorio/necesidad', { method: 'POST', body: JSON.stringify(body) }),
  obsGuardarDato: (body) => request('/api/observatorio/dato', { method: 'POST', body: JSON.stringify(body) }),
  obsEliminar: (tabla, id) => request(`/api/observatorio/${tabla}/${id}`, { method: 'DELETE' }),
  expedientePaciente: (id) => request(`/api/pacientes/${id}/expediente`),
  evidenciaUrl: (id) => request(`/api/evidencias/${id}/archivo`)
};

async function requestBlob(path) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status}`);
  }
  return res.blob();
}
