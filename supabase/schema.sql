-- Esquema para Supabase: pacientes que solicitan servicio
create table if not exists public.pacientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  apellido text not null,
  cedula text, -- almacena la edad del adulto mayor (el formulario envía "edad")
  telefono text,
  email text,
  direccion text,
  tipo_servicio text,
  descripcion text,
  fecha_solicitud date,
  fecha_inicio date,
  fecha_termino date,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_proceso', 'completado', 'cancelado')),
  registrado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pacientes_created_at_idx on public.pacientes (created_at desc);
create index if not exists pacientes_estado_idx on public.pacientes (estado);

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists pacientes_updated_at on public.pacientes;
create trigger pacientes_updated_at
  before update on public.pacientes
  for each row execute function public.set_updated_at();

-- RLS: solo el backend (service role) accede; la anon key no puede leer/escribir
alter table public.pacientes enable row level security;
-- Sin políticas para anon/authenticated: todo el acceso pasa por la API con service role.
