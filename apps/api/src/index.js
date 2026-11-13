import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Carga .env de la raíz del monorepo y, si existe, uno local en apps/api
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../../.env') });
loadEnv();

import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { readFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes, randomInt } from 'node:crypto';

const app = express();
const PORT = process.env.PORT || 3001;
// Cuenta única con permiso de rol Directivo (admin)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'nestorriverazandate@gmail.com';
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto-en-produccion';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim());

app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: CORS_ORIGINS }));

// ---------- Clientes ----------
function refFromJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).ref;
  } catch { return null; }
}
const supabaseUrl =
  process.env.SUPABASE_URL ||
  (refFromJwt(process.env.SUPABASE_SERVICE_ROLE_KEY || '') &&
    `https://${refFromJwt(process.env.SUPABASE_SERVICE_ROLE_KEY)}.supabase.co`);

if (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_URL) en .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
// Cliente aparte para signInWithPassword: evita que la sesión del usuario
// contamine el cliente service_role (causaba errores de RLS)
const supabaseAuth = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const googleAuthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

let driveClient = null;
function getDrive() {
  if (driveClient) return driveClient;
  let credentials;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  }
  if (!credentials) throw new Error('Faltan credenciales de Google (GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_APPLICATION_CREDENTIALS)');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive.file']
  });
  driveClient = google.docs({ version: 'v1', auth });
  return driveClient;
}

// ---------- Estado en memoria (balanceo/monitoreo) ----------
const stats = { requests: 0, startTime: Date.now(), worker: process.pid };
app.use((req, _res, next) => { stats.requests++; next(); });

// ---------- Auth ----------
const signToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

// Devuelve el perfil del usuario; si no existe, lo crea como 'pendiente'
async function ensurePerfil(userId, email, nombre = null) {
  const { data: perfil } = await supabase
    .from('perfiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (perfil) return perfil;
  const { data, error } = await supabase
    .from('perfiles')
    .insert({ id: userId, email, nombre, estado: 'aprobado', rol: 'paciente' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function findAuthUserByEmail(email) {
  const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  return data?.users?.find((u) => u.email === email) || null;
}

// ---------- Verificación de correo con código de 6 dígitos ----------
// El hash del código y su expiración se guardan en user_metadata de auth.users
// (no requiere columnas nuevas en la base de datos).
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const CODE_MAX_INTENTOS = 5;

const transporter = process.env.SMTP_USER
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 465),
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

function nuevoCodigo() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

function hashCodigo(codigo) {
  return createHash('sha256').update(`${codigo}:${JWT_SECRET}`).digest('hex');
}

async function setVerifMeta(userId, meta) {
  const { data: u } = await supabase.auth.admin.getUserById(userId);
  const actual = u?.user?.user_metadata || {};
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { ...actual, ...meta }
  });
  if (error) throw error;
}

async function enviarCodigo(email, codigo) {
  if (!transporter) return false;
  await transporter.sendMail({
    from: `"Agencia Gerontológica Integral" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: 'Tu código de verificación',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;border:1px solid #e3ddd1;border-radius:12px;padding:24px">
        <h2 style="color:#083340;margin-top:0">Verifica tu correo</h2>
        <p>Tu código de verificación es:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#135666">${codigo}</p>
        <p style="color:#5f767f;font-size:13px">Vence en 10 minutos. Si no creaste esta cuenta, ignora este mensaje.</p>
      </div>`
  });
  return true;
}

async function generarYEnviarCodigo(userId, email) {
  const codigo = nuevoCodigo();
  await setVerifMeta(userId, {
    verif_hash: hashCodigo(codigo),
    verif_exp: Date.now() + CODE_TTL_MS,
    verif_intentos: 0,
    verif_ok: false
  });
  const enviado = await enviarCodigo(email, codigo).catch((e) => {
    console.error('enviarCodigo:', e);
    return false;
  });
  return { codigo, enviado };
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, nombre } = req.body || {};
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Email válido y contraseña de mínimo 6 caracteres' });
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre: nombre || '' }
    });
    if (error) return res.status(400).json({ error: error.message });
    const perfil = await ensurePerfil(data.user.id, email, nombre || null);
    const { codigo, enviado } = await generarYEnviarCodigo(data.user.id, email);
    const resp = { requiere_verificacion: true, email };
    // Sin SMTP configurado: en desarrollo devolvemos el código para poder probar el flujo
    if (!enviado && process.env.NODE_ENV !== 'production') resp.dev_codigo = codigo;
    res.json(resp);
  } catch (e) {
    console.error('register:', e);
    res.status(500).json({ error: 'Error al registrar' });
  }
});

app.post('/api/auth/verificar', async (req, res) => {
  try {
    const { email, codigo } = req.body || {};
    if (!email || !codigo) return res.status(400).json({ error: 'Email y código son requeridos' });
    const user = await findAuthUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'Cuenta no encontrada' });
    const meta = user.user_metadata || {};
    if (meta.verif_ok !== false) {
      // Ya verificado (o usuario antiguo sin marca): emitir sesión directamente
      const perfil = await ensurePerfil(user.id, email);
      return res.json({ token: signToken({ id: user.id, email }), perfil });
    }
    if (!meta.verif_hash || Date.now() > meta.verif_exp) {
      return res.status(400).json({ error: 'El código venció. Solicita uno nuevo.' });
    }
    if ((meta.verif_intentos || 0) >= CODE_MAX_INTENTOS) {
      return res.status(400).json({ error: 'Demasiados intentos. Solicita un código nuevo.' });
    }
    if (hashCodigo(String(codigo).trim()) !== meta.verif_hash) {
      await setVerifMeta(user.id, { verif_intentos: (meta.verif_intentos || 0) + 1 });
      return res.status(400).json({ error: 'Código incorrecto' });
    }
    await setVerifMeta(user.id, { verif_ok: true, verif_hash: null, verif_exp: null, verif_intentos: 0 });
    const perfil = await ensurePerfil(user.id, email);
    res.json({ token: signToken({ id: user.id, email }), perfil });
  } catch (e) {
    console.error('verificar:', e);
    res.status(500).json({ error: 'Error al verificar' });
  }
});

app.post('/api/auth/reenviar', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email requerido' });
    const user = await findAuthUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'Cuenta no encontrada' });
    if (user.user_metadata?.verif_ok !== false) {
      return res.status(400).json({ error: 'Esta cuenta ya está verificada' });
    }
    const { codigo, enviado } = await generarYEnviarCodigo(user.id, email);
    const resp = { ok: true };
    if (!enviado && process.env.NODE_ENV !== 'production') resp.dev_codigo = codigo;
    res.json(resp);
  } catch (e) {
    console.error('reenviar:', e);
    res.status(500).json({ error: 'Error al reenviar código' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error || !data.user) return res.status(401).json({ error: 'Credenciales inválidas' });
    if (data.user.user_metadata?.verif_ok === false) {
      return res.status(403).json({ error: 'Debes verificar tu correo antes de entrar', requiere_verificacion: true, email });
    }
    const perfil = await ensurePerfil(data.user.id, email);
    res.json({ token: signToken({ id: data.user.id, email }), perfil });
  } catch (e) {
    console.error('login:', e);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Falta credential de Google' });
    const ticket = await googleAuthClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const g = ticket.getPayload();
    if (!g?.email) return res.status(400).json({ error: 'Token de Google inválido' });

    let userId;
    const existing = await findAuthUserByEmail(g.email);
    if (existing) {
      userId = existing.id;
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: g.email,
        password: randomBytes(32).toString('hex'),
        email_confirm: true,
        user_metadata: { nombre: g.name || '', avatar_url: g.picture || '' }
      });
      if (error) throw error;
      userId = data.user.id;
    }
    const perfil = await ensurePerfil(userId, g.email, g.name || null);
    res.json({ token: signToken({ id: userId, email: g.email }), perfil });
  } catch (e) {
    console.error('google auth:', e);
    res.status(401).json({ error: 'No se pudo verificar la cuenta de Google' });
  }
});

async function requireUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { data: perfil } = await supabase
      .from('perfiles')
      .select('*')
      .eq('id', payload.sub)
      .maybeSingle();
    req.user = { id: payload.sub, email: payload.email, perfil };
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

const isAdmin = (req) => req.user?.perfil?.rol === 'admin';
const isApproved = (req) => req.user?.perfil?.estado === 'aprobado' || isAdmin(req);

// ---------- Salud / balanceo ----------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.floor((Date.now() - stats.startTime) / 1000), worker: stats.worker, requests: stats.requests });
});

app.get('/api/stats', requireUser, (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    worker: stats.worker,
    uptime_s: Math.floor((Date.now() - stats.startTime) / 1000),
    requests: stats.requests,
    memory_mb: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) }
  });
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email, perfil: req.user.perfil } });
});

// ---------- Perfiles: aprobación de usuarios ----------
app.get('/api/perfiles', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo administradores' });
  try {
    const estado = req.query.estado || null;
    let q = supabase.from('perfiles').select('*').order('created_at', { ascending: false });
    if (estado) q = q.eq('estado', estado);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ perfiles: data });
  } catch (e) {
    console.error('GET /api/perfiles:', e);
    res.status(500).json({ error: 'Error al obtener perfiles' });
  }
});

// Campos del expediente laboral (columnas nuevas en perfiles)
const PERFIL_EXPEDIENTE = ['telefono', 'domicilio', 'profesion', 'especialidad', 'id_laboral', 'fecha_contratacion', 'estado_laboral'];

app.patch('/api/perfiles/:id', requireUser, async (req, res) => {
  try {
    const esPropio = req.params.id === req.user.id;
    const esAdminUser = isAdmin(req);
    // El empleado solo puede editar sus datos de contacto; el resto es del directivo
    if (!esAdminUser && !esPropio) return res.status(403).json({ error: 'Sin permiso' });

    const { estado, rol } = req.body || {};
    const update = {};
    if (esAdminUser) {
      // Solo la cuenta designada puede tener rol admin
      if (rol) {
        const { data: objetivo } = await supabase.from('perfiles').select('email').eq('id', req.params.id).maybeSingle();
        const esCuentaAdmin = objetivo?.email === ADMIN_EMAIL;
        if (rol === 'admin' && !esCuentaAdmin) {
          return res.status(403).json({ error: 'Solo la cuenta administradora puede tener rol Directivo' });
        }
        if (esCuentaAdmin && rol !== 'admin') {
          return res.status(403).json({ error: 'La cuenta administradora no puede cambiar de rol' });
        }
        if (['admin', 'paciente', 'staff', 'familiar', 'cuidador'].includes(rol)) update.rol = rol;
      }
      if (estado && ['pendiente', 'aprobado', 'rechazado'].includes(estado)) update.estado = estado;
      for (const f of PERFIL_EXPEDIENTE) if (req.body[f] != null) update[f] = String(req.body[f]).slice(0, 300);
    } else {
      for (const f of ['telefono', 'domicilio']) if (req.body[f] != null) update[f] = String(req.body[f]).slice(0, 300);
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });
    const { data, error } = await supabase
      .from('perfiles')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ perfil: data });
  } catch (e) {
    console.error('PATCH /api/perfiles:', e);
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

// ---------- Pacientes ----------
const PATIENT_FIELDS = ['nombre', 'apellido', 'cedula', 'telefono', 'email', 'direccion', 'tipo_servicio', 'descripcion', 'fecha_solicitud', 'fecha_inicio', 'fecha_termino', 'contacto_emergencia', 'telefono_emergencia'];
// Columnas opcionales: si la BD aún no las tiene, se reintenta sin ellas
const PATIENT_OPTIONALES = ['fecha_inicio', 'fecha_termino', 'contacto_emergencia', 'telefono_emergencia'];
function sinColumnaFaltante(p, errorMsg) {
  const copia = { ...p };
  const m = /column [`"]?(?:public\.)?pacientes\.([a-z_]+)[`"]? does not exist/i.exec(errorMsg || '');
  const col = m && PATIENT_OPTIONALES.includes(m[1]) ? m[1] : null;
  if (col) delete copia[col];
  else for (const f of PATIENT_OPTIONALES) delete copia[f]; // fallback: quitar todas
  return copia;
}

function sanitizePatient(body) {
  const p = {};
  for (const f of PATIENT_FIELDS) if (body[f] != null) p[f] = String(body[f]).slice(0, 500);
  // El formulario envía "edad"; se guarda en la columna cedula (texto)
  if (body.edad != null && p.cedula == null) {
    const e = Number(body.edad);
    if (Number.isFinite(e)) p.cedula = String(Math.round(e));
  }
  // Coordenadas del domicilio (numéricas)
  if (body.lat != null && body.lng != null) {
    const la = Number(body.lat), ln = Number(body.lng);
    if (Math.abs(la) <= 90 && Math.abs(ln) <= 180) { p.lat = la; p.lng = ln; }
  }
  return p;
}

app.post('/api/pacientes', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo puede registrar pacientes' });
  try {
    const p = sanitizePatient(req.body);
    if (!p.nombre || !p.apellido) return res.status(400).json({ error: 'nombre y apellido son requeridos' });

    let { data, error } = await supabase
      .from('pacientes')
      .insert({ ...p, estado: 'pendiente', user_id: req.user.id, registrado_por: req.user.email })
      .select()
      .single();
    // Si la BD aún no tiene las columnas opcionales, reintenta sin ellas
    if (error && /does not exist/i.test(error.message)) {
      ({ data, error } = await supabase
        .from('pacientes')
        .insert({ ...sinColumnaFaltante(p, error.message), estado: 'pendiente', user_id: req.user.id, registrado_por: req.user.email })
        .select()
        .single());
    }
    if (error) throw error;

    await appendToDriveDoc(data);
    res.status(201).json({ paciente: data });
  } catch (e) {
    console.error('POST /api/pacientes:', e);
    res.status(500).json({ error: 'Error al registrar paciente' });
  }
});

app.get('/api/pacientes', requireUser, async (req, res) => {
  if (!isApproved(req)) return res.status(403).json({ error: 'Cuenta pendiente de aprobación' });
  try {
    const { data, error } = await supabase
      .from('pacientes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    // El empleado solo ve pacientes que tienen asignados en visitas
    if (!isAdmin(req)) {
      const { data: misVisitas } = await supabase
        .from('visitas').select('paciente_id').eq('trabajador_id', req.user.id);
      const ids = new Set((misVisitas || []).map((v) => v.paciente_id));
      return res.json({ pacientes: (data || []).filter((p) => ids.has(p.id)) });
    }
    res.json({ pacientes: data });
  } catch (e) {
    console.error('GET /api/pacientes:', e);
    res.status(500).json({ error: 'Error al obtener pacientes' });
  }
});

app.patch('/api/pacientes/:id', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo puede modificar pacientes' });
  try {
    const update = sanitizePatient(req.body);
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });
    let { data, error } = await supabase
      .from('pacientes')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error && /does not exist/i.test(error.message)) {
      ({ data, error } = await supabase
        .from('pacientes')
        .update(sinColumnaFaltante(update, error.message))
        .eq('id', req.params.id)
        .select()
        .single());
    }
    if (error) throw error;
    res.json({ paciente: data });
  } catch (e) {
    console.error('PATCH paciente:', e);
    res.status(500).json({ error: 'Error al actualizar paciente' });
  }
});

app.delete('/api/pacientes/:id', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo puede eliminar pacientes' });
  try {
    const { error } = await supabase
      .from('pacientes')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE paciente:', e);
    res.status(500).json({ error: 'Error al eliminar paciente' });
  }
});

app.patch('/api/pacientes/:id/estado', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo puede cambiar estados' });
  try {
    const { estado } = req.body || {};
    if (!['pendiente', 'en_proceso', 'completado', 'cancelado'].includes(estado)) {
      return res.status(400).json({ error: 'estado inválido' });
    }
    const { data, error } = await supabase
      .from('pacientes')
      .update({ estado })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ paciente: data });
  } catch (e) {
    console.error('PATCH estado:', e);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

// ---------- Geocercas ----------
app.get('/api/geocercas', requireUser, async (req, res) => {
  if (!puedeVerTodas(req)) return res.status(403).json({ error: 'Solo directivo/staff' });
  try {
    const { data, error } = await supabase
      .from('geocercas')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ geocercas: data });
  } catch (e) {
    console.error('GET /api/geocercas:', e);
    res.status(500).json({ error: 'Error al obtener geocercas' });
  }
});

app.post('/api/geocercas', requireUser, async (req, res) => {
  if (!puedeVerTodas(req)) return res.status(403).json({ error: 'Solo directivo/staff' });
  try {
    const { nombre, tipo = 'circulo', centro_lat, centro_lng, radio_m, geojson } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
    const { data, error } = await supabase
      .from('geocercas')
      .insert({
        nombre: String(nombre).slice(0, 200),
        tipo: ['circulo', 'poligono'].includes(tipo) ? tipo : 'circulo',
        centro_lat: centro_lat != null ? Number(centro_lat) : null,
        centro_lng: centro_lng != null ? Number(centro_lng) : null,
        radio_m: radio_m != null ? Number(radio_m) : null,
        geojson: geojson || null,
        creado_por: req.user.id
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ geocerca: data });
  } catch (e) {
    console.error('POST /api/geocercas:', e);
    res.status(500).json({ error: 'Error al guardar geocerca' });
  }
});

app.delete('/api/geocercas/:id', requireUser, async (req, res) => {
  if (!isAdmin(req) && req.user?.perfil?.rol !== 'staff') {
    // permitir borrar al creador o admin
    const { data: g } = await supabase.from('geocercas').select('creado_por').eq('id', req.params.id).maybeSingle();
    if (!g || g.creado_por !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
  }
  const { error } = await supabase.from('geocercas').delete().eq('id', req.params.id);
  if (error) { console.error('DELETE geocerca:', error); return res.status(500).json({ error: 'Error al eliminar' }); }
  res.json({ ok: true });
});

// ---------- Visitas domiciliarias ----------
function distanciaM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// SSE: stream de eventos en tiempo real para admins conectados
const sseClients = new Set();
function broadcast(evento) {
  const payload = `data: ${JSON.stringify(evento)}\n\n`;
  for (const res of sseClients) { try { res.write(payload); } catch { sseClients.delete(res); } }
}

async function logEvento(visitaId, evento, detalle = {}) {
  await supabase.from('visita_eventos').insert({ visita_id: visitaId, evento, detalle });
}

async function notifyAdmins(tipo, mensaje, visita = null, datos = {}) {
  const { data: admins } = await supabase.from('perfiles').select('id').eq('rol', 'admin');
  const rows = (admins || []).map((a) => ({
    destinatario_id: a.id, tipo, mensaje,
    visita_id: visita?.id || null, datos
  }));
  if (rows.length) await supabase.from('notificaciones').insert(rows);
  broadcast({ tipo: 'notificacion', datos: { tipo, mensaje, visita_id: visita?.id } });
}

async function yaNotificado(visitaId, tipo) {
  const { data } = await supabase
    .from('visita_eventos')
    .select('id')
    .eq('visita_id', visitaId)
    .eq('evento', tipo)
    .limit(1);
  return (data || []).length > 0;
}

// La columna trabajador_estado puede no existir aún en la BD → se detecta una vez
let tieneTrabajadorEstado = null;
async function checkTrabajadorEstado() {
  if (tieneTrabajadorEstado !== null) return tieneTrabajadorEstado;
  const { error } = await supabase.from('visitas').select('trabajador_estado').limit(1);
  tieneTrabajadorEstado = !error;
  return tieneTrabajadorEstado;
}

const TRABAJADOR_ESTADOS = ['en_camino', 'en_domicilio', 'descanso', 'finalizada'];

// Metadata de auth.users (avatar_url, nombre) con caché de 60s
let authUsersCache = { ts: 0, map: new Map() };
async function authUsersMap() {
  if (Date.now() - authUsersCache.ts < 60000 && authUsersCache.map.size) return authUsersCache.map;
  const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const map = new Map();
  for (const u of data?.users || []) map.set(u.id, u.user_metadata || {});
  authUsersCache = { ts: Date.now(), map };
  return map;
}

// Auditoría de consultas a datos de ubicación (throttle 5 min por usuario)
const auditThrottle = new Map();
async function auditarConsulta(req) {
  const ahora = Date.now();
  const ult = auditThrottle.get(req.user.id) || 0;
  if (ahora - ult < 5 * 60 * 1000) return;
  auditThrottle.set(req.user.id, ahora);
  await supabase.from('auditoria_consultas').insert({
    usuario_id: req.user.id,
    usuario_email: req.user.email,
    endpoint: req.originalUrl,
    ip: req.ip || req.headers['x-forwarded-for'] || null
  }).then(() => {}).catch(() => {});
}

app.get('/api/eventos', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write('data: {"tipo":"conectado"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/trabajadores', requireUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('perfiles')
      .select('id, email, nombre, rol')
      .in('rol', ['staff', 'paciente'])
      .eq('estado', 'aprobado')
      .order('nombre');
    if (error) throw error;
    const authMap = await authUsersMap();
    const trabajadores = (data || []).map((t) => ({
      ...t,
      avatar_url: authMap.get(t.id)?.avatar_url || null
    }));
    res.json({ trabajadores });
  } catch (e) {
    console.error('GET trabajadores:', e);
    res.status(500).json({ error: 'Error al obtener trabajadores' });
  }
});

function puedeVerTodas(req) {
  return isAdmin(req) || req.user?.perfil?.rol === 'staff';
}

app.post('/api/visitas', requireUser, async (req, res) => {
  if (!isAdmin(req) && req.user?.perfil?.rol !== 'staff') {
    return res.status(403).json({ error: 'Solo admin/staff puede asignar visitas' });
  }
  try {
    const { paciente_id, trabajador_id, fecha, hora_programada, radio_m, duracion_estimada_min } = req.body || {};
    if (!paciente_id || !fecha) return res.status(400).json({ error: 'paciente_id y fecha son requeridos' });

    // El paciente debe tener coordenadas
    const { data: pac } = await supabase.from('pacientes').select('id, lat, lng, nombre, apellido, direccion').eq('id', paciente_id).single();
    if (!pac) return res.status(404).json({ error: 'Paciente no encontrado' });
    if (pac.lat == null || pac.lng == null) return res.status(400).json({ error: 'El paciente no tiene ubicación georreferenciada' });

    const { data, error } = await supabase
      .from('visitas')
      .insert({
        paciente_id, trabajador_id: trabajador_id || null, fecha,
        hora_programada: hora_programada || null,
        radio_m: radio_m || 50,
        duracion_estimada_min: duracion_estimada_min || 60,
        estado: 'programada', creado_por: req.user.id
      })
      .select()
      .single();
    if (error) throw error;
    await logEvento(data.id, 'asignada', { por: req.user.email });
    res.status(201).json({ visita: data });
  } catch (e) {
    console.error('POST visitas:', e);
    res.status(500).json({ error: 'Error al crear visita' });
  }
});

app.get('/api/visitas', requireUser, async (req, res) => {
  try {
    let q = supabase
      .from('visitas')
      .select('*, pacientes(nombre, apellido, direccion, lat, lng, telefono), perfiles!visitas_trabajador_id_fkey(nombre, email)')
      .order('fecha', { ascending: false })
      .order('hora_programada', { ascending: true })
      .limit(300);
    if (req.query.fecha) q = q.eq('fecha', req.query.fecha);
    if (req.query.estado) q = q.eq('estado', req.query.estado);
    if (!puedeVerTodas(req)) q = q.eq('trabajador_id', req.user.id);
    else if (req.query.trabajador_id) q = q.eq('trabajador_id', req.query.trabajador_id);
    const { data, error } = await q;
    if (error) throw error;
    if (puedeVerTodas(req)) {
      monitorVisitasThrottled(); // el mapa del admin hace polling: dispara el monitor
      auditarConsulta(req); // quién consulta ubicaciones de trabajadores
      const authMap = await authUsersMap();
      for (const v of data || []) {
        const meta = authMap.get(v.trabajador_id) || {};
        if (v.perfiles) {
          v.perfiles.avatar_url = meta.avatar_url || null;
          if (!v.perfiles.nombre && meta.nombre) v.perfiles.nombre = meta.nombre;
        }
      }
    }
    res.json({ visitas: data });
  } catch (e) {
    console.error('GET visitas:', e);
    res.status(500).json({ error: 'Error al obtener visitas' });
  }
});

app.patch('/api/visitas/:id', requireUser, async (req, res) => {
  try {
    const { data: v } = await supabase.from('visitas').select('*').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
    const esPropia = v.trabajador_id === req.user.id;
    if (!esPropia && !puedeVerTodas(req)) return res.status(403).json({ error: 'Sin permiso' });

    const { estado, hora_programada, trabajador_id, duracion_estimada_min, trabajador_estado } = req.body || {};
    const update = {};
    if (trabajador_estado && TRABAJADOR_ESTADOS.includes(trabajador_estado) && (puedeVerTodas(req) || esPropia)) {
      if (await checkTrabajadorEstado()) update.trabajador_estado = trabajador_estado;
    }
    if (estado && ['programada', 'cancelada'].includes(estado) && (puedeVerTodas(req) || esPropia)) update.estado = estado;
    if (puedeVerTodas(req)) {
      if (hora_programada) update.hora_programada = hora_programada;
      if (trabajador_id !== undefined) update.trabajador_id = trabajador_id || null;
      if (duracion_estimada_min) update.duracion_estimada_min = Number(duracion_estimada_min);
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });
    const { data, error } = await supabase.from('visitas').update(update).eq('id', v.id).select().single();
    if (error) throw error;
    if (update.estado === 'cancelada') await logEvento(v.id, 'cancelada', { por: req.user.email });
    res.json({ visita: data });
  } catch (e) {
    console.error('PATCH visita:', e);
    res.status(500).json({ error: 'Error al actualizar visita' });
  }
});

// Ping GPS del trabajador — detecta llegada/salida automáticamente
app.post('/api/visitas/:id/ping', requireUser, async (req, res) => {
  try {
    const { lat, lng, trabajador_estado } = req.body || {};
    if (lat == null || lng == null) return res.status(400).json({ error: 'lat y lng requeridos' });
    const la = Number(lat), ln = Number(lng);
    if (Math.abs(la) > 90 || Math.abs(ln) > 180) return res.status(400).json({ error: 'Coordenadas inválidas' });

    const { data: v } = await supabase.from('visitas').select('*').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
    if (v.trabajador_id && v.trabajador_id !== req.user.id && !puedeVerTodas(req)) {
      return res.status(403).json({ error: 'Esta visita no está asignada a ti' });
    }
    if (['finalizada', 'cancelada', 'no_show'].includes(v.estado)) {
      return res.status(400).json({ error: `La visita está ${v.estado}` });
    }

    const { data: pac } = await supabase.from('pacientes').select('nombre, apellido, direccion, lat, lng').eq('id', v.paciente_id).single();
    if (!pac || pac.lat == null) return res.status(400).json({ error: 'Paciente sin georreferencia' });

    monitorVisitasThrottled(); // actividad GPS real: aprovecha para correr el monitor

    const d = distanciaM(la, ln, pac.lat, pac.lng);
    const ahora = new Date();
    const radio = v.radio_m || 50;
    const dentro = d <= radio;
    const update = {
      ultima_ubicacion_lat: la,
      ultima_ubicacion_lng: ln,
      ultima_ping_at: ahora.toISOString()
    };
    if (trabajador_estado && TRABAJADOR_ESTADOS.includes(trabajador_estado) && await checkTrabajadorEstado()) {
      update.trabajador_estado = trabajador_estado;
    }
    let eventoNuevo = null;

    if (dentro) {
      update.ultima_dentro_at = ahora.toISOString();
      if (!v.llegada_at) {
        update.llegada_at = ahora.toISOString();
        update.llegada_lat = la;
        update.llegada_lng = ln;
        update.estado = 'en_curso';
        eventoNuevo = { tipo: 'llegada', mensaje: `Llegada al domicilio` };
      }
    } else if (v.llegada_at && !v.salida_at && v.ultima_dentro_at) {
      // Anti-falsos-positivos: exige 3 min fuera del radio para confirmar salida
      const msFuera = ahora - new Date(v.ultima_dentro_at);
      if (msFuera > 3 * 60 * 1000) {
        update.salida_at = ahora.toISOString();
        update.salida_lat = la;
        update.salida_lng = ln;
        update.estado = 'finalizada';
        const durMin = Math.round((ahora - new Date(v.llegada_at)) / 60000);
        eventoNuevo = { tipo: 'salida', mensaje: `Salida del domicilio — ${durMin} min de atención`, duracion_min: durMin };
      }
    }

    const { data: nv, error } = await supabase.from('visitas').update(update).eq('id', v.id).select().single();
    if (error) throw error;

    if (eventoNuevo) {
      await logEvento(v.id, eventoNuevo.tipo, { lat: la, lng: ln, distancia_m: Math.round(d), ...eventoNuevo });
      const quien = req.user.email;
      const pacNom = `${pac.nombre || ''} ${pac.apellido || ''}`.trim();
      const dir = pac.direccion || `${pac.lat},${pac.lng}`;
      await notifyAdmins(
        eventoNuevo.tipo,
        `${quien} — ${eventoNuevo.tipo === 'llegada' ? 'llegó a' : 'salió de'} la visita de ${pacNom} (${dir})`,
        nv,
        { trabajador: quien, paciente: pacNom, direccion: dir, lat: la, lng: ln, distancia_m: Math.round(d), ...(eventoNuevo.duracion_min ? { duracion_min: eventoNuevo.duracion_min } : {}) }
      );
    }

    res.json({
      distancia_m: Math.round(d),
      dentro,
      estado: nv.estado,
      llegada_at: nv.llegada_at,
      salida_at: nv.salida_at
    });
  } catch (e) {
    console.error('ping:', e);
    res.status(500).json({ error: 'Error al registrar ubicación' });
  }
});

// Historial con duración calculada
app.get('/api/visitas/historial', requireUser, async (req, res) => {
  try {
    let q = supabase
      .from('visitas')
      .select('*, pacientes(nombre, apellido, direccion), perfiles!visitas_trabajador_id_fkey(nombre, email)')
      .in('estado', ['finalizada', 'en_curso', 'no_show'])
      .order('fecha', { ascending: false })
      .limit(500);
    if (req.query.fecha) q = q.eq('fecha', req.query.fecha);
    if (req.query.trabajador_id && puedeVerTodas(req)) q = q.eq('trabajador_id', req.query.trabajador_id);
    if (req.query.paciente_id) q = q.eq('paciente_id', req.query.paciente_id);
    if (!puedeVerTodas(req)) q = q.eq('trabajador_id', req.user.id);
    const { data, error } = await q;
    if (error) throw error;
    const visitas = (data || []).map((v) => ({
      ...v,
      duracion_min:
        v.llegada_at && v.salida_at
          ? Math.round((new Date(v.salida_at) - new Date(v.llegada_at)) / 60000)
          : null
    }));
    res.json({ visitas });
  } catch (e) {
    console.error('historial:', e);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// Export CSV (compatible con Excel)
app.get('/api/visitas/export', requireUser, async (req, res) => {
  if (!puedeVerTodas(req)) return res.status(403).json({ error: 'Solo admin/staff' });
  try {
    let q = supabase
      .from('visitas')
      .select('*, pacientes(nombre, apellido, direccion), perfiles!visitas_trabajador_id_fkey(nombre, email)')
      .order('fecha', { ascending: false })
      .limit(2000);
    if (req.query.fecha) q = q.eq('fecha', req.query.fecha);
    if (req.query.trabajador_id) q = q.eq('trabajador_id', req.query.trabajador_id);
    const { data, error } = await q;
    if (error) throw error;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = (data || []).map((v) => [
      v.fecha, v.hora_programada || '', v.pacientes ? `${v.pacientes.nombre} ${v.pacientes.apellido}` : '',
      v.pacientes?.direccion || '', v.perfiles?.nombre || v.perfiles?.email || '', v.estado,
      v.llegada_at || '', v.salida_at || '',
      v.llegada_at && v.salida_at ? Math.round((new Date(v.salida_at) - new Date(v.llegada_at)) / 60000) : ''
    ]);
    const csv = ['Fecha;Hora prog.;Paciente;Direccion;Trabajador;Estado;Llegada;Salida;Duracion_min',
      ...rows.map((r) => r.map(esc).join(';'))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="visitas_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + csv); // BOM para Excel
  } catch (e) {
    console.error('export:', e);
    res.status(500).json({ error: 'Error al exportar' });
  }
});

// Dashboard admin
app.get('/api/dashboard', requireUser, async (req, res) => {
  if (!puedeVerTodas(req)) return res.status(403).json({ error: 'Solo admin/staff' });
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const { data: visitas } = await supabase.from('visitas').select('*').eq('fecha', hoy);
    const vs = visitas || [];
    const enCurso = vs.filter((v) => v.estado === 'en_curso');
    const finalizadas = vs.filter((v) => v.estado === 'finalizada' && v.llegada_at && v.salida_at);
    const durs = finalizadas.map((v) => (new Date(v.salida_at) - new Date(v.llegada_at)) / 60000);
    res.json({
      fecha: hoy,
      programadas_hoy: vs.filter((v) => v.estado === 'programada').length,
      en_curso: enCurso.length,
      finalizadas_hoy: finalizadas.length,
      trabajadores_activos: new Set(enCurso.map((v) => v.trabajador_id).filter(Boolean)).size,
      tiempo_promedio_min: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null
    });
  } catch (e) {
    console.error('dashboard:', e);
    res.status(500).json({ error: 'Error en dashboard' });
  }
});

// Notificaciones
app.get('/api/notificaciones', requireUser, async (req, res) => {
  try {
    let q = supabase
      .from('notificaciones')
      .select('*')
      .or(`destinatario_id.eq.${req.user.id},destinatario_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (req.query.no_leidas === '1') q = q.eq('leida', false);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ notificaciones: data });
  } catch (e) {
    console.error('GET notificaciones:', e);
    res.status(500).json({ error: 'Error al obtener notificaciones' });
  }
});

app.post('/api/notificaciones/:id/leida', requireUser, async (req, res) => {
  await supabase.from('notificaciones').update({ leida: true }).eq('id', req.params.id);
  res.json({ ok: true });
});

app.post('/api/notificaciones/leer-todas', requireUser, async (req, res) => {
  await supabase.from('notificaciones').update({ leida: true }).eq('destinatario_id', req.user.id).eq('leida', false);
  res.json({ ok: true });
});

// ---------- Monitor de retrasos / no-show / tiempo excedido ----------
async function monitorVisitas() {
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const ahora = new Date();
    const { data: pendientes } = await supabase
      .from('visitas')
      .select('id, hora_programada, llegada_at, estado, duracion_estimada_min, paciente_id')
      .eq('fecha', hoy)
      .in('estado', ['programada', 'en_curso']);
    for (const v of pendientes || []) {
      if (v.estado === 'programada' && v.hora_programada) {
        const [h, m] = v.hora_programada.split(':').map(Number);
        const prog = new Date(`${hoy}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
        const minutosTarde = (ahora - prog) / 60000;
        if (minutosTarde > 15 && !(await yaNotificado(v.id, 'retraso'))) {
          await logEvento(v.id, 'retraso', { minutos_tarde: Math.round(minutosTarde) });
          await notifyAdmins('retraso', `Visita programada hace ${Math.round(minutosTarde)} min sin llegada del trabajador`, v, { minutos_tarde: Math.round(minutosTarde) });
        }
      }
      if (v.estado === 'en_curso' && v.llegada_at) {
        const limite = (v.duracion_estimada_min || 60) + 30;
        const transcurrido = (ahora - new Date(v.llegada_at)) / 60000;
        if (transcurrido > limite && !(await yaNotificado(v.id, 'tiempo_excedido'))) {
          await logEvento(v.id, 'tiempo_excedido', { minutos: Math.round(transcurrido), limite });
          await notifyAdmins('tiempo_excedido', `La visita supera el tiempo estimado (${Math.round(transcurrido)} min)`, v, { minutos: Math.round(transcurrido) });
        }
      }
    }
  } catch (e) {
    console.error('monitor visitas:', e);
  }
}

// En serverless no hay setInterval confiable: se dispara con throttle desde
// eventos reales (ping GPS del trabajador, polling del mapa del admin)
let _monitorLastRun = 0;
function monitorVisitasThrottled() {
  const now = Date.now();
  if (now - _monitorLastRun < 60 * 1000) return;
  _monitorLastRun = now;
  monitorVisitas().catch((e) => console.error('monitor throttled:', e));
}

// En Vercel el cron de Hobby solo corre 1 vez al día; el monitoreo fino
// ocurre aquí, disparado por la actividad GPS real
app.post('/api/cron/monitor', async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  await monitorVisitas();
  res.json({ ok: true });
});

// ---------- Google Drive: un solo documento ----------
async function appendToDriveDoc(p) {
  if (!process.env.GOOGLE_DRIVE_DOC_ID) return;
  const docs = getDrive();
  const line = `\nPaciente: ${p.nombre} ${p.apellido} | Edad: ${p.cedula || 'N/A'} | Tel: ${p.telefono || 'N/A'} | Servicio: ${p.tipo_servicio || 'N/A'} | Inicio: ${p.fecha_inicio || 'N/A'} | Término: ${p.fecha_termino || 'N/A'} | Estado: ${p.estado} | Fecha: ${new Date().toISOString()}\n${p.descripcion || ''}`;
  await docs.documents.batchUpdate({
    documentId: process.env.GOOGLE_DRIVE_DOC_ID,
    requestBody: {
      requests: [{ insertText: { endOfSegmentLocation: {}, text: line } }]
    }
  });
}

// ---------- Notas de atención del empleado ----------
app.post('/api/visitas/:id/nota', requireUser, async (req, res) => {
  try {
    const { data: v } = await supabase.from('visitas').select('*').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
    const esPropia = v.trabajador_id === req.user.id;
    if (!esPropia && !puedeVerTodas(req)) return res.status(403).json({ error: 'Solo el trabajador asignado' });
    const campos = ['actividades', 'observaciones', 'evolucion', 'incidencias', 'recomendaciones', 'material'];
    const nota = {};
    for (const c of campos) if (req.body[c] != null) nota[c] = String(req.body[c]).slice(0, 4000);
    if (!Object.keys(nota).length) return res.status(400).json({ error: 'Escribe al menos un campo' });
    const { data, error } = await supabase.from('notas_atencion').insert({
      visita_id: v.id, paciente_id: v.paciente_id, trabajador_id: req.user.id, ...nota
    }).select().single();
    if (error) throw error;
    await logEvento(v.id, 'nota_atencion', { por: req.user.email });
    res.status(201).json({ nota: data });
  } catch (e) {
    console.error('POST nota:', e);
    res.status(500).json({ error: 'Error al guardar nota' });
  }
});

app.get('/api/visitas/:id/notas', requireUser, async (req, res) => {
  try {
    const { data: v } = await supabase.from('visitas').select('trabajador_id').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
    if (v.trabajador_id !== req.user.id && !puedeVerTodas(req)) return res.status(403).json({ error: 'Sin permiso' });
    const { data, error } = await supabase.from('notas_atencion').select('*').eq('visita_id', req.params.id).order('created_at');
    if (error) throw error;
    res.json({ notas: data });
  } catch (e) {
    console.error('GET notas:', e);
    res.status(500).json({ error: 'Error al obtener notas' });
  }
});

// ---------- Incidencias de GPS reportadas por el trabajador ----------
app.post('/api/visitas/:id/incidencia-gps', requireUser, async (req, res) => {
  try {
    const { data: v } = await supabase.from('visitas').select('*').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
    const esPropia = v.trabajador_id === req.user.id;
    if (!esPropia && !puedeVerTodas(req)) return res.status(403).json({ error: 'Solo el trabajador asignado' });
    const descripcion = String(req.body?.descripcion || '').slice(0, 1000);
    const { data, error } = await supabase.from('incidencias_gps').insert({
      visita_id: v.id, trabajador_id: req.user.id, descripcion
    }).select().single();
    if (error) throw error;
    await logEvento(v.id, 'incidencia_gps', { por: req.user.email, descripcion });
    await notifyAdmins('incidencia', `${req.user.email} reportó un problema de GPS en una visita`, v, { descripcion });
    res.status(201).json({ incidencia: data });
  } catch (e) {
    console.error('POST incidencia:', e);
    res.status(500).json({ error: 'Error al reportar incidencia' });
  }
});

// ---------- Paquetes / servicios gerontológicos ----------
app.get('/api/paquetes', requireUser, async (req, res) => {
  if (!isApproved(req)) return res.status(403).json({ error: 'Cuenta pendiente' });
  try {
    const { data, error } = await supabase.from('paquetes').select('*').order('nombre');
    if (error) throw error;
    res.json({ paquetes: data });
  } catch (e) {
    res.status(500).json({ error: 'Error al obtener paquetes' });
  }
});

app.post('/api/paquetes', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { nombre, descripcion, precio, duracion_min, activo = true } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
    const { data, error } = await supabase.from('paquetes').insert({
      nombre: String(nombre).slice(0, 200), descripcion: String(descripcion || '').slice(0, 2000),
      precio: precio != null ? Number(precio) : null, duracion_min: duracion_min != null ? Number(duracion_min) : null,
      activo: !!activo
    }).select().single();
    if (error) throw error;
    res.status(201).json({ paquete: data });
  } catch (e) {
    res.status(500).json({ error: 'Error al crear paquete' });
  }
});

app.patch('/api/paquetes/:id', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const update = {};
    for (const f of ['nombre', 'descripcion']) if (req.body[f] != null) update[f] = String(req.body[f]).slice(0, 2000);
    if (req.body.precio != null) update.precio = Number(req.body.precio);
    if (req.body.duracion_min != null) update.duracion_min = Number(req.body.duracion_min);
    if (req.body.activo != null) update.activo = !!req.body.activo;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });
    const { data, error } = await supabase.from('paquetes').update(update).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ paquete: data });
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar paquete' });
  }
});

// ---------- Recuperación de contraseña por código ----------
app.post('/api/auth/recuperar', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email requerido' });
    const user = await findAuthUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'Cuenta no encontrada' });
    const codigo = nuevoCodigo();
    await setVerifMeta(user.id, {
      recup_hash: hashCodigo(codigo), recup_exp: Date.now() + CODE_TTL_MS, recup_intentos: 0
    });
    const enviado = await enviarCodigo(email, codigo).catch(() => false);
    const resp = { ok: true };
    if (!enviado && process.env.NODE_ENV !== 'production') resp.dev_codigo = codigo;
    res.json(resp);
  } catch (e) {
    console.error('recuperar:', e);
    res.status(500).json({ error: 'Error al enviar código' });
  }
});

app.post('/api/auth/restablecer', async (req, res) => {
  try {
    const { email, codigo, password } = req.body || {};
    if (!email || !codigo || !password || password.length < 6) {
      return res.status(400).json({ error: 'Email, código y contraseña (mín. 6) requeridos' });
    }
    const user = await findAuthUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'Cuenta no encontrada' });
    const meta = user.user_metadata || {};
    if (!meta.recup_hash || Date.now() > meta.recup_exp || (meta.recup_intentos || 0) >= CODE_MAX_INTENTOS) {
      return res.status(400).json({ error: 'Código inválido o vencido. Solicita uno nuevo.' });
    }
    if (hashCodigo(String(codigo).trim()) !== meta.recup_hash) {
      await setVerifMeta(user.id, { recup_intentos: (meta.recup_intentos || 0) + 1 });
      return res.status(400).json({ error: 'Código incorrecto' });
    }
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
    await setVerifMeta(user.id, { recup_hash: null, recup_exp: null, recup_intentos: 0 });
    res.json({ ok: true });
  } catch (e) {
    console.error('restablecer:', e);
    res.status(500).json({ error: 'Error al restablecer contraseña' });
  }
});

// ---------- Frontend estático (solo en ejecución local; en Vercel el web es otro servicio) ----------
const webBuild = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/build');
if (existsSync(webBuild)) {
  app.use(express.static(webBuild));
  // SPA fallback: cualquier ruta que no sea /api devuelve index.html
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webBuild, 'index.html')));
}

export default app;

// Solo escuchar en ejecución local (node src/index.js); en Vercel se exporta como función
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  setInterval(monitorVisitas, 60 * 1000);
  app.listen(PORT, () => console.log(`Servidor único en http://localhost:${PORT} (API + frontend)`));
}
