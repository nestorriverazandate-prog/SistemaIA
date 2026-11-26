-- ============================================================
-- MÓDULO DE CONTROL FINANCIERO — AGI
-- Ejecutar completo en Supabase → SQL Editor
-- ============================================================

-- ---------- Movimientos financieros (ingresos manuales y egresos) ----------
-- Los pagos de familiares viven en `pagos` (fuente única, no se duplican aquí).
-- Esta tabla registra: otros ingresos, y TODOS los egresos operativos.
create table if not exists public.movimientos_financieros (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('ingreso','egreso')),
  categoria text not null,
  concepto text not null,
  descripcion text,
  monto numeric not null check (monto > 0),
  cantidad numeric not null default 1,
  metodo_pago text,
  fecha date not null default current_date,
  responsable text,
  paciente_id uuid references public.pacientes (id) on delete set null,
  comprobante_path text,
  comprobante_ref text,
  registrado_por text,
  -- Anulación (no se borra: queda auditoría)
  anulado boolean not null default false,
  anulado_por text,
  anulado_at timestamptz,
  motivo_anulacion text,
  created_at timestamptz not null default now()
);
create index if not exists movfin_tipo_idx on public.movimientos_financieros (tipo);
create index if not exists movfin_fecha_idx on public.movimientos_financieros (fecha);
create index if not exists movfin_pac_idx on public.movimientos_financieros (paciente_id);
create index if not exists movfin_cat_idx on public.movimientos_financieros (categoria);
alter table public.movimientos_financieros enable row level security;

-- ---------- Presupuestos por categoría / departamento ----------
create table if not exists public.presupuestos (
  id uuid primary key default gen_random_uuid(),
  periodo text not null check (periodo in ('mensual','trimestral','anual')),
  fecha_inicio date not null,
  categoria text not null,
  departamento text,
  monto_limite numeric not null check (monto_limite >= 0),
  notas text,
  creado_por text,
  created_at timestamptz not null default now()
);
create index if not exists presupuestos_periodo_idx on public.presupuestos (periodo, fecha_inicio);
alter table public.presupuestos enable row level security;

-- ---------- Campos extra en pagos: vencimiento y comprobante ----------
alter table public.pagos add column if not exists fecha_vencimiento date;
alter table public.pagos add column if not exists comprobante_ref text;
alter table public.pagos add column if not exists recibo_folio text;
alter table public.pagos add column if not exists familiar_id uuid references public.perfiles (id) on delete set null;

-- Folio de recibo automático para pagos confirmados (si está vacío)
create or replace function public.pagos_asignar_folio()
returns trigger language plpgsql as $$
begin
  if NEW.estado = 'pagado' and (NEW.recibo_folio is null or NEW.recibo_folio = '') then
    NEW.recibo_folio := 'AGI-R-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  end if;
  return NEW;
end $$;
drop trigger if exists pagos_folio_trg on public.pagos;
create trigger pagos_folio_trg before insert or update on public.pagos
  for each row execute function public.pagos_asignar_folio();

-- ---------- Bucket de Storage para comprobantes ----------
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;
