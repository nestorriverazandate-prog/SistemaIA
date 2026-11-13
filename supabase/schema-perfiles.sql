-- Ejecutar una vez en Supabase → SQL Editor
-- Perfiles: expediente laboral del empleado
alter table public.perfiles
  add column if not exists telefono text,
  add column if not exists domicilio text,
  add column if not exists profesion text,
  add column if not exists especialidad text,
  add column if not exists id_laboral text,
  add column if not exists fecha_contratacion date,
  add column if not exists estado_laboral text not null default 'activo';

-- Notas de atención que el empleado registra después de cada visita
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
alter table public.notas_atencion enable row level security;

-- Incidencias de GPS reportadas por el trabajador
create table if not exists public.incidencias_gps (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid references public.visitas (id) on delete cascade,
  trabajador_id uuid references public.perfiles (id) on delete set null,
  descripcion text,
  resuelta boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.incidencias_gps enable row level security;

-- Paquetes / servicios gerontológicos
create table if not exists public.paquetes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  precio numeric,
  duracion_min integer,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.paquetes enable row level security;
