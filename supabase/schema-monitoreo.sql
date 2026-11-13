-- Ejecutar una vez en Supabase → SQL Editor
-- Estado del trabajador durante la visita (en_camino, en_domicilio, descanso, finalizada)
alter table public.visitas
  add column if not exists trabajador_estado text;

-- Auditoría de quién consulta datos de ubicación de trabajadores
create table if not exists public.auditoria_consultas (
  id bigint generated always as identity primary key,
  usuario_id uuid,
  usuario_email text,
  endpoint text,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists auditoria_consultas_idx on public.auditoria_consultas (created_at desc);

alter table public.auditoria_consultas enable row level security;
-- Sin políticas: todo el acceso es vía API con service role.
