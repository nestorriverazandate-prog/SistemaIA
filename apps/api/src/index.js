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
import twilio from 'twilio';
import { readFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { resolveMx } from 'node:dns/promises';

const app = express();
const PORT = process.env.PORT || 3001;
// Cuenta única con permiso de rol Directivo (admin)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'nestorriverazandate@gmail.com';
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto-en-produccion';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim());

app.use(express.json({ limit: '12mb' }));
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
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutos
const CODE_MAX_INTENTOS = 5;

// ---------- Validación real de correo ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOMINIOS_BLOQUEADOS = new Set([
  'mailinator.com', 'tempmail.com', 'temp-mail.org', '10minutemail.com',
  'guerrillamail.com', 'guerrillamail.net', 'yopmail.com', 'throwawaymail.com',
  'sharklasers.com', 'getnada.com', 'maildrop.cc', 'dispostable.com',
  'fakeinbox.com', 'mintemail.com', 'tempr.email', 'trashmail.com',
  'mailnesia.com', 'mohmal.com', 'emailondeck.com', 'throwam.com'
]);

async function validarEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { ok: false, error: 'Formato de correo inválido' };
  const dominio = e.split('@')[1];
  if (DOMINIOS_BLOQUEADOS.has(dominio)) {
    return { ok: false, error: 'No se permiten correos temporales o desechables' };
  }
  try {
    const mx = await resolveMx(dominio);
    if (!mx || !mx.length) return { ok: false, error: 'El dominio del correo no puede recibir mensajes' };
  } catch {
    return { ok: false, error: 'El dominio del correo no existe o no recibe correo' };
  }
  return { ok: true, email: e };
}

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
        <p style="color:#5f767f;font-size:13px">Vence en 15 minutos. Si no creaste esta cuenta, ignora este mensaje.</p>
      </div>`
  });
  return true;
}

async function generarYEnviarCodigo(userId, email) {
  const codigo = nuevoCodigo();
  const enviado = await enviarCodigo(email, codigo).catch((e) => {
    console.error('enviarCodigo:', e);
    return false;
  });
  await setVerifMeta(userId, {
    // Si no hay SMTP configurado (o falló el envío), la cuenta queda
    // verificada de inmediato para no bloquear el registro.
    verif_hash: enviado ? hashCodigo(codigo) : null,
    verif_exp: enviado ? Date.now() + CODE_TTL_MS : null,
    verif_intentos: 0,
    verif_ok: !enviado
  });
  return { codigo, enviado };
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, password2, nombre } = req.body || {};
    if (password2 != null && password2 !== password) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' });
    }
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Email válido y contraseña de mínimo 6 caracteres' });
    }
    const v = await validarEmail(email);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { data, error } = await supabase.auth.admin.createUser({
      email: v.email,
      password,
      email_confirm: true,
      user_metadata: { nombre: nombre || '' }
    });
    if (error) {
      const msg = /already|registered|exists/i.test(error.message || '')
        ? 'Ya existe una cuenta con ese correo electrónico'
        : error.message;
      return res.status(400).json({ error: msg });
    }
    const perfil = await ensurePerfil(data.user.id, v.email, nombre || null);
    notifyAdmins('registro', `Nuevo registro: ${nombre || v.email} (${v.email}) creó una cuenta en la plataforma`, null, { email: v.email, nombre: nombre || null }).catch((e) => console.error('notify registro:', e));
    const { codigo, enviado } = await generarYEnviarCodigo(data.user.id, v.email);
    // Sin SMTP el código no llega a ningún lado: devolver sesión directamente
    if (!enviado) {
      return res.json({ token: signToken({ id: data.user.id, email: v.email }), perfil });
    }
    res.json({ requiere_verificacion: true, email: v.email });
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

// Rate limit de inicio de sesión: 5 fallos → bloqueo 15 min por correo
const LOGIN_MAX_FALLOS = 5;
const LOGIN_BLOQUEO_MS = 15 * 60 * 1000;
const loginFallos = new Map(); // email -> { fallos, hasta }

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const clave = String(email || '').trim().toLowerCase();
    const reg = loginFallos.get(clave);
    if (reg?.hasta && Date.now() < reg.hasta) {
      const mins = Math.ceil((reg.hasta - Date.now()) / 60000);
      return res.status(429).json({ error: `Demasiados intentos fallidos. Intenta de nuevo en ${mins} min` });
    }
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      const f = (reg?.fallos || 0) + 1;
      loginFallos.set(clave, { fallos: f, hasta: f >= LOGIN_MAX_FALLOS ? Date.now() + LOGIN_BLOQUEO_MS : 0 });
      return res.status(401).json({ error: 'Correo no registrado o contraseña incorrecta' });
    }
    loginFallos.delete(clave);
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
      notifyAdmins('registro', `Nuevo registro con Google: ${g.name || g.email} (${g.email})`, null, { email: g.email, nombre: g.name || null }).catch((e) => console.error('notify google:', e));
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
const PERFIL_EXPEDIENTE = [
  'telefono', 'domicilio', 'profesion', 'especialidad', 'id_laboral', 'fecha_contratacion', 'estado_laboral',
  // Datos personales
  'fecha_nacimiento', 'sexo', 'curp', 'codigo_postal',
  // Información profesional
  'cedula_profesional', 'institucion', 'cursos', 'experiencia_anos', 'experiencia_previa', 'areas', 'servicios_autorizados',
  // Información laboral
  'puesto', 'tipo_contrato', 'horario', 'dias_disponibles', 'zona', 'sueldo', 'disponibilidad'
];

// Quita de un objeto la columna que Supabase reporta como inexistente
function sinColumnaReportada(obj, errorMsg) {
  const copia = { ...obj };
  const m = /column [`"]?(?:public\.)?\w+\.([a-z_]+)[`"]? does not exist|Could not find the ['"`]([a-z_]+)['"`] column/i.exec(errorMsg || '');
  const col = m && (m[1] || m[2]);
  if (col) delete copia[col];
  return copia;
}

// ---------- Fotografía de perfil del trabajador (bucket privado 'perfiles') ----------
let bucketPerfilesOk = null;
async function asegurarBucketPerfiles() {
  if (bucketPerfilesOk !== null) return bucketPerfilesOk;
  const { error } = await supabase.storage.createBucket('perfiles', { public: false });
  bucketPerfilesOk = !error || /already exists|duplicate/i.test(error.message || '');
  return bucketPerfilesOk;
}

async function subirFotoPerfil(perfilId, dataUrl) {
  const parsed = dataUrlABuffer(dataUrl);
  if (!parsed || parsed.buffer.length > 8 * 1024 * 1024) return null;
  if (!(await asegurarBucketPerfiles())) return null;
  const ext = parsed.mime.includes('png') ? 'png' : 'jpg';
  const path = `${perfilId}/foto.${ext}`;
  await supabase.storage.from('perfiles').remove([`${perfilId}/foto.jpg`, `${perfilId}/foto.png`]).catch(() => {});
  const up = await supabase.storage.from('perfiles').upload(path, parsed.buffer, { contentType: parsed.mime, upsert: true });
  return up.error ? null : path;
}

// Registra en perfiles_historial los campos del expediente que cambiaron
async function logHistorialPerfil(perfilId, antes, despues, actor) {
  try {
    const filas = [];
    for (const f of [...PERFIL_EXPEDIENTE, 'estado_laboral', 'estado', 'rol', 'nombre', 'contactos_emergencia']) {
      const a = JSON.stringify(antes?.[f] ?? null);
      const d = JSON.stringify(despues?.[f] ?? null);
      if (a !== d) filas.push({ perfil_id: perfilId, campo: f, valor_anterior: a, valor_nuevo: d, actor });
    }
    if (filas.length) await supabase.from('perfiles_historial').insert(filas);
  } catch { /* la tabla puede no existir aún */ }
}

app.patch('/api/perfiles/:id', requireUser, async (req, res) => {
  try {
    const esPropio = req.params.id === req.user.id;
    const esAdminUser = isAdmin(req);
    // El empleado solo puede editar sus datos de contacto; el resto es del directivo
    if (!esAdminUser && !esPropio) return res.status(403).json({ error: 'Sin permiso' });

    const { estado, rol } = req.body || {};
    const update = {};
    let antes = null;
    if (esAdminUser) {
      const { data: objetivo } = await supabase.from('perfiles').select('*').eq('id', req.params.id).maybeSingle();
      antes = objetivo;
      // Solo la cuenta designada puede tener rol admin
      if (rol) {
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
      if (req.body.nombre != null) update.nombre = String(req.body.nombre).slice(0, 200);
      for (const f of PERFIL_EXPEDIENTE) if (req.body[f] != null) update[f] = CAMPOS_FECHA.has(f) && req.body[f] === '' ? null : String(req.body[f]).slice(0, 300);
      // Contactos de emergencia: arreglo JSON (máx. 2, uno principal)
      if (Array.isArray(req.body.contactos_emergencia)) {
        const limpios = req.body.contactos_emergencia.slice(0, 2).map((c) => ({
          nombre: String(c.nombre || '').slice(0, 200),
          parentesco: String(c.parentesco || '').slice(0, 100),
          telefono: String(c.telefono || '').slice(0, 50),
          telefono_alt: String(c.telefono_alt || '').slice(0, 50),
          email: String(c.email || '').slice(0, 200),
          domicilio: String(c.domicilio || '').slice(0, 300),
          observaciones: String(c.observaciones || '').slice(0, 500),
          principal: !!c.principal
        }));
        update.contactos_emergencia = limpios;
      }
    } else {
      for (const f of ['telefono', 'domicilio', 'nombre']) if (req.body[f] != null) update[f] = String(req.body[f]).slice(0, f === 'nombre' ? 200 : 300);
    }
    if (!Object.keys(update).length && req.body.foto === undefined) return res.status(400).json({ error: 'Nada que actualizar' });

    let data = null, error = null;
    if (Object.keys(update).length) {
      // Reintenta quitando columnas que la BD aún no tenga
      let payload = update;
      for (let i = 0; i < 25; i++) {
        ({ data, error } = await supabase.from('perfiles').update(payload).eq('id', req.params.id).select().single());
        if (!error) break;
        if (!/does not exist|schema cache|Could not find/i.test(error.message)) break;
        const reducido = sinColumnaReportada(payload, error.message);
        if (JSON.stringify(reducido) === JSON.stringify(payload)) break; // columna no reconocida
        payload = reducido;
      }
      if (error) throw error;
    } else {
      const { data: actual, error: errActual } = await supabase.from('perfiles').select('*').eq('id', req.params.id).single();
      if (errActual) throw errActual;
      data = actual;
    }
    // Fotografía de perfil (dataURL | null para quitar)
    if (req.body.foto !== undefined) {
      if (req.body.foto) {
        const path = await subirFotoPerfil(req.params.id, req.body.foto);
        if (path) {
          await supabase.from('perfiles').update({ avatar_path: path }).eq('id', req.params.id).then(() => {});
          data.avatar_path = path;
        }
      } else {
        const { data: actual } = await supabase.from('perfiles').select('avatar_path').eq('id', req.params.id).maybeSingle();
        if (actual?.avatar_path) {
          await supabase.storage.from('perfiles').remove([actual.avatar_path]).catch(() => {});
          await supabase.from('perfiles').update({ avatar_path: null }).eq('id', req.params.id).then(() => {});
          data.avatar_path = null;
        }
      }
    }
    if (esAdminUser && antes) await logHistorialPerfil(req.params.id, antes, data, req.user.email);
    res.json({ perfil: data });
  } catch (e) {
    console.error('PATCH /api/perfiles:', e);
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

// URL firmada de la foto de perfil (privada; admin o el propio usuario)
app.get('/api/perfiles/:id/foto', requireUser, async (req, res) => {
  try {
    const { data: p } = await supabase.from('perfiles').select('avatar_path').eq('id', req.params.id).maybeSingle();
    if (!p?.avatar_path) return res.status(404).json({ error: 'Sin fotografía' });
    if (!isAdmin(req) && req.params.id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
    const { data, error } = await supabase.storage.from('perfiles').createSignedUrl(p.avatar_path, 3600);
    if (error) throw error;
    res.json({ url: data.signedUrl });
  } catch (e) {
    console.error('GET foto perfil:', e);
    res.status(500).json({ error: 'No se pudo generar el enlace' });
  }
});

// ---------- Directorio del personal (solo directivo) ----------
app.get('/api/directorio', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo puede ver el directorio' });
  try {
    const { data, error } = await supabase
      .from('perfiles')
      .select('*')
      .neq('rol', 'admin')
      .order('nombre');
    if (error) throw error;
    const authMap = await authUsersMap();
    const trabajadores = (data || []).map((t) => ({
      ...t,
      avatar_url: authMap.get(t.id)?.avatar_url || null
    }));
    res.json({ trabajadores });
  } catch (e) {
    console.error('GET /api/directorio:', e);
    res.status(500).json({ error: 'Error al obtener directorio' });
  }
});

// Registrar trabajador: crea la cuenta de acceso y su expediente
app.post('/api/trabajadores', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo puede registrar trabajadores' });
  try {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const nombre = String(b.nombre || '').trim();
    if (!email || !password || !nombre) return res.status(400).json({ error: 'nombre, email y contraseña son requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const rol = ['staff', 'paciente', 'familiar', 'cuidador'].includes(b.rol) ? b.rol : 'staff';

    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true
    });
    if (authErr) return res.status(400).json({ error: authErr.message || 'No se pudo crear la cuenta' });
    const uid = authData.user.id;

    const perfil = { id: uid, email, nombre, estado: 'aprobado', rol };
    for (const f of PERFIL_EXPEDIENTE) if (b[f] != null) perfil[f] = CAMPOS_FECHA.has(f) && b[f] === '' ? null : String(b[f]).slice(0, 300);
    if (Array.isArray(b.contactos_emergencia)) perfil.contactos_emergencia = b.contactos_emergencia.slice(0, 2);

    let data = null, error = null, payload = perfil;
    for (let i = 0; i < 25; i++) {
      ({ data, error } = await supabase.from('perfiles').insert(payload).select().single());
      if (!error) break;
      if (!/does not exist|schema cache|Could not find/i.test(error.message)) break;
      const reducido = sinColumnaReportada(payload, error.message);
      if (JSON.stringify(reducido) === JSON.stringify(payload)) break;
      payload = reducido;
    }
    if (error) {
      await supabase.auth.admin.deleteUser(uid).catch(() => {});
      throw error;
    }
    res.status(201).json({ trabajador: data });
  } catch (e) {
    console.error('POST /api/trabajadores:', e);
    res.status(500).json({ error: 'Error al registrar trabajador' });
  }
});

// Dar de baja / eliminar trabajador (solo directivo, con confirmación en UI)
app.delete('/api/trabajadores/:id', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo puede eliminar trabajadores' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  try {
    const { data: obj } = await supabase.from('perfiles').select('email').eq('id', req.params.id).maybeSingle();
    if (obj?.email === ADMIN_EMAIL) return res.status(403).json({ error: 'La cuenta administradora no puede eliminarse' });
    await supabase.from('perfiles').delete().eq('id', req.params.id);
    await supabase.auth.admin.deleteUser(req.params.id).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/trabajadores:', e);
    res.status(500).json({ error: 'Error al eliminar trabajador' });
  }
});

// Historial de modificaciones del expediente
app.get('/api/perfiles/:id/historial', requireUser, async (req, res) => {
  const esPropio = req.params.id === req.user.id;
  if (!isAdmin(req) && !esPropio) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { data, error } = await supabase
      .from('perfiles_historial')
      .select('*')
      .eq('perfil_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.json({ historial: [] }); // tabla puede no existir aún
    res.json({ historial: data || [] });
  } catch (e) {
    console.error('GET historial:', e);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// ---------- Pacientes ----------
const PATIENT_FIELDS = ['nombre', 'apellido', 'cedula', 'telefono', 'email', 'direccion', 'tipo_servicio', 'descripcion', 'fecha_solicitud', 'fecha_inicio', 'fecha_termino', 'contacto_emergencia', 'telefono_emergencia', 'qr_token', 'paquete_id', 'frecuencia_visitas', 'profesional_asignado', 'diagnostico', 'antecedentes', 'objetivos', 'plan_atencion', 'zona'];
// Columnas opcionales: si la BD aún no las tiene, se reintenta sin ellas
const PATIENT_OPTIONALES = ['fecha_inicio', 'fecha_termino', 'contacto_emergencia', 'telefono_emergencia', 'paquete_id', 'frecuencia_visitas', 'profesional_asignado', 'diagnostico', 'antecedentes', 'objetivos', 'plan_atencion', 'zona'];
// Campos de fecha: '' del formulario se guarda como null
const CAMPOS_FECHA = new Set(['fecha_solicitud', 'fecha_inicio', 'fecha_termino', 'fecha_contratacion', 'fecha_nacimiento']);

// Quita del payload la columna que Supabase reporta como inexistente.
// Acepta cualquier columna; si no la identifica, quita las opcionales conocidas.
function sinColumnaFaltante(p, errorMsg) {
  const copia = { ...p };
  const m = /column [`"]?(?:public\.)?\w+\.([a-z_]+)[`"]? does not exist|Could not find the ['"`]([a-z_]+)['"`] column/i.exec(errorMsg || '');
  const col = m && (m[1] || m[2]);
  if (col && copia[col] !== undefined) { delete copia[col]; return copia; }
  for (const f of [...PATIENT_OPTIONALES, 'qr_token', 'qr_activo', 'lat', 'lng', 'user_id', 'registrado_por', 'foto_path']) delete copia[f];
  return copia;
}

// Ejecuta fn(payload) reintentando sin las columnas que la BD reporta inexistentes.
// Devuelve { data, error, payload, vacio } — vacio=true si no quedó nada que actualizar.
async function conReintentoColumnas(fn, payloadInicial) {
  let payload = payloadInicial;
  let ultimo = null;
  for (let i = 0; i < 25; i++) {
    if (!Object.keys(payload).length) return { data: null, error: null, payload, vacio: true };
    ultimo = await fn(payload);
    if (!ultimo.error || !/does not exist|schema cache|Could not find/i.test(ultimo.error.message)) {
      return { ...ultimo, payload, vacio: false };
    }
    const reducido = sinColumnaFaltante(payload, ultimo.error.message);
    if (JSON.stringify(reducido) === JSON.stringify(payload)) return { ...ultimo, payload, vacio: false };
    payload = reducido;
  }
  return { ...(ultimo || {}), payload, vacio: false };
}

function sanitizePatient(body) {
  const p = {};
  for (const f of PATIENT_FIELDS) if (body[f] != null) p[f] = String(body[f]).slice(0, 500);
  if (body.qr_activo != null) p.qr_activo = body.qr_activo === true || body.qr_activo === 'true';
  // Fechas vacías del formulario → null (Postgres rechaza '')
  for (const f of CAMPOS_FECHA) if (p[f] === '') p[f] = null;
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

// ---------- Fotografía del paciente (Supabase Storage privado 'pacientes') ----------
let bucketPacientesOk = null;
async function asegurarBucketPacientes() {
  if (bucketPacientesOk !== null) return bucketPacientesOk;
  const { error } = await supabase.storage.createBucket('pacientes', { public: false });
  bucketPacientesOk = !error || /already exists|duplicate/i.test(error.message || '');
  return bucketPacientesOk;
}

// Sube (o reemplaza) la foto del paciente; devuelve el storage_path o null
async function subirFotoPaciente(pacienteId, dataUrl) {
  const parsed = dataUrlABuffer(dataUrl);
  if (!parsed || parsed.buffer.length > 8 * 1024 * 1024) return null;
  if (!(await asegurarBucketPacientes())) return null;
  const ext = parsed.mime.includes('png') ? 'png' : 'jpg';
  const path = `${pacienteId}/foto.${ext}`;
  // Eliminar versión anterior con otra extensión si existe
  await supabase.storage.from('pacientes').remove([`${pacienteId}/foto.jpg`, `${pacienteId}/foto.png`]).catch(() => {});
  const up = await supabase.storage.from('pacientes').upload(path, parsed.buffer, { contentType: parsed.mime, upsert: true });
  return up.error ? null : path;
}

app.post('/api/pacientes', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo puede registrar pacientes' });
  try {
    const p = sanitizePatient(req.body);
    if (!p.nombre || !p.apellido) return res.status(400).json({ error: 'nombre y apellido son requeridos' });
    // QR único del domicilio: se genera una sola vez y se conserva
    if (!p.qr_token) p.qr_token = `AGI-${randomBytes(8).toString('hex').toUpperCase()}`;
    if (p.qr_activo == null) p.qr_activo = true;

    const base = { ...p, estado: 'pendiente', user_id: req.user.id, registrado_por: req.user.email };
    const { data, error } = await conReintentoColumnas(
      (payload) => supabase.from('pacientes').insert(payload).select().single(),
      base
    );
    if (error) throw error;

    // Fotografía (si se envió) → Storage privado + foto_path
    if (req.body.foto) {
      const path = await subirFotoPaciente(data.id, req.body.foto);
      if (path) {
        await supabase.from('pacientes').update({ foto_path: path }).eq('id', data.id).then(() => {});
        data.foto_path = path;
      }
    }

    broadcast({ tipo: 'paciente', datos: { id: data.id } });
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
    // El empleado solo ve pacientes que tiene asignados en visitas vigentes
    if (!isAdmin(req)) {
      const { data: misVisitas } = await supabase
        .from('visitas').select('paciente_id, estado').eq('trabajador_id', req.user.id);
      const ids = new Set((misVisitas || []).filter((v) => !['cancelada', 'no_show'].includes(v.estado)).map((v) => v.paciente_id));
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
    const resUpdate = await conReintentoColumnas(
      (payload) => supabase.from('pacientes').update(payload).eq('id', req.params.id).select().single(),
      update
    );
    if (resUpdate.error) throw resUpdate.error;
    // Si todas las columnas enviadas no existen aún en la BD, devolver el registro actual
    if (resUpdate.vacio) {
      const { data: actual } = await supabase.from('pacientes').select('*').eq('id', req.params.id).single();
      return res.json({ paciente: actual });
    }
    // Fotografía nueva o eliminada (foto: dataURL | null | '')
    if (req.body.foto !== undefined) {
      if (req.body.foto) {
        const path = await subirFotoPaciente(req.params.id, req.body.foto);
        if (path) {
          await supabase.from('pacientes').update({ foto_path: path }).eq('id', req.params.id).then(() => {});
          resUpdate.data.foto_path = path;
        }
      } else if (req.body.foto === null || req.body.foto === '') {
        const { data: actual } = await supabase.from('pacientes').select('foto_path').eq('id', req.params.id).maybeSingle();
        if (actual?.foto_path) {
          await supabase.storage.from('pacientes').remove([actual.foto_path]).catch(() => {});
          await supabase.from('pacientes').update({ foto_path: null }).eq('id', req.params.id).then(() => {});
          resUpdate.data.foto_path = null;
        }
      }
    }
    broadcast({ tipo: 'paciente', datos: { id: req.params.id } });
    res.json({ paciente: resUpdate.data });
  } catch (e) {
    console.error('PATCH paciente:', e);
    res.status(500).json({ error: 'Error al actualizar paciente' });
  }
});

// Mis pacientes del empleado: asignados + paquete + próxima visita (solo staff)
app.get('/api/mis-pacientes', requireUser, async (req, res) => {
  try {
    if (isAdmin(req)) return res.status(403).json({ error: 'Usa el directorio de pacientes' });
    if (!['staff', 'cuidador', 'familiar'].includes(req.user?.perfil?.rol)) return res.status(403).json({ error: 'Solo personal empleado' });
    if (req.user?.perfil?.estado && req.user.perfil.estado !== 'aprobado') return res.status(403).json({ error: 'Cuenta pendiente de aprobación' });
    const { data: vs } = await supabase.from('visitas').select('paciente_id, estado').eq('trabajador_id', req.user.id);
    const ids = [...new Set((vs || []).filter((v) => !['cancelada', 'no_show'].includes(v.estado)).map((v) => v.paciente_id).filter(Boolean))];
    if (!ids.length) return res.json({ pacientes: [] });
    const [{ data: pacs }, { data: paquetes }, { data: proxVisitas }] = await Promise.all([
      supadeStrictPacientes(ids),
      supabase.from('paquetes').select('id, nombre, precio, servicios, duracion_min').eq('activo', true),
      supabase.from('visitas').select('id, paciente_id, fecha, hora_programada, estado').in('paciente_id', ids).eq('trabajador_id', req.user.id).gte('fecha', new Date().toISOString().slice(0, 10)).in('estado', ['programada', 'en_curso']).order('fecha').order('hora_programada').limit(200)
    ]);
    const proxPorPac = {};
    for (const v of proxVisitas || []) if (!proxPorPac[v.paciente_id]) proxPorPac[v.paciente_id] = v;
    const lista = (pacs || []).map((p) => ({
      ...p,
      paquete: (paquetes || []).find((k) => k.id === p.paquete_id) || null,
      proxima_visita: proxPorPac[p.id] || null
    }));
    res.json({ pacientes: lista });
  } catch (e) {
    console.error('GET /api/mis-pacientes:', e);
    res.status(500).json({ error: 'Error al obtener pacientes' });
  }
});

async function supadeStrictPacientes(ids) {
  const { data } = await supabase.from('pacientes').select('*').in('id', ids).limit(300);
  return data;
}

// URL firmada de la foto del paciente (privada; admin o empleado con visita asignada)
app.get('/api/pacientes/:id/foto', requireUser, async (req, res) => {
  try {
    const { data: p } = await supabase.from('pacientes').select('foto_path').eq('id', req.params.id).maybeSingle();
    if (!p?.foto_path) return res.status(404).json({ error: 'Sin fotografía' });
    if (!isAdmin(req)) {
      const { data: v } = await supabase.from('visitas').select('id, estado').eq('paciente_id', req.params.id).eq('trabajador_id', req.user.id).limit(5);
      if (!(v || []).some((x) => !['cancelada', 'no_show'].includes(x.estado))) return res.status(403).json({ error: 'Sin permiso' });
    }
    const { data, error } = await supabase.storage.from('pacientes').createSignedUrl(p.foto_path, 3600);
    if (error) throw error;
    res.json({ url: data.signedUrl });
  } catch (e) {
    console.error('GET foto paciente:', e);
    res.status(500).json({ error: 'No se pudo generar el enlace' });
  }
});

// Expediente completo: paciente + visitas + notas de evolución + evidencias
app.get('/api/pacientes/:id/expediente', requireUser, async (req, res) => {
  try {
    const { data: p } = await supabase.from('pacientes').select('*').eq('id', req.params.id).maybeSingle();
    if (!p) return res.status(404).json({ error: 'Paciente no encontrado' });
    if (!isAdmin(req) && !['staff', 'cuidador', 'familiar'].includes(req.user?.perfil?.rol)) return res.status(403).json({ error: 'Sin permiso' });
    if (!isAdmin(req)) {
      const { data: v } = await supabase.from('visitas').select('id, estado').eq('paciente_id', req.params.id).eq('trabajador_id', req.user.id).limit(5);
      if (!(v || []).some((x) => !['cancelada', 'no_show'].includes(x.estado))) return res.status(403).json({ error: 'Paciente no asignado' });
    }
    const admin = isAdmin(req);
    const [{ data: visitas }, { data: notas }, { data: evidencias }, { data: auditoria }, { data: pagos }] = await Promise.all([
      supabase.from('visitas').select('*, perfiles!visitas_trabajador_id_fkey(nombre, profesion, especialidad)').eq('paciente_id', req.params.id).order('fecha', { ascending: false }).limit(300),
      supabase.from('notas_atencion').select('*').eq('paciente_id', req.params.id).order('created_at', { ascending: false }).limit(500),
      supabase.from('evidencias').select('*').eq('paciente_id', req.params.id).order('created_at', { ascending: false }).limit(1000),
      admin ? supabase.from('auditoria_expediente').select('*').eq('paciente_id', req.params.id).order('created_at', { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
      admin ? supabase.from('pagos').select('*').eq('paciente_id', req.params.id).order('fecha', { ascending: false }).limit(200) : Promise.resolve({ data: [] })
    ]);
    const { data: paquete } = p.paquete_id
      ? await supabase.from('paquetes').select('*').eq('id', p.paquete_id).maybeSingle()
      : { data: null };
    res.json({
      paciente: { ...p, paquete },
      visitas: visitas || [],
      notas: notas || [],
      evidencias: (evidencias || []).map((e) => ({ id: e.id, nota_id: e.nota_id, visita_id: e.visita_id, descripcion: e.descripcion, nombre_archivo: e.nombre_archivo, created_at: e.created_at })),
      auditoria: auditoria?.data || [],
      pagos: pagos?.data || []
    });
  } catch (e) {
    console.error('GET expediente:', e);
    res.status(500).json({ error: 'Error al obtener expediente' });
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

// Un trabajador suspendido/inactivo no puede recibir visitas nuevas
async function trabajadorAsignable(id) {
  if (!id) return true;
  const { data } = await supabase.from('perfiles').select('estado_laboral').eq('id', id).maybeSingle();
  if (!data) return true; // sin expediente: no bloquear
  return !['inactivo', 'suspendido'].includes(data.estado_laboral);
}

app.post('/api/visitas', requireUser, async (req, res) => {
  if (!isAdmin(req) && req.user?.perfil?.rol !== 'staff') {
    return res.status(403).json({ error: 'Solo admin/staff puede asignar visitas' });
  }
  try {
    const { paciente_id, trabajador_id, fecha, hora_programada, radio_m, duracion_estimada_min, disciplina } = req.body || {};
    if (!paciente_id || !fecha) return res.status(400).json({ error: 'paciente_id y fecha son requeridos' });
    if (!(await trabajadorAsignable(trabajador_id))) {
      return res.status(400).json({ error: 'El trabajador está suspendido o inactivo; actualiza su estado laboral primero' });
    }

    // El paciente debe tener coordenadas
    const { data: pac } = await supabase.from('pacientes').select('id, lat, lng, nombre, apellido, direccion').eq('id', paciente_id).single();
    if (!pac) return res.status(404).json({ error: 'Paciente no encontrado' });
    if (pac.lat == null || pac.lng == null) return res.status(400).json({ error: 'El paciente no tiene ubicación georreferenciada' });

    const dur = Number(duracion_estimada_min) || 60;
    // Detección de conflictos de horario: mismo trabajador, mismo día, franjas superpuestas
    if (trabajador_id && hora_programada) {
      const a = hhmmAMin(hora_programada);
      if (a != null) {
        const b = a + dur;
        const { data: delDia } = await supabase
          .from('visitas')
          .select('id, hora_programada, duracion_estimada_min, pacientes(nombre, apellido)')
          .eq('trabajador_id', trabajador_id).eq('fecha', fecha).neq('estado', 'cancelada');
        const conflictos = (delDia || []).filter((c) => {
          const ci = hhmmAMin(c.hora_programada);
          if (ci == null) return false;
          const cj = ci + (Number(c.duracion_estimada_min) || 60);
          return a < cj && ci < b;
        });
        if (conflictos.length && !req.body.confirmar_conflicto) {
          return res.status(409).json({
            error: `Conflicto de horario: ${conflictos.length} visita(s) se traslapan`,
            conflictos: conflictos.map((c) => ({ id: c.id, hora: c.hora_programada, paciente: `${c.pacientes?.nombre || ''} ${c.pacientes?.apellido || ''}`.trim() }))
          });
        }
      }
    }

    const { data, error } = await supabase
      .from('visitas')
      .insert({
        paciente_id, trabajador_id: trabajador_id || null, fecha,
        hora_programada: hora_programada || null,
        radio_m: radio_m || 50,
        duracion_estimada_min: dur,
        disciplina: disciplina ? String(disciplina).slice(0, 80) : null,
        estado: 'programada', creado_por: req.user.id
      })
      .select()
      .single();
    if (error) throw error;
    await logEvento(data.id, 'asignada', { por: req.user.email });
    const { data: pacNotif } = await supabase.from('pacientes').select('nombre, apellido').eq('id', paciente_id).maybeSingle();
    await notifyFamiliares(paciente_id, 'visita', `Nueva visita programada para ${pacNotif?.nombre || ''} ${pacNotif?.apellido || ''} el ${fecha}${hora_programada ? ' a las ' + hora_programada : ''}`);
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
    if (req.query.desde) q = q.gte('fecha', req.query.desde);
    if (req.query.hasta) q = q.lte('fecha', req.query.hasta);
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

    const { estado, hora_programada, trabajador_id, duracion_estimada_min, trabajador_estado, salida_manual, fecha, disciplina } = req.body || {};
    const update = {};
    // Corrección del directivo: registrar salida olvidada (queda evidencia en eventos)
    if (salida_manual && puedeVerTodas(req)) {
      const f = new Date(salida_manual);
      if (isNaN(f)) return res.status(400).json({ error: 'Fecha de salida inválida' });
      update.salida_at = f.toISOString();
      if (v.estado === 'en_curso') update.estado = 'finalizada';
    }
    if (trabajador_estado && TRABAJADOR_ESTADOS.includes(trabajador_estado) && (puedeVerTodas(req) || esPropia)) {
      if (await checkTrabajadorEstado()) update.trabajador_estado = trabajador_estado;
    }
    const estadosOk = puedeVerTodas(req) ? ['programada', 'cancelada', 'finalizada', 'no_show'] : ['programada', 'cancelada', 'finalizada'];
    if (estado && estadosOk.includes(estado) && (puedeVerTodas(req) || esPropia)) update.estado = estado;
    if (puedeVerTodas(req)) {
      if (hora_programada) update.hora_programada = hora_programada;
      if (fecha) update.fecha = fecha;
      if (disciplina !== undefined) update.disciplina = disciplina ? String(disciplina).slice(0, 80) : null;
      if (trabajador_id !== undefined) {
        if (!(await trabajadorAsignable(trabajador_id || null))) {
          return res.status(400).json({ error: 'El trabajador está suspendido o inactivo; actualiza su estado laboral primero' });
        }
        update.trabajador_id = trabajador_id || null;
      }
      if (duracion_estimada_min) update.duracion_estimada_min = Number(duracion_estimada_min);
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });
    const { data, error } = await supabase.from('visitas').update(update).eq('id', v.id).select().single();
    if (error) throw error;
    if (update.estado === 'cancelada') await logEvento(v.id, 'cancelada', { por: req.user.email });
    if (salida_manual) await logEvento(v.id, 'correccion_salida', { por: req.user.email, salida_manual: update.salida_at, evidencia: 'registrada manualmente por el directivo' });
    // Avisar a familiares vinculados cuando cambia/cancela la visita
    if (update.estado === 'cancelada') {
     const { data: pac } = await supabase.from('pacientes').select('nombre, apellido').eq('id', v.paciente_id).maybeSingle();
     await notifyFamiliares(v.paciente_id, 'visita', `La visita de ${pac?.nombre || ''} ${pac?.apellido || ''} del ${v.fecha} fue cancelada`);
    }
    res.json({ visita: data });
  } catch (e) {
    console.error('PATCH visita:', e);
    res.status(500).json({ error: 'Error al actualizar visita' });
  }
});

// El empleado solicita reprogramar su visita (el directivo decide)
app.post('/api/visitas/:id/solicitar-reprogramacion', requireUser, async (req, res) => {
  try {
    const { data: v } = await supabase.from('visitas').select('*, pacientes(nombre, apellido)').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
    if (v.trabajador_id !== req.user.id && !puedeVerTodas(req)) return res.status(403).json({ error: 'Solo el trabajador asignado' });
    const { nueva_fecha, nueva_hora, motivo } = req.body || {};
    if (!nueva_fecha) return res.status(400).json({ error: 'Indica la nueva fecha' });
    await logEvento(v.id, 'reprogramacion_solicitada', { por: req.user.email, nueva_fecha, nueva_hora: nueva_hora || null, motivo: motivo || null });
    const quien = (await supabase.from('perfiles').select('nombre').eq('id', req.user.id).maybeSingle()).data?.nombre || req.user.email;
    await notifyAdmins('reprogramacion',
      `${quien} solicita reprogramar la visita del ${v.fecha}${v.hora_programada ? ' ' + v.hora_programada : ''} (${v.pacientes?.nombre || ''} ${v.pacientes?.apellido || ''}) → ${nueva_fecha}${nueva_hora ? ' ' + nueva_hora : ''}${motivo ? ' — ' + motivo : ''}`,
      v, { nueva_fecha, nueva_hora: nueva_hora || null, motivo: motivo || null, solicitante: req.user.email });
    res.json({ ok: true });
  } catch (e) {
    console.error('solicitar-reprogramacion:', e);
    res.status(500).json({ error: 'Error al enviar solicitud' });
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

// ---------- Registro de visita por código QR ----------

// Consulta ligera del domicilio al escanear (sin datos sensibles)
app.get('/api/qr/:token', requireUser, async (req, res) => {
  try {
    const token = String(req.params.token || '').trim().toUpperCase();
    let { data: pac, error: errPac } = await supabase
      .from('pacientes')
      .select('id, nombre, apellido, cedula, telefono, tipo_servicio, contacto_emergencia, telefono_emergencia, direccion, lat, lng, qr_activo')
      .eq('qr_token', token)
      .maybeSingle();
    // Si faltan columnas opcionales en la BD, reintenta con las básicas
    if (errPac && /column|Could not find|schema cache/i.test(errPac.message)) {
      ({ data: pac, error: errPac } = await supabase
        .from('pacientes')
        .select('id, nombre, apellido, direccion, lat, lng, qr_activo')
        .eq('qr_token', token)
        .maybeSingle());
    }
    if (errPac) return res.status(503).json({ error: 'El módulo QR aún no está activado en la base de datos' });
    if (!pac || pac.qr_activo === false) {
      return res.status(404).json({ error: 'Código QR inválido o desactivado' });
    }
    // Visita relevante para ESTE trabajador (nadie registra a nombre de otro)
    const { data: visitas } = await supabase
      .from('visitas')
      .select('id, estado, fecha, hora_programada, paciente_id, trabajador_id, llegada_at, salida_at, radio_m')
      .eq('paciente_id', pac.id)
      .eq('trabajador_id', req.user.id)
      .in('estado', ['programada', 'en_curso'])
      .order('fecha', { ascending: false })
      .limit(1);
    const v = (visitas || [])[0] || null;
    res.json({
      domicilio: {
        paciente_id: pac.id,
        nombre: `${pac.nombre || ''} ${pac.apellido || ''}`.trim(),
        edad: pac.cedula || null,
        telefono: pac.telefono || null,
        tipo_servicio: pac.tipo_servicio || null,
        contacto_emergencia: pac.contacto_emergencia || null,
        telefono_emergencia: pac.telefono_emergencia || null,
        direccion: pac.direccion, lat: pac.lat, lng: pac.lng
      },
      visita: v
    });
  } catch (e) {
    console.error('GET /api/qr:', e);
    res.status(500).json({ error: 'Error al consultar el código' });
  }
});

// Check-in / check-out por QR + GPS
app.post('/api/visitas/qr-checkin', requireUser, async (req, res) => {
  try {
    const { token, lat, lng, precision, sesion, especialidad } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token requerido' });

    const tk = String(token).trim().toUpperCase();
    const { data: pac, error: errPac } = await supabase
      .from('pacientes')
      .select('id, nombre, apellido, direccion, lat, lng, qr_activo')
      .eq('qr_token', tk)
      .maybeSingle();
    if (errPac) return res.status(503).json({ error: 'El módulo QR aún no está activado en la base de datos' });
    if (!pac || pac.qr_activo === false) {
      return res.status(404).json({ error: 'Código QR inválido o desactivado' });
    }

    // Solo la visita asignada a ESTE trabajador puede cerrarse por QR
    const { data: candidatas } = await supabase
      .from('visitas')
      .select('*')
      .eq('paciente_id', pac.id)
      .eq('trabajador_id', req.user.id)
      .in('estado', ['programada', 'en_curso'])
      .order('fecha', { ascending: false })
      .limit(1);
    const v = (candidatas || [])[0];
    if (!v) {
      return res.status(403).json({ error: 'No tienes una visita asignada a este domicilio' });
    }

    const ahora = new Date();
    const tieneGps = lat != null && lng != null;
    const la = tieneGps ? Number(lat) : null;
    const ln = tieneGps ? Number(lng) : null;
    let distancia = null, dentro = null;
    if (tieneGps && pac.lat != null && pac.lng != null) {
      distancia = Math.round(distanciaM(la, ln, pac.lat, pac.lng));
      dentro = distancia <= (v.radio_m || 100);
    }
    const gpsValido = dentro === true;

    const esSalida = !!(v.llegada_at && !v.salida_at);
    const update = { ultima_ping_at: ahora.toISOString() };
    const extra = {
      fuente: 'qr', gps_valido: gpsValido,
      ...(sesion ? { sesion: String(sesion).slice(0, 200) } : {}),
      ...(especialidad ? { especialidad: String(especialidad).slice(0, 200) } : {}),
      ...(precision != null ? { precision_m: Math.round(Number(precision)) } : {})
    };

    if (esSalida) {
      update.salida_at = ahora.toISOString();
      update.salida_lat = la; update.salida_lng = ln;
      update.estado = 'finalizada';
      update.checkin_source = 'qr';
      update.gps_precision = precision != null ? Number(precision) : null;
      update.gps_valido = gpsValido;
    } else {
      update.llegada_at = ahora.toISOString();
      update.llegada_lat = la; update.llegada_lng = ln;
      update.ultima_dentro_at = ahora.toISOString();
      update.estado = 'en_curso';
      update.checkin_source = 'qr';
      update.gps_precision = precision != null ? Number(precision) : null;
      update.gps_valido = gpsValido;
    }

    // Si la BD aún no tiene las columnas QR, reintenta sin ellas
    let nv = null, error = null, payload = update;
    for (let i = 0; i < 10; i++) {
      ({ data: nv, error } = await supabase.from('visitas').update(payload).eq('id', v.id).select().single());
      if (!error) break;
      if (!/does not exist|schema cache|Could not find/i.test(error.message)) break;
      const reducido = sinColumnaReportada(payload, error.message);
      if (JSON.stringify(reducido) === JSON.stringify(payload)) break;
      payload = reducido;
    }
    if (error) throw error;

    const quien = req.user.email;
    const pacNom = `${pac.nombre || ''} ${pac.apellido || ''}`.trim();
    const dir = pac.direccion || `${pac.lat},${pac.lng}`;
    const notaGps = !tieneGps ? ' — GPS no disponible, pendiente de validación' : gpsValido ? '' : ` — fuera del radio (${distancia} m), pendiente de validación`;

    if (esSalida) {
      const durMin = Math.round((ahora - new Date(v.llegada_at)) / 60000);
      await logEvento(v.id, 'salida', { ...extra, lat: la, lng: ln, distancia_m: distancia, duracion_min: durMin });
      await notifyAdmins('salida', `${quien} ha finalizado su visita en el domicilio de ${pacNom} (${dir}) a las ${ahora.toTimeString().slice(0, 5)}. Tiempo de permanencia: ${durMin} min${notaGps}`, nv, { trabajador: quien, paciente: pacNom, direccion: dir, duracion_min: durMin, gps_valido: gpsValido });
      res.json({ tipo: 'salida', estado: nv.estado, duracion_min: durMin, gps_valido: gpsValido, distancia_m: distancia, sesion: sesion || null });
    } else {
      await logEvento(v.id, 'llegada', { ...extra, lat: la, lng: ln, distancia_m: distancia });
      await notifyAdmins('llegada', `${quien} ha registrado su llegada al domicilio de ${pacNom} (${dir}) a las ${ahora.toTimeString().slice(0, 5)}${notaGps}`, nv, { trabajador: quien, paciente: pacNom, direccion: dir, lat: la, lng: ln, distancia_m: distancia, gps_valido: gpsValido });
      res.json({ tipo: 'llegada', estado: nv.estado, gps_valido: gpsValido, distancia_m: distancia, sesion: sesion || null });
    }
  } catch (e) {
    console.error('qr-checkin:', e);
    res.status(500).json({ error: 'Error al registrar la visita' });
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
// ---------- Semáforo Inteligente de Bienestar (solo directivo) ----------
// Evalúa SOLO el cumplimiento del seguimiento (visitas, notas, incidencias,
// revisiones). No diagnostica ni evalúa estado clínico.
const SEMAFORO_CFG = {
  diasSinNotaAmarillo: 30,   // días desde la última nota de evolución
  diasVisitaVencidaRojo: 2,  // visita programada sin realizar hace más de N días
  diasVisitaProximaAmarillo: 3, // visita programada en los próximos N días
  maxNotasRevision: 3        // notas sin revisar que disparan amarillo
};

async function calcularSemaforoPaciente(p) {
  const [{ data: visitas }, { data: notas }] = await Promise.all([
    supabase.from('visitas').select('id, fecha, hora_programada, estado,created_at').eq('paciente_id', p.id).order('fecha', { ascending: false }).limit(60),
    supabase.from('notas_atencion').select('id, visita_id, actividades, evolucion, observaciones, incidencias, especialidad, sesion, revisado, created_at').eq('paciente_id', p.id).order('created_at', { ascending: false }).limit(200)
  ]);
  const vs = visitas || [];
  const ns = notas || [];
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const hace = (d) => Math.floor((hoy - new Date(d)) / 86400000);
  const motivos = [];
  let rojo = false, amarillo = false;

  // ROJO — visitas no realizadas / incidencias reportadas
  for (const v of vs) {
   if (v.estado === 'no_show') { rojo = true; motivos.push({ nivel: 'rojo', texto: `Visita no realizada (${v.fecha})`, fecha: v.fecha }); }
   if (v.estado === 'programada' && hace(v.fecha) > SEMAFORO_CFG.diasVisitaVencidaRojo) {
    rojo = true; motivos.push({ nivel: 'rojo', texto: `Visita programada vencida sin realizar (${v.fecha})`, fecha: v.fecha });
   }
  }
  for (const n of ns) {
   if (n.incidencias && String(n.incidencias).trim()) {
    rojo = true; motivos.push({ nivel: 'rojo', texto: `Incidencia reportada en nota de evolución (${String(n.created_at).slice(0, 10)})`, fecha: n.created_at });
    break;
   }
  }

  // AMARILLO — valoraciones próximas a vencer, pendientes de confirmar/revisar
  const ultimaNota = ns[0]?.created_at ? hace(ns[0].created_at) : null;
  if (ultimaNota === null || ultimaNota > SEMAFORO_CFG.diasSinNotaAmarillo) {
   amarillo = true; motivos.push({ nivel: 'amarillo', texto: ultimaNota === null ? 'Sin notas de evolución registradas' : `Última nota de evolución hace ${ultimaNota} días`, fecha: ns[0]?.created_at || null });
  }
  const pendientesRevision = ns.filter((n) => !n.revisado).length;
  if (pendientesRevision > 0) {
   amarillo = true; motivos.push({ nivel: 'amarillo', texto: `${pendientesRevision} nota(s) de evolución pendiente(s) de revisión`, fecha: null });
  }
  const proxima = vs.find((v) => v.estado === 'programada' && new Date(v.fecha) >= hoy);
  if (proxima) {
   const dias = Math.floor((new Date(proxima.fecha) - hoy) / 86400000);
   if (dias <= SEMAFORO_CFG.diasVisitaProximaAmarillo) {
    amarillo = true; motivos.push({ nivel: 'amarillo', texto: `Visita programada próxima (${proxima.fecha} ${proxima.hora_programada || ''})`, fecha: proxima.fecha });
   }
  }
  // Notas incompletas: visita finalizada sin nota de evolución
  const visitasFinalizadas = new Set(vs.filter((v) => v.estado === 'finalizada' || v.salida).map((v) => v.id));
  const visitasConNota = new Set(ns.map((n) => n.visita_id).filter(Boolean));
  const sinNota = [...visitasFinalizadas].filter((id) => !visitasConNota.has(id)).length;
  if (sinNota > 0) {
   amarillo = true; motivos.push({ nivel: 'amarillo', texto: `${sinNota} visita(s) finalizada(s) sin nota de evolución`, fecha: null });
  }

  const color = rojo ? 'rojo' : amarillo ? 'amarillo' : 'verde';
  return { color, motivos, stats: { visitas: vs.length, notas: ns.length, pendientesRevision, ultimaNotaDias: ultimaNota } };
}

app.get('/api/semaforo', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
   const { data: pacientes } = await supabase.from('pacientes').select('*').order('nombre').limit(500);
   const { data: alertas } = await supabase.from('alertas_semaforo').select('*').order('created_at', { ascending: false }).limit(1000);
   const abiertasPorPac = {};
   const historialPorPac = {};
   for (const a of alertas || []) {
    (historialPorPac[a.paciente_id] ||= []).push(a);
    if (!a.revisado && !abiertasPorPac[a.paciente_id]) abiertasPorPac[a.paciente_id] = a;
   }
   const items = [];
   for (const p of pacientes || []) {
    const s = await calcularSemaforoPaciente(p);
    items.push({ paciente: p, color: s.color, motivos: s.motivos, stats: s.stats, alerta_abierta: abiertasPorPac[p.id] || null, alertas: (historialPorPac[p.id] || []).slice(0, 10) });
   }
   const resumen = { verde: 0, amarillo: 0, rojo: 0, alertas_abiertas: 0 };
   for (const i of items) { resumen[i.color]++; if (i.alerta_abierta) resumen.alertas_abiertas++; }
   res.json({ items, resumen });
  } catch (e) {
   console.error('GET /api/semaforo:', e);
   res.status(500).json({ error: 'Error al calcular semáforo' });
  }
});

app.post('/api/alertas/:id/revisar', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
   const { acciones } = req.body || {};
   const { data, error } = await supabase.from('alertas_semaforo')
    .update({ revisado: true, revisado_at: new Date().toISOString(), revisado_por: req.user.email, acciones: String(acciones || '').slice(0, 1000) })
    .eq('id', req.params.id).select().single();
   if (error) throw error;
   res.json({ alerta: data });
  } catch (e) {
   console.error('POST /api/alertas/:id/revisar:', e);
   res.status(500).json({ error: 'Error al revisar alerta' });
  }
});

// Escaneo del semáforo: crea alertas nuevas y notifica al directivo (lo llama el cron)
async function revisarSemaforos() {
  const { data: pacientes } = await supabase.from('pacientes').select('id, nombre, apellido').limit(500);
  const { data: abiertas } = await supabase.from('alertas_semaforo').select('paciente_id').eq('revisado', false);
  const conAbierta = new Set((abiertas || []).map((a) => a.paciente_id));
  for (const p of pacientes || []) {
   const s = await calcularSemaforoPaciente({ id: p.id });
   if (s.color === 'verde' || conAbierta.has(p.id)) continue;
   const motivoPrincipal = s.motivos[0]?.texto || `Semáforo ${s.color}`;
   const { data: alerta } = await supabase.from('alertas_semaforo').insert({
    paciente_id: p.id, color: s.color, motivo: motivoPrincipal
   }).select().single();
   if (alerta) {
    conAbierta.add(p.id);
    await notifyAdmins('alerta', `🚦 Semáforo ${s.color.toUpperCase()}: ${p.nombre} ${p.apellido} — ${motivoPrincipal}`, null, { paciente_id: p.id, color: s.color, alerta_id: alerta.id });
   }
  }
}

// ---------- Portal del Familiar responsable ----------
// Vínculo familiar ↔ paciente autorizado por el directivo
app.get('/api/mis-familiares', requireUser, async (req, res) => {
  try {
    if (!['familiar', 'admin'].includes(req.user?.perfil?.rol)) return res.status(403).json({ error: 'Solo familiares' });
    if (req.user?.perfil?.estado && req.user.perfil.estado !== 'aprobado') return res.status(403).json({ error: 'Cuenta pendiente' });
    let q = supabase.from('vinculos_familiar').select('*').eq('activo', true);
    if (!isAdmin(req)) q = q.eq('familiar_id', req.user.id);
    const { data: vinculos } = await q;
    const pacIds = [...new Set((vinculos || []).map((v) => v.paciente_id))];
    if (!pacIds.length) return res.json({ pacientes: [] });
    const [{ data: pacientes }, { data: paquetes }, { data: visitas }, { data: notas }, { data: evidencias }] = await Promise.all([
      supabase.from('pacientes').select('id, nombre, apellido, cedula, telefono, direccion, tipo_servicio, descripcion, diagnostico, objetivos, paquete_id, foto_path, estado').in('id', pacIds),
      supabase.from('paquetes').select('id, nombre, precio, servicios, duracion_min').eq('activo', true),
      supabase.from('visitas').select('id, paciente_id, fecha, hora_programada, estado, salida').in('paciente_id', pacIds).order('fecha', { ascending: false }).limit(400),
      supabase.from('notas_atencion').select('id, paciente_id, visita_id, actividades, evolucion, observaciones, recomendaciones, incidencias, especialidad, sesion, revisado, created_at').in('paciente_id', pacIds).order('created_at', { ascending: false }).limit(300),
      supabase.from('evidencias').select('id, paciente_id, nota_id, descripcion, nombre_archivo, created_at').in('paciente_id', pacIds).order('created_at', { ascending: false }).limit(120)
    ]);
    // Firmar URLs de foto de paciente y de evidencias autorizadas (solo lectura)
    const firmar = async (bucket, path) => {
     try { const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600); return data?.signedUrl || null; } catch { return null; }
    };
    const out = [];
    for (const p of pacientes || []) {
     const misVisitas = (visitas || []).filter((v) => v.paciente_id === p.id);
     const proximas = misVisitas.filter((v) => v.estado === 'programada' && String(v.fecha) >= new Date().toISOString().slice(0, 10)).slice(0, 5);
     const realizadas = misVisitas.filter((v) => v.estado === 'finalizada' || v.salida).slice(0, 15);
     const misNotas = (notas || []).filter((n) => n.paciente_id === p.id).slice(0, 40);
     const misEvs = (evidencias || []).filter((e) => e.paciente_id === p.id).slice(0, 12);
     const evs = [];
     for (const e of misEvs) {
      const { data: evFull } = await supabase.from('evidencias').select('storage_path').eq('id', e.id).maybeSingle();
      const url = evFull?.storage_path ? await firmar('evidencias', evFull.storage_path) : null;
      if (url) evs.push({ id: e.id, descripcion: e.descripcion, created_at: e.created_at, url });
     }
     out.push({
      paciente: { ...p, foto_url: p.foto_path ? await firmar('pacientes', p.foto_path) : null },
      paquete: (paquetes || []).find((k) => k.id === p.paquete_id) || null,
      proximas_visitas: proximas,
      historial_visitas: realizadas,
      notas: misNotas,
      evidencias: evs
     });
    }
    res.json({ pacientes: out });
  } catch (e) {
   console.error('GET /api/mis-familiares:', e);
   res.status(500).json({ error: 'Error al obtener información' });
  }
});

// Vincular / desvincular familiar ↔ paciente (solo directivo)
app.get('/api/vinculos', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
   const { data } = await supabase.from('vinculos_familiar').select('*').order('created_at', { ascending: false }).limit(500);
   res.json({ vinculos: data || [] });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});
app.post('/api/vinculos', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
   const { paciente_id, familiar_id } = req.body || {};
   if (!paciente_id || !familiar_id) return res.status(400).json({ error: 'paciente_id y familiar_id requeridos' });
   const { data: fam } = await supabase.from('perfiles').select('rol, estado').eq('id', familiar_id).maybeSingle();
   if (fam?.rol !== 'familiar') return res.status(400).json({ error: 'La cuenta seleccionada no es de tipo Familiar' });
   const { data, error } = await supabase.from('vinculos_familiar')
    .upsert({ paciente_id, familiar_id, activo: true, autorizado_por: req.user.email }, { onConflict: 'paciente_id,familiar_id' })
    .select().single();
   if (error) throw error;
   res.status(201).json({ vinculo: data });
  } catch (e) {
   console.error('POST /api/vinculos:', e);
   res.status(500).json({ error: 'Error al vincular' });
  }
});
app.patch('/api/vinculos/:id', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
   const { activo } = req.body || {};
   const { data, error } = await supabase.from('vinculos_familiar')
    .update({ activo: activo !== false })
    .eq('id', req.params.id).select().single();
   if (error) throw error;
   res.json({ vinculo: data });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// ---------- Centro de Inteligencia (solo directivo) ----------
// Agregación de indicadores reales de la plataforma
app.get('/api/centro', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    let desde = req.query.desde || `${hoy.slice(0, 7)}-01`;
    let hasta = req.query.hasta || hoy;
    const profId = req.query.profesional || null;
    const packId = req.query.paquete || null;

    const [{ data: pacientes }, { data: paquetes }, { data: perfiles }, { data: visitas }, { data: notas }, { data: valoraciones }, { data: pagos }, { data: alertas }] = await Promise.all([
      supabase.from('pacientes').select('*'),
      supabase.from('paquetes').select('*'),
      supabase.from('perfiles').select('id, nombre, email, rol, profesion, especialidad, estado_laboral'),
      supabase.from('visitas').select('id, paciente_id, trabajador_id, fecha, hora_programada, estado, llegada_at, salida_at, duracion_estimada_min, disciplina, pacientes(paquete_id)').gte('fecha', desde).lte('fecha', hasta).limit(2000),
      supabase.from('notas_atencion').select('id, paciente_id, trabajador_id, especialidad, incidencias, revisado, created_at').gte('created_at', desde).lte('created_at', hasta + 'T23:59:59').limit(2000),
      supabase.from('valoraciones').select('id, paciente_id, escala, puntaje, fecha, evaluador_nombre').gte('fecha', desde).lte('fecha', hasta).limit(1000),
      supabase.from('pagos').select('*').gte('fecha', desde).lte('fecha', hasta).limit(1000),
      supabase.from('alertas_semaforo').select('id, paciente_id, color, revisado').eq('revisado', false).limit(500)
    ]);

    // --- Pacientes ---
    const packMap = new Map((paquetes || []).map((k) => [k.id, k]));
    const pacFiltrados = (pacientes || []).filter((p) => (!packId || p.paquete_id === packId));
    const porEstado = {};
    for (const p of pacFiltrados) porEstado[p.estado || 'sin_estado'] = (porEstado[p.estado || 'sin_estado'] || 0) + 1;
    const activos = pacFiltrados.filter((p) => ['en_proceso', 'pendiente'].includes(p.estado)).length;
    const nuevos = pacFiltrados.filter((p) => p.created_at && String(p.created_at).slice(0, 10) >= desde && String(p.created_at).slice(0, 10) <= hasta).length;
    const porPaquete = {};
    for (const p of pacFiltrados) {
      const pk = p.paquete_id ? packMap.get(p.paquete_id) : null;
      const nom = pk?.nombre || 'Sin paquete';
      porPaquete[nom] = (porPaquete[nom] || 0) + 1;
    }
    // Paquetes próximos a vencer: fecha_contratacion + 30 días dentro de los próximos 15 días (o vencido sin renovar)
    const proximosVencer = pacFiltrados.filter((p) => {
      if (!p.fecha_contratacion) return false;
      const venc = new Date(p.fecha_contratacion); venc.setDate(venc.getDate() + 30);
      const dias = (venc - new Date()) / 86400000;
      return dias <= 15;
    }).map((p) => ({ id: p.id, nombre: `${p.nombre || ''} ${p.apellido || ''}`.trim(), fecha_contratacion: p.fecha_contratacion, dias_restantes: Math.ceil((new Date(new Date(p.fecha_contratacion).getTime() + 30 * 86400000) - new Date()) / 86400000) }));

    // --- Empleados ---
    const trabajadores = (perfiles || []).filter((p) => ['staff', 'cuidador'].includes(p.rol));
    const empActivos = trabajadores.filter((t) => !['inactivo', 'suspendido'].includes(t.estado_laboral)).length;
    const visitasFiltradas = (visitas || []).filter((v) => (!profId || v.trabajador_id === profId) && (!packId || v.pacientes?.paquete_id === packId));
    const porProf = {};
    for (const v of visitasFiltradas) {
      const t = (perfiles || []).find((x) => x.id === v.trabajador_id);
      const nom = t?.nombre || t?.email || 'Sin asignar';
      porProf[nom] = (porProf[nom] || 0) + 1;
    }
    const vProgramadas = visitasFiltradas.filter((v) => v.estado === 'programada').length;
    const vCompletadas = visitasFiltradas.filter((v) => ['finalizada', 'completada', 'en_curso'].includes(v.estado)).length;
    const vConLlegada = visitasFiltradas.filter((v) => v.llegada_at).length;
    const cumplimiento = vCompletadas ? Math.round((vConLlegada / vCompletadas) * 100) : null;
    const incidenciasNotas = (notas || []).filter((n) => n.incidencias && String(n.incidencias).trim()).length;
    const incidenciasGps = visitasFiltradas.filter((v) => v.estado === 'no_show').length;

    // --- Financiero ---
    const pagosFiltrados = (pagos || []).filter((p) => (!packId || packMap.get(pacientes?.find((x) => x.id === p.paciente_id)?.paquete_id)?.id === packId));
    const cobrado = pagosFiltrados.filter((p) => p.estado === 'pagado').reduce((s, p) => s + Number(p.monto || 0), 0);
    const pendiente = pagosFiltrados.filter((p) => p.estado === 'pendiente').reduce((s, p) => s + Number(p.monto || 0), 0);
    const proyeccion = pacFiltrados.filter((p) => ['en_proceso', 'pendiente'].includes(p.estado) && p.paquete_id).reduce((s, p) => s + Number(packMap.get(p.paquete_id)?.precio || 0), 0);
    const cobradoPorPaquete = {};
    for (const p of pagosFiltrados.filter((x) => x.estado === 'pagado')) {
      const pac = pacientes?.find((x) => x.id === p.paciente_id);
      const nom = pac?.paquete_id ? packMap.get(pac.paquete_id)?.nombre || 'Sin paquete' : 'Sin paquete';
      cobradoPorPaquete[nom] = (cobradoPorPaquete[nom] || 0) + Number(p.monto || 0);
    }

    // --- Calidad ---
    const notasRango = (notas || []).length;
    const valoracionesRango = (valoraciones || []).length;
    const pacientesConSeguimiento = new Set((notas || []).map((n) => n.paciente_id)).size;
    const alertasAbiertas = (alertas || []).filter((a) => a.color === 'rojo').length;
    const alertasAmarillas = (alertas || []).filter((a) => a.color === 'amarillo').length;

    // --- Tendencias: visitas por día en el rango ---
    const visitasPorDia = {};
    for (const v of visitasFiltradas) visitasPorDia[v.fecha] = (visitasPorDia[v.fecha] || 0) + 1;
    // Tendencia mensual últimos 6 meses
    const meses = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      meses.push(d.toISOString().slice(0, 7));
    }
    const { data: visitas6m } = await supabase.from('visitas').select('fecha, estado').gte('fecha', `${meses[0]}-01`);
    const { data: pagos6m } = await supabase.from('pagos').select('fecha, monto, estado').gte('fecha', `${meses[0]}-01`);
    const tendencia = meses.map((m) => ({
      mes: m,
      visitas: (visitas6m || []).filter((v) => String(v.fecha).startsWith(m)).length,
      ingresos: (pagos6m || []).filter((p) => p.estado === 'pagado' && String(p.fecha).startsWith(m)).reduce((s, p) => s + Number(p.monto || 0), 0)
    }));

    res.json({
      periodo: { desde, hasta },
      pacientes: { total: pacFiltrados.length, activos, inactivos: pacFiltrados.length - activos, nuevos, porEstado, porPaquete, proximosVencer },
      empleados: { total: trabajadores.length, activos: empActivos, porProfesional: porProf, programadas: vProgramadas, completadas: vCompletadas, cumplimiento_horarios: cumplimiento, incidencias: incidenciasNotas + incidenciasGps },
      finanzas: { cobrado, pendiente, proyeccion, cobradoPorPaquete, totalPagos: pagosFiltrados.length },
      calidad: { valoraciones: valoracionesRango, notas: notasRango, pacientesConSeguimiento, alertasRojas: alertasAbiertas, alertasAmarillas },
      visitasPorDia, tendencia,
      filtros: { profesionales: trabajadores.map((t) => ({ id: t.id, nombre: t.nombre || t.email })), paquetes: (paquetes || []).map((k) => ({ id: k.id, nombre: k.nombre })) }
    });
  } catch (e) {
    console.error('GET /api/centro:', e);
    res.status(500).json({ error: 'Error al generar indicadores' });
  }
});

// ---------- Pagos ----------
app.get('/api/pagos', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    let q = supabase.from('pagos').select('*, pacientes(nombre, apellido, paquete_id, paquetes(nombre, precio))').order('fecha', { ascending: false }).limit(300);
    if (req.query.desde) q = q.gte('fecha', req.query.desde);
    if (req.query.hasta) q = q.lte('fecha', req.query.hasta);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ pagos: data || [] });
  } catch (e) { res.status(500).json({ error: 'Error al obtener pagos' }); }
});

app.post('/api/pagos', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { paciente_id, monto, fecha, metodo, estado, periodo, notas } = req.body || {};
    if (!paciente_id || monto == null) return res.status(400).json({ error: 'paciente_id y monto son requeridos' });
    const { data, error } = await supabase.from('pagos').insert({
      paciente_id, monto: Number(monto), fecha: fecha || new Date().toISOString().slice(0, 10),
      metodo: metodo || null, estado: estado === 'pendiente' ? 'pendiente' : 'pagado',
      periodo: periodo || null, notas: notas ? String(notas).slice(0, 500) : null,
      registrado_por: req.user.email
    }).select().single();
    if (error) throw error;
    res.status(201).json({ pago: data });
  } catch (e) { console.error('POST pago:', e); res.status(500).json({ error: 'Error al registrar pago' }); }
});

app.patch('/api/pagos/:id', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { estado, monto, metodo, notas } = req.body || {};
    const update = {};
    if (estado && ['pagado', 'pendiente'].includes(estado)) update.estado = estado;
    if (monto != null) update.monto = Number(monto);
    if (metodo !== undefined) update.metodo = metodo || null;
    if (notas !== undefined) update.notas = notas ? String(notas).slice(0, 500) : null;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });
    const { data, error } = await supabase.from('pagos').update(update).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ pago: data });
  } catch (e) { res.status(500).json({ error: 'Error al actualizar pago' }); }
});

// ---------- Evaluación de desempeño del empleado ----------
const INDICADORES_EVAL = ['puntualidad', 'cumplimiento_visitas', 'calidad_notas', 'cumplimiento_actividades', 'capacitacion', 'satisfaccion', 'seguimiento_indicaciones'];
const ETIQUETAS_EVAL = {
  puntualidad: 'Puntualidad', cumplimiento_visitas: 'Cumplimiento de visitas', calidad_notas: 'Calidad de notas de evolución',
  cumplimiento_actividades: 'Cumplimiento de actividades', capacitacion: 'Capacitación', satisfaccion: 'Satisfacción de pacientes y familiares',
  seguimiento_indicaciones: 'Seguimiento de indicaciones'
};
const NIVELES_EVAL = { 1: 'Deficiente', 2: 'Necesita mejorar', 3: 'Satisfactorio', 4: 'Bueno', 5: 'Excelente' };

// Métricas automáticas del trabajador en un periodo (datos reales del sistema)
async function metricasEmpleado(trabajador_id, desde, hasta) {
  const { data: visitas } = await supabase.from('visitas')
    .select('id, fecha, hora_programada, estado, llegada_at, salida_at')
    .eq('trabajador_id', trabajador_id).gte('fecha', desde).lte('fecha', hasta).limit(500);
  const { data: notas } = await supabase.from('notas_atencion')
    .select('id, paciente_id, especialidad, incidencias, revisado, created_at')
    .eq('trabajador_id', trabajador_id).gte('created_at', desde).lte('created_at', hasta + 'T23:59:59').limit(500);
  const { data: evidencias } = await supabase.from('evidencias')
    .select('id').eq('trabajador_id', trabajador_id).gte('created_at', desde).lte('created_at', hasta + 'T23:59:59').limit(500);
  const { data: caps } = await supabase.from('capacitaciones')
    .select('id, curso, fecha, horas').eq('trabajador_id', trabajador_id).gte('fecha', desde).lte('fecha', hasta).limit(100);
  const { data: encuestas } = await supabase.from('encuestas')
    .select('puntuacion').eq('trabajador_id', trabajador_id).gte('created_at', desde).lte('created_at', hasta + 'T23:59:59').limit(200);

  const programadas = (visitas || []).filter((v) => v.estado === 'programada').length;
  const completadas = (visitas || []).filter((v) => ['finalizada', 'completada'].includes(v.estado)).length;
  const noShow = (visitas || []).filter((v) => v.estado === 'no_show').length;
  // Puntualidad: de las visitas con llegada registrada, % que llegó ≤15 min después de la hora programada
  const conLlegada = (visitas || []).filter((v) => v.llegada_at && v.hora_programada);
  let puntuales = 0;
  for (const v of conLlegada) {
    const prog = new Date(`${v.fecha}T${v.hora_programada}:00`);
    const lleg = new Date(v.llegada_at);
    if (!isNaN(prog) && !isNaN(lleg) && (lleg - prog) <= 15 * 60000) puntuales++;
  }
  const puntualidadPct = conLlegada.length ? Math.round((puntuales / conLlegada.length) * 100) : null;
  const cumplimientoPct = (programadas + completadas + noShow) ? Math.round((completadas / (programadas + completadas + noShow)) * 100) : null;
  const satisfaccionProm = encuestas?.length ? (encuestas.reduce((s, e) => s + e.puntuacion, 0) / encuestas.length).toFixed(1) : null;

  return {
    visitas: { programadas, completadas, no_show: noShow, total: (visitas || []).length },
    puntualidad_pct: puntualidadPct,
    cumplimiento_pct: cumplimientoPct,
    notas: { total: (notas || []).length, con_incidencia: (notas || []).filter((n) => n.incidencias && String(n.incidencias).trim()).length, revisadas: (notas || []).filter((n) => n.revisado).length },
    evidencias: (evidencias || []).length,
    capacitaciones: (caps || []).map((c) => ({ curso: c.curso, fecha: c.fecha, horas: c.horas })),
    encuestas: { total: (encuestas || []).length, promedio: satisfaccionProm }
  };
}

app.get('/api/evaluaciones', requireUser, async (req, res) => {
  try {
    let q = supabase.from('evaluaciones_empleado')
      .select('*, perfiles!evaluaciones_empleado_trabajador_id_fkey(nombre, email, profesion, especialidad)')
      .order('fecha_fin', { ascending: false }).limit(300);
    if (!isAdmin(req)) q = q.eq('trabajador_id', req.user.id);
    else if (req.query.trabajador_id) q = q.eq('trabajador_id', req.query.trabajador_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ evaluaciones: data || [] });
  } catch (e) { res.status(500).json({ error: 'Error al obtener evaluaciones' }); }
});

app.post('/api/evaluaciones', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { trabajador_id, periodo, fecha_inicio, fecha_fin, calificaciones, fortalezas, oportunidades, observaciones, recomendaciones } = req.body || {};
    if (!trabajador_id || !periodo || !fecha_inicio || !fecha_fin) return res.status(400).json({ error: 'Faltan datos del periodo' });
    if (!calificaciones || typeof calificaciones !== 'object') return res.status(400).json({ error: 'Calificaciones requeridas' });
    const vals = Object.values(calificaciones).map(Number);
    if (vals.some((v) => !(v >= 1 && v <= 5))) return res.status(400).json({ error: 'Cada indicador debe calificar de 1 a 5' });
    const promedio = vals.reduce((a, b) => a + b, 0) / vals.length;
    const porcentaje = Math.round((promedio / 5) * 100);
    const resultado = porcentaje >= 90 ? 'Desempeño excelente' : porcentaje >= 80 ? 'Desempeño satisfactorio' : porcentaje >= 70 ? 'Desempeño en desarrollo' : 'Requiere intervención y seguimiento';
    const { data, error } = await supabase.from('evaluaciones_empleado').insert({
      trabajador_id, periodo, fecha_inicio, fecha_fin,
      calificaciones: Object.fromEntries(Object.entries(calificaciones).map(([k, v]) => [k, Number(v)])),
      promedio: promedio.toFixed(2), porcentaje, resultado,
      fortalezas: fortalezas ? String(fortalezas).slice(0, 2000) : null,
      oportunidades: oportunidades ? String(oportunidades).slice(0, 2000) : null,
      observaciones: observaciones ? String(observaciones).slice(0, 2000) : null,
      recomendaciones: recomendaciones ? String(recomendaciones).slice(0, 2000) : null,
      creado_por: req.user.email
    }).select().single();
    if (error) throw error;
    res.status(201).json({ evaluacion: data });
  } catch (e) { console.error('POST evaluacion:', e); res.status(500).json({ error: 'Error al crear evaluación' }); }
});

app.patch('/api/evaluaciones/:id', requireUser, async (req, res) => {
  try {
    const { data: ev } = await supabase.from('evaluaciones_empleado').select('*').eq('id', req.params.id).maybeSingle();
    if (!ev) return res.status(404).json({ error: 'No encontrada' });
    // El empleado solo puede confirmar que revisó su evaluación
    if (!isAdmin(req)) {
      if (ev.trabajador_id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
      if (req.body.revisada === true && !ev.revisada) {
        const { data, error } = await supabase.from('evaluaciones_empleado').update({ revisada: true, revisada_at: new Date().toISOString(), revisada_por: req.user.email }).eq('id', ev.id).select().single();
        if (error) throw error;
        return res.json({ evaluacion: data });
      }
      return res.status(403).json({ error: 'Solo puedes confirmar la revisión' });
    }
    const update = {};
    for (const f of ['fortalezas', 'oportunidades', 'observaciones', 'recomendaciones']) if (req.body[f] !== undefined) update[f] = req.body[f] ? String(req.body[f]).slice(0, 2000) : null;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });
    const { data, error } = await supabase.from('evaluaciones_empleado').update(update).eq('id', ev.id).select().single();
    if (error) throw error;
    res.json({ evaluacion: data });
  } catch (e) { res.status(500).json({ error: 'Error al actualizar' }); }
});

// Métricas automáticas para sugerir calificaciones
app.get('/api/evaluaciones/metricas', requireUser, async (req, res) => {
  try {
    const tid = req.query.trabajador_id;
    if (!tid) return res.status(400).json({ error: 'trabajador_id requerido' });
    if (!isAdmin(req) && tid !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
    const hasta = req.query.hasta || new Date().toISOString().slice(0, 10);
    const desde = req.query.desde || `${hasta.slice(0, 7)}-01`;
    const m = await metricasEmpleado(tid, desde, hasta);
    res.json({ metricas: m, indicadores: INDICADORES_EVAL, etiquetas: ETIQUETAS_EVAL, niveles: NIVELES_EVAL });
  } catch (e) { res.status(500).json({ error: 'Error al calcular métricas' }); }
});

// ---------- Planes de mejora ----------
app.get('/api/planes-mejora', requireUser, async (req, res) => {
  try {
    let q = supabase.from('planes_mejora').select('*, perfiles!planes_mejora_trabajador_id_fkey(nombre, email)').order('created_at', { ascending: false }).limit(200);
    if (!isAdmin(req)) q = q.eq('trabajador_id', req.user.id);
    else if (req.query.trabajador_id) q = q.eq('trabajador_id', req.query.trabajador_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ planes: data || [] });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/planes-mejora', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { trabajador_id, evaluacion_id, area, problema, objetivo, actividades, fecha_limite, responsable, proxima_evaluacion } = req.body || {};
    if (!trabajador_id || !area) return res.status(400).json({ error: 'trabajador_id y area son requeridos' });
    const { data, error } = await supabase.from('planes_mejora').insert({
      trabajador_id, evaluacion_id: evaluacion_id || null, area: String(area).slice(0, 200),
      problema: problema ? String(problema).slice(0, 2000) : null,
      objetivo: objetivo ? String(objetivo).slice(0, 2000) : null,
      actividades: actividades ? String(actividades).slice(0, 3000) : null,
      fecha_limite: fecha_limite || null, responsable: responsable ? String(responsable).slice(0, 200) : null,
      proxima_evaluacion: proxima_evaluacion || null, estado: 'pendiente'
    }).select().single();
    if (error) throw error;
    res.status(201).json({ plan: data });
  } catch (e) { console.error('POST plan:', e); res.status(500).json({ error: 'Error al crear plan' }); }
});

app.patch('/api/planes-mejora/:id', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { estado, ...resto } = req.body || {};
    const update = {};
    if (estado && ['pendiente', 'en_proceso', 'completado'].includes(estado)) update.estado = estado;
    for (const f of ['problema', 'objetivo', 'actividades', 'fecha_limite', 'responsable', 'proxima_evaluacion', 'area']) {
      if (resto[f] !== undefined) update[f] = resto[f] ? String(resto[f]).slice(0, 3000) : null;
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });
    const { data, error } = await supabase.from('planes_mejora').update(update).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ plan: data });
  } catch (e) { res.status(500).json({ error: 'Error al actualizar plan' }); }
});

// ---------- Capacitaciones ----------
app.get('/api/capacitaciones', requireUser, async (req, res) => {
  try {
    let q = supabase.from('capacitaciones').select('*, perfiles!capacitaciones_trabajador_id_fkey(nombre, email)').order('fecha', { ascending: false }).limit(300);
    if (!isAdmin(req)) q = q.eq('trabajador_id', req.user.id);
    else if (req.query.trabajador_id) q = q.eq('trabajador_id', req.query.trabajador_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ capacitaciones: data || [] });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/capacitaciones', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { trabajador_id, curso, fecha, horas, tipo } = req.body || {};
    if (!trabajador_id || !curso) return res.status(400).json({ error: 'trabajador_id y curso son requeridos' });
    const { data, error } = await supabase.from('capacitaciones').insert({
      trabajador_id, curso: String(curso).slice(0, 300), fecha: fecha || new Date().toISOString().slice(0, 10),
      horas: horas != null ? Number(horas) : null, tipo: tipo ? String(tipo).slice(0, 100) : null
    }).select().single();
    if (error) throw error;
    res.status(201).json({ capacitacion: data });
  } catch (e) { res.status(500).json({ error: 'Error al registrar capacitación' }); }
});

// ---------- Encuestas de satisfacción ----------
app.post('/api/encuestas', requireUser, async (req, res) => {
  try {
    const { paciente_id, puntuacion, comentario } = req.body || {};
    const p = Number(puntuacion);
    if (!paciente_id || !(p >= 1 && p <= 5)) return res.status(400).json({ error: 'paciente_id y puntuacion (1-5) requeridos' });
    // Familiar/staff solo puede evaluar pacientes vinculados o asignados
    let trabajador_id = null;
    if (!isAdmin(req)) {
      const rol = req.user?.perfil?.rol;
      if (rol === 'familiar') {
        const { data: v } = await supabase.from('vinculos_familiar').select('id').eq('paciente_id', paciente_id).eq('familiar_id', req.user.id).eq('activo', true).limit(1);
        if (!v?.length) return res.status(403).json({ error: 'Paciente no vinculado' });
      } else {
        const { data: v } = await supabase.from('visitas').select('id').eq('paciente_id', paciente_id).eq('trabajador_id', req.user.id).neq('estado', 'cancelada').limit(1);
        if (!v?.length) return res.status(403).json({ error: 'Paciente no asignado' });
      }
      // Trabajador evaluado = último profesional que atendió al paciente
      const { data: ult } = await supabase.from('visitas').select('trabajador_id').eq('paciente_id', paciente_id).not('trabajador_id', 'is', null).order('fecha', { ascending: false }).limit(1).maybeSingle();
      trabajador_id = ult?.trabajador_id || null;
    }
    const { data, error } = await supabase.from('encuestas').insert({
      paciente_id, trabajador_id, autor_id: req.user.id, puntuacion: p,
      comentario: comentario ? String(comentario).slice(0, 1000) : null
    }).select().single();
    if (error) throw error;
    res.status(201).json({ encuesta: data });
  } catch (e) { console.error('POST encuesta:', e); res.status(500).json({ error: 'Error al registrar encuesta' }); }
});

app.get('/api/encuestas', requireUser, async (req, res) => {
  try {
    let q = supabase.from('encuestas').select('*').order('created_at', { ascending: false }).limit(300);
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
    if (req.query.trabajador_id) q = q.eq('trabajador_id', req.query.trabajador_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ encuestas: data || [] });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// ---------- Encuestas de satisfacción familiar (mensuales) ----------
const PREGUNTAS_ENCUESTA = [
  { k: 'puntualidad_1', aspecto: 'A. Puntualidad', texto: 'El profesional llega puntualmente al domicilio' },
  { k: 'puntualidad_2', aspecto: 'A. Puntualidad', texto: 'Respeta los horarios establecidos para las sesiones' },
  { k: 'calidad_1', aspecto: 'B. Calidad del servicio', texto: 'El servicio proporcionado es profesional y de calidad' },
  { k: 'calidad_2', aspecto: 'B. Calidad del servicio', texto: 'Observa avances o beneficios en la atención de su familiar' },
  { k: 'trato_1', aspecto: 'C. Trato', texto: 'El profesional trata al adulto mayor con respeto, paciencia y empatía' },
  { k: 'trato_2', aspecto: 'C. Trato', texto: 'Respeta su dignidad, privacidad y necesidades individuales' },
  { k: 'comunicacion_1', aspecto: 'D. Comunicación', texto: 'El profesional mantiene informada a la familia sobre las actividades' },
  { k: 'comunicacion_2', aspecto: 'D. Comunicación', texto: 'Recibe información clara sobre la evolución y necesidades' },
  { k: 'paquete_1', aspecto: 'E. Paquete contratado', texto: 'Se cumplen las visitas y actividades del paquete contratado' },
  { k: 'paquete_2', aspecto: 'E. Paquete contratado', texto: 'El servicio corresponde a lo que la agencia ofreció' },
  { k: 'general_1', aspecto: 'F. Satisfacción general', texto: 'Qué tan satisfecho está con el servicio de este mes' },
  { k: 'general_2', aspecto: 'F. Satisfacción general', texto: 'Recomendaría nuestra agencia a otros familiares' }
];
const NIVELES_ENC = { 1: 'Muy insatisfecho', 2: 'Insatisfecho', 3: 'Regular', 4: 'Satisfecho', 5: 'Muy satisfecho' };

async function periodoAnterior() {
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

async function generarEncuestasPeriodo(periodo) {
  const [desde, hasta] = [`${periodo}-01`, `${periodo}-31`];
  const { data: visitas } = await supabase.from('visitas').select('paciente_id, trabajador_id').gte('fecha', desde).lte('fecha', hasta).neq('estado', 'cancelada');
  // Una encuesta por cada combinación paciente + profesional que atendió ese mes
  const combos = new Map();
  for (const v of visitas || []) {
    if (!v.paciente_id) continue;
    const key = `${v.paciente_id}|${v.trabajador_id || ''}`;
    if (!combos.has(key)) combos.set(key, { paciente_id: v.paciente_id, trabajador_id: v.trabajador_id || null });
  }
  let creadas = 0;
  for (const c of combos.values()) {
    const { data: vinculos } = await supabase.from('vinculos_familiar').select('familiar_id').eq('paciente_id', c.paciente_id).eq('activo', true);
    if (!vinculos?.length) continue;
    const { data: pac } = await supabase.from('pacientes').select('nombre, apellido').eq('id', c.paciente_id).maybeSingle();
    let prof = null;
    if (c.trabajador_id) {
      const { data: p } = await supabase.from('perfiles').select('nombre, profesion').eq('id', c.trabajador_id).maybeSingle();
      prof = p;
    }
    const profTxt = prof ? ` atendido por ${prof.nombre}${prof.profesion ? ` (${prof.profesion})` : ''}` : '';
    for (const v of vinculos) {
      // Dedupe manual (trabajador_id puede ser null y unique no lo cubre)
      let eq = supabase.from('encuestas_periodicas').select('id')
        .eq('paciente_id', c.paciente_id).eq('familiar_id', v.familiar_id).eq('periodo', periodo);
      eq = c.trabajador_id ? eq.eq('trabajador_id', c.trabajador_id) : eq.is('trabajador_id', null);
      const { data: ya } = await eq.limit(1);
      if (ya?.length) continue;
      const { error } = await supabase.from('encuestas_periodicas').insert(
        { paciente_id: c.paciente_id, trabajador_id: c.trabajador_id, familiar_id: v.familiar_id, periodo, estado: 'pendiente' }
      );
      if (error) continue;
      creadas++;
      await supabase.from('notificaciones').insert({
        destinatario_id: v.familiar_id, tipo: 'encuesta',
        mensaje: `Tienes una encuesta de satisfacción pendiente: ${pac?.nombre || ''} ${pac?.apellido || ''}${profTxt} — ${periodo}.`,
        datos: { encuesta_periodo: periodo, paciente_id: c.paciente_id }
      });
      broadcast({ tipo: 'notificacion', datos: { tipo: 'encuesta' } });
    }
  }
  return creadas;
}

async function recordarEncuestas() {
  const hace5d = new Date(Date.now() - 5 * 86400000).toISOString();
  const { data: pend } = await supabase.from('encuestas_periodicas').select('*').eq('estado', 'pendiente').lt('recordatorios', 3).lt('created_at', hace5d).limit(100);
  for (const e of pend || []) {
    const { data: pac } = await supabase.from('pacientes').select('nombre, apellido').eq('id', e.paciente_id).maybeSingle();
    await supabase.from('notificaciones').insert({
      destinatario_id: e.familiar_id, tipo: 'encuesta_recordatorio',
      mensaje: `Recordatorio: encuesta de satisfacción pendiente de ${pac?.nombre || ''} ${pac?.apellido || ''} (${e.periodo}).`,
      datos: { encuesta_periodo: e.periodo }
    });
    await supabase.from('encuestas_periodicas').update({ recordatorios: (e.recordatorios || 0) + 1 }).eq('id', e.id);
  }
}

app.get('/api/encuestas-periodo', requireUser, async (req, res) => {
  try {
    let q;
    if (isAdmin(req)) {
      q = supabase.from('encuestas_periodicas')
        .select('*, pacientes(nombre, apellido, paquete_id, paquetes(nombre)), perfiles!encuestas_periodicas_familiar_id_fkey(nombre, email), trabajador:perfiles!encuestas_periodicas_trabajador_id_fkey(nombre, profesion)')
        .order('periodo', { ascending: false }).order('created_at', { ascending: false }).limit(500);
      if (req.query.periodo) q = q.eq('periodo', req.query.periodo);
      if (req.query.estado) q = q.eq('estado', req.query.estado);
      if (req.query.paciente_id) q = q.eq('paciente_id', req.query.paciente_id);
    } else {
      if (req.user?.perfil?.rol !== 'familiar') return res.status(403).json({ error: 'Solo familiares y directivo' });
      q = supabase.from('encuestas_periodicas')
        .select('*, pacientes(nombre, apellido), trabajador:perfiles!encuestas_periodicas_trabajador_id_fkey(nombre, profesion)')
        .eq('familiar_id', req.user.id).order('periodo', { ascending: false }).limit(100);
    }
    const { data, error } = await q;
    if (error) throw error;
    res.json({ encuestas: data || [], preguntas: PREGUNTAS_ENCUESTA, niveles: NIVELES_ENC });
  } catch (e) { res.status(500).json({ error: 'Error al obtener encuestas' }); }
});

app.post('/api/encuestas-periodo/:id/responder', requireUser, async (req, res) => {
  try {
    const { data: enc } = await supabase.from('encuestas_periodicas').select('*').eq('id', req.params.id).maybeSingle();
    if (!enc) return res.status(404).json({ error: 'Encuesta no encontrada' });
    if (enc.familiar_id !== req.user.id && !isAdmin(req)) return res.status(403).json({ error: 'No es tu encuesta' });
    if (enc.estado === 'respondida') return res.status(400).json({ error: 'Esta encuesta ya fue respondida' });
    const { respuestas, comentario, solicitar_contacto } = req.body || {};
    if (!respuestas || typeof respuestas !== 'object') return res.status(400).json({ error: 'Respuestas requeridas' });
    for (const p of PREGUNTAS_ENCUESTA) {
      const v = Number(respuestas[p.k]);
      if (!(v >= 1 && v <= 5)) return res.status(400).json({ error: 'Falta responder una pregunta' });
    }
    const vals = PREGUNTAS_ENCUESTA.map((p) => Number(respuestas[p.k]));
    const promedio = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
    const { data, error } = await supabase.from('encuestas_periodicas').update({
      estado: 'respondida', respuestas, comentario: comentario ? String(comentario).slice(0, 2000) : null,
      solicitar_contacto: !!solicitar_contacto, respondida_at: new Date().toISOString()
    }).eq('id', enc.id).select().single();
    if (error) throw error;
    const { data: pac } = await supabase.from('pacientes').select('nombre, apellido').eq('id', enc.paciente_id).maybeSingle();
    const { data: fam } = await supabase.from('perfiles').select('nombre').eq('id', enc.familiar_id).maybeSingle();
    const { data: prof } = enc.trabajador_id ? await supabase.from('perfiles').select('nombre').eq('id', enc.trabajador_id).maybeSingle() : { data: null };
    const quien = fam?.nombre || 'Un familiar';
    const profTxt = prof?.nombre ? ` — profesional: ${prof.nombre}` : '';
    await notifyAdmins('encuesta', `Encuesta respondida: ${quien} evaluó a ${pac?.nombre || ''} ${pac?.apellido || ''} (${enc.periodo})${profTxt} — promedio ${promedio}/5${Number(promedio) < 3 ? ' (calificación baja)' : ''}`, null, { encuesta_id: enc.id, promedio });
    res.json({ encuesta: data, promedio });
  } catch (e) { console.error('responder encuesta:', e); res.status(500).json({ error: 'Error al responder' }); }
});

app.post('/api/encuestas-periodo/generar', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const periodo = req.body?.periodo || (await periodoAnterior());
    const creadas = await generarEncuestasPeriodo(periodo);
    res.json({ ok: true, periodo, encuestas_generadas: creadas });
  } catch (e) { res.status(500).json({ error: 'Error al generar' }); }
});

app.patch('/api/encuestas-periodo/:id/accion', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { acciones, accion_responsable, accion_fecha, accion_resultado } = req.body || {};
    const update = {};
    if (acciones !== undefined) update.acciones = acciones ? String(acciones).slice(0, 3000) : null;
    if (accion_responsable !== undefined) update.accion_responsable = accion_responsable ? String(accion_responsable).slice(0, 200) : null;
    if (accion_fecha !== undefined) update.accion_fecha = accion_fecha || null;
    if (accion_resultado !== undefined) update.accion_resultado = accion_resultado ? String(accion_resultado).slice(0, 2000) : null;
    const { data, error } = await supabase.from('encuestas_periodicas').update(update).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ encuesta: data });
  } catch (e) { res.status(500).json({ error: 'Error al actualizar' }); }
});

app.get('/api/encuestas-periodo/estadisticas', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { data: encs } = await supabase.from('encuestas_periodicas').select('*, pacientes(nombre, apellido, paquete_id, paquetes(nombre)), trabajador:perfiles!encuestas_periodicas_trabajador_id_fkey(nombre, profesion)')
      .limit(1000);
    const lista = encs || [];
    const respondidas = lista.filter((e) => e.estado === 'respondida');
    const promDe = (e) => { const vals = Object.values(e.respuestas || {}).map(Number).filter((v) => v >= 1 && v <= 5); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; };
    const proms = respondidas.map(promDe).filter((x) => x != null);
    const promedio = proms.length ? proms.reduce((a, b) => a + b, 0) / proms.length : null;
    const porAspecto = {};
    for (const p of PREGUNTAS_ENCUESTA) porAspecto[p.aspecto] = [];
    for (const e of respondidas) for (const p of PREGUNTAS_ENCUESTA) { const v = Number(e.respuestas?.[p.k]); if (v >= 1 && v <= 5) porAspecto[p.aspecto].push(v); }
    const aspectoProm = Object.fromEntries(Object.entries(porAspecto).map(([k, vs]) => [k, vs.length ? +(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(2) : null]));
    const porPaciente = {};
    for (const e of respondidas) { const nom = `${e.pacientes?.nombre || ''} ${e.pacientes?.apellido || ''}`.trim() || 'Paciente'; const pr = promDe(e); if (pr != null) (porPaciente[nom] = porPaciente[nom] || []).push(pr); }
    const pacienteProm = Object.fromEntries(Object.entries(porPaciente).map(([k, vs]) => [k, +(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(2)]));
    const porTrabajador = {};
    for (const e of respondidas) {
      const nom = e.trabajador ? `${e.trabajador.nombre || ''}${e.trabajador.profesion ? ' (' + e.trabajador.profesion + ')' : ''}`.trim() : 'Sin profesional asignado';
      const pr = promDe(e); if (pr == null) continue;
      (porTrabajador[nom] = porTrabajador[nom] || []).push(pr);
    }
    const trabajadorProm = Object.fromEntries(Object.entries(porTrabajador).map(([k, vs]) => [k, +(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(2)]));
    const porPeriodo = {};
    for (const e of respondidas) { const pr = promDe(e); if (pr != null) (porPeriodo[e.periodo] = porPeriodo[e.periodo] || []).push(pr); }
    const tendencia = Object.entries(porPeriodo).sort().map(([p, vs]) => ({ periodo: p, promedio: +(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(2), n: vs.length }));
    const bajas = respondidas.filter((e) => { const pr = promDe(e); return pr != null && pr < 3; }).length;
    res.json({
      total_enviadas: lista.length, total_respondidas: respondidas.length,
      pendientes: lista.length - respondidas.length,
      participacion: lista.length ? Math.round((respondidas.length / lista.length) * 100) : 0,
      promedio_general: promedio != null ? +promedio.toFixed(2) : null,
      por_aspecto: aspectoProm, por_paciente: pacienteProm, por_trabajador: trabajadorProm, tendencia, bajas
    });
  } catch (e) { res.status(500).json({ error: 'Error en estadísticas' }); }
});



// ---------- Academia de Profesionales Gerontológicos ----------
const AREAS_ACADEMIA = {
  gerontologia: 'Gerontología y envejecimiento',
  cuidados: 'Cuidados básicos e integrales del adulto mayor',
  enfermedades: 'Enfermedades crónicas y patologías geriátricas',
  fisioterapia: 'Fisioterapia y rehabilitación geriátrica',
  salud_mental: 'Psicología, salud mental y estimulación cognitiva',
  nutricion: 'Nutrición y alimentación geriátrica',
  enfermeria: 'Enfermería y atención clínica geriátrica',
  emergencias: 'Primeros auxilios y emergencias',
  paliativos: 'Cuidados paliativos y atención al final de la vida',
  etica: 'Ética, derechos humanos y trato humanizado',
  cuidador: 'Desarrollo profesional del cuidador',
  administracion: 'Administración y gestión de servicios gerontológicos',
  talleres: 'Talleres prácticos y simulación profesional'
};
const esEmpleadoAcademia = (req) => ['staff','cuidador','familiar'].includes(req.user?.perfil?.rol) || isAdmin(req);

async function inscripcionDe(cursoId, empleadoId) {
  const { data } = await supabase.from('academia_inscripciones').select('*').eq('curso_id', cursoId).eq('empleado_id', empleadoId).maybeSingle();
  return data;
}

async function notificarAcademia(empleadoId, mensaje, datos) {
  await supabase.from('notificaciones').insert({ destinatario_id: empleadoId, tipo: 'academia', mensaje, datos: datos || {} });
}

// Catálogo público para empleados (cursos publicados)
app.get('/api/academia/catalogo', requireUser, async (req, res) => {
  try {
    const { data: cursos } = await supabase.from('academia_cursos').select('*').eq('estado', 'publicado').order('area').order('titulo');
    const ids = (cursos || []).map((c) => c.id);
    const { data: ins } = ids.length
      ? await supabase.from('academia_inscripciones').select('curso_id, estado, progreso, calificacion').eq('empleado_id', req.user.id).in('curso_id', ids)
      : { data: [] };
    const mapa = Object.fromEntries((ins || []).map((i) => [i.curso_id, i]));
    res.json({ cursos: (cursos || []).map((c) => ({ ...c, mi_estado: mapa[c.id]?.estado || null, mi_progreso: mapa[c.id]?.progreso || 0, mi_calificacion: mapa[c.id]?.calificacion ?? null })), areas: AREAS_ACADEMIA });
  } catch (e) { res.status(500).json({ error: 'Error del catálogo' }); }
});

// Detalle de curso: unidades + preguntas SIN respuesta correcta (para el empleado)
app.get('/api/academia/cursos/:id', requireUser, async (req, res) => {
  try {
    const { data: curso } = await supabase.from('academia_cursos').select('*').eq('id', req.params.id).maybeSingle();
    if (!curso) return res.status(404).json({ error: 'Curso no encontrado' });
    const [{ data: unidades }, { data: preguntas }, ins] = await Promise.all([
      supabase.from('academia_unidades').select('*').eq('curso_id', curso.id).order('orden'),
      supabase.from('academia_preguntas').select('id, curso_id, unidad_id, tipo, pregunta, opciones, puntos').eq('curso_id', curso.id),
      inscripcionDe(curso.id, req.user.id)
    ]);
    res.json({ curso, unidades: unidades || [], preguntas: preguntas || [], inscripcion: ins });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Auto-inscripción del empleado a un curso publicado
app.post('/api/academia/inscribir', requireUser, async (req, res) => {
  try {
    const { curso_id } = req.body || {};
    const { data: curso } = await supabase.from('academia_cursos').select('id, estado, titulo').eq('id', curso_id).maybeSingle();
    if (!curso || curso.estado !== 'publicado') return res.status(400).json({ error: 'Curso no disponible' });
    const { data: ins, error } = await supabase.from('academia_inscripciones').upsert(
      { curso_id, empleado_id: req.user.id, estado: 'en_proceso', iniciado_at: new Date().toISOString(), asignacion: 'voluntario' },
      { onConflict: 'curso_id,empleado_id', ignoreDuplicates: true }
    ).select().single();
    if (error) throw error;
    const final = ins || (await inscripcionDe(curso_id, req.user.id));
    res.json({ inscripcion: final });
  } catch (e) { res.status(500).json({ error: 'Error al inscribir' }); }
});

// Marcar unidad completada → actualiza progreso
app.post('/api/academia/progreso', requireUser, async (req, res) => {
  try {
    const { curso_id, unidad_id } = req.body || {};
    const ins = await inscripcionDe(curso_id, req.user.id);
    if (!ins) return res.status(404).json({ error: 'No estás inscrito' });
    const hechas = new Set(ins.unidades_completadas || []);
    hechas.add(unidad_id);
    const { data: total } = await supabase.from('academia_unidades').select('id', { count: 'exact', head: true }).eq('curso_id', curso_id);
    const { count } = await supabase.from('academia_unidades').select('id', { count: 'exact', head: true }).eq('curso_id', curso_id);
    const prog = count ? Math.min(100, Math.round((hechas.size / count) * 100)) : 100;
    await supabase.from('academia_inscripciones').update({ unidades_completadas: [...hechas], progreso: prog, estado: prog >= 100 ? 'en_proceso' : ins.estado }).eq('id', ins.id);
    res.json({ progreso: prog });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Evaluación: califica automáticamente, aleatoriza preguntas, respeta intentos
app.post('/api/academia/evaluar', requireUser, async (req, res) => {
  try {
    const { curso_id, respuestas } = req.body || {};
    const ins = await inscripcionDe(curso_id, req.user.id);
    if (!ins) return res.status(404).json({ error: 'No estás inscrito en este curso' });
    const { data: curso } = await supabase.from('academia_cursos').select('*').eq('id', curso_id).single();
    if (ins.intentos >= (curso.max_intentos || 3)) return res.status(400).json({ error: 'Sin intentos restantes' });
    const { data: preguntas } = await supabase.from('academia_preguntas').select('*').eq('curso_id', curso_id);
    const lista = preguntas || [];
    const cerradas = lista.filter((p) => p.tipo !== 'abierta');
    const abiertas = lista.filter((p) => p.tipo === 'abierta');
    let puntosOk = 0, puntosTot = 0;
    const evalRespuestas = {}, pendientes = [];
    for (const p of cerradas) {
      puntosTot += Number(p.puntos) || 1;
      const r = String(respuestas?.[p.id] ?? '');
      evalRespuestas[p.id] = r;
      if (r === String(p.respuesta_correcta)) puntosOk += Number(p.puntos) || 1;
    }
    for (const p of abiertas) {
      const r = String(respuestas?.[p.id] ?? '').trim();
      evalRespuestas[p.id] = r;
      if (r) pendientes.push({ pregunta_id: p.id, pregunta: p.pregunta, respuesta: r });
    }
    const porcentaje = puntosTot ? Math.round((puntosOk / puntosTot) * 1000) / 10 : 0;
    const calificacion = puntosTot ? Math.round((puntosOk / puntosTot) * curso.calificacion_minima * 100) / 100 : 0;
    const nota100 = puntosTot ? Math.round((puntosOk / puntosTot) * 1000) / 10 : 0;
    const aprobado = nota100 >= Number(curso.calificacion_minima);
    const nuevoIntentos = ins.intentos + 1;
    const updateIns = {
      intentos: nuevoIntentos,
      calificacion: aprobado ? nota100 : (ins.calificacion ?? nota100),
      progreso: aprobado ? 100 : ins.progreso,
      estado: aprobado ? 'aprobado' : (nuevoIntentos >= curso.max_intentos ? 'reprobado' : ins.estado)
    };
    if (aprobado && !ins.completado_at) { updateIns.completado_at = new Date().toISOString(); }
    await supabase.from('academia_inscripciones').update(updateIns).eq('id', ins.id);
    await supabase.from('academia_evaluaciones').insert({
      inscripcion_id: ins.id, curso_id, empleado_id: req.user.id,
      calificacion: nota100, porcentaje: nota100, respuestas: evalRespuestas,
      pendientes_revision: pendientes, intentos: nuevoIntentos
    });
    // Constancia automática al aprobar
    if (aprobado && !ins.completado_at) {
      const folio = `AGE-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900000) + 100000)}`;
      await supabase.from('academia_constancias').insert({ inscripcion_id: ins.id, empleado_id: req.user.id, curso_id, folio, calificacion: nota100, horas: curso.horas });
      await notificarAcademia(req.user.id, `¡Felicidades! Aprobaste el curso "${curso.titulo}" con ${nota100}%. Tu constancia está disponible en Mi Formación.`, { curso_id });
      broadcast({ tipo: 'academia', datos: { curso_id, empleado_id: req.user.id } });
    }
    res.json({ calificacion: nota100, aprobado, intentos: nuevoIntentos, max_intentos: curso.max_intentos, pendientes_revision: pendientes.length, mostrar_resultados: curso.mostrar_resultados });
  } catch (e) { console.error('evaluar:', e); res.status(500).json({ error: 'Error al evaluar' }); }
});

// Mi formación: resumen académico del empleado
app.get('/api/academia/mio', requireUser, async (req, res) => {
  try {
    const empId = isAdmin(req) && req.query.empleado_id ? req.query.empleado_id : req.user.id;
    const [ins, constancias, evals, protocolos, lecturas, eventos, competencias] = await Promise.all([
      supabase.from('academia_inscripciones').select('*, academia_cursos(titulo, area, horas, nivel, obligatorio, estado, instructor, video_url, material_url)').eq('empleado_id', empId).order('created_at', { ascending: false }),
      supabase.from('academia_constancias').select('*, academia_cursos(titulo, area, horas)').eq('empleado_id', empId),
      supabase.from('academia_evaluaciones').select('*, academia_cursos(titulo)').eq('empleado_id', empId).order('created_at', { ascending: false }).limit(50),
      supabase.from('academia_protocolos').select('*').eq('estado', 'vigente'),
      supabase.from('academia_lecturas').select('protocolo_id').eq('empleado_id', empId),
      supabase.from('academia_eventos').select('*').gte('fecha', new Date().toISOString().slice(0, 10)).order('fecha').limit(50),
      supabase.from('academia_competencias').select('*').eq('empleado_id', empId)
    ]);
    const leidas = new Set((lecturas.data || []).map((l) => l.protocolo_id));
    const lista = ins.data || [];
    const horas = lista.filter((i) => i.estado === 'aprobado').reduce((a, i) => a + Number(i.academia_cursos?.horas || 0), 0);
    const obligatorios = lista.filter((i) => i.academia_cursos?.obligatorio);
    const obligPendientes = obligatorios.filter((i) => i.estado !== 'aprobado').length;
    res.json({
      inscripciones: lista,
      constancias: constancias.data || [],
      evaluaciones: evals.data || [],
      protocolos: (protocolos.data || []).map((p) => ({ ...p, leido: leidas.has(p.id) })),
      eventos: eventos.data || [],
      competencias: competencias.data || [],
      resumen: {
        horas: Math.round(horas * 10) / 10,
        aprobados: lista.filter((i) => i.estado === 'aprobado').length,
        pendientes: lista.filter((i) => ['asignado', 'en_proceso'].includes(i.estado)).length,
        reprobados: lista.filter((i) => i.estado === 'reprobado').length,
        obligatorios_pendientes: obligPendientes,
        constancias: (constancias.data || []).length
      }
    });
  } catch (e) { console.error('academia/mio:', e); res.status(500).json({ error: 'Error' }); }
});

// Confirmar lectura de protocolo
app.post('/api/academia/lectura', requireUser, async (req, res) => {
  try {
    const { protocolo_id } = req.body || {};
    const { error } = await supabase.from('academia_lecturas').upsert({ protocolo_id, empleado_id: req.user.id }, { onConflict: 'protocolo_id,empleado_id', ignoreDuplicates: true });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// ---------- Administración de la Academia (solo directivo) ----------
app.get('/api/academia/admin/cursos', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { data: cursos } = await supabase.from('academia_cursos').select('*').order('created_at', { ascending: false });
    const { data: stats } = await supabase.from('academia_inscripciones').select('curso_id, estado, calificacion, progreso').limit(5000);
    const porCurso = {};
    for (const i of stats || []) {
      porCurso[i.curso_id] = porCurso[i.curso_id] || { inscritos: 0, aprobados: 0, pendientes: 0, califs: [] };
      porCurso[i.curso_id].inscritos++;
      if (i.estado === 'aprobado') porCurso[i.curso_id].aprobados++;
      if (['asignado', 'en_proceso'].includes(i.estado)) porCurso[i.curso_id].pendientes++;
      if (i.calificacion != null) porCurso[i.curso_id].califs.push(Number(i.calificacion));
    }
    res.json({ cursos: (cursos || []).map((c) => ({ ...c, stats: porCurso[c.id] || { inscritos: 0, aprobados: 0, pendientes: 0, califs: [] } })) });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/academia/admin/curso', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const b = req.body || {};
    const payload = {
      titulo: String(b.titulo || '').trim(), area: b.area, descripcion: b.descripcion || null,
      nivel: ['basico', 'intermedio', 'avanzado'].includes(b.nivel) ? b.nivel : 'basico',
      horas: Number(b.horas) || 1, obligatorio: !!b.obligatorio,
      estado: ['borrador', 'publicado', 'archivado'].includes(b.estado) ? b.estado : 'borrador',
      video_url: b.video_url || null, video_titulo: b.video_titulo || null,
      material_url: b.material_url || null, material_nombre: b.material_nombre || null,
      instructor: b.instructor || null, fecha_inicio: b.fecha_inicio || null, fecha_fin: b.fecha_fin || null,
      max_intentos: Math.min(10, Math.max(1, Number(b.max_intentos) || 3)),
      calificacion_minima: Math.min(100, Math.max(1, Number(b.calificacion_minima) || 70)),
      mostrar_resultados: b.mostrar_resultados !== false,
      modalidad: ['virtual','presencial','hibrido'].includes(b.modalidad) ? b.modalidad : 'virtual',
      etiqueta: ['formacion_basica','especializacion','actualizacion','obligatoria','taller'].includes(b.etiqueta) ? b.etiqueta : null,
      profesiones: Array.isArray(b.profesiones) ? b.profesiones : (typeof b.profesiones === 'string' ? b.profesiones.split(',').map(x=>x.trim()).filter(Boolean) : []),
      justificacion: b.justificacion || null, objetivos: b.objetivos || null, temario: b.temario || null,
      bibliografia: b.bibliografia || null, revisor: b.revisor || null,
      vigencia_anios: Math.min(10, Math.max(1, Number(b.vigencia_anios) || 2))
    };
    if (!payload.titulo || !payload.area) return res.status(400).json({ error: 'Título y área requeridos' });
    const q = b.id ? supabase.from('academia_cursos').update(payload).eq('id', b.id) : supabase.from('academia_cursos').insert(payload);
    const { data, error } = await q.select().single();
    if (error) throw error;
    res.json({ curso: data });
  } catch (e) { res.status(500).json({ error: e.message || 'Error' }); }
});

app.post('/api/academia/admin/unidad', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { id, curso_id, titulo, contenido, orden } = req.body || {};
    if (!titulo || !curso_id) return res.status(400).json({ error: 'Datos incompletos' });
    const payload = { curso_id, titulo, contenido: contenido || null, orden: Number(orden) || 1 };
    const q = id ? supabase.from('academia_unidades').update(payload).eq('id', id) : supabase.from('academia_unidades').insert(payload);
    const { data, error } = await q.select().single();
    if (error) throw error;
    res.json({ unidad: data });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/academia/admin/pregunta', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { id, curso_id, unidad_id, tipo, pregunta, opciones, respuesta_correcta, puntos } = req.body || {};
    if (!pregunta || !curso_id) return res.status(400).json({ error: 'Datos incompletos' });
    const payload = { curso_id, unidad_id: unidad_id || null, tipo: ['opcion_multiple', 'verdadero_falso', 'abierta'].includes(tipo) ? tipo : 'opcion_multiple', pregunta, opciones: opciones || null, respuesta_correcta: respuesta_correcta || null, puntos: Number(puntos) || 1 };
    const q = id ? supabase.from('academia_preguntas').update(payload).eq('id', id) : supabase.from('academia_preguntas').insert(payload);
    const { data, error } = await q.select().single();
    if (error) throw error;
    res.json({ pregunta: data });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Asignar curso: todos los empleados activos, uno específico, o por área/puesto
app.post('/api/academia/admin/asignar', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { curso_id, modo, empleado_id, filtro } = req.body || {};
    const { data: curso } = await supabase.from('academia_cursos').select('id, titulo, area').eq('id', curso_id).maybeSingle();
    if (!curso) return res.status(404).json({ error: 'Curso no encontrado' });
    let empleados = [];
    if (modo === 'todos') {
      const { data } = await supabase.from('perfiles').select('id').in('rol', ['staff', 'cuidador']).eq('estado', 'aprobado');
      empleados = data || [];
    } else if (modo === 'empleado' && empleado_id) {
      empleados = [{ id: empleado_id }];
    } else if (modo === 'area' || modo === 'puesto') {
      const campo = modo === 'area' ? 'areas' : 'puesto';
      const { data } = await supabase.from('perfiles').select('id, ' + campo).in('rol', ['staff', 'cuidador']).eq('estado', 'aprobado');
      empleados = (data || []).filter((p) => String(p[campo] || '').toLowerCase().includes(String(filtro || '').toLowerCase()));
    }
    let creadas = 0;
    for (const e of empleados) {
      const { data: ins } = await supabase.from('academia_inscripciones').upsert(
        { curso_id, empleado_id: e.id, estado: 'asignado', asignado_por: req.user.id, asignacion: modo },
        { onConflict: 'curso_id,empleado_id', ignoreDuplicates: true }
      ).select();
      if (ins?.length) {
        creadas++;
        await notificarAcademia(e.id, `Tienes un curso asignado: "${curso.titulo}". Revísalo en Mi Formación.`, { curso_id });
      }
    }
    broadcast({ tipo: 'academia', datos: { curso_id } });
    res.json({ ok: true, asignados: creadas });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Seguimiento académico: directorio de empleados con indicadores
app.get('/api/academia/admin/seguimiento', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { data: empleados } = await supabase.from('perfiles').select('id, nombre, email, profesion, puesto, rol, estado, foto_path').in('rol', ['staff', 'cuidador']).eq('estado', 'aprobado');
    const { data: ins } = await supabase.from('academia_inscripciones').select('empleado_id, curso_id, estado, progreso, calificacion, academia_cursos(titulo, horas, obligatorio)').limit(10000);
    const porEmp = {};
    for (const i of ins || []) {
      porEmp[i.empleado_id] = porEmp[i.empleado_id] || { total: 0, aprobados: 0, pendientes: 0, horas: 0, califs: [], obligPend: 0, ultima: null };
      const p = porEmp[i.empleado_id];
      p.total++;
      if (i.estado === 'aprobado') { p.aprobados++; p.horas += Number(i.academia_cursos?.horas || 0); }
      if (['asignado', 'en_proceso'].includes(i.estado)) { p.pendientes++; if (i.academia_cursos?.obligatorio) p.obligPend++; }
      if (i.calificacion != null) p.califs.push(Number(i.calificacion));
    }
    const lista = (empleados || []).map((e) => {
      const p = porEmp[e.id] || { total: 0, aprobados: 0, pendientes: 0, horas: 0, califs: [], obligPend: 0 };
      const pct = p.total ? Math.round((p.aprobados / p.total) * 100) : 0;
      return { ...e, cursos_total: p.total, cursos_aprobados: p.aprobados, cursos_pendientes: p.pendientes, horas: Math.round(p.horas * 10) / 10, promedio: p.califs.length ? Math.round((p.califs.reduce((a, b) => a + b, 0) / p.califs.length) * 10) / 10 : null, pct, obligatorios_pendientes: p.obligPend };
    });
    res.json({ empleados: lista });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Detalle académico de un empleado (para el directivo)
app.get('/api/academia/admin/empleado/:id', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const r = await fetch(`http://localhost:${PORT}/api/academia/mio?empleado_id=${req.params.id}`, { headers: { authorization: req.headers.authorization } });
    res.status(r.status).json(await r.json());
  } catch (e) {
    // fallback directo
    const { data } = await supabase.from('academia_inscripciones').select('*, academia_cursos(titulo, area, horas, nivel, obligatorio, instructor)').eq('empleado_id', req.params.id).order('created_at', { ascending: false });
    res.json({ inscripciones: data || [], resumen: {} });
  }
});

// Evaluaciones pendientes de revisión (preguntas abiertas)
app.get('/api/academia/admin/evaluaciones', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { data } = await supabase.from('academia_evaluaciones').select('*, perfiles!academia_evaluaciones_empleado_id_fkey(nombre), academia_cursos(titulo)').order('created_at', { ascending: false }).limit(200);
    const pendientes = (data || []).filter((e) => (e.pendientes_revision || []).length);
    res.json({ evaluaciones: data || [], pendientes_count: pendientes.length });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Estadísticas de la academia
app.get('/api/academia/admin/stats', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const [cursos, ins, constancias, evals] = await Promise.all([
      supabase.from('academia_cursos').select('id, titulo, area, horas, estado'),
      supabase.from('academia_inscripciones').select('curso_id, empleado_id, estado, calificacion, progreso').limit(10000),
      supabase.from('academia_constancias').select('id'),
      supabase.from('academia_evaluaciones').select('calificacion, empleado_id, curso_id')
    ]);
    const insL = ins.data || [];
    const porCurso = {};
    for (const i of insL) {
      porCurso[i.curso_id] = porCurso[i.curso_id] || { inscritos: 0, aprobados: 0, califs: [] };
      porCurso[i.curso_id].inscritos++;
      if (i.estado === 'aprobado') porCurso[i.curso_id].aprobados++;
      if (i.calificacion != null) porCurso[i.curso_id].califs.push(Number(i.calificacion));
    }
    const horasTotales = insL.filter((i) => i.estado === 'aprobado').reduce((a, i) => {
      const c = (cursos.data || []).find((x) => x.id === i.curso_id);
      return a + Number(c?.horas || 0);
    }, 0);
    const califs = (evals.data || []).map((e) => Number(e.calificacion)).filter((v) => v != null && !isNaN(v));
    res.json({
      cursos_total: (cursos.data || []).length,
      cursos_publicados: (cursos.data || []).filter((c) => c.estado === 'publicado').length,
      inscripciones: insL.length,
      aprobados: insL.filter((i) => i.estado === 'aprobado').length,
      pendientes: insL.filter((i) => ['asignado', 'en_proceso'].includes(i.estado)).length,
      constancias: (constancias.data || []).length,
      horas_totales: Math.round(horasTotales * 10) / 10,
      promedio_general: califs.length ? Math.round((califs.reduce((a, b) => a + b, 0) / califs.length) * 10) / 10 : null,
      por_curso: Object.entries(porCurso).map(([curso_id, s]) => ({
        curso_id, titulo: (cursos.data || []).find((c) => c.id === curso_id)?.titulo || curso_id,
        inscritos: s.inscritos, aprobados: s.aprobados,
        promedio: s.califs.length ? Math.round((s.califs.reduce((a, b) => a + b, 0) / s.califs.length) * 10) / 10 : null
      })).sort((a, b) => b.inscritos - a.inscritos)
    });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Protocolo CRUD + competencias + eventos (admin)
app.post('/api/academia/admin/protocolo', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { id, nombre, version, descripcion, contenido_url, estado, responsable } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const payload = { nombre, version: version || null, descripcion: descripcion || null, contenido_url: contenido_url || null, estado: estado || 'vigente', responsable: responsable || null, updated_at: new Date().toISOString() };
    const q = id ? supabase.from('academia_protocolos').update(payload).eq('id', id) : supabase.from('academia_protocolos').insert(payload);
    const { data, error } = await q.select().single();
    if (error) throw error;
    // Notificar nueva versión a todos los empleados
    if (!id || payload.estado === 'vigente') {
      const { data: emps } = await supabase.from('perfiles').select('id').in('rol', ['staff', 'cuidador']).eq('estado', 'aprobado');
      for (const e of emps || []) await notificarAcademia(e.id, `Nuevo/actualizado protocolo: "${nombre}" v${version || '1.0'}. Confirma su lectura en Mi Formación.`, { protocolo_id: data.id });
    }
    res.json({ protocolo: data });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/academia/admin/competencia', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { empleado_id, competencia, dimension, nivel, notas } = req.body || {};
    if (!empleado_id || !competencia || !nivel) return res.status(400).json({ error: 'Datos incompletos' });
    const { data, error } = await supabase.from('academia_competencias').insert({
      empleado_id, competencia, dimension: ['conocimientos', 'habilidades', 'actitudes', 'etica'].includes(dimension) ? dimension : 'conocimientos',
      nivel: Math.min(4, Math.max(1, Number(nivel))), evaluador: req.user.perfil?.nombre || req.user.email, notas: notas || null
    }).select().single();
    if (error) throw error;
    res.json({ competencia: data });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/academia/admin/evento', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { id, nombre, fecha, hora, duracion, instructor, modalidad, ubicacion, descripcion } = req.body || {};
    if (!nombre || !fecha) return res.status(400).json({ error: 'Nombre y fecha requeridos' });
    const payload = { nombre, fecha, hora: hora || null, duracion: duracion || null, instructor: instructor || null, modalidad: modalidad || 'virtual', ubicacion: ubicacion || null, descripcion: descripcion || null };
    const q = id ? supabase.from('academia_eventos').update(payload).eq('id', id) : supabase.from('academia_eventos').insert(payload);
    const { data, error } = await q.select().single();
    if (error) throw error;
    res.json({ evento: data });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/academia/admin/asistencia', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { evento_id, asistencias } = req.body || {};
    for (const a of asistencias || []) {
      await supabase.from('academia_asistencia').upsert({ evento_id, empleado_id: a.empleado_id, presente: !!a.presente }, { onConflict: 'evento_id,empleado_id' });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/academia/admin/eventos', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { data: eventos } = await supabase.from('academia_eventos').select('*').order('fecha', { ascending: false }).limit(100);
    const { data: asist } = await supabase.from('academia_asistencia').select('*').limit(5000);
    const { data: emps } = await supabase.from('perfiles').select('id, nombre, profesion').in('rol', ['staff', 'cuidador']).eq('estado', 'aprobado');
    res.json({ eventos: eventos || [], asistencia: asist || [], empleados: emps || [] });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Sembrar catálogo inicial (idempotente por título)
app.post('/api/academia/admin/sembrar', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const CATALOGO = {
  gerontologia: [
    ['Introducción a la gerontología','basico',2],['Biología del envejecimiento','intermedio',2],['Psicología del envejecimiento','intermedio',2],
    ['Sociología de la vejez','intermedio',2],['Envejecimiento saludable y activo','basico',2],['Envejecimiento exitoso','intermedio',2],
    ['Gerontología social','intermedio',2],['Teorías del envejecimiento','avanzado',3],['Derechos humanos de las personas adultas mayores','basico',2],
    ['Autonomía e independencia funcional','basico',2],['Calidad de vida en la vejez','intermedio',2],['Determinantes sociales del envejecimiento','intermedio',2],
    ['Valoración Gerontológica Integral','intermedio',3],['Modelos de atención gerontológica','intermedio',2],['Atención centrada en la persona','basico',2]
  ],
  cuidados: [
    ['Fundamentos del cuidado gerontológico','basico',2],['Higiene y aseo personal','basico',2],['Baño en cama y baño asistido','basico',2],
    ['Vestido y arreglo personal','basico',1.5],['Alimentación e hidratación','basico',1.5],['Asistencia durante la alimentación','basico',1.5],
    ['Movilización y transferencias','basico',2],['Cambios posturales','basico',1.5],['Cuidados de personas encamadas','basico',2],
    ['Prevención de lesiones por presión','intermedio',1.5],['Control de eliminación y cuidados de continencia','basico',1.5],
    ['Apoyo en actividades básicas de la vida diaria','basico',2],['Cuidados domiciliarios','basico',2],
    ['Cuidados de adultos mayores con dependencia','intermedio',2],['Seguridad y confort en el hogar','basico',1.5]
  ],
  enfermedades: [
    ['Diabetes mellitus en el adulto mayor','intermedio',2],['Hipertensión arterial','intermedio',2],['Enfermedades cardiovasculares','intermedio',2],
    ['Enfermedad pulmonar obstructiva crónica','intermedio',2],['Enfermedad renal crónica','intermedio',2],['Enfermedad de Parkinson','intermedio',2.5],
    ['Enfermedad de Alzheimer','intermedio',2.5],['Demencias y deterioro cognitivo','intermedio',2.5],['Accidente cerebrovascular','intermedio',2.5],
    ['Osteoporosis y osteoartritis','intermedio',2],['Artritis reumatoide','intermedio',2],['Cáncer en el adulto mayor','intermedio',2],
    ['Alteraciones del sueño','basico',1.5],['Depresión en la vejez','intermedio',2],['Dolor crónico','intermedio',2],
    ['Polifarmacia y riesgos farmacológicos','intermedio',2],['Síndrome de fragilidad','avanzado',2.5],['Sarcopenia','avanzado',2],
    ['Desnutrición geriátrica','intermedio',2],['Síndromes geriátricos','avanzado',2.5]
  ],
  fisioterapia: [
    ['Fundamentos de fisioterapia geriátrica','basico',2],['Valoración funcional del adulto mayor','intermedio',2.5],['Movilidad articular y flexibilidad','basico',2],
    ['Fortalecimiento muscular','intermedio',2],['Entrenamiento de equilibrio','intermedio',2],['Reeducación de la marcha','intermedio',2.5],
    ['Prevención de caídas','basico',2],['Ejercicio terapéutico en personas mayores','intermedio',2],
    ['Rehabilitación posterior a un accidente cerebrovascular','avanzado',3],['Intervención fisioterapéutica en Parkinson','avanzado',3],
    ['Rehabilitación en pacientes con Alzheimer','intermedio',2],['Rehabilitación en osteoporosis','intermedio',2],
    ['Terapia física en pacientes encamados','basico',2],['Uso de auxiliares de marcha','basico',1.5],
    ['Transferencias y manejo corporal seguro','basico',2],['Actividad física adaptada','intermedio',2],
    ['Rehabilitación de la funcionalidad','intermedio',2.5],['Terapia ocupacional en geriatría','intermedio',2],
    ['Estimulación sensoriomotriz','basico',1.5],['Rehabilitación domiciliaria','intermedio',2.5]
  ],
  salud_mental: [
    ['Psicología del adulto mayor','intermedio',2],['Salud mental en la vejez','intermedio',2],['Depresión y ansiedad','intermedio',2],
    ['Deterioro cognitivo leve','intermedio',2],['Estimulación cognitiva','basico',2],['Ejercicios de memoria','basico',1.5],
    ['Orientación temporal y espacial','basico',1.5],['Estimulación de atención y concentración','basico',1.5],
    ['Manejo de alteraciones conductuales en demencias','intermedio',2.5],['Comunicación con personas con Alzheimer','intermedio',2],
    ['Prevención del aislamiento social','basico',1.5],['Inteligencia emocional en cuidadores','intermedio',1.5],
    ['Acompañamiento emocional','basico',1.5],['Manejo del duelo','intermedio',2],['Actividades recreativas y terapéuticas','basico',1.5]
  ],
  nutricion: [
    ['Nutrición en el adulto mayor','basico',2],['Requerimientos nutricionales durante el envejecimiento','intermedio',2],
    ['Evaluación del estado nutricional','intermedio',2],['Desnutrición y riesgo nutricional','intermedio',2],
    ['Sarcopenia y alimentación','intermedio',1.5],['Hidratación en personas mayores','basico',1],
    ['Diabetes y alimentación','intermedio',2],['Hipertensión y alimentación','intermedio',2],
    ['Alimentación en pacientes con disfagia','intermedio',2],['Modificaciones de consistencia de alimentos','basico',1.5],
    ['Seguridad alimentaria','basico',1],['Elaboración de menús saludables','basico',1.5],
    ['Obesidad en el adulto mayor','intermedio',1.5],['Suplementación nutricional: criterios de evaluación','avanzado',2]
  ],
  enfermeria: [
    ['Fundamentos de enfermería geriátrica','intermedio',2.5],['Signos vitales y parámetros de vigilancia','basico',2],
    ['Valoración clínica básica','intermedio',2],['Administración segura de medicamentos por personal autorizado','intermedio',2.5],
    ['Control de glucosa capilar por personal capacitado','intermedio',2],['Cuidados de heridas','intermedio',2.5],
    ['Prevención y vigilancia de infecciones','intermedio',2],['Cuidados de sondas y dispositivos','intermedio',2.5],
    ['Manejo de pacientes con enfermedades crónicas','intermedio',2],['Identificación de signos de alarma','basico',2],
    ['Prevención de complicaciones por inmovilidad','intermedio',2],['Registro de notas de evolución','basico',1.5],
    ['Seguridad del paciente','basico',1.5],['Continuidad de cuidados','intermedio',2]
  ],
  emergencias: [
    ['Primeros auxilios básicos','basico',3],['Reanimación cardiopulmonar (RCP)','basico',3],
    ['Uso del desfibrilador externo automático (DEA)','intermedio',2.5],['Atención inicial ante caídas','basico',1.5],
    ['Reconocimiento de accidente cerebrovascular','basico',2],['Identificación de infarto agudo de miocardio','intermedio',2],
    ['Manejo inicial de atragantamiento','basico',1.5],['Atención inicial ante quemaduras','basico',1.5],
    ['Reconocimiento de hipoglucemia','basico',1.5],['Activación de servicios de emergencia','basico',1],
    ['Atención inicial ante pérdida del estado de conciencia','basico',2],['Simulación de emergencias domiciliarias','intermedio',2]
  ],
  paliativos: [
    ['Introducción a los cuidados paliativos','intermedio',2],['Atención integral al paciente terminal','intermedio',2.5],
    ['Manejo del dolor','intermedio',2.5],['Confort y bienestar','basico',1.5],
    ['Cuidados físicos y emocionales','basico',2],['Comunicación de malas noticias','intermedio',2],
    ['Acompañamiento familiar','basico',1.5],['Duelo anticipado','intermedio',1.5],
    ['Dignidad y autonomía al final de la vida','intermedio',1.5],['Ética en los cuidados paliativos','intermedio',2]
  ],
  etica: [
    ['Ética profesional en gerontología','basico',2],['Derechos de las personas adultas mayores en México','basico',2],
    ['Prevención del maltrato al adulto mayor','basico',2],['Detección de negligencia y abandono','basico',1.5],
    ['Consentimiento informado','intermedio',1.5],['Confidencialidad y protección de datos personales','basico',1.5],
    ['Atención centrada en la persona','basico',1.5],['Comunicación asertiva','basico',1.5],
    ['Respeto a la autonomía','basico',1.5],['Dignidad humana y envejecimiento','basico',1.5],
    ['Responsabilidad profesional','basico',1],['Prevención de conflictos con familiares','intermedio',1.5]
  ],
  cuidador: [
    ['Perfil profesional del cuidador gerontológico','basico',1.5],['Funciones y responsabilidades del cuidador','basico',1.5],
    ['Técnicas de comunicación efectiva','basico',1.5],['Manejo de situaciones difíciles','intermedio',2],
    ['Prevención del síndrome del cuidador quemado','intermedio',2],['Autocuidado del profesional','basico',1.5],
    ['Trabajo en equipo multidisciplinario','basico',1.5],['Organización de actividades domiciliarias','basico',1.5],
    ['Manejo del estrés laboral','basico',1.5],['Resolución de conflictos','intermedio',1.5],
    ['Responsabilidad y puntualidad','basico',1],['Elaboración de reportes de atención','basico',1.5],
    ['Límites profesionales en el domicilio','basico',1.5],['Manejo de situaciones de riesgo','intermedio',2]
  ],
  administracion: [
    ['Administración de servicios gerontológicos','intermedio',2],['Gestión de atención domiciliaria','intermedio',2],
    ['Organización de expedientes de pacientes','basico',1.5],['Elaboración de planes individuales de atención','intermedio',2],
    ['Supervisión de personal','intermedio',2],['Indicadores de calidad en servicios gerontológicos','intermedio',2],
    ['Gestión de riesgos','intermedio',2],['Protocolos institucionales','basico',1.5],
    ['Gestión de recursos humanos','intermedio',2],['Evaluación de satisfacción familiar','basico',1.5],
    ['Mejora continua de servicios','intermedio',2],['Protección de información y expedientes clínicos','basico',1.5]
  ],
  talleres: [
    ['Taller de movilización y transferencias','basico',4],['Taller de primeros auxilios y RCP','basico',6],
    ['Taller de estimulación cognitiva','basico',4],['Taller de prevención de caídas','basico',4],
    ['Taller de higiene y cuidados personales','basico',4]
  ]
};
    const ETIQUETA = { talleres: 'taller' };
    const MODALIDAD = { talleres: 'presencial' };
    const OBLIG = new Set(['Higiene y aseo personal','Movilización y transferencias','Prevención de caídas','Ética profesional en gerontología','Primeros auxilios básicos']);
    let creados = 0, total = 0;
    for (const [area, cursos] of Object.entries(CATALOGO)) {
      for (const [titulo, nivel, horas] of cursos) {
        total++;
        const { data: existe } = await supabase.from('academia_cursos').select('id').eq('titulo', titulo).maybeSingle();
        if (existe) continue;
        await supabase.from('academia_cursos').insert({
          titulo, area, nivel, horas,
          descripcion: `Curso de formación en ${AREAS_ACADEMIA[area] || area}.`,
          estado: 'publicado', instructor: 'Academia AGI',
          obligatorio: OBLIG.has(titulo),
          modalidad: MODALIDAD[area] || 'virtual',
          etiqueta: ETIQUETA[area] || (OBLIG.has(titulo) ? 'obligatoria' : 'formacion_basica'),
          calificacion_minima: area === 'talleres' ? 80 : 70
        });
        creados++;
      }
    }
    res.json({ ok: true, cursos_creados: creados, total_semilla: total });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// ---------- Observatorio Gerontológico de Ciudad Juárez (solo directivo) ----------
const TIPOS_SERVICIO_OBS = ['hospital','centro_salud','rehabilitacion','residencia','comunitario','otro'];
const TIPOS_NECESIDAD = ['acompanamiento','terapia_fisica','cognitiva','psicologica','nutricional','cuidados_personales','prevencion_caidas','dependencia','capacitacion_familiares'];

app.get('/api/observatorio/resumen', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const [pacs, visitas, servicios, necesidades, datos, zonas] = await Promise.all([
      supabase.from('pacientes').select('id, nombre, apellido, zona, tipo_servicio, paquete_id, lat, lng, estado').limit(2000),
      supabase.from('visitas').select('paciente_id, trabajador_id, fecha, estado').gte('fecha', new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)).limit(10000),
      supabase.from('observatorio_servicios').select('*').limit(1000),
      supabase.from('observatorio_necesidades').select('*').limit(2000),
      supabase.from('observatorio_datos').select('*').order('indicador'),
      supabase.from('observatorio_zonas').select('*').eq('activo', true).limit(500)
    ]);
    const pacientes = pacs.data || [];
    const visitasL = visitas.data || [];
    const servL = servicios.data || [];
    const necL = necesidades.data || [];
    const datosL = datos.data || [];
    const zonasL = zonas.data || [];

    // Agrupar pacientes por zona (texto) — datos agregados, sin domicilios exactos
    const porZona = {};
    const zonaDe = (p) => (p.zona || '').trim() || 'Sin zona asignada';
    for (const p of pacientes) {
      const z = zonaDe(p);
      porZona[z] = porZona[z] || { zona: z, pacientes: 0, con_coords: 0, lat_sum: 0, lng_sum: 0, servicios: {}, frecuencia: {} };
      porZona[z].pacientes++;
      if (p.lat && p.lng) { porZona[z].con_coords++; porZona[z].lat_sum += p.lat; porZona[z].lng_sum += p.lng; }
    }
    // Visitas por zona (vía paciente) y profesionales
    const pacZona = Object.fromEntries(pacientes.map((p) => [p.id, zonaDe(p)]));
    const profsPorZona = {};
    for (const v of visitasL) {
      const z = pacZona[v.paciente_id];
      if (!z) continue;
      profsPorZona[z] = profsPorZona[z] || new Set();
      if (v.trabajador_id) profsPorZona[z].add(v.trabajador_id);
    }
    // Servicios/paquetes más demandados por zona
    for (const p of pacientes) {
      const z = zonaDe(p);
      const serv = p.paquete_id ? `paquete:${p.paquete_id}` : (p.tipo_servicio || 'Sin especificar');
      porZona[z].servicios[serv] = (porZona[z].servicios[serv] || 0) + 1;
    }
    // Necesidades por zona
    const necPorZona = {};
    for (const n of necL) { const z = (n.zona || '').trim() || 'General'; necPorZona[z] = necPorZona[z] || {}; necPorZona[z][n.tipo] = (necPorZona[z][n.tipo] || 0) + 1; }
    // Zonas del catálogo con coordenada
    const zonaCoords = {};
    for (const zn of zonasL) zonaCoords[zn.nombre.toLowerCase()] = zn;

    const zonasArr = Object.values(porZona).map((z) => {
      const cat = zonaCoords[z.zona.toLowerCase()];
      const lat = cat?.lat ?? (z.con_coords ? z.lat_sum / z.con_coords : null);
      const lng = cat?.lng ?? (z.con_coords ? z.lng_sum / z.con_coords : null);
      const nServ = servL.filter((s) => (s.zona || '').trim().toLowerCase() === z.zona.toLowerCase()).length;
      return {
        ...z,
        lat, lng,
        profesionales: profsPorZona[z.zona]?.size || 0,
        servicios_externos: nServ,
        necesidades: necPorZona[z.zona] || {},
        top_servicios: Object.entries(z.servicios).sort((a, b) => b[1] - a[1]).slice(0, 3)
      };
    }).sort((a, b) => b.pacientes - a.pacientes);

    // Oportunidades de expansión: zonas con pacientes pero pocos servicios externos,
    // o zonas del catálogo sin cobertura de la agencia
    const zonasSinCobertura = zonasL.filter((z) => !pacientes.some((p) => (p.zona || '').trim().toLowerCase() === z.nombre.toLowerCase()))
      .map((z) => ({ nombre: z.nombre, tipo: z.tipo, lat: z.lat, lng: z.lng, cobertura: 'sin_cobertura' }));
    const oportunidades = zonasArr
      .filter((z) => z.pacientes > 0)
      .map((z) => ({ ...z, score: z.pacientes * 2 + z.profesionales + (z.servicios_externos === 0 ? 3 : 0) }))
      .sort((a, b) => b.score - a.score).slice(0, 10);

    res.json({
      generado: new Date().toISOString(),
      kpis: {
        pacientes: pacientes.length,
        pacientes_con_zona: pacientes.filter((p) => (p.zona || '').trim()).length,
        zonas_con_cobertura: zonasArr.filter((z) => z.pacientes > 0).length,
        zonas_sin_cobertura: zonasSinCobertura.length,
        servicios_externos: servL.length,
        necesidades_registradas: necL.length,
        datos_demograficos: datosL.length
      },
      zonas: zonasArr,
      zonas_sin_cobertura: zonasSinCobertura,
      oportunidades,
      servicios: servL,
      necesidades: necL,
      datos_demograficos: datosL,
      catalogo_zonas: zonasL,
      tipos_servicio: TIPOS_SERVICIO_OBS,
      tipos_necesidad: TIPOS_NECESIDAD
    });
  } catch (e) { console.error('observatorio resumen:', e); res.status(500).json({ error: 'Error del observatorio' }); }
});

// CRUD ligero del observatorio (solo directivo)
app.post('/api/observatorio/zona', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { id, nombre, tipo, lat, lng, descripcion } = req.body || {};
    const payload = { nombre: String(nombre || '').trim(), tipo: tipo || 'colonia', lat: lat ?? null, lng: lng ?? null, descripcion: descripcion || null };
    if (!payload.nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const q = id ? supabase.from('observatorio_zonas').update(payload).eq('id', id) : supabase.from('observatorio_zonas').insert(payload);
    const { data, error } = await q.select().single();
    if (error) throw error;
    res.json({ zona: data });
  } catch (e) { res.status(500).json({ error: e.message || 'Error' }); }
});

app.post('/api/observatorio/servicio', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { id, nombre, tipo, zona, direccion, lat, lng, fuente } = req.body || {};
    const payload = { nombre: String(nombre || '').trim(), tipo: tipo || null, zona: zona || null, direccion: direccion || null, lat: lat ?? null, lng: lng ?? null, fuente: fuente || null };
    if (!payload.nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const q = id ? supabase.from('observatorio_servicios').update(payload).eq('id', id) : supabase.from('observatorio_servicios').insert(payload);
    const { data, error } = await q.select().single();
    if (error) throw error;
    res.json({ servicio: data });
  } catch (e) { res.status(500).json({ error: e.message || 'Error' }); }
});

app.post('/api/observatorio/necesidad', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { id, zona, tipo, nivel, fuente, nota } = req.body || {};
    if (!tipo) return res.status(400).json({ error: 'Tipo de necesidad requerido' });
    const payload = { zona: zona || null, tipo, nivel: nivel ? Number(nivel) : null, fuente: fuente || null, nota: nota || null };
    const q = id ? supabase.from('observatorio_necesidades').update(payload).eq('id', id) : supabase.from('observatorio_necesidades').insert(payload);
    const { data, error } = await q.select().single();
    if (error) throw error;
    res.json({ necesidad: data });
  } catch (e) { res.status(500).json({ error: e.message || 'Error' }); }
});

app.post('/api/observatorio/dato', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { id, indicador, grupo, valor, unidad, fuente, anio } = req.body || {};
    if (!indicador || valor == null) return res.status(400).json({ error: 'Indicador y valor requeridos' });
    const payload = { indicador: String(indicador).trim(), grupo: grupo || null, valor: Number(valor), unidad: unidad || null, fuente: fuente || null, anio: anio ? Number(anio) : null };
    const q = id ? supabase.from('observatorio_datos').update(payload).eq('id', id) : supabase.from('observatorio_datos').insert(payload);
    const { data, error } = await q.select().single();
    if (error) throw error;
    res.json({ dato: data });
  } catch (e) { res.status(500).json({ error: e.message || 'Error' }); }
});

app.delete('/api/observatorio/:tabla/:id', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  const permitidas = { servicios: 'observatorio_servicios', necesidades: 'observatorio_necesidades', datos: 'observatorio_datos', zonas: 'observatorio_zonas' };
  const tabla = permitidas[req.params.tabla];
  if (!tabla) return res.status(400).json({ error: 'Tabla no válida' });
  const { error } = await supabase.from(tabla).delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---------- Valoración gerontológica (escalas validadas) ----------
async function puedeAtenderPaciente(req, paciente_id) {
  if (isAdmin(req)) return true;
  if (!['staff', 'cuidador', 'familiar'].includes(req.user?.perfil?.rol)) return false;
  const { data: v } = await supabase.from('visitas').select('id, estado').eq('paciente_id', paciente_id).eq('trabajador_id', req.user.id).limit(5);
  return (v || []).some((x) => !['cancelada', 'no_show'].includes(x.estado));
}

app.get('/api/pacientes/:id/valoraciones', requireUser, async (req, res) => {
  try {
    const { data: p } = await supabase.from('pacientes').select('id').eq('id', req.params.id).maybeSingle();
    if (!p) return res.status(404).json({ error: 'Paciente no encontrado' });
    if (!(await puedeAtenderPaciente(req, p.id))) return res.status(403).json({ error: 'Sin permiso' });
    const { data, error } = await supabase.from('valoraciones')
      .select('*').eq('paciente_id', p.id).order('fecha', { ascending: false }).limit(200);
    if (error) throw error;
    res.json({ valoraciones: data || [] });
  } catch (e) { res.status(500).json({ error: 'Error al obtener valoraciones' }); }
});

app.post('/api/pacientes/:id/valoraciones', requireUser, async (req, res) => {
  try {
    const { data: p } = await supabase.from('pacientes').select('id, nombre, apellido').eq('id', req.params.id).maybeSingle();
    if (!p) return res.status(404).json({ error: 'Paciente no encontrado' });
    if (!(await puedeAtenderPaciente(req, p.id))) return res.status(403).json({ error: 'Solo personal asignado o directivo' });
    const { escala, fecha, respuestas, puntaje, interpretacion, notas } = req.body || {};
    if (!escala || puntaje == null) return res.status(400).json({ error: 'escala y puntaje son requeridos' });
    const { data: prof } = await supabase.from('perfiles').select('nombre, profesion, especialidad').eq('id', req.user.id).maybeSingle();
    const { data, error } = await supabase.from('valoraciones').insert({
      paciente_id: p.id,
      evaluador_id: req.user.id,
      evaluador_nombre: prof?.nombre || req.user.email,
      evaluador_disciplina: prof?.especialidad || prof?.profesion || null,
      escala: String(escala).slice(0, 60),
      fecha: fecha || new Date().toISOString().slice(0, 10),
      respuestas: respuestas || {},
      puntaje: Number(puntaje),
      interpretacion: interpretacion ? String(interpretacion).slice(0, 500) : null,
      notas: notas ? String(notas).slice(0, 2000) : null
    }).select().single();
    if (error) throw error;
    await auditarExpediente(p.id, null, req.user.email, 'valoracion_registrada', { escala: data.escala, puntaje: data.puntaje });
    res.status(201).json({ valoracion: data });
  } catch (e) { console.error('POST valoraciones:', e); res.status(500).json({ error: 'Error al guardar valoración' }); }
});

app.delete('/api/valoraciones/:id', requireUser, async (req, res) => {
  try {
    const { data: v } = await supabase.from('valoraciones').select('*').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'No encontrada' });
    if (!isAdmin(req) && v.evaluador_id !== req.user.id) return res.status(403).json({ error: 'Solo el evaluador o el directivo' });
    const { error } = await supabase.from('valoraciones').delete().eq('id', v.id);
    if (error) throw error;
    await auditarExpediente(v.paciente_id, null, req.user.email, 'valoracion_eliminada', { escala: v.escala, puntaje: v.puntaje });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error al eliminar' }); }
});

// Mensaje del familiar a la administración → notificación al directivo
app.post('/api/mensajes', requireUser, async (req, res) => {
  try {
   if (!['familiar', 'staff', 'cuidador'].includes(req.user?.perfil?.rol)) return res.status(403).json({ error: 'Sin permiso' });
   const texto = String(req.body?.texto || '').trim().slice(0, 1000);
   if (!texto) return res.status(400).json({ error: 'Escribe un mensaje' });
   await notifyAdmins('mensaje', `💬 Mensaje de ${req.user.perfil?.nombre || req.user.email}: ${texto}`, null, { de: req.user.email, nombre: req.user.perfil?.nombre || null, texto });
   res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error al enviar' }); }
});

// Notifica a familiares vinculados de un paciente (visitas, cambios)
async function notifyFamiliares(paciente_id, tipo, mensaje) {
  try {
   const { data: vinculos } = await supabase.from('vinculos_familiar').select('familiar_id').eq('paciente_id', paciente_id).eq('activo', true);
   const rows = (vinculos || []).map((v) => ({ destinatario_id: v.familiar_id, tipo, mensaje, datos: { paciente_id } }));
   if (rows.length) await supabase.from('notificaciones').insert(rows);
  } catch (e) { console.error('notifyFamiliares:', e); }
}

// Recordatorio diario: visitas programadas para mañana → aviso al trabajador y familiares
async function recordarVisitasManana() {
  const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const { data: visitas } = await supabase
    .from('visitas')
    .select('*, pacientes(nombre, apellido)')
    .eq('fecha', manana).eq('estado', 'programada');
  for (const v of visitas || []) {
    const pac = `${v.pacientes?.nombre || ''} ${v.pacientes?.apellido || ''}`.trim() || 'paciente';
    const msg = `Recordatorio: visita mañana ${manana}${v.hora_programada ? ' a las ' + v.hora_programada : ''} — ${pac}`;
    if (v.trabajador_id) {
      const { data: prev } = await supabase.from('notificaciones').select('id').eq('destinatario_id', v.trabajador_id).eq('tipo', 'recordatorio_visita').contains('datos', { visita_id: v.id }).limit(1);
      if (!prev?.length) {
        await supabase.from('notificaciones').insert({ destinatario_id: v.trabajador_id, tipo: 'recordatorio_visita', mensaje: msg, visita_id: v.id, datos: { visita_id: v.id, fecha: manana } });
      }
    }
    await notifyFamiliares(v.paciente_id, 'recordatorio_visita', `Recordatorio: visita de ${pac} mañana ${manana}${v.hora_programada ? ' a las ' + v.hora_programada : ''}`);
  }
  if (visitas?.length) broadcast({ tipo: 'notificacion', datos: { tipo: 'recordatorio' } });
}

app.post('/api/cron/monitor', async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  await monitorVisitas();
  await revisarSemaforos().catch((e) => console.error('revisarSemaforos:', e));
  await recordarVisitasManana().catch((e) => console.error('recordarVisitasManana:', e));
  const per = await periodoAnterior();
  const { data: yaExiste } = await supabase.from('encuestas_periodicas').select('id').eq('periodo', per).limit(1);
  if (!yaExiste?.length) await generarEncuestasPeriodo(per).catch((e) => console.error('generarEncuestasPeriodo:', e));
  await recordarEncuestas().catch((e) => console.error('recordarEncuestas:', e));
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
// Bucket privado de evidencias fotográficas (se crea solo si no existe)
let bucketEvidenciasOk = null;
async function asegurarBucketEvidencias() {
  if (bucketEvidenciasOk !== null) return bucketEvidenciasOk;
  const { error } = await supabase.storage.createBucket('evidencias', { public: false });
  bucketEvidenciasOk = !error || /already exists|duplicate/i.test(error.message || '');
  return bucketEvidenciasOk;
}

function dataUrlABuffer(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

app.post('/api/visitas/:id/nota', requireUser, async (req, res) => {
  try {
    const { data: v } = await supabase.from('visitas').select('*').eq('id', req.params.id).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
    const esPropia = v.trabajador_id === req.user.id;
    if (!esPropia && !puedeVerTodas(req)) return res.status(403).json({ error: 'Solo el trabajador asignado' });
    const campos = ['actividades', 'observaciones', 'evolucion', 'incidencias', 'recomendaciones', 'material', 'sesion', 'especialidad', 'objetivos'];
    const nota = {};
    for (const c of campos) if (req.body[c] != null) nota[c] = String(req.body[c]).slice(0, 4000);
    if (!Object.keys(nota).length) return res.status(400).json({ error: 'Escribe al menos un campo' });
    const { data, error } = await supabase.from('notas_atencion').insert({
      visita_id: v.id, paciente_id: v.paciente_id, trabajador_id: req.user.id, ...nota
    }).select().single();
    if (error) throw error;

    // Evidencias fotográficas → Supabase Storage privado + tabla evidencias
    const fotos = Array.isArray(req.body.fotos) ? req.body.fotos.slice(0, 6) : [];
    const evidencias = [];
    if (fotos.length) {
      const ok = await asegurarBucketEvidencias();
      if (ok) {
        for (let i = 0; i < fotos.length; i++) {
          const f = fotos[i] || {};
          const parsed = dataUrlABuffer(f.data);
          if (!parsed || parsed.buffer.length > 8 * 1024 * 1024) continue;
          const ext = parsed.mime.includes('png') ? 'png' : 'jpg';
          const path = `${v.id}/${data.id}/${Date.now()}-${i}.${ext}`;
          const up = await supabase.storage.from('evidencias').upload(path, parsed.buffer, { contentType: parsed.mime, upsert: false });
          if (up.error) { console.error('upload evidencia:', up.error.message); continue; }
          const { data: ev, error: evErr } = await supabase.from('evidencias').insert({
            nota_id: data.id, visita_id: v.id, paciente_id: v.paciente_id, trabajador_id: req.user.id,
            storage_path: path, descripcion: String(f.descripcion || '').slice(0, 500), nombre_archivo: String(f.nombre || `evidencia-${i + 1}.${ext}`).slice(0, 200)
          }).select().single();
          if (!evErr && ev) evidencias.push(ev);
        }
      }
    }

    await logEvento(v.id, 'nota_atencion', { por: req.user.email, evidencias: evidencias.length });
    await auditarExpediente(v.paciente_id, data.id, req.user.email, 'nota_creada', { visita_id: v.id, especialidad: nota.especialidad || null });

    // Notificación inmediata al directivo
    const { data: pac } = await supabase.from('pacientes').select('nombre, apellido').eq('id', v.paciente_id).maybeSingle();
    const { data: prof } = await supabase.from('perfiles').select('nombre, profesion, especialidad').eq('id', req.user.id).maybeSingle();
    const quien = prof?.nombre || req.user.email;
    const disc = prof?.especialidad || prof?.profesion || 'Atención general';
    const pacNom = pac ? `${pac.nombre || ''} ${pac.apellido || ''}`.trim() : 'paciente';
    await notifyAdmins('evolucion', `Nuevo reporte de evolución recibido: ${quien} atendió a ${pacNom} — ${disc}${evidencias.length ? ` · ${evidencias.length} foto(s)` : ''}`, v, {
      nota_id: data.id, trabajador: quien, paciente: pacNom, disciplina: disc, evidencias: evidencias.length
    });
    res.status(201).json({ nota: data, evidencias });
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

// ---------- Seguimiento de evolución (directivo) ----------
app.get('/api/seguimiento', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const [{ data: notas, error: e1 }, { data: evidencias, error: e2 }] = await Promise.all([
      supabase.from('notas_atencion').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('evidencias').select('*').order('created_at', { ascending: false }).limit(2000)
    ]);
    if (e1) throw e1;
    if (e2 && !/does not exist|relation/i.test(e2.message || '')) throw e2;

    const idsPac = [...new Set((notas || []).map((n) => n.paciente_id).filter(Boolean))];
    const idsTrab = [...new Set((notas || []).map((n) => n.trabajador_id).filter(Boolean))];
    const idsVis = [...new Set((notas || []).map((n) => n.visita_id).filter(Boolean))];
    const [{ data: pacs }, { data: profs }, { data: viss }] = await Promise.all([
      idsPac.length ? supabase.from('pacientes').select('id, nombre, apellido, direccion').in('id', idsPac) : { data: [] },
      idsTrab.length ? supabase.from('perfiles').select('id, nombre, profesion, especialidad').in('id', idsTrab) : { data: [] },
      idsVis.length ? supabase.from('visitas').select('id, fecha, hora_programada, llegada_at, salida_at, estado').in('id', idsVis) : { data: [] }
    ]);
    const pacMap = new Map((pacs || []).map((p) => [p.id, p]));
    const profMap = new Map((profs || []).map((p) => [p.id, p]));
    const visMap = new Map((viss || []).map((v) => [v.id, v]));
    const evPorNota = new Map();
    for (const ev of evidencias || []) {
      if (!evPorNota.has(ev.nota_id)) evPorNota.set(ev.nota_id, []);
      evPorNota.get(ev.nota_id).push(ev);
    }

    const items = (notas || []).map((n) => {
      const p = pacMap.get(n.paciente_id) || {};
      const t = profMap.get(n.trabajador_id) || {};
      const v = visMap.get(n.visita_id) || {};
      return {
        ...n,
        paciente: p, trabajador: t, visita: v,
        disciplina: t.especialidad || t.profesion || null,
        evidencias: (evPorNota.get(n.id) || []).map((e) => ({ id: e.id, descripcion: e.descripcion, nombre_archivo: e.nombre_archivo, created_at: e.created_at }))
      };
    });

    // Indicadores
    const ahora = Date.now();
    const hace30 = ahora - 30 * 86400000;
    const stats = {
      sesiones: viss.length,
      notas: items.length,
      pendientes: items.filter((n) => !n.revisado).length,
      revisadas: items.filter((n) => n.revisado).length,
      fotos: (evidencias || []).length,
      por_trabajador: {},
      pacientes_periodo: new Set(items.filter((n) => new Date(n.created_at).getTime() >= hace30).map((n) => n.paciente_id)).size
    };
    for (const n of items) {
      const k = n.trabajador?.nombre || n.trabajador?.email || 'Desconocido';
      stats.por_trabajador[k] = (stats.por_trabajador[k] || 0) + 1;
    }
    res.json({ notas: items, stats });
  } catch (e) {
    console.error('GET seguimiento:', e);
    res.status(500).json({ error: 'Error al obtener seguimiento' });
  }
});

// Revisión del directivo: marcar revisado / comentar / solicitar corrección
// Auditoría del expediente multidisciplinario
function hhmmAMin(h) {
  const m = String(h || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

async function auditarExpediente(paciente_id, nota_id, actor, accion, detalle = {}) {
  try {
   await supabase.from('auditoria_expediente').insert({ paciente_id, nota_id: nota_id || null, actor, accion, detalle });
  } catch (e) { console.error('auditarExpediente:', e.message); }
}

app.patch('/api/notas/:id', requireUser, async (req, res) => {
  try {
    const { data: notaActual } = await supabase.from('notas_atencion').select('*').eq('id', req.params.id).maybeSingle();
    if (!notaActual) return res.status(404).json({ error: 'Nota no encontrada' });
    const esAdminUser = isAdmin(req);
    const esDuenio = notaActual.trabajador_id === req.user.id;
    if (!esAdminUser && !esDuenio) return res.status(403).json({ error: 'Solo el autor o el directivo' });
    // Registro cerrado: el autor no puede modificarlo; el directivo sí (con trazabilidad)
    if (notaActual.cerrada && !esAdminUser) return res.status(403).json({ error: 'Registro cerrado — contacta al directivo para correcciones' });

    const update = {};
    if (esAdminUser) {
      if (req.body.revisado != null) { update.revisado = !!req.body.revisado; update.revisado_at = new Date().toISOString(); update.revisado_por = req.user.email; }
      if (req.body.comentario_admin != null) update.comentario_admin = String(req.body.comentario_admin).slice(0, 2000);
      if (req.body.correccion != null) update.correccion = String(req.body.correccion).slice(0, 2000);
    }
    // El autor (o admin) puede editar el contenido de su nota si no está cerrada
    const editables = ['actividades', 'observaciones', 'evolucion', 'incidencias', 'recomendaciones', 'material', 'sesion', 'especialidad', 'objetivos'];
    for (const c of editables) if (req.body[c] != null && (!notaActual.cerrada || esAdminUser)) update[c] = String(req.body[c]).slice(0, 4000);
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });

    let { data, error } = await supabase.from('notas_atencion').update(update).eq('id', req.params.id).select().single();
    if (error && /revisado|comentario_admin|correccion|PGRST204|column/i.test(error.message || '')) {
      // Columnas nuevas pueden no existir aún → reintentar solo con las básicas
      const base = {};
      if (update.revisado != null) base.revisado = update.revisado;
      const limpio = Object.keys(base).length ? base : {};
      if (!Object.keys(limpio).length) return res.status(400).json({ error: 'Columnas de revisión no existen: ejecuta el SQL en Supabase' });
      ({ data, error } = await supabase.from('notas_atencion').update(limpio).eq('id', req.params.id).select().single());
    }
    if (error) throw error;
    await auditarExpediente(notaActual.paciente_id, req.params.id, req.user.email, notaActual.cerrada ? 'correccion_admin' : 'nota_editada', { campos: Object.keys(update) });
    if (req.body.correccion) {
      const { data: n } = await supabase.from('notas_atencion').select('trabajador_id, paciente_id, visita_id').eq('id', req.params.id).maybeSingle();
      if (n?.trabajador_id) {
        await supabase.from('notificaciones').insert({
          destinatario_id: n.trabajador_id, tipo: 'correccion',
          mensaje: `El directivo solicitó una corrección en tu reporte de evolución: ${String(req.body.correccion).slice(0, 140)}`,
          visita_id: n.visita_id, datos: { nota_id: req.params.id }
        });
        broadcast({ tipo: 'notificacion', datos: { tipo: 'correccion' } });
      }
    }
    res.json({ nota: data });
  } catch (e) {
    console.error('PATCH nota:', e);
    res.status(500).json({ error: 'Error al actualizar nota' });
  }
});

// Cerrar nota de evolución: queda inmutable (correcciones solo por directivo con trazabilidad)
app.post('/api/notas/:id/cerrar', requireUser, async (req, res) => {
  try {
    const { data: nota } = await supabase.from('notas_atencion').select('trabajador_id, paciente_id, cerrada').eq('id', req.params.id).maybeSingle();
    if (!nota) return res.status(404).json({ error: 'Nota no encontrada' });
    if (!isAdmin(req) && nota.trabajador_id !== req.user.id) return res.status(403).json({ error: 'Solo el autor o el directivo' });
    if (nota.cerrada) return res.status(400).json({ error: 'La nota ya está cerrada' });
    const { data, error } = await supabase.from('notas_atencion').update({
      cerrada: true, cerrada_at: new Date().toISOString(), cerrada_por: req.user.email
    }).eq('id', req.params.id).select().single();
    if (error) throw error;
    await auditarExpediente(nota.paciente_id, req.params.id, req.user.email, 'nota_cerrada', {});
    res.json({ nota: data });
  } catch (e) {
    console.error('POST cerrar nota:', e);
    res.status(500).json({ error: 'Error al cerrar nota' });
  }
});

// Evidencias de una nota (solo admin o el trabajador dueño)
app.get('/api/notas/:id/evidencias', requireUser, async (req, res) => {
  try {
    const { data: n } = await supabase.from('notas_atencion').select('trabajador_id').eq('id', req.params.id).maybeSingle();
    if (!n) return res.status(404).json({ error: 'Nota no encontrada' });
    if (n.trabajador_id !== req.user.id && !isAdmin(req)) return res.status(403).json({ error: 'Sin permiso' });
    const { data, error } = await supabase.from('evidencias').select('*').eq('nota_id', req.params.id).order('created_at');
    if (error) {
      if (/does not exist|relation/i.test(error.message || '')) return res.json({ evidencias: [] });
      throw error;
    }
    res.json({ evidencias: data || [] });
  } catch (e) {
    console.error('GET evidencias:', e);
    res.status(500).json({ error: 'Error al obtener evidencias' });
  }
});

// URL firmada temporal para ver/descargar una evidencia (privada)
app.get('/api/evidencias/:id/archivo', requireUser, async (req, res) => {
  try {
    const { data: ev } = await supabase.from('evidencias').select('*').eq('id', req.params.id).maybeSingle();
    if (!ev) return res.status(404).json({ error: 'Evidencia no encontrada' });
    if (ev.trabajador_id !== req.user.id && !isAdmin(req)) return res.status(403).json({ error: 'Sin permiso — solo personal autorizado' });
    const { data, error } = await supabase.storage.from('evidencias').createSignedUrl(ev.storage_path, 3600);
    if (error) throw error;
    res.json({ url: data.signedUrl });
  } catch (e) {
    console.error('GET evidencia archivo:', e);
    res.status(500).json({ error: 'No se pudo generar el enlace' });
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
    const { nombre, descripcion, servicios, precio, duracion_min, activo = true } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
    const fila = {
      nombre: String(nombre).slice(0, 200), descripcion: String(descripcion || '').slice(0, 2000),
      servicios: String(servicios || '').slice(0, 4000),
      precio: precio != null ? Number(precio) : null, duracion_min: duracion_min != null ? Number(duracion_min) : null,
      activo: !!activo
    };
    let { data, error } = await supabase.from('paquetes').insert(fila).select().single();
    if (error && /servicios|PGRST204|column/i.test(error.message || '')) {
      const { servicios: _s, ...sinServicios } = fila;
      ({ data, error } = await supabase.from('paquetes').insert(sinServicios).select().single());
    }
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
    for (const f of ['nombre', 'descripcion', 'servicios']) if (req.body[f] != null) update[f] = String(req.body[f]).slice(0, 4000);
    if (req.body.precio != null) update.precio = Number(req.body.precio);
    if (req.body.duracion_min != null) update.duracion_min = Number(req.body.duracion_min);
    if (req.body.activo != null) update.activo = !!req.body.activo;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada que actualizar' });
    let { data, error } = await supabase.from('paquetes').update(update).eq('id', req.params.id).select().single();
    if (error && update.servicios != null && /servicios|PGRST204|column/i.test(error.message || '')) {
      delete update.servicios;
      if (!Object.keys(update).length) return res.json({ paquete: null });
      ({ data, error } = await supabase.from('paquetes').update(update).eq('id', req.params.id).select().single());
    }
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
  app.use(express.static(webBuild, { extensions: ['html'] }));
  // SPA fallback: cualquier ruta que no sea /api devuelve index.html
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webBuild, 'index.html')));
}


// ---------- Academia: exámenes por unidad, examen final y banco de contenido ----------
const MEJOR_CALIF_UNIDAD = async (inscripcionId) => {
  const { data } = await supabase.from('academia_unidad_intentos').select('unidad_id, calificacion, estado').eq('inscripcion_id', inscripcionId);
  const m = {};
  for (const i of data || []) if (!m[i.unidad_id] || Number(i.calificacion) > Number(m[i.unidad_id].calificacion)) m[i.unidad_id] = i;
  return m;
};

function calificarPreguntas(preguntas, respuestas) {
  let ok = 0, tot = 0; const det = [];
  for (const p of preguntas) {
    const pts = Number(p.puntos) || 1; tot += pts;
    const r = String(respuestas?.[p.id] ?? '');
    const bien = r === String(p.respuesta_correcta);
    if (bien) ok += pts;
    det.push({ id: p.id, pregunta: p.pregunta, correcta: bien, respuesta_correcta: p.respuesta_correcta, retroalimentacion: p.retroalimentacion || null, opciones: p.opciones });
  }
  return { calificacion: tot ? Math.round((ok / tot) * 1000) / 10 : 0, correctas: ok, total: tot, detalle: det };
}

// Detalle de curso con estado de cada unidad para el empleado
app.get('/api/academia/curso/:id/progreso', requireUser, async (req, res) => {
  try {
    const ins = await inscripcionDe(req.params.id, req.user.id);
    if (!ins) return res.json({ inscripcion: null });
    const [{ data: unidades }, intentos] = await Promise.all([
      supabase.from('academia_unidades').select('*').eq('curso_id', req.params.id).order('orden'),
      MEJOR_CALIF_UNIDAD(ins.id)
    ]);
    const aprobadas = new Set(ins.unidades_aprobadas || []);
    const estados = (unidades || []).map((u, i) => {
      const t = intentos[u.id];
      let estado = 'no_iniciada';
      if (aprobadas.has(u.id) || t?.estado === 'aprobado') estado = 'aprobada';
      else if (t) estado = t.calificacion >= 80 ? 'aprobada' : 'no_aprobada';
      else {
        const prevAprobada = i === 0 || aprobadas.has((unidades[i - 1] || {}).id) || intentos[(unidades[i - 1] || {})?.id]?.estado === 'aprobado';
        estado = prevAprobada ? 'disponible' : 'bloqueada';
      }
      return { ...u, estado, mejor_calificacion: t?.calificacion ?? null, intentos: t?.intentos ?? 0 };
    });
    const todasAprobadas = estados.length > 0 && estados.every((u) => u.estado === 'aprobada');
    res.json({ inscripcion: ins, unidades: estados, todas_aprobadas: todasAprobadas, examen_final_estado: todasAprobadas ? 'disponible' : ins.examen_final_estado });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Examen de una unidad (mínimo 80, máx 3 intentos, unidades en orden)
app.post('/api/academia/examen-unidad', requireUser, async (req, res) => {
  try {
    const { curso_id, unidad_id, respuestas } = req.body || {};
    const ins = await inscripcionDe(curso_id, req.user.id);
    if (!ins) return res.status(404).json({ error: 'No estás inscrito en este curso' });
    const [{ data: unidades }, { data: preguntas }, previos] = await Promise.all([
      supabase.from('academia_unidades').select('*').eq('curso_id', curso_id).order('orden'),
      supabase.from('academia_preguntas').select('*').eq('curso_id', curso_id).eq('unidad_id', unidad_id),
      supabase.from('academia_unidad_intentos').select('calificacion, intentos').eq('inscripcion_id', ins.id).eq('unidad_id', unidad_id).order('created_at', { ascending: false })
    ]);
    const idx = (unidades || []).findIndex((u) => u.id === unidad_id);
    if (idx < 0) return res.status(400).json({ error: 'Unidad inválida' });
    // Bloqueo secuencial: todas las anteriores deben estar aprobadas
    const { data: intentosPrev } = await supabase.from('academia_unidad_intentos').select('unidad_id, estado').eq('inscripcion_id', ins.id);
    const aprobadas = new Set([...(ins.unidades_aprobadas || []), ...(intentosPrev || []).filter(i => i.estado === 'aprobado').map(i => i.unidad_id)]);
    for (let i = 0; i < idx; i++) {
      if (!aprobadas.has(unidades[i].id)) return res.status(400).json({ error: `Debes aprobar la unidad ${i + 1} antes de continuar`, bloqueada: true });
    }
    const lista = preguntas || [];
    if (!lista.length) return res.status(400).json({ error: 'Esta unidad aún no tiene examen' });
    const intentosPrevios = (previos || []).length;
    if (intentosPrevios >= 3) {
      await notificarAcademia(req.user.id, `Agotaste los intentos del examen de una unidad. El directivo revisará tu caso.`, { curso_id, unidad_id });
      return res.status(400).json({ error: 'Sin intentos restantes en esta unidad', sin_intentos: true });
    }
    const r = calificarPreguntas(lista, respuestas);
    const aprobado = r.calificacion >= 80;
    const nuevoIntentos = intentosPrevios + 1;
    await supabase.from('academia_unidad_intentos').insert({
      inscripcion_id: ins.id, unidad_id, empleado_id: req.user.id,
      calificacion: r.calificacion, correctas: r.correctas, incorrectas: r.total - r.correctas,
      total: lista.length, intentos: nuevoIntentos, estado: aprobado ? 'aprobado' : 'no_aprobado',
      respuestas: Object.fromEntries(lista.map(p => [p.id, String(respuestas?.[p.id] ?? '')]))
    });
    let nuevasAprobadas = [...aprobadas];
    if (aprobado && !aprobadas.has(unidad_id)) nuevasAprobadas.push(unidad_id);
    const { count: totalUnidades } = await supabase.from('academia_unidades').select('id', { count: 'exact', head: true }).eq('curso_id', curso_id);
    const progreso = totalUnidades ? Math.round((nuevasAprobadas.length / totalUnidades) * 100) : ins.progreso;
    const todas = totalUnidades > 0 && nuevasAprobadas.length >= totalUnidades;
    await supabase.from('academia_inscripciones').update({
      unidades_aprobadas: nuevasAprobadas, progreso,
      estado: ins.estado === 'asignado' ? 'en_proceso' : ins.estado,
      examen_final_estado: todas ? 'disponible' : ins.examen_final_estado
    }).eq('id', ins.id);
    broadcast({ tipo: 'academia', datos: { curso_id, empleado_id: req.user.id, unidad: idx + 1, aprobado } });
    res.json({ calificacion: r.calificacion, aprobado, correctas: Math.round(r.correctas), incorrectas: Math.round(r.total - r.correctas), total: lista.length, intentos: nuevoIntentos, max_intentos: 3, progreso, todas_aprobadas: todas, detalle: r.detalle });
  } catch (e) { console.error('examen-unidad:', e); res.status(500).json({ error: 'Error al evaluar' }); }
});

// Examen final integrador (preguntas sin unidad asignada; si no hay, usa todas)
app.post('/api/academia/examen-final', requireUser, async (req, res) => {
  try {
    const { curso_id, respuestas } = req.body || {};
    const ins = await inscripcionDe(curso_id, req.user.id);
    if (!ins) return res.status(404).json({ error: 'No estás inscrito' });
    const { data: unidades } = await supabase.from('academia_unidades').select('id').eq('curso_id', curso_id);
    const { data: aprobadasRows } = await supabase.from('academia_unidad_intentos').select('unidad_id').eq('inscripcion_id', ins.id).eq('estado', 'aprobado');
    const aprobadas = new Set([...(ins.unidades_aprobadas || []), ...(aprobadasRows || []).map(i => i.unidad_id)]);
    if ((unidades || []).length && aprobadas.size < unidades.length) {
      return res.status(400).json({ error: 'Debes aprobar todas las unidades antes del examen final', bloqueada: true });
    }
    const { data: finales } = await supabase.from('academia_preguntas').select('*').eq('curso_id', curso_id).is('unidad_id', null);
    const lista = (finales && finales.length ? finales : (await supabase.from('academia_preguntas').select('*').eq('curso_id', curso_id)).data) || [];
    if (!lista.length) return res.status(400).json({ error: 'Este curso no tiene examen final' });
    if (ins.intentos >= 3) return res.status(400).json({ error: 'Sin intentos restantes en el examen final', sin_intentos: true });
    const { data: curso } = await supabase.from('academia_cursos').select('*').eq('id', curso_id).single();
    const r = calificarPreguntas(lista, respuestas);
    const aprobado = r.calificacion >= Number(curso.calificacion_minima || 80);
    const nuevoIntentos = ins.intentos + 1;
    await supabase.from('academia_inscripciones').update({
      intentos: nuevoIntentos, calificacion: aprobado ? r.calificacion : (ins.calificacion ?? r.calificacion),
      progreso: aprobado ? 100 : ins.progreso,
      estado: aprobado ? 'aprobado' : (nuevoIntentos >= 3 ? 'reprobado' : ins.estado),
      examen_final_estado: aprobado ? 'aprobado' : 'reprobado',
      completado_at: aprobado ? new Date().toISOString() : ins.completado_at
    }).eq('id', ins.id);
    await supabase.from('academia_evaluaciones').insert({
      inscripcion_id: ins.id, curso_id, empleado_id: req.user.id,
      calificacion: r.calificacion, porcentaje: r.calificacion, respuestas: Object.fromEntries(lista.map(p => [p.id, String(respuestas?.[p.id] ?? '')])),
      intentos: nuevoIntentos
    });
    if (aprobado) {
      const folio = `AGE-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900000) + 100000)}`;
      await supabase.from('academia_constancias').insert({ inscripcion_id: ins.id, empleado_id: req.user.id, curso_id, folio, calificacion: r.calificacion, horas: curso.horas });
      await notificarAcademia(req.user.id, `¡Felicidades! Concluiste y aprobaste "${curso.titulo}" con ${r.calificacion}%. Tu constancia está en Mi Formación.`, { curso_id });
      broadcast({ tipo: 'academia', datos: { curso_id, empleado_id: req.user.id, final: true } });
    }
    res.json({ calificacion: r.calificacion, aprobado, intentos: nuevoIntentos, max_intentos: 3, detalle: r.detalle });
  } catch (e) { console.error('examen-final:', e); res.status(500).json({ error: 'Error' }); }
});

// ---------- Sembrado de contenido académico por categoría ----------
const BANCO_PREGUNTAS = {
  gerontologia: [
    ['La gerontología se define como el estudio de:', ['La vejez únicamente','El envejecimiento en sus aspectos biológicos, psicológicos y sociales','Las enfermedades del corazón','La pediatría'], 1, 'La gerontología es multidisciplinaria y estudia el envejecimiento de forma integral.'],
    ['La Valoración Gerontológica Integral (VGI) sirve para:', ['Cobrar más por los servicios','Conocer la situación funcional, cognitiva, afectiva y social del adulto mayor','Diagnosticar enfermedades','Reemplazar al médico'], 1, 'La VGI es una herramienta de valoración multidimensional, no diagnóstica.'],
    ['El envejecimiento se caracteriza por:', ['Un proceso homogéneo en todas las personas','Un proceso heterogéneo e individual','Una enfermedad','Una etapa sin cambios'], 1, 'Cada persona envejece de manera distinta según genética, ambiente y hábitos.'],
    ['La autonomía en el adulto mayor se refiere a:', ['Depender totalmente de otros','La capacidad de decidir y ejecutar acciones por sí mismo','No tener familia','Vivir solo'], 1, 'Autonomía es la capacidad de autodeterminación y ejecución de actividades.'],
    ['Un determinante social del envejecimiento es:', ['La herencia genética únicamente','Las condiciones socioeconómicas y el entorno','El color de piel','La estatura'], 1, 'Los determinantes sociales incluyen economía, educación, vivienda y red de apoyo.'],
    ['La atención centrada en la persona implica:', ['Atender solo las órdenes médicas','Considerar preferencias, valores y autonomía del adulto mayor','Ignorar a la familia','Estandarizar todos los cuidados'], 1, 'Pone a la persona y sus preferencias al centro del cuidado.'],
    ['La calidad de vida en la vejez se relaciona con:', ['Únicamente la salud física','Bienestar físico, psicológico, social y ambiental','Solo el dinero','La apariencia'], 1, 'Es multidimensional.'],
    ['Una teoría del envejecimiento es:', ['La idea de que todos envejecen igual','El desgaste biológico programado','Una moda','Una religión'], 1, 'Las teorías explican causas biológicas, psicológicas y sociales del envejecimiento.'],
    ['El envejecimiento activo promueve:', ['El sedentarismo','La participación continua en la vida social, económica y cultural','El aislamiento','La dependencia'], 1, 'Busca optimizar oportunidades de salud, participación y seguridad.'],
    ['La gerontología social estudia:', ['Solo las células','Las relaciones del adulto mayor con su familia, comunidad y sociedad','Los huesos','Los medicamentos'], 1, 'Analiza el contexto social del envejecimiento.'],
    ['Falso o verdadero: la vejez es una enfermedad.', ['Verdadero','Falso'], 1, 'La vejez es una etapa del ciclo vital, no una enfermedad.'],
    ['La independencia funcional se mide principalmente por:', ['La edad','La capacidad de realizar actividades básicas e instrumentales de la vida diaria','El peso','La presión arterial'], 1, 'Se evalúa con escalas de AVD/AIVD.']
  ],
  cuidados: [
    ['La higiene personal del adulto mayor tiene como objetivo principal:', ['Embellecer únicamente','Mantener la salud de la piel, prevenir infecciones y promover confort','Perfumar','Cumplir un horario'], 1, 'La higiene previene infecciones, lesiones y mejora el bienestar.'],
    ['Al realizar un baño en cama se debe:', ['Usar agua muy caliente','Verificar la temperatura del agua y proteger la privacidad','Dejar al paciente solo','Usar productos irritantes'], 1, 'Seguridad térmica y dignidad son prioritarias.'],
    ['Una lesión por presión se previene principalmente con:', ['Dejar al paciente inmóvil','Cambios posturales frecuentes y alivio de presión','Más medicamentos','Pelar la piel'], 1, 'La presión sostenida sobre prominencias óseas causa úlceras.'],
    ['La movilización segura de un paciente encamado requiere:', ['Hacerlo solo sin ayuda','Técnica adecuada, apoyo del equipo y protección del cuidador','Tirar bruscamente','Usar fuerza máxima'], 1, 'Previene lesiones en paciente y cuidador.'],
    ['La deshidratación en adultos mayores es frecuente porque:', ['Beben demasiado','La sensación de sed disminuye con la edad','Les gusta el agua','Toman suplementos'], 1, 'El reflejo de sed se atenúa; hay que ofrecer líquidos con frecuencia.'],
    ['Al alimentar a un paciente con disfagia se debe:', ['Dar líquidos en gran cantidad','Ofrecer consistencias adaptadas y posición erguida','Apresurarlo','Darle de comer acostado'], 1, 'Reduce el riesgo de aspiración.'],
    ['Los cambios posturales se recomiendan cada:', ['4-6 horas','2 horas en pacientes de riesgo','12 horas','Una vez al día'], 1, 'Cada 2 horas se alternan decúbitos para prevenir úlceras.'],
    ['La continencia urinaria se refiere a:', ['No orinar nunca','La capacidad de controlar la micción','Orinar de noche','Usar pañal'], 1, 'La incontinencia es su pérdida de control.'],
    ['Falso o verdadero: el adulto mayor encamado no necesita higiene bucal.', ['Verdadero','Falso'], 1, 'La higiene bucal previene neumonías y candidiasis.'],
    ['La transferencia cama-silla debe realizarse:', ['Con el paciente de pie solo','Con técnica de pivote y ayuda de dos personas si es necesario','Arrastrando al paciente','En 30 segundos'], 1, 'La técnica correcta protege a ambos.'],
    ['Una señal de alarma durante la alimentación es:', ['Masticar despacio','Tos o atragantamiento','Sonreír','Pedir agua'], 1, 'La tos indica posible aspiración.'],
    ['La comodidad del paciente incluye:', ['Temperatura agradable, ropa limpia y posición adecuada','Solo la cama','Luces fuertes','Silencio total'], 1, 'El confort integral favorece la recuperación.']
  ],
  enfermedades: [
    ['La diabetes mellitus en el adulto mayor se caracteriza por:', ['Glucosa elevada en sangre','Presión baja','Fiebre','Sarro dental'], 0, 'La DM es hiperglucemia crónica.'],
    ['Una complicación frecuente de la hipertensión no controlada es:', ['Mejor visión','Daño cardiovascular y renal','Crecimiento de uñas','Mayor apetito'], 1, 'La HTA daña corazón, cerebro, riñón y ojos.'],
    ['La enfermedad de Alzheimer afecta principalmente:', ['Los músculos','La memoria y funciones cognitivas','Los dientes','La audición'], 1, 'Es una demencia neurodegenerativa.'],
    ['Los signos de un accidente cerebrovascular incluyen:', ['Dolor de muelas','Debilidad de un lado del cuerpo y dificultad para hablar (FAST)','Comezón','Hambre'], 1, 'Se reconoce con la regla FAST: cara, brazos, habla, tiempo.'],
    ['La osteoporosis aumenta el riesgo de:', ['Caries','Fracturas por caídas','Resfriados','Estrías'], 1, 'Los huesos pierden densidad y se fracturan con facilidad.'],
    ['La sarcopenia es:', ['Pérdida de masa muscular relacionada con la edad','Un tipo de diabetes','Una demencia','Una fractura'], 0, 'Es la pérdida progresiva de músculo y fuerza.'],
    ['La polifarmacia se refiere a:', ['Tomar un solo medicamento','El uso de múltiples medicamentos simultáneos','No tomar nada','Solo vitaminas'], 1, 'Aumenta el riesgo de interacciones y efectos adversos.'],
    ['Un síntoma de hipotensión ortostática es:', ['Mareos al incorporarse','Dolor de cabeza intenso','Sarpullido','Fiebre'], 0, 'El descenso brusco de presión al levantarse causa mareo.'],
    ['La enfermedad renal crónica en el adulto mayor se detecta con:', ['La vista','Análisis de sangre y orina','El peso solamente','La talla'], 1, 'Creatinina, urea y depuración glomerular la evidencian.'],
    ['La depresión en la vejez se manifiesta con:', ['Euforia constante','Tristeza persistente, pérdida de interés y cambios de sueño/apetito','Hiperactividad','Mejor memoria'], 1, 'Es frecuente y subdiagnosticada en mayores.'],
    ['Falso o verdadero: toda persona con demencia pierde la capacidad de comunicarse.',['Verdadero','Falso'],1,'Aunque la comunicación cambia, siempre hay formas de conectar.'],
    ['El dolor crónico en el adulto mayor debe tratarse porque:', ['No existe','Impacta la funcionalidad, el ánimo y la calidad de vida','Es normal ignorarlo','Solo se quita con cirugía'], 1, 'El dolor no tratado genera dependencia y sufrimiento.']
  ],
  fisioterapia: [
    ['El objetivo principal de la fisioterapia geriátrica es:', ['Curar enfermedades','Preservar y mejorar la funcionalidad, movilidad y autonomía','Reemplazar al médico','Eliminar el dolor siempre'], 1, 'Busca máxima independencia funcional.'],
    ['El entrenamiento de equilibrio previene:', ['La desnutrición','Las caídas','La sordera','Las arrugas'], 1, 'Mejorar el equilibrio reduce el riesgo de caídas.'],
    ['La reeducación de la marcha busca:', ['Caminar más rápido siempre','Recuperar un patrón de marcha seguro y funcional','Usar solo silla de ruedas','No caminar nunca'], 1, 'Se corrigen compensaciones y se gana seguridad.'],
    ['El ejercicio terapéutico en mayores debe ser:', ['Intenso y exhaustivo','Adaptado a la condición y capacidad de cada persona','Solo por las mañanas','Idéntico para todos'], 1, 'La prescripción es individualizada.'],
    ['Un auxiliar de marcha como la andadera se usa para:', ['Decorar','Brindar apoyo y estabilidad al caminar','Dormir','Comer'], 1, 'Amplía la base de soporte y da confianza.'],
    ['La terapia ocupacional en geriatría se enfoca en:', ['Ejercicios de fuerza únicamente','Actividades de la vida diaria y participación significativas','Solo ejercicios respiratorios','Radiografías'], 1, 'Restablece la capacidad de participar en actividades cotidianas.'],
    ['La estimulación sensoriomotriz trabaja:', ['Solo la vista','Integración de los sentidos con el movimiento','Solo el oído','La memoria exclusivamente'], 1, 'Coordina input sensorial y respuesta motora.'],
    ['Antes de un programa de ejercicio en un adulto mayor se debe:', ['Saltar el calentamiento','Valorar signos vitales, dolor y capacidad funcional','Dar el mismo ejercicio a todos','No registrar nada'], 1, 'La valoración previa garantiza seguridad.'],
    ['La rehabilitación domiciliaria tiene la ventaja de:', ['Ser más cara siempre','Contextualizar la terapia en el entorno real del paciente','No tener valor','Ser solo para médicos'], 1, 'Permite intervenir donde el paciente vive y se desenvuelve.'],
    ['La flexibilidad articular se refiere a:', ['La fuerza muscular','El rango de movimiento de una articulación','La resistencia','La velocidad'], 1, 'Se mejora con estiramientos y movilizaciones.'],
    ['Falso o verdadero: un paciente con demencia no puede beneficiarse de fisioterapia.',['Verdadero','Falso'],1,'La movilidad y el equilibrio también son entrenables en demencias.'],
    ['La marcha segura requiere principalmente:', ['Zapatos nuevos','Buena fuerza de miembros inferiores, equilibrio y entorno libre de obstáculos','Caminar rápido','Ojos cerrados'], 1, 'Factores intrínsecos y extrínsecos se combinan.']
  ],
  salud_mental: [
    ['La estimulación cognitiva consiste en:', ['Ejercicios mentales que mantienen activas las funciones cognitivas','Dormir mucho','Ver televisión pasivamente','Comer dulce'], 0, 'Busca mantener memoria, atención y lenguaje.'],
    ['Un ejercicio de orientación temporal consiste en:', ['Preguntar la fecha, día y lugar','Cerrar los ojos','Correr','No hablar'], 0, 'Refuerza la orientación en tiempo y espacio.'],
    ['La comunicación con personas con demencia debe ser:', ['Con frases largas y complejas','Simple, calmada y con contacto visual','Enojada','Por gritos'], 1, 'La claridad y el tono favorecen la comprensión.'],
    ['La inteligencia emocional del cuidador ayuda a:', ['Ignorar emociones','Manejar el estrés y responder con empatía','No sentir nada','Trabajar más horas'], 1, 'Permite regular las propias emociones en situaciones difíciles.'],
    ['El aislamiento social en el adulto mayor aumenta el riesgo de:', ['Mejor salud','Depresión y deterioro cognitivo','Fuerza muscular','Buena memoria'], 1, 'La conexión social es un factor protector.'],
    ['El manejo del duelo implica:', ['Olvidar al ser querido','Acompañar el proceso de pérdida con respeto y tiempo','Reemplazar rápido','Prohibir llorar'], 1, 'El duelo es un proceso natural que requiere acompañamiento.'],
    ['Las actividades recreativas terapéuticas buscan:', ['Solo entretener','Estimular cognición, estado de ánimo y socialización','Gastar dinero','Reemplazar la medicina'], 1, 'Tienen propósito terapéutico además del ocio.'],
    ['Un signo de ansiedad en el adulto mayor puede ser:', ['Calma total','Inquietud, tensión y dificultad para concentrarse','Sueño profundo','Apetito excesivo'], 1, 'La ansiedad se manifiesta en múltiples síntomas.'],
    ['La memoria en el envejecimiento normal muestra:', ['Pérdida total','Cambios leves que no interfieren con la vida diaria','Olvido de todo','Mejora universal'], 1, 'El envejecimiento cognitivo normal difiere de la demencia.'],
    ['La validación emocional consiste en:', ['Decir que no sienta','Reconocer y aceptar los sentimientos de la persona','Ignorar el llanto','Reírse'], 1, 'Validar no es estar de acuerdo, es reconocer la emoción.'],
    ['Falso o verdadero: las personas con demencia no entienden el tono de voz.',['Verdadero','Falso'],1,'Aunque olvidan palabras, perciben el tono y la actitud.'],
    ['La prevención de la depresión en mayores incluye:', ['Aislamiento','Actividad social, propósito y estimulación','Sedentarismo','Soledad'], 1, 'Los factores protectores reducen el riesgo.']
  ],
  nutricion: [
    ['Los requerimientos nutricionales en el adulto mayor tienden a:', ['Ser menores en calorías por menor actividad','Ser mayores en proteínas por riesgo de sarcopenia','Ser idénticos a los de un niño','No existir'], 1, 'La proteína es clave contra la sarcopenia.'],
    ['La desnutrición geriátrica se detecta con:', ['La talla solamente','Evaluación del estado nutricional, peso y ingesta','El color de piel','La presión arterial'], 1, 'Requiere valoración integral.'],
    ['En la disfagia se recomienda:', ['Líquidos abundantes','Modificaciones de consistencia y posición erguida','Comer rápido','Solo alimentos duros'], 1, 'Reduce el riesgo de aspiración.'],
    ['La hidratación en personas mayores es importante porque:', ['No tienen sed','Su cuerpo retiene menos agua y la sed se atenúa','Beben sola','El agua engorda'], 0, 'La deshidratación es un riesgo frecuente.'],
    ['Una dieta para hipertensión debe ser:', ['Alta en sodio','Baja en sodio y rica en frutas y verduras','Solo carne','Sin verduras'], 1, 'El sodio eleva la presión arterial.'],
    ['La sarcopenia se combate nutricionalmente con:', ['Azúcar','Proteína suficiente y actividad física','Solo líquidos','Ayuno'], 1, 'Proteína + ejercicio preservan músculo.'],
    ['La evaluación nutricional incluye:', ['Solo el peso','Antropometría, ingesta, laboratorio y condición clínica','La opinión','La talla del zapato'], 1, 'Es multidimensional.'],
    ['Los suplementos nutricionales deben usarse:', ['Siempre','Solo cuando exista indicación profesional','En lugar de comida','Sin revisar'], 1, 'Requieren evaluación y supervisión.'],
    ['La seguridad alimentaria en el hogar implica:', ['Dejar alimentos a temperatura ambiente','Manipulación higiénica y conservación correcta','Recalentar varias veces','Guardar crudo con cocido'], 1, 'Previene intoxicaciones.'],
    ['La obesidad en el adulto mayor puede asociarse a:', ['Mejor salud siempre','Mayor riesgo metabólico y funcional','Mayor fuerza','Menos caídas'], 1, 'El exceso de peso también genera riesgos.'],
    ['Falso o verdadero: el adulto mayor necesita menos proteína que un joven.',['Verdadero','Falso'],1,'Necesita igual o más proteína por el riesgo de sarcopenia.'],
    ['Un menú saludable para un adulto mayor debe incluir:', ['Solo líquidos','Proteína, fibra, frutas, verduras y líquidos suficientes','Solo frituras','Nada de carbohidratos'], 1, 'Equilibrio y densidad nutricional.']
  ],
  enfermeria: [
    ['La valoración clínica básica incluye:', ['Solo la presión','Signos vitales, dolor, estado general y observación','Solo el peso','La temperatura ambiente'], 1, 'Evalúa el estado de salud integral.'],
    ['La administración segura de medicamentos requiere:', ['Darlos a cualquier hora','Verificar paciente, medicamento, dosis y hora correctos','Partirlos siempre','Guardarlos en la cama'], 1, 'Los cinco correctos garantizan seguridad.'],
    ['Un signo de alarma en signos vitales es:', ['Tensión 120/80','Fiebre alta con confusión','Pulso 70','Respiración tranquila'], 1, 'Fiebre + confusión puede indicar infección grave.'],
    ['El control de glucosa capilar lo realiza:', ['Cualquier persona','Personal capacitado y autorizado','Solo el médico','Los familiares siempre'], 1, 'Requiere capacitación específica.'],
    ['La prevención de infecciones incluye:', ['No lavarse','Higiene de manos y manejo aséptico','Compartir utensilios','Dejar heridas abiertas'], 1, 'La higiene es la medida principal.'],
    ['El registro de notas de evolución sirve para:', ['Gastar papel','Documentar la evolución del paciente y continuidad de cuidados','Hacer dibujos','Nada'], 1, 'Garantiza continuidad y comunicación del equipo.'],
    ['La seguridad del paciente se basa en:', ['La velocidad','Identificación correcta y verificación de procedimientos','El silencio','La prisa'], 1, 'Evita errores de identidad y tratamiento.'],
    ['Los cuidados de una herida incluyen:', ['Dejarla sucia','Limpieza, protección y vigilancia de signos de infección','Poner tierra','No tocarla nunca'], 1, 'Previene complicaciones.'],
    ['La continuidad de cuidados significa:', ['Que cada turno invente','Que la información y el plan se transmitan correctamente','Cambiar todo','Olvidar al paciente'], 1, 'Asegura que el paciente reciba cuidado consistente.'],
    ['Un parámetro de vigilancia importante en encamados es:', ['La presión arterial solamente','Estado de la piel y puntos de presión','Solo el humor','La talla de zapatos'], 1, 'La piel es vulnerable en inmovilidad.'],
    ['Falso o verdadero: el personal no autorizado puede administrar medicamentos.',['Verdadero','Falso'],1,'Solo personal capacitado y autorizado por la institución.'],
    ['La identificación de signos de alarma permite:', ['Ignorar','Actuar tempranamente ante complicaciones','Esperar','Medicar sin orden'], 1, 'La detección temprana salva vidas.']
  ],
  emergencias: [
    ['La RCP básica consiste en:', ['Solo llamar al 911','Compresiones torácicas y ventilaciones si está capacitado','Dar agua','Mover al paciente'], 1, 'Mantiene la circulación y oxigenación.'],
    ['Ante una caída, primero se debe:', ['Levantar al paciente de inmediato','Evaluar si hay lesión y no mover si se sospecha fractura','Darle comida','Ignorar'], 1, 'La evaluación previa evita agravar lesiones.'],
    ['La regla FAST para detectar EVC se refiere a:', ['Comida, Agua, Sueño, Tiempo','Cara, Brazos, Habla, Tiempo','Fiebre, Alegría, Sudor, Tos','Fuerza, Agua, Sal, Té'], 1, 'Face, Arms, Speech, Time.'],
    ['El atragantamiento se maneja con:', ['Golpes en la espalda si no puede toser','Darle agua','Ponerlo acostado','Esperar'], 0, 'Si no tose, se aplican maniobras de desobstrucción.'],
    ['El número de emergencias en México es:', ['911','115','060','100'], 0, '911 es la línea nacional de emergencia.'],
    ['Ante un infarto sospechado se debe:', ['Dar comida','Activar emergencias y mantener reposo','Hacer ejercicio','Darle agua fría'], 1, 'Reducir la demanda cardiaca y activar ayuda.'],
    ['La hipoglucemia se reconoce por:', ['Fiebre','Sudoración, temblor y confusión','Dolor de muelas','Náuseas solamente'], 1, 'Es una urgencia que requiere glucosa rápida.'],
    ['El DEA (desfibrilador externo) se usa en:', ['Toda persona','Paro cardiorrespiratorio con ritmo desfibrilable','Dolor de cabeza','Cualquier sangrado'], 1, 'Solo personal capacitado y en paro.'],
    ['Ante quemaduras se debe:', ['Poner pasta dental','Enfriar con agua corriente y cubrir','Reventar ampollas','Poner hielo directo'], 1, 'El agua fresca reduce el daño; el hielo puede lesionar más.'],
    ['La pérdida del estado de conciencia requiere:', ['Esperar a que despierte','Evaluar vía aérea, respiración y circulación y activar emergencias','Darle de comer','Moverlo'], 1, 'Secuencia ABC y llamada de emergencia.'],
    ['Falso o verdadero: en una emergencia domiciliaria primero se debe mover al paciente.',['Verdadero','Falso'],1,'Primero se evalúa y se llama ayuda; mover solo si es seguro.'],
    ['La simulación de emergencias sirve para:', ['Practicar la respuesta ante urgencias en un entorno seguro','Entretener','Nada','Entrenar médicos únicamente'], 0, 'Fortalece la toma de decisiones bajo presión.']
  ],
  paliativos: [
    ['Los cuidados paliativos se enfocan en:', ['Curar la enfermedad siempre','Aliviar el sufrimiento y mejorar la calidad de vida','Acelerar la muerte','Solo en hospital'], 1, 'Acompañan en cualquier etapa de enfermedad grave.'],
    ['El manejo del dolor en paliativos es:', ['Opcional','Central y multidimensional','Solo con placebo','Innecesario'], 1, 'El confort es prioridad.'],
    ['La comunicación de malas noticias debe ser:', ['Brusca y rápida','Clara, empática y en el momento adecuado','Por mensaje','Nunca'], 1, 'El cómo importa tanto como el qué.'],
    ['El acompañamiento familiar en paliativos incluye:', ['Aislar a la familia','Incluir a la familia en el cuidado y el duelo','Prohibir visitas','Ignorar emociones'], 1, 'La familia es parte del proceso.'],
    ['La dignidad en el final de la vida implica:', ['Decidir por la persona','Respetar sus valores, autonomía y comodidad','Ocultar información','Forzar tratamientos'], 1, 'La persona es el centro de las decisiones.'],
    ['El duelo anticipado es:', ['Llorar antes','El proceso de adaptación que ocurre antes de la pérdida','Una enfermedad','Un tipo de demencia'], 1, 'Ocurre cuando se anticipa la pérdida.'],
    ['Los cuidados físicos en paciente terminal incluyen:', ['Solo medicinas','Confort, higiene, control de síntomas y alivio','Nada','Hospitalización forzada'], 1, 'El bienestar físico es fundamental.'],
    ['La ética en cuidados paliativos se centra en:', ['Ganar dinero','Beneficencia, no maleficencia, autonomía y justicia','Velocidad','Cantidad de turnos'], 1, 'Los principios éticos guían las decisiones.'],
    ['El confort en paliativos puede lograrse con:', ['Procedimientos invasivos','Medidas no farmacológicas y farmacológicas según necesidad','Aislamiento','Prohibir contacto'], 1, 'Enfoque integral del bienestar.'],
    ['La atención integral al paciente terminal abarca:', ['Solo lo físico','Físico, emocional, social y espiritual','Solo lo espiritual','Nada'], 1, 'Es un cuidado holístico.'],
    ['Falso o verdadero: los cuidados paliativos son solo para cancerosos.',['Verdadero','Falso'],1,'Son para cualquier enfermedad grave que amenace la calidad de vida.'],
    ['La autonomía al final de la vida significa:', ['Que la familia decida todo','Que la persona exprese sus deseos y sean respetados','No decidir nada','Que el médico decida'], 1, 'Las voluntades anticipadas y preferencias mandan.']
  ],
  etica: [
    ['La ética profesional en gerontología exige:', ['Solo obedecer','Respeto, responsabilidad y bienestar del adulto mayor','Competir','Silencio'], 1, 'El bienestar del paciente es el centro.'],
    ['La confidencialidad de la información del paciente implica:', ['Contar todo a todos','Proteger los datos personales y de salud','Publicar fotos','Ignorar normas'], 1, 'Es un derecho y un deber profesional.'],
    ['El consentimiento informado requiere:', ['Firmar sin leer','Explicar riesgos, beneficios y alternativas antes de actuar','Obligar','Ignorar preguntas'], 1, 'La persona debe decidir con información completa.'],
    ['La prevención del maltrato al adulto mayor incluye:', ['Ignorar señales','Detectar, reportar y proteger','Normalizar el abuso','Guardar silencio'], 1, 'Es obligación ética y legal reportar.'],
    ['La comunicación asertiva es:', ['Gritar','Expresar con respeto, claridad y sin agresión','Mentir','Ignorar'], 1, 'Claridad + respeto.'],
    ['El respeto a la autonomía del adulto mayor significa:', ['Decidir por él','Permitir que tome decisiones sobre su vida','Controlarlo','Ignorarlo'], 1, 'Aun con dependencia, se respetan sus preferencias.'],
    ['La responsabilidad profesional implica:', ['Hacer solo lo pedido','Actuar con competencia, honestidad y rendición de cuentas','Delegar todo','Mentir'], 1, 'Ser responsable de las propias acciones.'],
    ['La protección de datos personales en la plataforma requiere:', ['Compartir contraseñas','Manejo seguro, confidencialidad y acceso restringido','Publicar datos','Usar WiFi público sin cuidado'], 1, 'La información de salud es sensible.'],
    ['La atención centrada en la persona desde la ética busca:', ['Estandarizar','Valorar la dignidad y preferencias individuales','Acelerar','Reducir costos'], 1, 'Cada persona es única.'],
    ['La prevención de conflictos con familiares requiere:', ['Imponer criterios','Comunicación clara, empatía y límites profesionales','Ignorar','Gritar'], 1, 'La familia es aliada pero con límites.'],
    ['Falso o verdadero: un empleado puede compartir la información de un paciente con su familia sin autorización.',['Verdadero','Falso'],1,'Solo con consentimiento del paciente o tutor legal.'],
    ['La negligencia profesional se configura cuando:', ['Se hace el trabajo','Se omite un cuidado necesario causando daño','Se trabaja extra','Se pide ayuda'], 1, 'La omisión dolosa o culposa genera responsabilidad.']
  ],
  cuidador: [
    ['El perfil profesional del cuidador gerontológico incluye:', ['Solo fuerza física','Conocimientos, habilidades, actitudes y ética','Solo experiencia','Título universitario siempre'], 1, 'Es un perfil integral de competencias.'],
    ['Las funciones del cuidador incluyen:', ['Diagnosticar','Cuidar, acompañar, observar y reportar','Recetar','Operar'], 1, 'El cuidador no diagnostica ni prescribe.'],
    ['La prevención del síndrome del cuidador quemado requiere:', ['Trabajar más','Autocuidado, límites y apoyo','Aislarse','Ignorar el cansancio'], 1, 'Cuidar al que cuida es esencial.'],
    ['El autocuidado del profesional comprende:', ['Solo dormir','Salud física, emocional y límites sanos','Nada','Solo fines de semana'], 1, 'Sostiene la calidad del cuidado.'],
    ['El trabajo en equipo multidisciplinario implica:', ['Trabajar solo','Coordinarse con otros profesionales del paciente','Competir','Ignorar al equipo'], 1, 'El paciente se beneficia del trabajo conjunto.'],
    ['La organización de actividades domiciliarias incluye:', ['Hacer lo que sea','Planificar rutinas seguras y significativas',' improvisar','Nada'], 1, 'La rutina aporta seguridad y propósito.'],
    ['La responsabilidad y puntualidad del cuidador son:', ['Opcionales','Fundamentales para la confianza del paciente','Solo para médicos','Irrelevantes'], 1, 'La confianza se construye con constancia.'],
    ['El reporte de atención debe incluir:', ['Solo lo bueno','Observaciones, incidencias y evolución del paciente','Chismes','Nada'], 1, 'Documenta para continuidad del cuidado.'],
    ['Los límites profesionales en el domicilio se refieren a:', ['No tener límites','Respetar la intimidad y el espacio del paciente','Invadir todo','Ignorar normas'], 1, 'El domicilio es el espacio privado del paciente.'],
    ['El manejo de situaciones de riesgo incluye:', ['Ignorar','Identificar, reportar y actuar según protocolo','Actuar solo','Negar'], 1, 'La prevención y reporte protegen al paciente.'],
    ['Falso o verdadero: el cuidador puede administrar medicamentos sin autorización.',['Verdadero','Falso'],1,'Solo personal autorizado puede administrar medicamentos.'],
    ['La comunicación efectiva con el adulto mayor requiere:', ['Hablar de él en tercera persona','Dirigirse a él con respeto y escuchar','Gritar','Ignorar'], 1, 'La persona mayor merece ser escuchada.']
  ],
  administracion: [
    ['La administración de servicios gerontológicos busca:', ['Solo ganar dinero','Calidad, seguridad y satisfacción del paciente','Velocidad','Reducir personal'], 1, 'El paciente es el centro.'],
    ['La gestión de atención domiciliaria incluye:', ['Solo traslados','Planificación, supervisión y evaluación del servicio','Solo cobros','Nada'], 1, 'Asegura servicio ordenado y seguro.'],
    ['Los indicadores de calidad en servicios gerontológicos miden:', ['Solo ingresos','Satisfacción, seguridad, resultados y procesos','Solo quejas','El clima'], 1, 'Permiten mejorar continuamente.'],
    ['La gestión de riesgos identifica:', ['Solo oportunidades','Peligros potenciales y planes de mitigación','Solo ganancias','Nada'], 1, 'Previene incidentes.'],
    ['La evaluación de satisfacción familiar mide:', ['Solo la puntualidad','La percepción de calidad del servicio por la familia','Solo el precio','La ubicación'], 1, 'La familia es cliente clave.'],
    ['La mejora continua se basa en:', ['No cambiar nada','Ciclos de evaluación y ajuste constante','Quejas únicamente','Tradición'], 1, 'PDCA: planear, hacer, verificar, actuar.'],
    ['La protección de expedientes clínicos requiere:', ['Exhibirlos','Confidencialidad, acceso restringido y respaldo','Compartirlos','Tirarlos'], 1, 'Son información sensible.'],
    ['La supervisión de personal incluye:', ['Solo regañar','Acompañamiento, evaluación y desarrollo','Ignorar','Castigar'], 1, 'Busca el crecimiento del equipo.'],
    ['Los planes individuales de atención documentan:', ['Solo el diagnóstico','Objetivos, intervenciones y responsables del cuidado','Nada','Solo medicinas'], 1, 'Personalizan y ordenan el cuidado.'],
    ['La organización de expedientes de pacientes implica:', ['Desorden','Orden, confidencialidad y acceso controlado','Pérdida','Exhibición'], 1, 'Facilita la continuidad del cuidado.'],
    ['Falso o verdadero: los protocolos institucionales son opcionales.',['Verdadero','Falso'],1, 'Son guías obligatorias que estandarizan la calidad.'],
    ['La gestión de recursos humanos en una agencia incluye:', ['Solo contratar','Captación, formación, evaluación y retención','Solo despedir','Nada'], 1, 'El personal es el recurso clave.']
  ],
  talleres: [
    ['La movilización segura en un taller práctico se entrena con:', ['Solo teoría','Práctica supervisada con técnica correcta','Imitación','Nada'], 1, 'La habilidad se aprende practicando.'],
    ['La RCP con maniquí sirve para:', ['Entretener','Practicar compresiones y ventilaciones en condiciones realistas','Nada','Solo ver videos'], 1, 'La práctica genera confianza y destreza.'],
    ['La evaluación del entorno domiciliario en prevención de caídas incluye:', ['Solo el piso','Iluminación, alfombras, baño y obstáculos','Solo la cama','Nada'], 1, 'El entorno es factor clave de riesgo.'],
    ['El baño asistido en taller se practica para:', ['Ver cómo se hace','Dominar técnica, seguridad y dignidad','Nada','Solo teoría'], 1, 'La destreza práctica requiere repetición.'],
    ['La estimulación cognitiva en taller incluye:', ['Solo leer','Diseñar y aplicar actividades de memoria y atención','Solo dormir','Nada'], 1, 'Se aprende diseñando y practicando.'],
    ['La transferencia cama-silla en taller se evalúa por:', ['Velocidad','Seguridad, técnica y comodidad del paciente','Fuerza','Nada'], 1, 'La seguridad prima sobre la velocidad.'],
    ['El uso del DEA en taller requiere:', ['No practicar','Practicar con simulador o equipo real bajo supervisión','Solo leer','Nada'], 1, 'La práctica controlada salva vidas.'],
    ['La prevención de lesiones por presión en taller incluye:', ['Solo vendas','Técnica de cambios posturales y alivio de presión','Nada','Solo medicinas'], 1, 'La práctica correcta previene úlceras.'],
    ['La simulación de emergencias en taller permite:', ['Practicar la respuesta ante urgencias','Solo ver','Nada','Olvidar'], 1, 'Fortalece la toma de decisiones.'],
    ['La retroalimentación en un taller práctico es:', ['Crítica','Constructiva y orientada a mejorar','Ignorar','Castigo'], 1, 'Ayuda a mejorar la técnica.'],
    ['Falso o verdadero: los talleres prácticos reemplazan la teoría.',['Verdadero','Falso'],1, 'Complementan la teoría con habilidad práctica.'],
    ['La evaluación práctica de competencias se realiza mediante:', ['Solo exámenes escritos','Observación, lista de cotejo y desempeño','Solo memoria','Nada'], 1, 'Las habilidades se evalúan en la acción.']
  ]
};

const BANCO_PREGUNTAS_EXTRA = {
  gerontologia: [
    ['La vejez como etapa del ciclo vital se caracteriza por:', ['Ser una enfermedad','Cambios biológicos, psicológicos y sociales acumulados','La imposibilidad de aprender','La dependencia total'], 1, 'Es una etapa normal del desarrollo humano.'],
    ['Un factor protector del envejecimiento saludable es:', ['El aislamiento','La actividad física y social regular','El sedentarismo','La mala alimentación'], 1, 'Los hábitos saludables retrasan el deterioro.'],
    ['La valoración funcional del adulto mayor evalúa:', ['Solo los análisis de sangre','La capacidad para realizar actividades de la vida diaria','La presión arterial solamente','La talla'], 1, 'Incluye AVD y AIVD.'],
    ['La red de apoyo social del adulto mayor incluye:', ['Solo la familia nuclear','Familia, amigos, vecinos y comunidad','Solo el médico','Nadie'], 1, 'Es un factor protector clave.'],
    ['El envejecimiento poblacional en México implica:', ['Menos adultos mayores','Un aumento sostenido de la proporción de personas de 60+','Menos demanda de servicios','Sin cambios'], 1, 'La pirámide poblacional se invierte.'],
    ['La independencia del adulto mayor se promueve mediante:', ['Hacer todo por él','Adaptar el entorno y respetar sus decisiones','Sobreproteger','Ignorar'], 1, 'El apoyo debe preservar la autonomía.'],
    ['Un indicador de calidad de vida es:', ['El peso corporal solamente','Bienestar físico, mental, social y espiritual','La presión arterial','La estatura'], 1, 'Es multidimensional.'],
    ['La gerontología se diferencia de la geriatría en que:', ['Son lo mismo','La gerontología estudia el envejecimiento; la geriatría es la especialidad médica','La geriatría no existe','La gerontología solo investiga'], 1, 'La geriatría es especialidad médica clínica.'],
    ['El concepto de envejecimiento exitoso se refiere a:', ['Vivir muchos años enfermo','Envejecer con buena salud, funcionalidad y participación','No envejecer','Solo vivir mucho'], 1, 'Integra longevidad y calidad de vida.'],
    ['La atención domiciliaria gerontológica tiene como ventaja:', ['El paciente sale de casa','Se atiende en el entorno familiar y cotidiano','Es más cara','No tiene ventajas'], 1, 'Favorece la comodidad y el contexto real.']
  ],
  cuidados: [
    ['El baño en cama debe realizarse con el paciente:', ['Desnudo en la sala','Tapado y en su cama para preservar privacidad','De pie','En el jardín'], 1, 'Privacidad y seguridad térmica.'],
    ['La temperatura del agua para el baño debe ser:', ['Muy caliente','Tibia, verificada antes de aplicar','Fría','Sin importar'], 1, 'Evita quemaduras y favorece la vasodilatación.'],
    ['La piel del adulto mayor es más vulnerable porque:', ['Es más gruesa','Es más delgada, seca y con menos elasticidad','No cambia','Es más resistente'], 1, 'Mayor riesgo de lesiones y úlceras.'],
    ['La higiene bucal del encamado previene:', ['Solo mal aliento','Neumonía aspirativa y candidiasis','Nada','Solo caries'], 1, 'Las bacterias bucales pueden aspirarse.'],
    ['La transferencia segura requiere evaluar:', ['Solo la edad','Capacidad del paciente, fuerza del cuidador y espacio disponible','Solo el peso','Nada'], 1, 'La evaluación previa previene accidentes.'],
    ['El vendaje compresivo NO debe aplicarse cuando:', ['Hay herida leve','Hay sospecha de trombosis o edema importante','Hay dolor','Siempre'], 1, 'Puede agravar problemas circulatorios.'],
    ['La deshidratación se manifiesta con:', ['Piel húmeda','Piel seca, orina escasa y confusión','Mucha orina','Solo sed'], 1, 'Signos sistémicos múltiples.'],
    ['El cambio de ropa del paciente encamado se realiza:', ['De pie','Con técnica de decúbito y sin exponer innecesariamente','Siempre solo','Nunca'], 1, 'Técnica que minimiza esfuerzo y exposición.'],
    ['La incontinencia urinaria se clasifica en:', ['Leve y grave','De esfuerzo, urgencia, mixta y funcional','Alta y baja','Solo una'], 1, 'Cada tipo requiere manejo diferente.'],
    ['El confort del paciente durante el cuidado incluye:', ['Solo la posición','Calor adecuado, ropa limpia, analgesia y escucha','Solo silencio','Nada'], 1, 'Es multidimensional.']
  ],
  enfermedades: [
    ['La glucosa capilar normal en ayunas es aproximadamente:', ['200 mg/dL','70-100 mg/dL','300 mg/dL','50 mg/dL'], 1, 'Rango normal según laboratorios.'],
    ['Los factores de riesgo cardiovascular incluyen:', ['Ejercicio regular','Tabaquismo, sedentarismo e hipertensión','Frutas','Sueño'], 1, 'Hábitos modificables clave.'],
    ['El deterioro cognitivo leve difiere de la demencia en que:', ['Es igual','No interfiere significativamente con la vida diaria','Es peor','No existe'], 1, 'DCL es un paso previo posible pero no siempre progresa.'],
    ['La sarcopenia se asocia con:', ['Mayor fuerza','Pérdida de fuerza, riesgo de caídas y dependencia','Mejor marcha','Más energía'], 1, 'Impacta la funcionalidad.'],
    ['El dolor neuropático se caracteriza por:', ['Dolor punzante o ardiente','Dolor sordo solamente','No existe','Solo muscular'], 0, 'Afecta los nervios.'],
    ['La enfermedad de Parkinson se manifiesta con:', ['Solo tos','Tembor en reposo, rigidez y bradicinesia','Fiebre','Ceguera'], 1, 'Tríada motora clásica.'],
    ['La desnutrición en el adulto mayor se agrava por:', ['Buen apetito','Anorexia, polifarmacia y problemas dentales','Ejercicio','Hidratación'], 1, 'Múltiples causas convergen.'],
    ['La osteoporosis se previene con:', ['Solo calcio','Calcio, vitamina D y actividad física','Nada','Solo reposo'], 1, 'Estrategia integral.'],
    ['El síndrome geriátrico es:', ['Una enfermedad específica','Un conjunto de condiciones que afectan la funcionalidad','Solo demencia','Solo fractura'], 1, 'Incluye caídas, incontinencia, delirio, fragilidad.'],
    ['La EPOC se relaciona con:', ['Solo asma','Tabaquismo y exposición a contaminantes','Solo gripe','Solo dieta'], 1, 'Es obstructiva y progresiva.'],
    ['La enfermedad renal crónica se valora con:', ['Solo el peso','Creatinina, urea y depuración glomerular','Solo la orina','Nada'], 1, 'Función renal estimada.'],
    ['La fragilidad en el adulto mayor predice:', ['Mejor salud','Riesgo de dependencia, hospitalización y muerte','Menos caídas','Más fuerza'], 1, 'Es un estado de vulnerabilidad.']
  ],
  fisioterapia: [
    ['La fuerza muscular se evalúa con:', ['La vista','Pruebas funcionales y dinamometría','Solo el peso','Nada'], 1, 'Se mide objetivamente.'],
    ['El ejercicio aeróbico en mayores mejora:', ['Solo el corazón','Resistencia cardiovascular y ánimo','Solo los huesos','Nada'], 1, 'Beneficio multisistémico.'],
    ['La restricción articular limita:', ['Solo la vista','El rango de movimiento y la funcionalidad','Solo el peso','Nada'], 1, 'Reduce la independencia.'],
    ['La marcha antálgica se caracteriza por:', ['Caminar normal','Alteración del patrón por dolor','Correr','Sentarse'], 1, 'Compensación por dolor.'],
    ['La terapia ocupacional busca:', ['Solo fuerza','Participación en actividades significativas','Solo ejercicios','Nada'], 1, 'Sentido y propósito.'],
    ['La estimulación propioceptiva mejora:', ['Solo la vista','El equilibrio y la conciencia corporal','Solo el oído','Nada'], 1, 'Integración sensorial-motora.'],
    ['El calentamiento previo al ejercicio sirve para:', ['Nada','Preparar el cuerpo y prevenir lesiones','Enfriar','Comer'], 0, 'Reduce el riesgo de lesión.'],
    ['La marcha segura requiere:', ['Solo calzado','Fuerza, equilibrio y entorno adecuado','Solo velocidad','Nada'], 1, 'Factores combinados.'],
    ['La rehabilitación post-EVC busca:', ['Olvidar','Recuperar función perdida y compensar','Nada','Solo reposo'], 1, 'Neuroplasticidad.'],
    ['El ejercicio adaptado se ajusta a:', ['Todos igual','La capacidad individual del paciente','Solo jóvenes','Nada'], 1, 'Individualización.']
  ],
  salud_mental: [
    ['La atención plena (mindfulness) en el adulto mayor ayuda a:', ['Nada','Reducir ansiedad y mejorar el bienestar','Solo dormir','Solo comer'], 1, 'Estrategia de autorregulación.'],
    ['La reminiscencia terapéutica consiste en:', ['Recordar solo lo malo','Revivir recuerdos positivos para bienestar','Olvidar todo','Dormir'], 1, 'Técnica de estimulación.'],
    ['La validación en demencias significa:', ['Corregir siempre','Aceptar la realidad del paciente aunque difiera','Ignorar','Reñir'], 1, 'Reduce ansiedad y resistencias.'],
    ['El aislamiento se combate con:', ['Soledad','Actividades sociales y contacto regular','Nada','Televisión'], 1, 'La conexión humana protege.'],
    ['La depresión en el adulto mayor se trata con:', ['Solo pastillas','Terapia, apoyo social y en algunos casos fármacos','Nada','Encierro'], 1, 'Enfoque integral.'],
    ['La comunicación no verbal en demencias incluye:', ['Solo palabras','Tono de voz, expresión facial y contacto','Nada','Gritos'], 1, 'Mensaje más allá de las palabras.'],
    ['La actividad ocupacional terapéutica promueve:', ['Solo distracción','Sentido de propósito y competencia','Nada','Pasividad'], 1, 'Participación significativa.'],
    ['El duelo en el adulto mayor puede manifestarse con:', ['Solo llanto','Tristeza, culpa, aislamiento y cambios físicos','Solo alegría','Nada'], 1, 'Es un proceso multifacético.'],
    ['La resiliencia en el adulto mayor se refiere a:', ['Fragilidad','Capacidad de adaptarse y recuperarse de adversidades','Nada','Debilidad'], 1, 'Factor protector clave.'],
    ['La estimulación sensorial en demencias incluye:', ['Solo vista','Tocar, oler, escuchar y saborear','Nada','Solo oído'], 1, 'Activa múltiples sentidos.']
  ],
  nutricion: [
    ['La proteína en el adulto mayor es importante porque:', ['No sirve','Preserva músculo y función','Solo da energía','Nada'], 1, 'Previene la sarcopenia.'],
    ['La fibra dietética ayuda a:', ['Solo el peso','La digestión y el control glucémico','Solo la vista','Nada'], 1, 'Beneficio metabólico.'],
    ['La vitamina D en el adulto mayor previene:', ['Solo resfriados','Osteoporosis y debilidad muscular','Solo caries','Nada'], 1, 'Clave para los huesos.'],
    ['El índice de masa corporal en el adulto mayor se interpreta con cautela porque:', ['Es perfecto','Puede enmascarar sarcopenia','No sirve','Solo en niños'], 1, 'La composición corporal cambia.'],
    ['La disfagia se evalúa con:', ['Solo la vista','Prueba de deglución y valoración clínica','Nada','Solo peso'], 1, 'Diagnóstico funcional.'],
    ['La consistencia de alimentos en disfagia se clasifica por:', ['Color','Textura y nivel de espesante','Sabor','Nada'], 1, 'Estándar IDDSI.'],
    ['La deshidratación crónica en mayores se asocia con:', ['Mejor salud','Confusión, estreñimiento y caídas','Más energía','Nada'], 1, 'Impacto sistémico.'],
    ['El sodio en la dieta hipertensa debe ser:', ['Abundante','Restringido','Irrelevante','Solo en niños'], 1, 'Control de presión.'],
    ['La suplementación proteica se indica cuando:', ['Siempre','Hay riesgo o evidencia de desnutrición','Nunca','Solo en jóvenes'], 1, 'Basada en evaluación.'],
    ['La seguridad alimentaria incluye:', ['Solo cocinar','Higiene, conservación y manipulación correcta','Solo comprar','Nada'], 1, 'Previene intoxicaciones.']
  ],
  enfermeria: [
    ['La escala de Braden evalúa:', ['Solo el dolor','Riesgo de lesiones por presión','Solo la fiebre','Nada'], 1, 'Herramienta estándar.'],
    ['La higiene de manos es la medida más importante para:', ['Solo el olor','Prevenir infecciones','Solo la vista','Nada'], 1, 'Simple y efectiva.'],
    ['El monitoreo de constantes vitales incluye:', ['Solo la temperatura','Tensión, pulso, respiración y temperatura','Solo peso','Nada'], 1, 'Set completo.'],
    ['La técnica aséptica en curaciones previene:', ['Solo dolor','Infección de la herida','Solo cicatrización','Nada'], 1, 'Barreras microbiológicas.'],
    ['El registro de enfermería debe ser:', ['Vago','Objetivo, legible y con hora','Confidencial','Opcional'], 1, 'Documentación de calidad.'],
    ['La identificación del paciente se verifica con:', ['Solo el nombre','Dos identificadores (nombre + fecha/cama)','Nada','Solo la cara'], 1, 'Previene errores.'],
    ['La escalera analgésica de la OMS incluye:', ['Solo opioides','No opioides, opioides débiles y fuertes según dolor','Solo placebo','Nada'], 1, 'Escalonada por intensidad.'],
    ['La profilaxis de trombosis incluye:', ['Solo reposo','Movilización, media de compresión y en casos fármacos','Nada','Solo vendas'], 1, 'Prevención multifactorial.'],
    ['La sonda vesical requiere:', ['No cuidados','Higiene, fijación y vigilancia de infecciones','Solo vaciar','Nada'], 1, 'Dispositivo de riesgo.'],
    ['La comunicación con el médico se realiza mediante:', ['Solo notas','Reporte estructurado y llamada si es urgente','Solo WhatsApp','Nada'], 1, 'SBAR recomendado.']
  ],
  emergencias: [
    ['La cadena de supervivencia en paro cardiaco incluye:', ['Solo RCP','Activación temprana, RCP, desfibrilación y soporte','Solo DEA','Nada'], 1, 'Cada eslabón es vital.'],
    ['Las compresiones en RCP deben ser:', ['Lentas','Rápidas, profundas y centradas en el esternón','Superficiales','Irregulares'], 1, '100-120/min, 5-6 cm.'],
    ['El DEA analiza:', ['Solo el ritmo','El ritmo cardíaco y decide si desfibrila','Solo la presión','Nada'], 1, 'Automatizado.'],
    ['Ante una hemorragia externa se debe:', ['Ignorar','Presionar con apósito y elevar','Poner tierra','Nada'], 1, 'Control de sangrado.'],
    ['La posición lateral de seguridad se usa en:', ['Todo paciente','Paciente inconsciente que respira','Solo niños','Nunca'], 1, 'Protege la vía aérea.'],
    ['El golpe de calor se reconoce por:', ['Solo sudor','Temperatura alta, confusión y piel seca','Solo frío','Nada'], 1, 'Emergencia térmica.'],
    ['La hipotermia se maneja con:', ['Agua caliente','Recalentamiento gradual','Frotar','Nada'], 1, 'Cuidado de reanimación.'],
    ['El kit de emergencia domiciliaria debe incluir:', ['Solo vendas','Botiquín completo, contactos y plan','Nada','Solo agua'], 1, 'Preparación previa.'],
    ['La obstrucción de vía aérea parcial se maneja con:', ['Maniobras de desobstrucción','Tos espontánea y animar a toser','Golpes','Nada'], 0, 'Si puede toser, se anima.'],
    ['El tiempo es cerebro en EVC significa:', ['Nada','Cada minuto cuenta para la recuperación','Solo en niños','Nada'], 1, 'Urgencia neurológica.']
  ],
  paliativos: [
    ['La sedación en cuidados paliativos se indica cuando:', ['Siempre','Síntomas refractarios con consentimiento','Nunca','Solo en UCI'], 1, 'Decisión ética compartida.'],
    ['La vía subcutánea en paliativos se usa para:', ['Solo venosa','Administrar medicamentos de forma no invasiva','Solo oral','Nada'], 1, 'Acceso domiciliario.'],
    ['El delirium en el paciente terminal es:', ['Normal','Estado confusional agudo que requiere evaluación','Solo demencia','Nada'], 1, 'Reversible en muchos casos.'],
    ['La xerostomía en paliativos se maneja con:', ['Nada','Hidratación, humidificación y cuidado bucal','Solo antibióticos','Nada'], 1, 'Confort.'],
    ['La congestión en los últimos días se alivia con:', ['Nada','Posición, humidificación y en casos fármacos','Solo agua','Nada'], 1, 'Medidas de confort.'],
    ['La muerte digna incluye:', ['Solo morir','Control de síntomas, privacidad y acompañamiento','Solo hospital','Nada'], 1, 'Respeto integral.'],
    ['El testamento vital / directivas anticipadas permite:', ['Nada','Expresar deseos sobre tratamientos futuros','Solo herencias','Nada'], 1, 'Autonomía anticipada.'],
    ['La eutanasia activa en México:', ['Es legal en todo','Solo en contextos específicos y con regulación estricta','Es libre','No existe'], 1, 'Marco legal limitado.'],
    ['El acompañamiento en el duelo incluye:', ['Evitar el tema','Presencia, escucha y normalizar el proceso','Solo','Nada'], 1, 'Acompañamiento humano.'],
    ['La fase de agonía se caracteriza por:', ['Fuerza','Disminución de ingesta, somnolencia y cambios circulatorios','Solo dolor','Nada'], 1, 'Signos de proximidad.']
  ],
  etica: [
    ['El principio de beneficencia implica:', ['Hacer daño','Actuar en beneficio del paciente','Solo obedecer','Nada'], 1, 'Hacer el bien.'],
    ['El principio de no maleficencia significa:', ['Hacer daño','No causar daño innecesario','Solo ayudar','Nada'], 1, 'Primum non nocere.'],
    ['El consentimiento sustituto aplica cuando:', ['Siempre','El paciente no puede decidir por sí mismo','Nunca','Solo niños'], 1, 'Tutor o familia según ley.'],
    ['La confidencialidad puede romperse cuando:', ['Nunca','Hay riesgo de daño grave a sí mismo o terceros','Siempre','Solo por curiosidad'], 1, 'Excepción por protección.'],
    ['El deber de reporte del maltrato es:', ['Opcional','Obligatorio ante sospecha fundada','Solo si piden','Nunca'], 1, 'Obligación legal y ética.'],
    ['La comunicación de malas noticias sigue el protocolo:', ['Decir todo de golpe','Preparar, informar, escuchar y acompañar','Solo escribir','Nada'], 1, 'SPIKES simplificado.'],
    ['El conflicto de interés en el cuidado se da cuando:', ['Nunca','El interés personal interfiere con el del paciente','Solo en empresas','Nada'], 1, 'Transparencia.'],
    ['La equidad en la atención significa:', ['Trato igual para todos','Trato justo según necesidades','Solo a los que pagan','Nada'], 1, 'Equidad no es igualdad.'],
    ['El cuidado culturalmente sensible requiere:', ['Ignorar cultura','Respetar creencias y prácticas del paciente','Imponer','Nada'], 1, 'Diversidad humana.'],
    ['La objeción de conciencia del profesional:', ['No existe','Puede negarse a ciertas prácticas por convicciones, con alternativa','Es ilegal','Nada'], 1, 'Con límites éticos.']
  ],
  cuidador: [
    ['La comunicación empática incluye:', ['Solo oír','Escuchar activamente y validar emociones','Solo hablar','Nada'], 1, 'Conexión humana.'],
    ['El burnout del cuidador se manifiesta con:', ['Energía','Agotamiento emocional, cinismo y baja realización','Solo alegría','Nada'], 1, 'Síndrome de desgaste.'],
    ['Las técnicas de manejo del estrés incluyen:', ['Solo trabajar','Respiración, pausas y autocuidado','Solo dormir','Nada'], 1, 'Regulación.'],
    ['La escucha activa requiere:', ['Interrumpir','Atención plena, contacto visual y no juzgar','Solo oír','Nada'], 1, 'Presencia real.'],
    ['La resolución de conflictos con familiares se logra con:', ['Imponer','Comunicación clara, empatía y límites','Gritar','Ignorar'], 1, 'Habilidad interpersonal.'],
    ['La organización del turno incluye:', [' Improvisar','Planificar actividades, medicación y reportes','Nada','Solo trabajar'], 1, 'Rutina segura.'],
    ['El reporte de incidencia debe ser:', ['Inmediato','Veraz, objetivo y dentro del plazo','Vago','Opcional'], 1, 'Documentación.'],
    ['La higiene emocional del cuidador se cuida con:', ['Solo trabajo','Límites, descanso y redes de apoyo','Solo dinero','Nada'], 1, 'Sostenibilidad.'],
    ['La delegación de tareas en el equipo requiere:', ['Hacer todo solo','Comunicar, coordinar y verificar','Nada','Solo confiar'], 1, 'Trabajo en red.'],
    ['La puntualidad del cuidador genera:', ['Nada','Confianza y seguridad en el paciente','Solo quejas','Nada'], 1, 'Pilar de la relación.']
  ],
  administracion: [
    ['El ciclo PHVA (PDCA) de mejora continua incluye:', ['Solo planear','Planear, hacer, verificar y actuar','Solo hacer','Nada'], 1, 'Mejora sistemática.'],
    ['Un indicador de calidad asistencial es:', ['Solo ingresos','Tasa de caídas, úlceras o satisfacción','Solo número de turnos','Nada'], 1, 'Resultados medibles.'],
    ['La gestión del riesgo incluye:', ['Ignorar','Identificar, evaluar y mitigar peligros','Solo asegurar','Nada'], 1, 'Prevención.'],
    ['La evaluación del desempeño del personal mide:', ['Solo puntualidad','Competencias, resultados y conductas','Solo edad','Nada'], 1, 'Integral.'],
    ['La rotación de personal se previene con:', ['Nada','Reconocimiento, formación y buen clima','Solo salario','Nada'], 1, 'Retención.'],
    ['El expediente clínico electrónico debe ser:', ['Público','Confidencial, íntegro y con respaldo','Opcional','Nada'], 1, 'Normativa.'],
    ['La supervisión de calidad incluye:', ['Solo revisar','Auditorías, observación y retroalimentación','Solo castigar','Nada'], 1, 'Mejora.'],
    ['El plan de contingencia para emergencias incluye:', ['Nada','Procedimientos, responsables y simulacros','Solo seguro','Nada'], 1, 'Preparación.'],
    ['La capacitación del personal es:', ['Opcional','Inversión en calidad y seguridad','Solo para nuevos','Nada'], 1, 'Desarrollo.'],
    ['La satisfacción del paciente se mide con:', ['Solo quejas','Encuestas y seguimiento sistemático','Nada','Solo llamadas'], 1, 'Feedback estructurado.']
  ],
  talleres: [
    ['La práctica de transferencia en taller debe ser:', ['Solo ver','Repetida con retroalimentación y corrección','Una vez','Nada'], 1, 'Aprendizaje motor.'],
    ['La evaluación por lista de cotejo incluye:', ['Solo nota','Criterios observables de desempeño','Solo teoría','Nada'], 1, 'Evaluación objetiva.'],
    ['El maniquí de RCP permite:', ['Solo ver','Practicar compresiones con retroalimentación','Nada','Solo leer'], 1, 'Simulación realista.'],
    ['La retroalimentación inmediata en taller:', ['Atrasada','Corrige errores y refuerza aciertos','Solo al final','Nunca'], 1, 'Aprendizaje efectivo.'],
    ['La competencia práctica se demuestra con:', ['Solo examen','Desempeño correcto en situación real o simulada','Solo teoría','Nada'], 1, 'Evaluación auténtica.'],
    ['El calentamiento en taller práctico:', ['Opcional','Prepara el cuerpo y previene lesiones','Solo para niños','Nada'], 0, 'Seguridad.'],
    ['La variación de escenarios en simulación:', ['Repetitiva','Genera adaptación y pensamiento crítico','Nada','Solo uno'], 1, 'Transferencia.'],
    ['El instructor en taller debe:', ['Solo observar','Demostrar, corregir y facilitar','Solo hablar','Nada'], 1, 'Rol activo.'],
    ['La evaluación sumativa del taller mide:', ['Solo asistencia','Competencias alcanzadas al final','Solo puntualidad','Nada'], 1, 'Resultado final.'],
    ['El portafolio de evidencias en formación práctica incluye:', ['Solo notas','Registros de desempeño y reflexiones','Nada','Solo fotos'], 1, 'Documentación de aprendizaje.']
  ]
};

const CONTENIDO_UNIDADES = {
  gerontologia: ['Conceptos fundamentales del envejecimiento','Aspectos biológicos, psicológicos y sociales del ciclo vital','Funcionalidad, autonomía e independencia en la vejez','Calidad de vida y envejecimiento activo'],
  cuidados: ['Fundamentos del cuidado integral del adulto mayor','Higiene, confort y cuidado personal','Movilización, transferencias y cambios posturales','Prevención de complicaciones: caídas, úlceras y deshidratación'],
  enfermedades: ['Panorama de las enfermedades crónicas más frecuentes','Reconocimiento de signos y síntomas por condición','Manejo seguro y comunicación con el equipo','Prevención de complicaciones y educación al paciente'],
  fisioterapia: ['Fundamentos de la rehabilitación geriátrica','Valoración funcional y prescripción de ejercicio','Ejercicios de fuerza, equilibrio y marcha','Aplicación práctica en el domicilio'],
  salud_mental: ['Salud mental y bienestar en la vejez','Estimulación cognitiva y memoria','Comunicación y manejo emocional','Acompañamiento, duelo y actividades terapéuticas'],
  nutricion: ['Fundamentos de la nutrición geriátrica','Evaluación del estado nutricional','Condiciones especiales: diabetes, disfagia, sarcopenia','Elaboración de planes alimentarios seguros'],
  enfermeria: ['Fundamentos de la atención clínica geriátrica','Signos vitales y valoración básica','Procedimientos seguros dentro de atribuciones','Vigilancia, registro y continuidad de cuidados'],
  emergencias: ['Principios de primera respuesta','RCP, DEA y soporte vital básico','Reconocimiento de emergencias específicas','Activación de servicios y simulación práctica'],
  paliativos: ['Introducción a los cuidados paliativos','Confort, síntomas y calidad de vida','Comunicación, familia y duelo','Ética y dignidad en el final de la vida'],
  etica: ['Fundamentos éticos de la atención geriátrica','Derechos, confidencialidad y consentimiento','Prevención del maltrato y negligencia','Responsabilidad profesional y límites'],
  cuidador: ['Perfil y funciones del cuidador profesional','Habilidades de comunicación y organización','Autocuidado y manejo del estrés','Límites, reportes y manejo de riesgos'],
  administracion: ['Fundamentos de la gestión de servicios','Calidad, indicadores y mejora continua','Gestión de riesgos y protocolos','Recursos humanos, expedientes y satisfacción'],
  talleres: ['Fundamentos teóricos del taller','Demostración y práctica guiada','Práctica supervisada y retroalimentación','Evaluación de competencias prácticas']
};

app.post('/api/academia/admin/sembrar-contenido', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { data: cursos } = await supabase.from('academia_cursos').select('*').eq('estado', 'publicado');
    let cursosCon = 0, unidadesCreadas = 0, preguntasCreadas = 0;
    for (const curso of cursos || []) {
      const { count: hayUnidades } = await supabase.from('academia_unidades').select('id', { count: 'exact', head: true }).eq('curso_id', curso.id);
      if (hayUnidades > 0) { cursosCon++; continue; }
      const banco = [...(BANCO_PREGUNTAS[curso.area] || BANCO_PREGUNTAS.cuidador), ...(BANCO_PREGUNTAS_EXTRA[curso.area] || [])];
      const titulos = CONTENIDO_UNIDADES[curso.area] || CONTENIDO_UNIDADES.cuidados;
      const nUnidades = curso.area === 'talleres' ? 4 : 5;
      const unidadesIds = [];
      for (let i = 0; i < nUnidades; i++) {
        const tema = titulos[i % titulos.length];
        const titulo = `${tema} — ${curso.titulo}`;
        const { data: u } = await supabase.from('academia_unidades').insert({
          curso_id: curso.id, orden: i + 1, titulo,
          contenido: `Unidad ${i + 1} de ${nUnidades}: ${tema}. En el marco del curso "${curso.titulo}", esta unidad desarrolla los conceptos fundamentales, las aplicaciones prácticas en el entorno domiciliario y los criterios de evaluación del desempeño profesional. Se abordan casos representativos de la atención gerontológica integral, las medidas de seguridad pertinentes y las competencias específicas que el participante debe demostrar para avanzar.`
        }).select().single();
        if (u) { unidadesIds.push(u.id); unidadesCreadas++; }
      }
      // Preguntas por unidad: muestra del banco de la categoría
      for (let i = 0; i < unidadesIds.length; i++) {
        const muestra = [...banco].sort(() => Math.random() - 0.5).slice(0, Math.min(12, banco.length));
        for (const [pregunta, opciones, correctaIdx, retro] of muestra) {
          const tipo = opciones.length === 2 && ['Verdadero','Falso'].includes(opciones[0]) ? 'verdadero_falso' : 'opcion_multiple';
          await supabase.from('academia_preguntas').insert({
            curso_id: curso.id, unidad_id: unidadesIds[i], tipo, pregunta,
            opciones: tipo === 'opcion_multiple' ? opciones : null,
            respuesta_correcta: tipo === 'verdadero_falso' ? opciones[correctaIdx] : opciones[correctaIdx],
            retroalimentacion: retro, dificultad: 'medio', puntos: 1
          });
          preguntasCreadas++;
        }
      }
      // Examen final: preguntas sin unidad
      const muestraFinal = [...banco].sort(() => Math.random() - 0.5).slice(0, Math.min(20, banco.length));
      for (const [pregunta, opciones, correctaIdx, retro] of muestraFinal) {
        const tipo = opciones.length === 2 && ['Verdadero','Falso'].includes(opciones[0]) ? 'verdadero_falso' : 'opcion_multiple';
        await supabase.from('academia_preguntas').insert({
          curso_id: curso.id, unidad_id: null, tipo, pregunta,
          opciones: tipo === 'opcion_multiple' ? opciones : null,
          respuesta_correcta: opciones[correctaIdx], retroalimentacion: retro, dificultad: 'medio', puntos: 1
        });
        preguntasCreadas++;
      }
      cursosCon++;
    }
    res.json({ ok: true, cursos_procesados: cursosCon, unidades_creadas: unidadesCreadas, preguntas_creadas: preguntasCreadas });
  } catch (e) { console.error('sembrar-contenido:', e); res.status(500).json({ error: e.message || 'Error' }); }
});

// ---------- Botón de Pánico y Centro de Emergencias ----------
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;
const DIRECTIVO_TEL = process.env.DIRECTIVO_TELEFONO || '';

// Normaliza a E.164: números mexicanos de 10 dígitos → +52XXXXXXXXXX
function aE164(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (String(tel).trim().startsWith('+')) return '+' + d;
  if (d.length === 10) return '+52' + d;
  if (d.length === 12 && d.startsWith('52')) return '+' + d;
  return '+' + d;
}

async function llamarYMensaje(emergenciaId, emp) {
  // Llamada + SMS de respaldo vía Twilio si está configurado; si no, queda registrado
  const tel = aE164(DIRECTIVO_TEL || emp?.contacto_emergencia_telefono || emp?.contactos_emergencia?.[0]?.telefono || emp?.telefono || '');
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !tel) {
    await supabase.from('emergencia_eventos').insert({ emergencia_id: emergenciaId, tipo: 'llamada_sms', detalle: 'No configurado: faltan credenciales Twilio o teléfono del directivo (TWILIO_*, DIRECTIVO_TELEFONO)' });
    return { llamada: 'no_configurada' };
  }
  const resultados = {};
  const client = twilio(TWILIO_SID, TWILIO_TOKEN);
  const msg = `EMERGENCIA AGI - ${emp?.nombre || 'Empleado'} activo el boton de panico. Revisa el Centro de Emergencias.`;
  try {
    await client.messages.create({ to: tel, from: TWILIO_FROM, body: msg });
    resultados.sms = 'enviado';
  } catch (e) { resultados.sms = 'error: ' + (e.message || e.code || 'desconocido'); }
  try {
    await client.calls.create({
      to: tel, from: TWILIO_FROM,
      twiml: '<Response><Say language="es-MX">Alerta de emergencia. Un trabajador activo el boton de panico. Revisa la plataforma.</Say></Response>'
    });
    resultados.llamada = 'iniciada';
  } catch (e) { resultados.llamada = 'error: ' + (e.message || e.code || 'desconocido'); }
  await supabase.from('emergencia_eventos').insert({ emergencia_id: emergenciaId, tipo: 'llamada_sms', detalle: JSON.stringify(resultados) });
  return resultados;
}

// SMS genérico de emergencia (Twilio). Regresa estado y lo registra en la bitácora.
async function enviarSms(telRaw, body) {
  const tel = aE164(telRaw);
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !tel) return 'no_configurado';
  try {
    const client = twilio(TWILIO_SID, TWILIO_TOKEN);
    await client.messages.create({ to: tel, from: TWILIO_FROM, body: String(body).slice(0, 1600) });
    return 'enviado';
  } catch (e) { return 'error: ' + (e.message || e.code || 'desconocido'); }
}

async function smsEmergencia(emergenciaId, telRaw, body) {
  const r = await enviarSms(telRaw, body);
  await supabase.from('emergencia_eventos').insert({
    emergencia_id: emergenciaId, tipo: 'sms',
    detalle: `${r} -> ${aE164(telRaw) || 'sin teléfono'} | ${String(body).slice(0, 120)}`
  });
  return r;
}

async function telEmpleado(empleadoId) {
  if (!empleadoId) return '';
  const { data } = await supabase.from('perfiles').select('telefono, contactos_emergencia').eq('id', empleadoId).maybeSingle();
  return data?.telefono || data?.contactos_emergencia?.[0]?.telefono || '';
}

// Activar botón de pánico (cualquier usuario autenticado)
app.post('/api/emergencias', requireUser, async (req, res) => {
  try {
    const { lat, lng, paciente_id, visita_id, servicio, silenciosa, contacto_respaldo } = req.body || {};
    const emp = req.user.perfil || {};
    let paciente = null;
    if (paciente_id) {
      const { data: p } = await supabase.from('pacientes').select('id, nombre, apellido, direccion').eq('id', paciente_id).maybeSingle();
      paciente = p;
    }
    const { data: em, error } = await supabase.from('emergencias').insert({
      empleado_id: req.user.id, paciente_id: paciente_id || null, visita_id: visita_id || null,
      tipo: 'panico', silenciosa: !!silenciosa,
      lat: lat ?? null, lng: lng ?? null, servicio: servicio || null,
      contacto_respaldo: contacto_respaldo || emp.contacto_emergencia_telefono || emp.contactos_emergencia?.[0]?.telefono || emp.telefono || null
    }).select().single();
    if (error) throw error;
    await supabase.from('emergencia_eventos').insert({ emergencia_id: em.id, tipo: 'activacion', detalle: `Activada por ${emp.nombre || req.user.email} ${silenciosa ? '(modo silencioso)' : ''}` });
    // Notificar a TODOS los admins en tiempo real
    const { data: admins } = await supabase.from('perfiles').select('id, nombre').eq('rol', 'admin').eq('estado', 'aprobado');
    for (const a of admins || []) {
      await supabase.from('notificaciones').insert({
        destinatario_id: a.id, tipo: 'emergencia',
        mensaje: '🚨 BOTÓN DE PÁNICO — ' + (emp.nombre || req.user.email) + (paciente ? ' está con el paciente ' + paciente.nombre + ' ' + paciente.apellido : '') + '. Revisa el Centro de Emergencias.',
        datos: { emergencia_id: em.id, empleado_id: req.user.id }
      });
    }
    broadcast({ tipo: 'emergencia', datos: { emergencia_id: em.id } });
    llamarYMensaje(em.id, emp).catch(() => {});
    // Escalación: si en 30s sigue activa sin confirmación → segunda alerta + reintento de llamada
    setTimeout(async () => {
      try {
        const { data: actual } = await supabase.from('emergencias').select('estado').eq('id', em.id).maybeSingle();
        if (!actual || actual.estado !== 'activa') return;
        const { data: admins2 } = await supabase.from('perfiles').select('id').eq('rol', 'admin').eq('estado', 'aprobado');
        for (const a of admins2 || []) {
          await supabase.from('notificaciones').insert({
            destinatario_id: a.id, tipo: 'emergencia',
            mensaje: '⚠️ EMERGENCIA SIN CONFIRMAR — ' + (emp.nombre || req.user.email) + ' activó pánico hace 30s sin confirmación. Responde de inmediato.',
            datos: { emergencia_id: em.id, escalada: true }
          });
        }
        await supabase.from('emergencia_eventos').insert({ emergencia_id: em.id, tipo: 'escalada', detalle: 'Sin confirmación tras 30s — reintento de llamada y SMS' });
        llamarYMensaje(em.id, emp).catch(() => {});
        broadcast({ tipo: 'emergencia', datos: { emergencia_id: em.id, escalada: true } });
      } catch {}
    }, 30000);
    res.json({ emergencia: em, paciente });
  } catch (e) { console.error('emergencia:', e); res.status(500).json({ error: 'Error al activar emergencia' }); }
});

// Actualizar GPS durante emergencia activa (el empleado comparte su ubicación)
app.post('/api/emergencias/:id/ubicacion', requireUser, async (req, res) => {
  try {
    const { lat, lng } = req.body || {};
    const { data: em } = await supabase.from('emergencias').select('empleado_id, estado').eq('id', req.params.id).maybeSingle();
    if (!em || !['activa','confirmada','en_gestion'].includes(em.estado)) return res.status(404).json({ error: 'Emergencia no activa' });
    if (em.empleado_id !== req.user.id && !isAdmin(req)) return res.status(403).json({ error: 'Sin permiso' });
    await supabase.from('emergencias').update({ lat, lng }).eq('id', req.params.id);
    await supabase.from('emergencia_eventos').insert({ emergencia_id: req.params.id, tipo: 'gps', detalle: `${lat},${lng}` });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Cancelar activación accidental (con motivo)
app.post('/api/emergencias/:id/cancelar', requireUser, async (req, res) => {
  try {
    const { motivo } = req.body || {};
    const { data: em } = await supabase.from('emergencias').select('empleado_id, estado').eq('id', req.params.id).maybeSingle();
    if (!em || !['activa','confirmada','en_gestion'].includes(em.estado)) return res.status(404).json({ error: 'No está activa' });
    if (em.empleado_id !== req.user.id && !isAdmin(req)) return res.status(403).json({ error: 'Sin permiso' });
    await supabase.from('emergencias').update({ estado: 'cancelada', cancelada_at: new Date().toISOString(), motivo_cancelacion: motivo || 'No especificado' }).eq('id', req.params.id);
    await supabase.from('emergencia_eventos').insert({ emergencia_id: req.params.id, tipo: 'cancelacion', detalle: motivo || 'Sin motivo' });
    const { data: admins } = await supabase.from('perfiles').select('id').eq('rol', 'admin').eq('estado', 'aprobado');
    for (const a of admins || []) await supabase.from('notificaciones').insert({ destinatario_id: a.id, tipo: 'emergencia', mensaje: `Emergencia cancelada por el empleado. Motivo: ${motivo || 'no especificado'}.`, datos: { emergencia_id: req.params.id } });
    broadcast({ tipo: 'emergencia', datos: { emergencia_id: req.params.id, cancelada: true } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// El directivo confirma que está enterado → notifica al empleado de inmediato
const MSG_ENTERADO = 'TU ALERTA DE EMERGENCIA HA SIDO RECIBIDA.\n\nEl directivo ya está enterado de tu situación y está gestionando la ayuda correspondiente.\n\nMantén la calma, busca un lugar seguro si es posible y permanece atento a las indicaciones y comunicaciones del directivo.\n\nNO ESTÁS SOLO. ESTAMOS ATENDIENDO TU EMERGENCIA.';

app.post('/api/emergencias/:id/confirmar', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { data: em } = await supabase.from('emergencias').select('estado, empleado_id').eq('id', req.params.id).maybeSingle();
    if (!em || !['activa'].includes(em.estado)) return res.status(404).json({ error: 'No está activa' });
    await supabase.from('emergencias').update({ estado: 'confirmada', confirmada_at: new Date().toISOString() }).eq('id', req.params.id);
    await supabase.from('emergencia_eventos').insert({ emergencia_id: req.params.id, tipo: 'confirmacion', detalle: `Directivo enterado: ${req.user.perfil?.nombre || req.user.email}` });
    // Notificación prioritaria al empleado (aparece en su app al instante vía SSE)
    if (em.empleado_id) {
      await supabase.from('notificaciones').insert({
        destinatario_id: em.empleado_id, tipo: 'emergencia', mensaje: MSG_ENTERADO,
        datos: { emergencia_id: req.params.id, estado: 'confirmada' }
      });
      await supabase.from('emergencia_eventos').insert({ emergencia_id: req.params.id, tipo: 'aviso_empleado', detalle: 'Notificación de recepción enviada al empleado' });
      const tel = await telEmpleado(em.empleado_id);
      await smsEmergencia(req.params.id, tel, 'AGI EMERGENCIA: Tu alerta fue recibida por el directivo, quien esta gestionando la ayuda. Mantente en un lugar seguro y atento a tu telefono.');
    }
    broadcast({ tipo: 'emergencia', datos: { emergencia_id: req.params.id, confirmada: true } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// El directivo marca que está gestionando la ayuda
app.post('/api/emergencias/:id/gestion', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { data: em } = await supabase.from('emergencias').select('estado, empleado_id').eq('id', req.params.id).maybeSingle();
    if (!em || !['activa', 'confirmada'].includes(em.estado)) return res.status(404).json({ error: 'Estado inválido' });
    await supabase.from('emergencias').update({ estado: 'en_gestion', gestionada_at: new Date().toISOString() }).eq('id', req.params.id);
    await supabase.from('emergencia_eventos').insert({ emergencia_id: req.params.id, tipo: 'gestion', detalle: `Ayuda en gestión por ${req.user.perfil?.nombre || req.user.email}` });
    if (em.empleado_id) await supabase.from('notificaciones').insert({
      destinatario_id: em.empleado_id, tipo: 'emergencia',
      mensaje: 'El directivo está gestionando la ayuda para tu emergencia. Mantente en un lugar seguro y atento a tu teléfono.',
      datos: { emergencia_id: req.params.id, estado: 'en_gestion' }
    });
    const telG = await telEmpleado(em.empleado_id);
    await smsEmergencia(req.params.id, telG, 'AGI EMERGENCIA: El directivo esta gestionando la ayuda para ti. Mantente en un lugar seguro y atento a tu telefono.');
    broadcast({ tipo: 'emergencia', datos: { emergencia_id: req.params.id, gestion: true } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Empleado confirma que recibió el aviso del directivo
app.post('/api/emergencias/:id/confirmar-recepcion', requireUser, async (req, res) => {
  try {
    const { data: em } = await supabase.from('emergencias').select('empleado_id, estado').eq('id', req.params.id).maybeSingle();
    if (!em || em.empleado_id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
    if (!['confirmada', 'en_gestion'].includes(em.estado)) return res.status(404).json({ error: 'Sin aviso pendiente' });
    await supabase.from('emergencias').update({ empleado_confirmo_at: new Date().toISOString() }).eq('id', req.params.id);
    await supabase.from('emergencia_eventos').insert({ emergencia_id: req.params.id, tipo: 'recepcion_empleado', detalle: `${req.user.perfil?.nombre || req.user.email} confirmó que recibió el aviso` });
    const { data: admins } = await supabase.from('perfiles').select('id').eq('rol', 'admin').eq('estado', 'aprobado');
    for (const a of admins || []) await supabase.from('notificaciones').insert({
      destinatario_id: a.id, tipo: 'emergencia',
      mensaje: `${req.user.perfil?.nombre || req.user.email} confirmó que recibió tu aviso de emergencia.`,
      datos: { emergencia_id: req.params.id }
    });
    broadcast({ tipo: 'emergencia', datos: { emergencia_id: req.params.id, recepcion: true } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Marcar emergencia atendida (contacto logrado)
app.post('/api/emergencias/:id/atender', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { acciones, contacto_realizado } = req.body || {};
    const { data: em } = await supabase.from('emergencias').select('estado, empleado_id').eq('id', req.params.id).maybeSingle();
    if (!em || !['activa', 'confirmada', 'en_gestion'].includes(em.estado)) return res.status(404).json({ error: 'No se puede atender' });
    await supabase.from('emergencias').update({ estado: 'atendida', atendida_at: new Date().toISOString(), acciones: acciones || null }).eq('id', req.params.id);
    await supabase.from('emergencia_eventos').insert({ emergencia_id: req.params.id, tipo: 'atencion', detalle: `${acciones || ''} | Contacto: ${contacto_realizado || 'no registrado'}` });
    if (em.empleado_id) await supabase.from('notificaciones').insert({
      destinatario_id: em.empleado_id, tipo: 'emergencia',
      mensaje: 'Se estableció contacto y tu emergencia está siendo atendida. El directivo registró las acciones en el Centro de Emergencias.',
      datos: { emergencia_id: req.params.id, estado: 'atendida' }
    });
    const telA = await telEmpleado(em.empleado_id);
    await smsEmergencia(req.params.id, telA, 'AGI EMERGENCIA: Se establecio contacto y tu emergencia esta siendo atendida por el directivo.');
    broadcast({ tipo: 'emergencia', datos: { emergencia_id: req.params.id, atendida: true } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Cerrar incidente con observaciones finales (solo directivo)
app.post('/api/emergencias/:id/cerrar', requireUser, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo el directivo' });
  try {
    const { observaciones } = req.body || {};
    const { data: em } = await supabase.from('emergencias').select('estado, empleado_id').eq('id', req.params.id).maybeSingle();
    if (!em || !['atendida', 'en_gestion', 'confirmada'].includes(em.estado)) return res.status(404).json({ error: 'No se puede cerrar' });
    await supabase.from('emergencias').update({ estado: 'cerrada', acciones: observaciones || null }).eq('id', req.params.id);
    await supabase.from('emergencia_eventos').insert({ emergencia_id: req.params.id, tipo: 'cierre', detalle: observaciones || `Cerrada por ${req.user.perfil?.nombre || req.user.email}` });
    if (em.empleado_id) await supabase.from('notificaciones').insert({
      destinatario_id: em.empleado_id, tipo: 'emergencia',
      mensaje: 'Tu emergencia fue cerrada por el directivo. Revisa el Centro de Emergencias para ver el resumen.',
      datos: { emergencia_id: req.params.id, estado: 'cerrada' }
    });
    const telC = await telEmpleado(em.empleado_id);
    await smsEmergencia(req.params.id, telC, 'AGI EMERGENCIA: Tu emergencia fue cerrada por el directivo. Revisa el Centro de Emergencias para el resumen.');
    broadcast({ tipo: 'emergencia', datos: { emergencia_id: req.params.id, cerrada: true } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Indicador "escribiendo..." — efímero vía SSE, no se guarda en BD
app.post('/api/emergencias/:id/escribiendo', requireUser, async (req, res) => {
  try {
    const { data: em } = await supabase.from('emergencias').select('empleado_id').eq('id', req.params.id).maybeSingle();
    if (!em || (em.empleado_id !== req.user.id && !isAdmin(req))) return res.status(403).json({ error: 'Sin permiso' });
    broadcast({ tipo: 'escribiendo', datos: { emergencia_id: req.params.id, nombre: req.user.perfil?.nombre || req.user.email } });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error' }); }
});

// ---------- Canal de mensajes de la emergencia ----------
app.get('/api/emergencias/:id/mensajes', requireUser, async (req, res) => {
  try {
    const { data: em } = await supabase.from('emergencias').select('empleado_id').eq('id', req.params.id).maybeSingle();
    if (!em) return res.status(404).json({ error: 'No encontrada' });
    if (em.empleado_id !== req.user.id && !isAdmin(req)) return res.status(403).json({ error: 'Sin permiso' });
    // Marcar como leídos los mensajes del otro participante
    await supabase.from('emergencia_mensajes').update({ entregado: true, leido: true }).eq('emergencia_id', req.params.id).neq('remitente_id', req.user.id);
    const { data, error } = await supabase.from('emergencia_mensajes').select('*, perfiles!emergencia_mensajes_remitente_id_fkey(nombre)').eq('emergencia_id', req.params.id).order('created_at', { ascending: true }).limit(500);
    if (error) {
      // Si el embed del FK falla, devolver sin nombre
      const { data: d2 } = await supabase.from('emergencia_mensajes').select('*').eq('emergencia_id', req.params.id).order('created_at', { ascending: true }).limit(500);
      return res.json({ mensajes: d2 || [] });
    }
    res.json({ mensajes: data || [] });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/emergencias/:id/mensajes', requireUser, async (req, res) => {
  try {
    const { mensaje } = req.body || {};
    if (!mensaje || !String(mensaje).trim()) return res.status(400).json({ error: 'Mensaje vacío' });
    const { data: em } = await supabase.from('emergencias').select('empleado_id, estado').eq('id', req.params.id).maybeSingle();
    if (!em || !['activa', 'confirmada', 'en_gestion', 'atendida'].includes(em.estado)) return res.status(404).json({ error: 'Emergencia no disponible' });
    if (em.empleado_id !== req.user.id && !isAdmin(req)) return res.status(403).json({ error: 'Sin permiso' });
    const { data, error } = await supabase.from('emergencia_mensajes').insert({
      emergencia_id: req.params.id, remitente_id: req.user.id, mensaje: String(mensaje).trim().slice(0, 1000)
    }).select().single();
    if (error) throw error;
    // Notificar al otro participante
    const destinatario = em.empleado_id === req.user.id
      ? (await supabase.from('perfiles').select('id').eq('rol', 'admin').eq('estado', 'aprobado'))?.data || []
      : [em.empleado_id];
    for (const d of destinatario) {
      await supabase.from('notificaciones').insert({
        destinatario_id: d.id || d, tipo: 'emergencia',
        mensaje: `Mensaje en emergencia: ${String(mensaje).trim().slice(0, 80)}`,
        datos: { emergencia_id: req.params.id }
      });
    }
    // SMS al otro participante
    const esEmpleado = em.empleado_id === req.user.id;
    const telMsg = esEmpleado ? DIRECTIVO_TEL : await telEmpleado(em.empleado_id);
    const quien = req.user.perfil?.nombre || req.user.email;
    await smsEmergencia(req.params.id, telMsg, `AGI EMERGENCIA (${quien}): ${String(mensaje).trim().slice(0, 140)}`);
    broadcast({ tipo: 'emergencia', datos: { emergencia_id: req.params.id, mensaje: true } });
    res.json({ mensaje: data });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Listar emergencias: admin ve todas; empleado solo las suyas
app.get('/api/emergencias', requireUser, async (req, res) => {
  try {
    const admin = isAdmin(req);
    let q = supabase.from('emergencias').select('*')
      .order('created_at', { ascending: false }).limit(200);
    if (!admin) q = q.eq('empleado_id', req.user.id);
    const { data, error } = await q;
    if (error) throw error;
    // Adjuntar datos del empleado y paciente (evita depender del nombre del FK en Supabase)
    const lista = data || [];
    const empIds = [...new Set(lista.map((e) => e.empleado_id).filter(Boolean))];
    const pacIds = [...new Set(lista.map((e) => e.paciente_id).filter(Boolean))];
    const { data: perfiles } = empIds.length ? await supabase.from('perfiles').select('id, nombre, email, telefono, profesion, foto_path').in('id', empIds) : { data: [] };
    const { data: pacientes } = pacIds.length ? await supabase.from('pacientes').select('id, nombre, apellido, direccion').in('id', pacIds) : { data: [] };
    const pMap = Object.fromEntries((perfiles || []).map((p) => [p.id, p]));
    const paMap = Object.fromEntries((pacientes || []).map((p) => [p.id, p]));
    for (const e of lista) { e.perfiles = pMap[e.empleado_id] || null; e.pacientes = paMap[e.paciente_id] || null; }
    const data2 = lista;
    const { data: eventos } = await supabase.from('emergencia_eventos').select('*').order('created_at', { ascending: true }).limit(2000);
    res.json({ emergencias: data2, eventos: eventos || [] });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

export default app;

// Solo escuchar en ejecución local (node src/index.js); en Vercel se exporta como función
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  setInterval(monitorVisitas, 60 * 1000);
  app.listen(PORT, () => console.log(`Servidor único en http://localhost:${PORT} (API + frontend)`));
}
