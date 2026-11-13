-- ===== Visitas domiciliarias =====
alter table public.pacientes
  add column if not exists lat double precision,
  add column if not exists lng double precision;

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
  -- registro de llegada/salida
  llegada_at timestamptz,
  llegada_lat double precision,
  llegada_lng double precision,
  salida_at timestamptz,
  salida_lat double precision,
  salida_lng double precision,
  -- tracking en vivo (solo durante la visita)
  ultima_ubicacion_lat double precision,
  ultima_ubicacion_lng double precision,
  ultima_ping_at timestamptz,
  ultima_dentro_at timestamptz,
  creado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists visitas_fecha_idx on public.visitas (fecha);
create index if not exists visitas_trabajador_idx on public.visitas (trabajador_id, fecha);
create index if not exists visitas_paciente_idx on public.visitas (paciente_id);
create index if not exists visitas_estado_idx on public.visitas (estado);

drop trigger if exists visitas_updated_at on public.visitas;
create trigger visitas_updated_at
  before update on public.visitas
  for each row execute function public.set_updated_at();

-- ===== Auditoría de eventos de visita =====
create table if not exists public.visita_eventos (
  id bigint generated always as identity primary key,
  visita_id uuid not null references public.visitas (id) on delete cascade,
  evento text not null,               -- llegada, salida, ping, retraso, tiempo_excedido, asignada, cancelada
  detalle jsonb,
  created_at timestamptz not null default now()
);

create index if not exists visita_eventos_visita_idx on public.visita_eventos (visita_id);

-- ===== Notificaciones al administrador =====
create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  destinatario_id uuid references public.perfiles (id) on delete cascade, -- null = broadcast a admins
  tipo text not null,                -- llegada, salida, retraso, no_show, tiempo_excedido
  mensaje text not null,
  visita_id uuid references public.visitas (id) on delete cascade,
  datos jsonb,
  leida boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notificaciones_destinatario_idx on public.notificaciones (destinatario_id, leida);

alter table public.visitas enable row level security;
alter table public.visita_eventos enable row level security;
alter table public.notificaciones enable row level security;
-- Sin políticas: todo el acceso es vía API con service role.
