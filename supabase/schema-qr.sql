-- Control de asistencia por código QR
-- Ejecutar una vez en Supabase → SQL Editor

alter table public.pacientes
  add column if not exists qr_token text,
  add column if not exists qr_activo boolean not null default true;

-- Token único por paciente (los ya registrados se generan bajo demanda)
create unique index if not exists pacientes_qr_token_idx
  on public.pacientes (qr_token) where qr_token is not null;

-- Metadatos del check-in QR en visitas
alter table public.visitas
  add column if not exists checkin_source text,
  add column if not exists gps_precision double precision,
  add column if not exists gps_valido boolean;
