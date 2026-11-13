-- Directorio y expedientes del personal: columnas nuevas en perfiles
-- Ejecutar una vez en Supabase → SQL Editor

alter table public.perfiles
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

-- Historial de modificaciones del expediente
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
alter table public.perfiles_historial enable row level security;
-- Sin políticas: el acceso es solo vía API con service role.
