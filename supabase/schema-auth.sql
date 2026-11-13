-- Perfiles de usuario ligados a Supabase Auth (auth.users)
-- El registro con Google crea un perfil en estado 'pendiente'; un admin lo aprueba.
create table if not exists public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  nombre text,
  rol text not null default 'paciente'
    check (rol in ('admin', 'paciente', 'staff')),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobado', 'rechazado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists perfiles_estado_idx on public.perfiles (estado);

drop trigger if exists perfiles_updated_at on public.perfiles;
create trigger perfiles_updated_at
  before update on public.perfiles
  for each row execute function public.set_updated_at();

alter table public.perfiles enable row level security;

-- Cada usuario puede leer su propio perfil
create policy "perfiles_select_own" on public.perfiles
  for select to authenticated
  using (auth.uid() = id);

-- Cada usuario puede insertar su propio perfil (registro)
create policy "perfiles_insert_own" on public.perfiles
  for insert to authenticated
  with check (auth.uid() = id);

-- El backend usa service_role y omite RLS; no se necesitan más políticas.

-- Vincular pacientes con el usuario que los registró
alter table public.pacientes
  add column if not exists user_id uuid references auth.users (id) on delete set null;
