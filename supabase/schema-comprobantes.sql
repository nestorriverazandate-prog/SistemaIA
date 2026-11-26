-- ============================================================
-- COMPROBANTES DE PAGO DEL FAMILIAR — AGI
-- Ejecutar en Supabase → SQL Editor (se suma a schema-finanzas.sql)
-- ============================================================

create table if not exists public.comprobantes_pago (
  id uuid primary key default gen_random_uuid(),
  familiar_id uuid not null references public.perfiles (id) on delete cascade,
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  paquete_id uuid references public.paquetes (id) on delete set null,
  monto numeric not null check (monto > 0),
  fecha_deposito date not null,
  metodo text not null check (metodo in ('deposito','transferencia')),
  referencia text,
  comprobante_path text,
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  motivo_rechazo text,
  revisado_por text,
  revisado_at timestamptz,
  pago_id uuid references public.pagos (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists comp_fam_idx on public.comprobantes_pago (familiar_id);
create index if not exists comp_pac_idx on public.comprobantes_pago (paciente_id);
create index if not exists comp_estado_idx on public.comprobantes_pago (estado);
create index if not exists comp_ref_idx on public.comprobantes_pago (referencia);
alter table public.comprobantes_pago enable row level security;

-- Evita duplicar la misma referencia de operación
create unique index if not exists comp_ref_unica
  on public.comprobantes_pago (referencia)
  where referencia is not null and referencia <> '';

-- Bucket privado para comprobantes de pago (si no existe)
insert into storage.buckets (id, name, public)
values ('comprobantes-pago', 'comprobantes-pago', false)
on conflict (id) do nothing;
