-- ============================================================
-- SCRIPT COMPLETO — ejecutar UNA vez en Supabase → SQL Editor
-- Crea/actualiza todo lo que la plataforma necesita.
-- Es idempotente: se puede ejecutar completo sin errores.
-- ============================================================

-- ---------- 1. Pacientes: columnas extra ----------
alter table public.pacientes
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists fecha_inicio date,
  add column if not exists fecha_termino date,
  add column if not exists contacto_emergencia text,
  add column if not exists telefono_emergencia text;

-- ---------- 2. Perfiles: expediente laboral + roles nuevos ----------
alter table public.perfiles
  add column if not exists telefono text,
  add column if not exists domicilio text,
  add column if not exists profesion text,
  add column if not exists especialidad text,
  add column if not exists id_laboral text,
  add column if not exists fecha_contratacion date,
  add column if not exists estado_laboral text not null default 'activo',
  -- Directorio / expediente completo
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

-- Ampliar roles permitidos (familiar y cuidador)
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles
  add constraint perfiles_rol_check
  check (rol in ('admin', 'paciente', 'staff', 'familiar', 'cuidador'));

-- ---------- 3. Código QR del domicilio ----------
alter table public.pacientes
  add column if not exists qr_token text,
  add column if not exists qr_activo boolean not null default true;
create unique index if not exists pacientes_qr_token_idx
  on public.pacientes (qr_token) where qr_token is not null;

-- ---------- 4. Visitas: tracking, estados y check-in QR ----------
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
  llegada_at timestamptz,
  llegada_lat double precision,
  llegada_lng double precision,
  salida_at timestamptz,
  salida_lat double precision,
  salida_lng double precision,
  ultima_ubicacion_lat double precision,
  ultima_ubicacion_lng double precision,
  ultima_ping_at timestamptz,
  ultima_dentro_at timestamptz,
  creado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.visitas
  add column if not exists trabajador_estado text,
  add column if not exists checkin_source text,
  add column if not exists gps_precision double precision,
  add column if not exists gps_valido boolean;

create index if not exists visitas_fecha_idx on public.visitas (fecha);
create index if not exists visitas_trabajador_idx on public.visitas (trabajador_id, fecha);
create index if not exists visitas_paciente_idx on public.visitas (paciente_id);
create index if not exists visitas_estado_idx on public.visitas (estado);

drop trigger if exists visitas_updated_at on public.visitas;
create trigger visitas_updated_at
  before update on public.visitas
  for each row execute function public.set_updated_at();

-- ---------- 5. Eventos, notificaciones, auditoría ----------
create table if not exists public.visita_eventos (
  id bigint generated always as identity primary key,
  visita_id uuid not null references public.visitas (id) on delete cascade,
  evento text not null,
  detalle jsonb,
  created_at timestamptz not null default now()
);
create index if not exists visita_eventos_visita_idx on public.visita_eventos (visita_id);

create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  destinatario_id uuid references public.perfiles (id) on delete cascade,
  tipo text not null,
  mensaje text not null,
  visita_id uuid references public.visitas (id) on delete cascade,
  datos jsonb,
  leida boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notificaciones_destinatario_idx on public.notificaciones (destinatario_id, leida);

create table if not exists public.auditoria_consultas (
  id bigint generated always as identity primary key,
  usuario_id uuid,
  usuario_email text,
  endpoint text,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists auditoria_consultas_idx on public.auditoria_consultas (created_at desc);

-- ---------- 6. Notas de atención, incidencias GPS, paquetes ----------
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

alter table public.notas_atencion
  add column if not exists sesion text,
  add column if not exists especialidad text,
  add column if not exists revisado boolean not null default false,
  add column if not exists revisado_at timestamptz,
  add column if not exists revisado_por text,
  add column if not exists comentario_admin text,
  add column if not exists correccion text;

create table if not exists public.evidencias (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.notas_atencion (id) on delete cascade,
  visita_id uuid references public.visitas (id) on delete cascade,
  paciente_id uuid references public.pacientes (id) on delete cascade,
  trabajador_id uuid references public.perfiles (id) on delete set null,
  storage_path text not null,
  descripcion text,
  nombre_archivo text,
  created_at timestamptz not null default now()
);
create index if not exists evidencias_nota_idx on public.evidencias (nota_id);
create index if not exists evidencias_paciente_idx on public.evidencias (paciente_id);

create table if not exists public.incidencias_gps (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid references public.visitas (id) on delete cascade,
  trabajador_id uuid references public.perfiles (id) on delete set null,
  descripcion text,
  resuelta boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.paquetes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  precio numeric,
  duracion_min integer,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.paquetes add column if not exists servicios text;
-- Expediente del paciente: paquete contratado, foto y datos clínicos
alter table public.pacientes add column if not exists foto_path text;
alter table public.pacientes add column if not exists paquete_id uuid references public.paquetes (id) on delete set null;
alter table public.pacientes add column if not exists frecuencia_visitas text;
alter table public.pacientes add column if not exists profesional_asignado text;
alter table public.pacientes add column if not exists diagnostico text;
alter table public.pacientes add column if not exists antecedentes text;
alter table public.pacientes add column if not exists objetivos text;
alter table public.pacientes add column if not exists fecha_contratacion date;
-- Fotografía de perfil del trabajador (credencial / expediente)
alter table public.perfiles add column if not exists avatar_path text;
-- Semáforo Inteligente de Bienestar: alertas por paciente
create table if not exists public.alertas_semaforo (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  color text not null check (color in ('verde','amarillo','rojo')),
  motivo text not null,
  revisado boolean not null default false,
  revisado_at timestamptz,
  revisado_por text,
  acciones text,
  created_at timestamptz not null default now()
);
create index if not exists alertas_semaforo_pac_idx on public.alertas_semaforo (paciente_id);
create index if not exists alertas_semaforo_abiertas_idx on public.alertas_semaforo (revisado) where revisado = false;
alter table public.alertas_semaforo enable row level security;
-- Portal del familiar responsable: vínculo autorizado por el directivo
create table if not exists public.vinculos_familiar (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  familiar_id uuid not null references public.perfiles (id) on delete cascade,
  activo boolean not null default true,
  autorizado_por text,
  created_at timestamptz not null default now(),
  unique (paciente_id, familiar_id)
);
create index if not exists vinculos_familiar_fam_idx on public.vinculos_familiar (familiar_id);
create index if not exists vinculos_familiar_pac_idx on public.vinculos_familiar (paciente_id);
alter table public.vinculos_familiar enable row level security;
-- Expediente multidisciplinario: objetivos por disciplina, cierre de registros y auditoría
alter table public.notas_atencion add column if not exists objetivos text;
alter table public.notas_atencion add column if not exists cerrada boolean not null default false;
alter table public.notas_atencion add column if not exists cerrada_at timestamptz;
alter table public.notas_atencion add column if not exists cerrada_por text;
alter table public.pacientes add column if not exists plan_atencion text;
alter table public.visitas add column if not exists disciplina text;
-- Valoración gerontológica: escalas validadas por paciente
create table if not exists public.valoraciones (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  evaluador_id uuid references public.perfiles (id) on delete set null,
  evaluador_nombre text,
  evaluador_disciplina text,
  escala text not null,
  fecha date not null default current_date,
  respuestas jsonb,
  puntaje numeric,
  interpretacion text,
  notas text,
  created_at timestamptz not null default now()
);
create index if not exists valoraciones_pac_idx on public.valoraciones (paciente_id);
alter table public.valoraciones enable row level security;
-- Pagos/cobros de pacientes (centro de inteligencia financiera)
create table if not exists public.pagos (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  monto numeric not null,
  fecha date not null default current_date,
  metodo text,
  estado text not null default 'pagado' check (estado in ('pagado','pendiente')),
  periodo text,
  notas text,
  registrado_por text,
  created_at timestamptz not null default now()
);
create index if not exists pagos_pac_idx on public.pagos (paciente_id);
create index if not exists pagos_fecha_idx on public.pagos (fecha);
alter table public.pagos enable row level security;
-- Evaluación de desempeño del empleado
create table if not exists public.evaluaciones_empleado (
  id uuid primary key default gen_random_uuid(),
  trabajador_id uuid not null references public.perfiles (id) on delete cascade,
  periodo text not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  calificaciones jsonb not null,
  promedio numeric,
  porcentaje numeric,
  resultado text,
  fortalezas text,
  oportunidades text,
  observaciones text,
  recomendaciones text,
  revisada boolean not null default false,
  revisada_at timestamptz,
  revisada_por text,
  creado_por text,
  created_at timestamptz not null default now()
);
create index if not exists eval_emp_idx on public.evaluaciones_empleado (trabajador_id);
alter table public.evaluaciones_empleado enable row level security;
-- Planes de mejora individual
create table if not exists public.planes_mejora (
  id uuid primary key default gen_random_uuid(),
  evaluacion_id uuid references public.evaluaciones_empleado (id) on delete set null,
  trabajador_id uuid not null references public.perfiles (id) on delete cascade,
  area text not null,
  problema text,
  objetivo text,
  actividades text,
  fecha_limite date,
  responsable text,
  proxima_evaluacion date,
  estado text not null default 'pendiente' check (estado in ('pendiente','en_proceso','completado')),
  created_at timestamptz not null default now()
);
create index if not exists planes_mejora_emp_idx on public.planes_mejora (trabajador_id);
alter table public.planes_mejora enable row level security;
-- Capacitaciones del personal
create table if not exists public.capacitaciones (
  id uuid primary key default gen_random_uuid(),
  trabajador_id uuid not null references public.perfiles (id) on delete cascade,
  curso text not null,
  fecha date not null default current_date,
  horas numeric,
  tipo text,
  created_at timestamptz not null default now()
);
create index if not exists capacitaciones_emp_idx on public.capacitaciones (trabajador_id);
alter table public.capacitaciones enable row level security;
-- Encuestas de satisfacción (pacientes/familiares)
create table if not exists public.encuestas (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid references public.pacientes (id) on delete set null,
  trabajador_id uuid references public.perfiles (id) on delete set null,
  autor_id uuid,
  puntuacion integer not null check (puntuacion between 1 and 5),
  comentario text,
  created_at timestamptz not null default now()
);
create index if not exists encuestas_emp_idx on public.encuestas (trabajador_id);
alter table public.encuestas enable row level security;
create table if not exists public.auditoria_expediente (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  nota_id uuid references public.notas_atencion (id) on delete set null,
  actor text not null,
  accion text not null,
  detalle jsonb,
  created_at timestamptz not null default now()
);
create index if not exists auditoria_exp_pac_idx on public.auditoria_expediente (paciente_id);
alter table public.auditoria_expediente enable row level security;

-- ---------- 7. Geocercas ----------
create table if not exists public.geocercas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null default 'circulo'
    check (tipo in ('circulo', 'poligono')),
  centro_lat double precision,
  centro_lng double precision,
  radio_m integer,
  geojson jsonb,
  creado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- 8. Historial de expedientes ----------
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

-- ---------- 9. RLS (todo el acceso es vía API con service role) ----------
alter table public.visitas enable row level security;
alter table public.visita_eventos enable row level security;
alter table public.notificaciones enable row level security;
alter table public.auditoria_consultas enable row level security;
alter table public.notas_atencion enable row level security;
alter table public.incidencias_gps enable row level security;
alter table public.paquetes enable row level security;
alter table public.geocercas enable row level security;
alter table public.perfiles_historial enable row level security;
alter table public.evidencias enable row level security;

-- ============================================================
-- FIN — si todo sale en verde, la plataforma queda completa.
-- ============================================================

-- Encuestas de satisfacción familiar por periodo (envío mensual automático)
create table if not exists public.encuestas_periodicas (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  trabajador_id uuid references public.perfiles (id) on delete set null,
  familiar_id uuid not null references public.perfiles (id) on delete cascade,
  periodo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','respondida')),
  respuestas jsonb,
  comentario text,
  solicitar_contacto boolean not null default false,
  acciones text,
  accion_responsable text,
  accion_fecha date,
  accion_resultado text,
  recordatorios integer not null default 0,
  created_at timestamptz not null default now(),
  respondida_at timestamptz,
  unique (paciente_id, trabajador_id, familiar_id, periodo)
);
-- Si la tabla ya existía con el unique anterior, eliminarlo:
alter table public.encuestas_periodicas drop constraint if exists encuestas_periodicas_paciente_id_familiar_id_periodo_key;
create index if not exists enc_period_fam_idx on public.encuestas_periodicas (familiar_id);
create index if not exists enc_period_per_idx on public.encuestas_periodicas (periodo);
alter table public.encuestas_periodicas enable row level security;

-- Encuestas por profesional (si la tabla ya existía sin trabajador_id):
alter table public.encuestas_periodicas add column if not exists trabajador_id uuid references public.perfiles (id) on delete set null;
alter table public.encuestas_periodicas drop constraint if exists encuestas_periodicas_paciente_id_familiar_id_periodo_key;

-- ================= OBSERVATORIO GERONTOLÓGICO =================
-- Zona/colonia del paciente (texto libre, se agrupa en el observatorio)
alter table public.pacientes add column if not exists zona text;

-- Datos demográficos oficiales (INEGI/CONAPO/COESPO) — se registran con fuente
create table if not exists public.observatorio_datos (
  id uuid primary key default gen_random_uuid(),
  indicador text not null,
  grupo text,
  valor numeric,
  unidad text,
  fuente text,
  anio integer,
  updated_at timestz not null default now()
);
alter table public.observatorio_datos enable row level security;

-- Zonas/sectores territoriales conocidos (centro del polígono o punto representativo)
create table if not exists public.observatorio_zonas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tipo text default 'colonia',
  lat double precision,
  lng double precision,
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.observatorio_zonas enable row level security;

-- Servicios externos de atención al adulto mayor (hospitales, centros de salud, etc.)
create table if not exists public.observatorio_servicios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text,
  zona text,
  direccion text,
  lat double precision,
  lng double precision,
  fuente text,
  created_at timestamptz not null default now()
);
alter table public.observatorio_servicios enable row level security;

-- Necesidades gerontológicas identificadas por zona (con fuente: oficial/estudio/interna)
create table if not exists public.observatorio_necesidades (
  id uuid primary key default gen_random_uuid(),
  zona text,
  tipo text not null,
  nivel integer check (nivel between 1 and 5),
  fuente text,
  nota text,
  created_at timestamptz not null default now()
);
alter table public.observatorio_necesidades enable row level security;

-- ================= ACADEMIA DE PROFESIONALES GERONTOLÓGICOS =================
create table if not exists public.academia_cursos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  area text not null,
  descripcion text,
  nivel text not null default 'basico' check (nivel in ('basico','intermedio','avanzado')),
  horas numeric not null default 1,
  obligatorio boolean not null default false,
  estado text not null default 'borrador' check (estado in ('borrador','publicado','archivado')),
  video_url text,
  video_titulo text,
  material_url text,
  material_nombre text,
  instructor text,
  fecha_inicio date,
  fecha_fin date,
  max_intentos integer not null default 3,
  calificacion_minima numeric not null default 70,
  mostrar_resultados boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.academia_cursos enable row level security;

create table if not exists public.academia_unidades (
  id uuid primary key default gen_random_uuid(),
  curso_id uuid not null references public.academia_cursos (id) on delete cascade,
  titulo text not null,
  contenido text,
  orden integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists academia_uni_idx on public.academia_unidades (curso_id);
alter table public.academia_unidades enable row level security;

create table if not exists public.academia_preguntas (
  id uuid primary key default gen_random_uuid(),
  curso_id uuid not null references public.academia_cursos (id) on delete cascade,
  unidad_id uuid references public.academia_unidades (id) on delete set null,
  tipo text not null default 'opcion_multiple' check (tipo in ('opcion_multiple','verdadero_falso','abierta')),
  pregunta text not null,
  opciones jsonb,
  respuesta_correcta text,
  puntos numeric not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists academia_preg_idx on public.academia_preguntas (curso_id);
alter table public.academia_preguntas enable row level security;

create table if not exists public.academia_inscripciones (
  id uuid primary key default gen_random_uuid(),
  curso_id uuid not null references public.academia_cursos (id) on delete cascade,
  empleado_id uuid not null references public.perfiles (id) on delete cascade,
  estado text not null default 'asignado' check (estado in ('asignado','en_proceso','aprobado','reprobado')),
  progreso integer not null default 0,
  unidades_completadas jsonb not null default '[]'::jsonb,
  intentos integer not null default 0,
  calificacion numeric,
  asignado_por text,
  asignacion text,
  created_at timestamptz not null default now(),
  iniciado_at timestamptz,
  completado_at timestamptz,
  unique (curso_id, empleado_id)
);
create index if not exists academia_ins_emp_idx on public.academia_inscripciones (empleado_id);
create index if not exists academia_ins_cur_idx on public.academia_inscripciones (curso_id);
alter table public.academia_inscripciones enable row level security;

create table if not exists public.academia_evaluaciones (
  id uuid primary key default gen_random_uuid(),
  inscripcion_id uuid not null references public.academia_inscripciones (id) on delete cascade,
  curso_id uuid not null references public.academia_cursos (id) on delete cascade,
  empleado_id uuid not null references public.perfiles (id) on delete cascade,
  calificacion numeric,
  porcentaje numeric,
  respuestas jsonb,
  pendientes_revision jsonb,
  intentos integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists academia_eval_emp_idx on public.academia_evaluaciones (empleado_id);
alter table public.academia_evaluaciones enable row level security;

create table if not exists public.academia_constancias (
  id uuid primary key default gen_random_uuid(),
  inscripcion_id uuid not null references public.academia_inscripciones (id) on delete cascade,
  empleado_id uuid not null references public.perfiles (id) on delete cascade,
  curso_id uuid not null references public.academia_cursos (id) on delete cascade,
  folio text not null unique,
  calificacion numeric,
  horas numeric,
  created_at timestamptz not null default now()
);
alter table public.academia_constancias enable row level security;

create table if not exists public.academia_protocolos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  version text,
  descripcion text,
  contenido_url text,
  estado text not null default 'vigente' check (estado in ('vigente','archivado')),
  responsable text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.academia_protocolos enable row level security;

create table if not exists public.academia_lecturas (
  id uuid primary key default gen_random_uuid(),
  protocolo_id uuid not null references public.academia_protocolos (id) on delete cascade,
  empleado_id uuid not null references public.perfiles (id) on delete cascade,
  confirmado_at timestamptz not null default now(),
  unique (protocolo_id, empleado_id)
);
alter table public.academia_lecturas enable row level security;

create table if not exists public.academia_competencias (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.perfiles (id) on delete cascade,
  competencia text not null,
  dimension text not null default 'conocimientos' check (dimension in ('conocimientos','habilidades','actitudes','etica')),
  nivel integer not null check (nivel between 1 and 4),
  evaluador text,
  notas text,
  created_at timestamptz not null default now()
);
create index if not exists academia_comp_emp_idx on public.academia_competencias (empleado_id);
alter table public.academia_competencias enable row level security;

create table if not exists public.academia_eventos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  fecha date not null,
  hora text,
  duracion text,
  instructor text,
  modalidad text default 'virtual',
  ubicacion text,
  descripcion text,
  created_at timestamptz not null default now()
);
alter table public.academia_eventos enable row level security;

create table if not exists public.academia_asistencia (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.academia_eventos (id) on delete cascade,
  empleado_id uuid not null references public.perfiles (id) on delete cascade,
  presente boolean not null default false,
  unique (evento_id, empleado_id)
);
alter table public.academia_asistencia enable row level security;

-- ================= ACADEMIA: catálogo institucional (campos extendidos) =================
alter table public.academia_cursos add column if not exists modalidad text not null default 'virtual';
alter table public.academia_cursos add column if not exists etiqueta text;
alter table public.academia_cursos add column if not exists profesiones jsonb not null default '[]'::jsonb;
alter table public.academia_cursos add column if not exists justificacion text;
alter table public.academia_cursos add column if not exists objetivos text;
alter table public.academia_cursos add column if not exists temario text;
alter table public.academia_cursos add column if not exists bibliografia text;
alter table public.academia_cursos add column if not exists revisor text;
alter table public.academia_cursos add column if not exists vigencia_anios integer not null default 2;

-- ================= ACADEMIA: exámenes por unidad y banco de reactivos =================
alter table public.academia_preguntas add column if not exists dificultad text not null default 'medio';
alter table public.academia_preguntas add column if not exists competencia text;
alter table public.academia_preguntas add column if not exists retroalimentacion text;
alter table public.academia_preguntas add column if not exists caso text;

create table if not exists public.academia_unidad_intentos (
  id uuid primary key default gen_random_uuid(),
  inscripcion_id uuid not null references public.academia_inscripciones (id) on delete cascade,
  unidad_id uuid not null references public.academia_unidades (id) on delete cascade,
  empleado_id uuid not null references public.perfiles (id) on delete cascade,
  calificacion numeric not null,
  correctas integer not null default 0,
  incorrectas integer not null default 0,
  total integer not null default 0,
  intentos integer not null default 1,
  estado text not null default 'no_aprobado' check (estado in ('no_aprobado','aprobado')),
  respuestas jsonb,
  created_at timestamptz not null default now()
);
create index if not exists acad_uni_int_idx on public.academia_unidad_intentos (inscripcion_id, unidad_id);
alter table public.academia_unidad_intentos enable row level security;

alter table public.academia_inscripciones add column if not exists unidades_aprobadas jsonb not null default '[]'::jsonb;
alter table public.academia_inscripciones add column if not exists examen_final_estado text not null default 'bloqueado' check (examen_final_estado in ('bloqueado','disponible','aprobado','reprobado'));

-- ================= BOTÓN DE PÁNICO / EMERGENCIAS =================
create table if not exists public.emergencias (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.perfiles (id) on delete cascade,
  paciente_id uuid references public.pacientes (id) on delete set null,
  visita_id uuid,
  tipo text not null default 'panico',
  silenciosa boolean not null default false,
  estado text not null default 'activa' check (estado in ('activa','confirmada','atendida','cancelada')),
  lat double precision, lng double precision,
  servicio text,
  contacto_respaldo text,
  confirmada_at timestamptz,
  atendida_at timestamptz,
  cancelada_at timestamptz,
  motivo_cancelacion text,
  acciones text,
  created_at timestamptz not null default now()
);
create index if not exists emerg_emp_idx on public.emergencias (empleado_id);
create index if not exists emerg_est_idx on public.emergencias (estado);
alter table public.emergencias enable row level security;

create table if not exists public.emergencia_eventos (
  id uuid primary key default gen_random_uuid(),
  emergencia_id uuid not null references public.emergencias (id) on delete cascade,
  tipo text not null,
  detalle text,
  created_at timestamptz not null default now()
);
alter table public.emergencia_eventos enable row level security;

alter table public.perfiles add column if not exists contacto_emergencia_nombre text;
alter table public.perfiles add column if not exists contacto_emergencia_telefono text;

-- ================= EMERGENCIAS: comunicación bidireccional =================
alter table public.emergencias drop constraint if exists emergencias_estado_check;
alter table public.emergencias add constraint emergencias_estado_check
  check (estado in ('activa','confirmada','en_gestion','atendida','cerrada','cancelada'));
alter table public.emergencias add column if not exists empleado_confirmo_at timestamptz;
alter table public.emergencias add column if not exists gestionada_at timestamptz;

create table if not exists public.emergencia_mensajes (
  id uuid primary key default gen_random_uuid(),
  emergencia_id uuid not null references public.emergencias (id) on delete cascade,
  remitente_id uuid not null references public.perfiles (id) on delete cascade,
  mensaje text not null,
  leido boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists emerg_msg_idx on public.emergencia_mensajes (emergencia_id);
alter table public.emergencia_mensajes enable row level security;

-- Chat de emergencia: estado de entrega de mensajes
alter table public.emergencia_mensajes add column if not exists entregado boolean not null default false;
