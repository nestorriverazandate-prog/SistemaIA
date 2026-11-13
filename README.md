# Despliegue en Vercel (monorepo)

Este repo es un monorepo npm workspaces con dos apps:

- `apps/web` — Frontend SvelteKit (adapter-vercel)
- `apps/api` — Backend Node.js + Express

## Opción recomendada: dos proyectos de Vercel

### 1. Backend (`apps/api`)

Vercel no ejecuta Express "serverless" de forma nativa, así que tienes dos caminos:

**A) Vercel + función serverless (recomendado para empezar)**
Crea `apps/api/api/index.js` que exporte la app Express (Vercel la convierte en función). Alternativa: despliega el backend en Railway/Render/Fly.io y apunta `PUBLIC_API_URL` del frontend ahí.

**B) Backend en otro host**
Despliega `apps/api` en Railway, Render o Fly.io (todos soportan `npm start` y variables de entorno). Luego configura en el frontend:

```
PUBLIC_API_URL=https://tu-api.onrender.com
```

### 2. Frontend (`apps/web`)

1. Importa el repo en Vercel.
2. **Root Directory**: `apps/web`
3. Framework: SvelteKit (se autodetecta)
4. Environment variables:
   - `PUBLIC_API_URL` = URL del backend desplegado

### 3. Variables de entorno del backend

Configura en el host del backend (o en Vercel si usas la opción A):

```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
GOOGLE_DRIVE_DOC_ID, GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_APPLICATION_CREDENTIALS,
JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, BCRYPT_ROUNDS,
CORS_ORIGINS (incluye la URL del frontend en producción)
```

### 4. Generar el hash de la contraseña admin

```bash
cd apps/api && node -e "require('bcryptjs').hash('TU_CLAVE',12).then(h=>console.log(h))"
```

Pega el resultado en `ADMIN_PASSWORD_HASH` del `.env`. Nunca guardes la contraseña en texto plano.

## Desarrollo local

```bash
npm install                 # en la raíz (workspaces)
cp .env.example .env        # rellena los valores
npm run build               # compila web (estático) + verifica api
npm start                   # UN SOLO servidor: API + frontend en http://localhost:3001
```

Para desarrollo con hot-reload del frontend: `npm run build -w apps/web -- --watch` en una terminal y `npm run dev:api` en otra.

## Autenticación (Supabase Auth + Google)

1. **SQL**: ejecuta `supabase/schema.sql` y luego `supabase/schema-auth.sql` en el SQL Editor.
2. **Google provider**: Dashboard → Authentication → Sign In / Providers → **Google** → habilita y pega el Client ID/Secret de Google Cloud (OAuth consent + credenciales web, redirect URI: `https://TU-PROYECTO.supabase.co/auth/v1/callback`).
3. **URLs**: Authentication → URL Configuration → Site URL = URL del frontend; Redirect URLs = `http://localhost:5173` y la URL de producción.
4. **Primer admin**: inicia sesión una vez con Google, luego en SQL Editor:
   ```sql
   update public.perfiles set rol='admin', estado='aprobado' where email='tu@email.com';
   ```
   A partir de ahí, el panel de admin (visible solo para `rol='admin'`) permite aprobar/rechazar usuarios y asignar roles.

Flujo: login Google → si no existe perfil se crea como `pendiente` → el admin lo aprueba → el usuario ya puede registrar pacientes (que se guardan en Supabase y se anexan al documento de Drive).

## Google Drive

1. Crea una cuenta de servicio en Google Cloud con la **Docs API** y **Drive API** habilitadas.
2. Comparte el documento de Google Docs (o la carpeta) con el email del service account (`client_email`).
3. Pon el ID del documento en `GOOGLE_DRIVE_DOC_ID`. Cada paciente registrado se añade como texto al final del documento.
4. Alternativa: pega el JSON del service account completo en `GOOGLE_SERVICE_ACCOUNT_JSON`.
