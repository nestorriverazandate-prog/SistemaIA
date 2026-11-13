-- Geocercas dibujadas en el módulo de mapas (Leaflet)
create table if not exists public.geocercas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null default 'circulo'
    check (tipo in ('circulo', 'poligono')),
  centro_lat double precision,
  centro_lng double precision,
  radio_m integer,
  geojson jsonb,               -- para polígonos u otras formas
  creado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.geocercas enable row level security;
-- El acceso es solo vía API (service role); sin políticas para anon.
