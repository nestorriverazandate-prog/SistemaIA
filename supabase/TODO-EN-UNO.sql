-- ============================================================
-- SCRIPT COMPLETO — ejecutar UNA vez en Supabase → SQL Editor
-- Crea/actualiza todo lo que la plataforma necesita.
-- Es idempotente: se puede ejecutar completo sin errores.
-- ============================================================

-- ---------- 1. Pacientes: columnas extra ----------
alter table public.pacientes
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists fecha_inicio date,
  add column if not exists fecha_termino date,
  add column if not exists contacto_emergencia text,
  add column if not exists telefono_emergencia text;

-- ---------- 2. Perfiles: expediente laboral + roles nuevos ----------
alter table public.perfiles
  add column if not exists telefono text,
  add column if not exists domicilio text,
  add column if not exists profesion text,
  add column if not exists especialidad text,
  add column if not exists id_laboral text,
  add column if not exists fecha_contratacion date,
  add column if not exists estado_laboral text not null default 'activo',
  -- Directorio / expediente completo
  add column if not exists fecha_nacimiento date,
  add column if not exists sexo text,
  add column if not exists curp text,
  add column if not exists codigo_postal text,
  add column if not exists cedula_profesional text,
  add column if not exists institucion text,
  add column if not exists cursos text,
  add column if not exists experiencia_anos text,
  add column if not exists experiencia_previa text,
  add column if not exists areas text,
  add column if not exists servicios_autorizados text,
  add column if not exists puesto text,
  add column if not exists tipo_contrato text,
  add column if not exists horario text,
  add column if not exists dias_disponibles text,
  add column if not exists zona text,
  add column if not exists sueldo text,
  add column if not exists disponibilidad text,
  add column if not exists contactos_emergencia jsonb default '[]'::jsonb;

-- Ampliar roles permitidos (familiar y cuidador)
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles
  add constraint perfiles_rol_check
  check (rol in ('admin', 'paciente', 'staff', 'familiar', 'cuidador'));

-- ---------- 3. Código QR del domicilio ----------
alter table public.pacientes
  add column if not exists qr_token text,
  add column if not exists qr_activo boolean not null default true;
create unique index if not exists pacientes_qr_token_idx
  on public.pacientes (qr_token) where qr_token is not null;

-- ---------- 4. Visitas: tracking, estados y check-in QR ----------
create table if not exists public.visitas (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  trabajador_id uuid references public.perfiles (id) on delete set null,
  fecha date not null,
  hora_programada time,
  radio_m integer not null default 50,
  duracion_estimada_min integer not null default 60,
  estado text not null default 'programada'
    check (estado in ('programada', 'en_curso', 'finalizada', 'cancelada', 'no_show')),
  llegada_at timestamptz,
  llegada_lat double precision,
  llegada_lng double precision,
  salida_at timestamptz,
  salida_lat double precision,
  salida_lng double precision,
  ultima_ubicacion_lat double precision,
  ultima_ubicacion_lng double precision,
  ultima_ping_at timestamptz,
  ultima_dentro_at timestamptz,
  creado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.visitas
  add column if not exists trabajador_estado text,
  add column if not exists checkin_source text,
  add column if not exists gps_precision double precision,
  add column if not exists gps_valido boolean;

create index if not exists visitas_fecha_idx on public.visitas (fecha);
create index if not exists visitas_trabajador_idx on public.visitas (trabajador_id, fecha);
create index if not exists visitas_paciente_idx on public.visitas (paciente_id);
create index if not exists visitas_estado_idx on public.visitas (estado);

drop trigger if exists visitas_updated_at on public.visitas;
create trigger visitas_updated_at
  before update on public.visitas
  for each row execute function public.set_updated_at();

-- ---------- 5. Eventos, notificaciones, auditoría ----------
create table if not exists public.visita_eventos (
  id bigint generated always as identity primary key,
  visita_id uuid not null references public.visitas (id) on delete cascade,
  evento text not null,
  detalle jsonb,
  created_at timestamptz not null default now()
);
create index if not exists visita_eventos_visita_idx on public.visita_eventos (visita_id);

create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  destinatario_id uuid references public.perfiles (id) on delete cascade,
  tipo text not null,
  mensaje text not null,
  visita_id uuid references public.visitas (id) on delete cascade,
  datos jsonb,
  leida boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notificaciones_destinatario_idx on public.notificaciones (destinatario_id, leida);

create table if not exists public.auditoria_consultas (
  id bigint generated always as identity primary key,
  usuario_id uuid,
  usuario_email text,
  endpoint text,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists auditoria_consultas_idx on public.auditoria_consultas (created_at desc);

-- ---------- 6. Notas de atención, incidencias GPS, paquetes ----------
create table if not exists public.notas_atencion (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid not null references public.visitas (id) on delete cascade,
  paciente_id uuid references public.pacientes (id) on delete cascade,
  trabajador_id uuid references public.perfiles (id) on delete set null,
  actividades text,
  observaciones text,
  evolucion text,
  incidencias text,
  recomendaciones text,
  material text,
  created_at timestamptz not null default now()
);
create index if not exists notas_atencion_visita_idx on public.notas_atencion (visita_id);
create index if not exists notas_atencion_paciente_idx on public.notas_atencion (paciente_id);

alter table public.notas_atencion
  add column if not exists sesion text,
  add column if not exists especialidad text,
  add column if not exists revisado boolean not null default false,
  add column if not exists revisado_at timestamptz,
  add column if not exists revisado_por text,
  add column if not exists comentario_admin text,
  add column if not exists correccion text;

create table if not exists public.evidencias (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.notas_atencion (id) on delete cascade,
  visita_id uuid references public.visitas (id) on delete cascade,
  paciente_id uuid references public.pacientes (id) on delete cascade,
  trabajador_id uuid references public.perfiles (id) on delete set null,
  storage_path text not null,
  descripcion text,
  nombre_archivo text,
  created_at timestamptz not null default now()
);
create index if not exists evidencias_nota_idx on public.evidencias (nota_id);
create index if not exists evidencias_paciente_idx on public.evidencias (paciente_id);

create table if not exists public.incidencias_gps (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid references public.visitas (id) on delete cascade,
  trabajador_id uuid references public.perfiles (id) on delete set null,
  descripcion text,
  resuelta boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.paquetes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  precio numeric,
  duracion_min integer,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.paquetes add column if not exists servicios text;
-- Expediente del paciente: paquete contratado, foto y datos clínicos
alter table public.pacientes add column if not exists foto_path text;
alter table public.pacientes add column if not exists paquete_id uuid references public.paquetes (id) on delete set null;
alter table public.pacientes add column if not exists frecuencia_visitas text;
alter table public.pacientes add column if not exists profesional_asignado text;
alter table public.pacientes add column if not exists diagnostico text;
alter table public.pacientes add column if not exists antecedentes text;
alter table public.pacientes add column if not exists objetivos text;
alter table public.pacientes add column if not exists fecha_contratacion date;
-- Fotografía de perfil del trabajador (credencial / expediente)
alter table public.perfiles add column if not exists avatar_path text;
-- Semáforo Inteligente de Bienestar: alertas por paciente
create table if not exists public.alertas_semaforo (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  color text not null check (color in ('verde','amarillo','rojo')),
  motivo text not null,
  revisado boolean not null default false,
  revisado_at timestamptz,
  revisado_por text,
  acciones text,
  created_at timestamptz not null default now()
);
create index if not exists alertas_semaforo_pac_idx on public.alertas_semaforo (paciente_id);
create index if not exists alertas_semaforo_abiertas_idx on public.alertas_semaforo (revisado) where revisado = false;
alter table public.alertas_semaforo enable row level security;
-- Portal del familiar responsable: vínculo autorizado por el directivo
create table if not exists public.vinculos_familiar (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  familiar_id uuid not null references public.perfiles (id) on delete cascade,
  activo boolean not null default true,
  autorizado_por text,
  created_at timestamptz not null default now(),
  unique (paciente_id, familiar_id)
);
create index if not exists vinculos_familiar_fam_idx on public.vinculos_familiar (familiar_id);
create index if not exists vinculos_familiar_pac_idx on public.vinculos_familiar (paciente_id);
alter table public.vinculos_familiar enable row level security;
-- Expediente multidisciplinario: objetivos por disciplina, cierre de registros y auditoría
alter table public.notas_atencion add column if not exists objetivos text;
alter table public.notas_atencion add column if not exists cerrada boolean not null default false;
alter table public.notas_atencion add column if not exists cerrada_at timestamptz;
alter table public.notas_atencion add column if not exists cerrada_por text;
alter table public.pacientes add column if not exists plan_atencion text;
create table if not exists public.auditoria_expediente (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  nota_id uuid references public.notas_atencion (id) on delete set null,
  actor text not null,
  accion text not null,
  detalle jsonb,
  created_at timestamptz not null default now()
);
create index if not exists auditoria_exp_pac_idx on public.auditoria_expediente (paciente_id);
alter table public.auditoria_expediente enable row level security;

-- ---------- 7. Geocercas ----------
create table if not exists public.geocercas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null default 'circulo'
    check (tipo in ('circulo', 'poligono')),
  centro_lat double precision,
  centro_lng double precision,
  radio_m integer,
  geojson jsonb,
  creado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- 8. Historial de expedientes ----------
create table if not exists public.perfiles_historial (
  id bigint generated always as identity primary key,
  perfil_id uuid not null,
  campo text not null,
  valor_anterior text,
  valor_nuevo text,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists perfiles_historial_idx on public.perfiles_historial (perfil_id, created_at desc);

-- ---------- 9. RLS (todo el acceso es vía API con service role) ----------
alter table public.visitas enable row level security;
alter table public.visita_eventos enable row level security;
alter table public.notificaciones enable row level security;
alter table public.auditoria_consultas enable row level security;
alter table public.notas_atencion enable row level security;
alter table public.incidencias_gps enable row level security;
alter table public.paquetes enable row level security;
alter table public.geocercas enable row level security;
alter table public.perfiles_historial enable row level security;
alter table public.evidencias enable row level security;

-- ============================================================
-- FIN — si todo sale en verde, la plataforma queda completa.
-- ============================================================
