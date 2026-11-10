-- ═══════════════════════════════════════════════════════════════
-- CUPFI · Etapa 1: categorías, conexiones con doble aceptación, chat
-- privado, permiso de webmaster, bitácora y guía.
--
-- Se corre DESPUÉS de sql/001_schema.sql (y de 011 en el proyecto ya
-- existente). Es idempotente: se puede correr más de una vez sin romper
-- nada ni duplicar datos. Volver a correrlo también migra al nuevo
-- formato las empresas que se hayan cargado con el formato viejo
-- (por ejemplo, si se corre sql/005_seed_demo_empresas.sql después).
--
-- NO borra ni modifica las columnas viejas empresas.ofertas y
-- empresas.needs_uncovered: quedan como respaldo de los datos originales.
--
-- Resumen de reglas que hace cumplir la base (no el navegador):
--  · Solo los usuarios de una empresa pueden aceptar / rechazar / retirar
--    una conexión en nombre de esa empresa (ni siquiera un admin).
--  · El contenido del chat solo lo leen los usuarios de las dos empresas
--    de la conexión. Ni admins ni webmasters pueden leerlo: el webmaster
--    solo obtiene cantidades y fechas (webmaster_contacto_resumen).
--  · La bitácora solo la leen los webmasters y nadie puede editarla ni
--    borrarla desde la app.
--  · El permiso de webmaster solo puede tenerlo un admin, y solo un
--    webmaster puede otorgarlo o quitarlo (a otro usuario, no a sí mismo).
--    El primero se asigna desde el SQL Editor (ver README).
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1. COLUMNAS NUEVAS EN TABLAS EXISTENTES
-- ───────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists is_webmaster boolean not null default false;
alter table public.profiles add column if not exists guia_vista boolean not null default false;
alter table public.empresas add column if not exists items_migrados boolean not null default false;

-- ───────────────────────────────────────────────────────────────
-- 2. FUNCIONES AUXILIARES
-- ───────────────────────────────────────────────────────────────

-- Normaliza texto igual que normalizeTagKey() en assets/js/utils.ts
-- (minúsculas, sin acentos, sin signos, espacios simples). Así la base y
-- el navegador consideran "iguales" exactamente los mismos textos.
create or replace function public.fn_norm(t text)
returns text as $$
  select trim(regexp_replace(
    regexp_replace(
      translate(lower(coalesce(t, '')), 'áàäéèëíìïóòöúùü', 'aaaeeeiiiooouuu'),
      '[^a-z0-9 ]', ' ', 'g'),
    '\s+', ' ', 'g'));
$$ language sql immutable;

create or replace function public.fn_es_admin(p_uid uuid)
returns boolean as $$
  select exists (select 1 from public.profiles where id = p_uid and role = 'admin');
$$ language sql stable security definer set search_path = public;

create or replace function public.fn_es_webmaster(p_uid uuid)
returns boolean as $$
  select exists (select 1 from public.profiles where id = p_uid and role = 'admin' and is_webmaster);
$$ language sql stable security definer set search_path = public;

-- ¿p_uid es administrador principal o usuario asociado de la empresa?
create or replace function public.fn_es_usuario_empresa(p_empresa bigint, p_uid uuid)
returns boolean as $$
  select p_uid is not null and (
    exists (select 1 from public.empresas where id = p_empresa and uid = p_uid)
    or exists (select 1 from public.empresa_usuarios where empresa_id = p_empresa and user_id = p_uid)
  );
$$ language sql stable security definer set search_path = public;

-- Todos los usuarios con acceso a una empresa (principal + asociados).
create or replace function public.fn_usuarios_empresa(p_empresa bigint)
returns setof uuid as $$
  select uid from public.empresas where id = p_empresa and uid is not null
  union
  select user_id from public.empresa_usuarios where empresa_id = p_empresa;
$$ language sql stable security definer set search_path = public;

-- ¿Las dos empresas comparten algún usuario? (mismo criterio que
-- isSameOwner() en assets/js/matching.ts: nunca se conectan entre sí).
create or replace function public.fn_mismo_titular(p_a bigint, p_b bigint)
returns boolean as $$
  select exists (
    select 1 from public.fn_usuarios_empresa(p_a) a
    join public.fn_usuarios_empresa(p_b) b on a = b
  );
$$ language sql stable security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 3. BITÁCORA
-- ───────────────────────────────────────────────────────────────
create table if not exists public.bitacora (
  id bigserial primary key,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  -- Quién hizo la acción. Se guarda también nombre y email del momento
  -- para que el registro siga siendo legible si la cuenta se borra.
  user_id uuid references public.profiles(id) on delete set null,
  user_nombre text,
  user_email text,
  accion text not null,
  entidad text,
  entidad_id text,
  detalle jsonb not null default '{}'::jsonb
);

create index if not exists bitacora_created_at_idx on public.bitacora (created_at desc);
create index if not exists bitacora_user_idx on public.bitacora (user_id);
create index if not exists bitacora_accion_idx on public.bitacora (accion);

alter table public.bitacora enable row level security;

drop policy if exists "Solo webmasters leen la bitacora" on public.bitacora;
create policy "Solo webmasters leen la bitacora"
  on public.bitacora for select
  to authenticated using (public.fn_es_webmaster(auth.uid()));
-- Sin políticas de insert/update/delete: nadie puede escribir, editar ni
-- borrar la bitácora directamente. Solo se escribe desde fn_log (abajo).

-- Escribe un evento. NO se expone al navegador (ver los revoke al final
-- del archivo): solo la usan triggers y funciones de este archivo.
-- auth.uid() es NULL cuando la acción viene del SQL Editor / Table Editor.
create or replace function public.fn_log(
  p_accion text, p_entidad text default null, p_entidad_id text default null,
  p_detalle jsonb default '{}'::jsonb, p_user uuid default null
) returns void as $$
declare
  v_uid uuid := coalesce(p_user, auth.uid());
  v_nombre text;
  v_email text;
begin
  if current_setting('cupfi.sin_bitacora', true) = 'on' then
    return;
  end if;
  if v_uid is not null then
    select trim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')), email
      into v_nombre, v_email
      from public.profiles where id = v_uid;
  end if;
  insert into public.bitacora (user_id, user_nombre, user_email, accion, entidad, entidad_id, detalle)
  values (
    case when exists (select 1 from public.profiles where id = v_uid) then v_uid else null end,
    coalesce(nullif(v_nombre, ''), case when v_uid is null then 'Sistema (consola de Supabase)' else null end),
    v_email, p_accion, p_entidad, p_entidad_id, coalesce(p_detalle, '{}'::jsonb)
  );
end;
$$ language plpgsql security definer set search_path = public;

-- Eventos que solo el navegador conoce (inicio/cierre de sesión). Lista
-- cerrada: no permite inventar otros tipos de evento, y el usuario
-- registrado es siempre quien llama (no se puede firmar por otro).
create or replace function public.registrar_evento(p_accion text)
returns void as $$
begin
  if auth.uid() is null then
    raise exception 'NO_AUTENTICADO';
  end if;
  if coalesce(p_accion, '') not in ('sesion_inicio', 'sesion_cierre') then
    raise exception 'EVENTO_NO_PERMITIDO';
  end if;
  perform public.fn_log(p_accion, 'sesion', null, '{}'::jsonb);
end;
$$ language plpgsql security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 4. CATEGORÍAS
-- ───────────────────────────────────────────────────────────────
create table if not exists public.categorias (
  id bigserial primary key,
  nombre text not null,
  subcategorias text[] not null default '{}',  -- subcategorías sugeridas
  orden integer not null default 0,
  es_otros boolean not null default false,     -- la categoría especial "Otros"
  created_at timestamp with time zone default timezone('utc'::text, now())
);

create unique index if not exists categorias_nombre_unico on public.categorias (public.fn_norm(nombre));
create unique index if not exists categorias_un_solo_otros on public.categorias (es_otros) where es_otros;

alter table public.categorias enable row level security;

drop policy if exists "Categorias visibles para autenticados" on public.categorias;
create policy "Categorias visibles para autenticados"
  on public.categorias for select to authenticated using (true);

drop policy if exists "Webmasters crean categorias" on public.categorias;
create policy "Webmasters crean categorias"
  on public.categorias for insert to authenticated
  with check (public.fn_es_webmaster(auth.uid()) and not es_otros);

drop policy if exists "Webmasters editan categorias" on public.categorias;
create policy "Webmasters editan categorias"
  on public.categorias for update to authenticated
  using (public.fn_es_webmaster(auth.uid()))
  with check (public.fn_es_webmaster(auth.uid()));

drop policy if exists "Webmasters borran categorias" on public.categorias;
create policy "Webmasters borran categorias"
  on public.categorias for delete to authenticated
  using (public.fn_es_webmaster(auth.uid()) and not es_otros);

-- "Otros" no se puede renombrar ni dejar de ser "Otros" (la app depende
-- de ella para la migración y para su regla especial de coincidencia).
create or replace function public.fn_proteger_otros()
returns trigger as $$
begin
  if OLD.es_otros and (NEW.es_otros is distinct from OLD.es_otros or public.fn_norm(NEW.nombre) <> public.fn_norm(OLD.nombre)) then
    raise exception 'CATEGORIA_OTROS_PROTEGIDA';
  end if;
  if NEW.es_otros and not OLD.es_otros then
    raise exception 'CATEGORIA_OTROS_PROTEGIDA';
  end if;
  NEW.nombre := trim(regexp_replace(NEW.nombre, '\s+', ' ', 'g'));
  return NEW;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists proteger_otros_trigger on public.categorias;
create trigger proteger_otros_trigger
  before update on public.categorias
  for each row execute procedure public.fn_proteger_otros();

-- Categorías iniciales (las mismas 28 sugerencias que ya usaba la app,
-- más "Otros"), con subcategorías sugeridas. Si una categoría ya existe
-- (por nombre) no se toca: los cambios hechos por un webmaster se respetan.
insert into public.categorias (nombre, subcategorias, orden, es_otros)
select v.nombre, v.subs, v.orden, v.es_otros
from (values
  ('Mecanizado de piezas', array['Torneado CNC','Fresado CNC','Rectificado','Electroerosión','Piezas a medida','Series cortas'], 10, false),
  ('Diseño eléctrico', array['Tableros eléctricos','Instalaciones de potencia','Iluminación','Planos y documentación','Puesta a tierra'], 20, false),
  ('Diseño mecánico', array['Diseño CAD 3D','Cálculo estructural','Simulación (FEA)','Planos de fabricación','Matricería'], 30, false),
  ('Ensayos de materiales', array['Tracción y dureza','Fatiga','Ensayos no destructivos','Metalografía','Análisis químico'], 40, false),
  ('Mantenimiento industrial', array['Preventivo','Correctivo','Predictivo','Mantenimiento eléctrico','Mantenimiento mecánico'], 50, false),
  ('Logística y transporte', array['Transporte de cargas','Distribución','Almacenamiento','Logística de campo','Comercio exterior'], 60, false),
  ('Consultoría técnica', array['Gestión de proyectos','Estudios de factibilidad','Peritajes','Optimización de procesos'], 70, false),
  ('Automatización industrial', array['PLC','SCADA','Robótica','Instrumentación','Sensores e IoT'], 80, false),
  ('Soldadura', array['TIG','MIG/MAG','Electrodo','Soldadura de cañerías','Calificación de soldadores'], 90, false),
  ('Metrología', array['Calibración de instrumentos','Medición dimensional','Medición 3D','Metrología eléctrica'], 100, false),
  ('Inyección de plásticos', array['Moldes de inyección','Piezas técnicas','Series largas','Prototipos'], 110, false),
  ('Tratamientos superficiales', array['Galvanizado','Pintura industrial','Cromado','Tratamiento térmico','Anodizado'], 120, false),
  ('Control de calidad', array['Inspección','Ensayos de producto','Gestión de no conformidades','Trazabilidad'], 130, false),
  ('Ingeniería de procesos', array['Layout de planta','Lean manufacturing','Estudio de tiempos','Mejora continua'], 140, false),
  ('Instalaciones eléctricas', array['Baja tensión','Media tensión','Industriales','Domiciliarias'], 150, false),
  ('Climatización (HVAC)', array['Aire acondicionado','Calefacción','Ventilación industrial','Refrigeración'], 160, false),
  ('Software a medida', array['Desarrollo web','E-commerce','Aplicaciones móviles','Sistemas de gestión (ERP)','Integraciones'], 170, false),
  ('Capacitación técnica', array['Cursos presenciales','Cursos online','Seguridad laboral','Formación en normas'], 180, false),
  ('Importación / Exportación', array['Despacho de aduana','Gestión de importaciones','Asesoría en exportación','Búsqueda de proveedores'], 190, false),
  ('Insumos industriales', array['Materias primas','Repuestos','Herramientas','Elementos de protección personal'], 200, false),
  ('Seguridad e higiene', array['Prevención de incendios','Estudios de riesgo','Medición de contaminantes','Elementos de protección personal'], 210, false),
  ('Auditoría técnica', array['ISO 9001','ISO 14001','ISO 45001','Auditorías de habilitación'], 220, false),
  ('Impresión 3D / prototipado', array['Impresión FDM','Impresión en resina','Prototipos funcionales','Escaneo 3D'], 230, false),
  ('Energías renovables', array['Solar fotovoltaica','Solar térmica','Eólica','Eficiencia energética'], 240, false),
  ('Construcción y obra civil', array['Naves industriales','Estructuras metálicas','Hormigón','Movimiento de suelos'], 250, false),
  ('Recursos humanos técnicos', array['Selección de personal técnico','Pasantías','Personal temporal'], 260, false),
  ('Marketing y ventas B2B', array['Diseño web','Redes sociales','Ferias y eventos','Desarrollo de nuevos mercados'], 270, false),
  ('Legal y contable', array['Asesoría legal','Contabilidad','Financiamiento público','Gestión de subsidios'], 280, false),
  ('Otros', array[]::text[], 1000, true)
) as v(nombre, subs, orden, es_otros)
where not exists (select 1 from public.categorias c where public.fn_norm(c.nombre) = public.fn_norm(v.nombre))
  and not (v.es_otros and exists (select 1 from public.categorias c where c.es_otros));

-- ───────────────────────────────────────────────────────────────
-- 5. ÍTEMS DE EMPRESA (ofertas y necesidades con categoría + subcategoría)
-- ───────────────────────────────────────────────────────────────
create table if not exists public.empresa_items (
  id bigserial primary key,
  empresa_id bigint not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('oferta', 'necesidad')),
  -- restrict: no se puede borrar una categoría que alguna empresa usa.
  categoria_id bigint not null references public.categorias(id) on delete restrict,
  subcategoria text not null default '' check (char_length(subcategoria) <= 120),
  -- true = vino de la migración automática y conviene que la empresa lo revise
  revisar boolean not null default false,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

create unique index if not exists empresa_items_unico
  on public.empresa_items (empresa_id, tipo, categoria_id, public.fn_norm(subcategoria));
create index if not exists empresa_items_categoria_idx on public.empresa_items (categoria_id, tipo);

alter table public.empresa_items enable row level security;

drop policy if exists "Items visibles para autenticados" on public.empresa_items;
create policy "Items visibles para autenticados"
  on public.empresa_items for select to authenticated using (true);
-- Sin políticas de escritura directa: se escriben solo con
-- guardar_items_empresa(), que valida y registra en la bitácora.

-- Reemplaza todas las ofertas y necesidades de una empresa por las que
-- manda el formulario. p_items es un array JSON de objetos
-- {"tipo": "oferta"|"necesidad", "categoria_id": n, "subcategoria": "..."}.
-- Al guardar desde el formulario se considera que la empresa revisó sus
-- ítems, así que se limpia la marca "revisar".
create or replace function public.guardar_items_empresa(p_empresa bigint, p_items jsonb)
returns setof public.empresa_items as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_tipo text;
  v_cat bigint;
  v_sub text;
  v_es_otros boolean;
  v_agregados jsonb := '[]'::jsonb;
  v_quitados jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if not exists (select 1 from public.empresas where id = p_empresa) then
    raise exception 'EMPRESA_INEXISTENTE';
  end if;
  if not (public.fn_es_usuario_empresa(p_empresa, v_uid) or public.fn_es_admin(v_uid)) then
    raise exception 'SIN_PERMISO_EMPRESA';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ITEMS_INVALIDOS';
  end if;
  if jsonb_array_length(p_items) > 120 then
    raise exception 'DEMASIADOS_ITEMS';
  end if;

  create temporary table if not exists tmp_items_nuevos (
    tipo text, categoria_id bigint, subcategoria text
  ) on commit drop;
  delete from tmp_items_nuevos;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_tipo := v_item->>'tipo';
    v_cat := nullif(v_item->>'categoria_id', '')::bigint;
    v_sub := trim(regexp_replace(coalesce(v_item->>'subcategoria', ''), '\s+', ' ', 'g'));
    if coalesce(v_tipo, '') not in ('oferta', 'necesidad') then raise exception 'ITEMS_INVALIDOS'; end if;
    select es_otros into v_es_otros from public.categorias where id = v_cat;
    if not found then raise exception 'CATEGORIA_INEXISTENTE'; end if;
    if char_length(v_sub) > 120 then raise exception 'SUBCATEGORIA_LARGA'; end if;
    if v_es_otros and v_sub = '' then raise exception 'OTROS_REQUIERE_DETALLE'; end if;
    -- descarta duplicados dentro del mismo envío
    if not exists (
      select 1 from tmp_items_nuevos t
      where t.tipo = v_tipo and t.categoria_id = v_cat and public.fn_norm(t.subcategoria) = public.fn_norm(v_sub)
    ) then
      insert into tmp_items_nuevos values (v_tipo, v_cat, v_sub);
    end if;
  end loop;

  -- Quitados: los que existían y ya no vienen.
  with q as (
    delete from public.empresa_items e
    where e.empresa_id = p_empresa
      and not exists (
        select 1 from tmp_items_nuevos t
        where t.tipo = e.tipo and t.categoria_id = e.categoria_id
          and public.fn_norm(t.subcategoria) = public.fn_norm(e.subcategoria)
      )
    returning e.tipo, e.categoria_id, e.subcategoria
  )
  select coalesce(jsonb_agg(jsonb_build_object('tipo', q.tipo, 'categoria', c.nombre, 'subcategoria', q.subcategoria)), '[]'::jsonb)
    into v_quitados
    from q join public.categorias c on c.id = q.categoria_id;

  -- Agregados: los que vienen y no existían.
  with a as (
    insert into public.empresa_items (empresa_id, tipo, categoria_id, subcategoria)
    select p_empresa, t.tipo, t.categoria_id, t.subcategoria from tmp_items_nuevos t
    where not exists (
      select 1 from public.empresa_items e
      where e.empresa_id = p_empresa and e.tipo = t.tipo and e.categoria_id = t.categoria_id
        and public.fn_norm(e.subcategoria) = public.fn_norm(t.subcategoria)
    )
    returning tipo, categoria_id, subcategoria
  )
  select coalesce(jsonb_agg(jsonb_build_object('tipo', a.tipo, 'categoria', c.nombre, 'subcategoria', a.subcategoria)), '[]'::jsonb)
    into v_agregados
    from a join public.categorias c on c.id = a.categoria_id;

  update public.empresa_items set revisar = false where empresa_id = p_empresa and revisar;
  update public.empresas set items_migrados = true where id = p_empresa and not items_migrados;

  if jsonb_array_length(v_agregados) > 0 or jsonb_array_length(v_quitados) > 0 then
    perform public.fn_log('empresa_items_cambio', 'empresa', p_empresa::text,
      jsonb_build_object(
        'empresa', (select nombre from public.empresas where id = p_empresa),
        'agregados', v_agregados, 'quitados', v_quitados));
  end if;

  return query select * from public.empresa_items where empresa_id = p_empresa order by id;
end;
$$ language plpgsql security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 6. CONEXIONES (doble aceptación)
-- Una conexión = "empresa_necesita necesita [categoría] ← empresa_ofrece
-- la ofrece". Las subcategorías que coinciden se calculan en vivo a partir
-- de empresa_items (así se ve siempre el estado actual). La fila se crea
-- recién cuando una de las dos empresas acepta o rechaza; mientras no
-- existe, la conexión es solo una "sugerencia" calculada.
-- ───────────────────────────────────────────────────────────────
create table if not exists public.conexiones (
  id bigserial primary key,
  empresa_necesita_id bigint not null references public.empresas(id) on delete cascade,
  empresa_ofrece_id bigint not null references public.empresas(id) on delete cascade,
  categoria_id bigint not null references public.categorias(id) on delete restrict,
  acepta_necesita_at timestamp with time zone,
  acepta_necesita_por uuid references public.profiles(id) on delete set null,
  acepta_ofrece_at timestamp with time zone,
  acepta_ofrece_por uuid references public.profiles(id) on delete set null,
  rechazada_at timestamp with time zone,
  rechazada_por uuid references public.profiles(id) on delete set null,
  rechazada_empresa_id bigint references public.empresas(id) on delete set null,
  match_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint conexiones_distintas check (empresa_necesita_id <> empresa_ofrece_id),
  constraint conexiones_unica unique (empresa_necesita_id, empresa_ofrece_id, categoria_id)
);

create index if not exists conexiones_ofrece_idx on public.conexiones (empresa_ofrece_id);

alter table public.conexiones enable row level security;

drop policy if exists "Conexiones visibles para sus empresas o webmaster" on public.conexiones;
create policy "Conexiones visibles para sus empresas o webmaster"
  on public.conexiones for select to authenticated using (
    public.fn_es_usuario_empresa(empresa_necesita_id, auth.uid())
    or public.fn_es_usuario_empresa(empresa_ofrece_id, auth.uid())
    or public.fn_es_webmaster(auth.uid())
  );
-- Sin políticas de escritura directa: solo conexion_responder().

-- ¿Existe hoy una coincidencia real para esa conexión? Mismo criterio que
-- assets/js/matching.ts: misma categoría (en "Otros", además, la misma
-- subcategoría) y empresas sin usuarios en común.
create or replace function public.fn_conexion_vigente(p_necesita bigint, p_ofrece bigint, p_categoria bigint)
returns boolean as $$
declare
  v_es_otros boolean;
begin
  select es_otros into v_es_otros from public.categorias where id = p_categoria;
  if not found then return false; end if;
  if p_necesita = p_ofrece or public.fn_mismo_titular(p_necesita, p_ofrece) then return false; end if;
  if v_es_otros then
    return exists (
      select 1 from public.empresa_items n
      join public.empresa_items o
        on o.empresa_id = p_ofrece and o.tipo = 'oferta' and o.categoria_id = p_categoria
       and public.fn_norm(o.subcategoria) = public.fn_norm(n.subcategoria)
      where n.empresa_id = p_necesita and n.tipo = 'necesidad' and n.categoria_id = p_categoria
        and public.fn_norm(n.subcategoria) <> ''
    );
  end if;
  return exists (select 1 from public.empresa_items where empresa_id = p_necesita and tipo = 'necesidad' and categoria_id = p_categoria)
     and exists (select 1 from public.empresa_items where empresa_id = p_ofrece and tipo = 'oferta' and categoria_id = p_categoria);
end;
$$ language plpgsql stable security definer set search_path = public;

-- Aceptar, rechazar o retirar la aceptación de una conexión, en nombre de
-- la empresa (de las dos) de la que quien llama es usuario.
create or replace function public.conexion_responder(
  p_necesita bigint, p_ofrece bigint, p_categoria bigint, p_accion text
) returns public.conexiones as $$
declare
  v_uid uuid := auth.uid();
  v_lado text;
  v_row public.conexiones;
  v_detalle jsonb;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if coalesce(p_accion, '') not in ('aceptar', 'rechazar', 'retirar') then raise exception 'ACCION_INVALIDA'; end if;

  if public.fn_es_usuario_empresa(p_necesita, v_uid) and public.fn_es_usuario_empresa(p_ofrece, v_uid) then
    raise exception 'MISMO_TITULAR';
  elsif public.fn_es_usuario_empresa(p_necesita, v_uid) then
    v_lado := 'necesita';
  elsif public.fn_es_usuario_empresa(p_ofrece, v_uid) then
    v_lado := 'ofrece';
  else
    raise exception 'SIN_PERMISO_EMPRESA';
  end if;

  select * into v_row from public.conexiones
    where empresa_necesita_id = p_necesita and empresa_ofrece_id = p_ofrece and categoria_id = p_categoria
    for update;

  if not found then
    if p_accion = 'retirar' then raise exception 'NADA_PARA_RETIRAR'; end if;
    if not public.fn_conexion_vigente(p_necesita, p_ofrece, p_categoria) then
      raise exception 'CONEXION_SIN_COINCIDENCIA';
    end if;
    insert into public.conexiones (empresa_necesita_id, empresa_ofrece_id, categoria_id)
      values (p_necesita, p_ofrece, p_categoria)
      on conflict on constraint conexiones_unica do nothing;
    select * into v_row from public.conexiones
      where empresa_necesita_id = p_necesita and empresa_ofrece_id = p_ofrece and categoria_id = p_categoria
      for update;
  end if;

  if v_row.rechazada_at is not null then raise exception 'CONEXION_RECHAZADA'; end if;
  if v_row.match_at is not null then raise exception 'CONEXION_YA_EN_MATCH'; end if;

  if p_accion = 'aceptar' then
    if not public.fn_conexion_vigente(p_necesita, p_ofrece, p_categoria) then
      raise exception 'CONEXION_SIN_COINCIDENCIA';
    end if;
    if v_lado = 'necesita' then
      if v_row.acepta_necesita_at is not null then raise exception 'YA_ACEPTADA'; end if;
      v_row.acepta_necesita_at := timezone('utc'::text, now());
      v_row.acepta_necesita_por := v_uid;
    else
      if v_row.acepta_ofrece_at is not null then raise exception 'YA_ACEPTADA'; end if;
      v_row.acepta_ofrece_at := timezone('utc'::text, now());
      v_row.acepta_ofrece_por := v_uid;
    end if;
    if v_row.acepta_necesita_at is not null and v_row.acepta_ofrece_at is not null then
      v_row.match_at := timezone('utc'::text, now());
    end if;
  elsif p_accion = 'retirar' then
    if v_lado = 'necesita' then
      if v_row.acepta_necesita_at is null then raise exception 'NADA_PARA_RETIRAR'; end if;
      v_row.acepta_necesita_at := null; v_row.acepta_necesita_por := null;
    else
      if v_row.acepta_ofrece_at is null then raise exception 'NADA_PARA_RETIRAR'; end if;
      v_row.acepta_ofrece_at := null; v_row.acepta_ofrece_por := null;
    end if;
  else -- rechazar
    v_row.rechazada_at := timezone('utc'::text, now());
    v_row.rechazada_por := v_uid;
    v_row.rechazada_empresa_id := case when v_lado = 'necesita' then p_necesita else p_ofrece end;
  end if;

  update public.conexiones set
    acepta_necesita_at = v_row.acepta_necesita_at, acepta_necesita_por = v_row.acepta_necesita_por,
    acepta_ofrece_at = v_row.acepta_ofrece_at, acepta_ofrece_por = v_row.acepta_ofrece_por,
    rechazada_at = v_row.rechazada_at, rechazada_por = v_row.rechazada_por,
    rechazada_empresa_id = v_row.rechazada_empresa_id,
    match_at = v_row.match_at, updated_at = timezone('utc'::text, now())
  where id = v_row.id
  returning * into v_row;

  v_detalle := jsonb_build_object(
    'empresa_necesita', (select nombre from public.empresas where id = p_necesita),
    'empresa_ofrece', (select nombre from public.empresas where id = p_ofrece),
    'categoria', (select nombre from public.categorias where id = p_categoria),
    'como_empresa', (select nombre from public.empresas where id = case when v_lado = 'necesita' then p_necesita else p_ofrece end),
    'match', v_row.match_at is not null);
  perform public.fn_log(
    case p_accion when 'aceptar' then 'conexion_aceptada' when 'rechazar' then 'conexion_rechazada' else 'conexion_retirada' end,
    'conexion', v_row.id::text, v_detalle);
  if v_row.match_at is not null then
    perform public.fn_log('conexion_match', 'conexion', v_row.id::text, v_detalle - 'como_empresa');
  end if;

  return v_row;
end;
$$ language plpgsql security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 7. MENSAJES (chat privado; una pestaña por conexión en match)
-- ───────────────────────────────────────────────────────────────
create table if not exists public.mensajes (
  id bigserial primary key,
  conexion_id bigint not null references public.conexiones(id) on delete cascade,
  empresa_id bigint not null references public.empresas(id) on delete cascade, -- empresa en nombre de la cual se escribe
  autor_id uuid references public.profiles(id) on delete set null,
  contenido text not null check (char_length(contenido) between 1 and 4000),
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists mensajes_conexion_idx on public.mensajes (conexion_id, created_at);

alter table public.mensajes enable row level security;

-- Solo los usuarios de las dos empresas de la conexión. A propósito NO
-- incluye admins ni webmasters (privacidad del contenido).
drop policy if exists "Mensajes solo para las empresas de la conexion" on public.mensajes;
create policy "Mensajes solo para las empresas de la conexion"
  on public.mensajes for select to authenticated using (
    exists (
      select 1 from public.conexiones c
      where c.id = mensajes.conexion_id
        and (public.fn_es_usuario_empresa(c.empresa_necesita_id, auth.uid())
             or public.fn_es_usuario_empresa(c.empresa_ofrece_id, auth.uid()))
    )
  );
-- Sin políticas de escritura directa: solo enviar_mensaje(). Los mensajes
-- no se editan ni se borran.

create or replace function public.enviar_mensaje(p_conexion bigint, p_contenido text)
returns public.mensajes as $$
declare
  v_uid uuid := auth.uid();
  v_con public.conexiones;
  v_empresa bigint;
  v_texto text := trim(coalesce(p_contenido, ''));
  v_row public.mensajes;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  select * into v_con from public.conexiones where id = p_conexion;
  if not found then raise exception 'CONEXION_INEXISTENTE'; end if;
  if v_con.match_at is null then raise exception 'CHAT_SIN_MATCH'; end if;
  if public.fn_es_usuario_empresa(v_con.empresa_necesita_id, v_uid) then
    v_empresa := v_con.empresa_necesita_id;
  elsif public.fn_es_usuario_empresa(v_con.empresa_ofrece_id, v_uid) then
    v_empresa := v_con.empresa_ofrece_id;
  else
    raise exception 'SIN_PERMISO_EMPRESA';
  end if;
  if char_length(v_texto) = 0 then raise exception 'MENSAJE_VACIO'; end if;
  if char_length(v_texto) > 4000 then raise exception 'MENSAJE_LARGO'; end if;

  insert into public.mensajes (conexion_id, empresa_id, autor_id, contenido)
    values (p_conexion, v_empresa, v_uid, v_texto)
    returning * into v_row;

  -- La bitácora registra QUE hubo contacto, nunca el texto.
  perform public.fn_log('mensaje_enviado', 'conexion', p_conexion::text, jsonb_build_object(
    'como_empresa', (select nombre from public.empresas where id = v_empresa),
    'empresa_necesita', (select nombre from public.empresas where id = v_con.empresa_necesita_id),
    'empresa_ofrece', (select nombre from public.empresas where id = v_con.empresa_ofrece_id),
    'categoria', (select nombre from public.categorias where id = v_con.categoria_id)));
  return v_row;
end;
$$ language plpgsql security definer set search_path = public;

-- Para el webmaster: si hubo contacto en cada conexión, sin contenido.
create or replace function public.webmaster_contacto_resumen()
returns table (conexion_id bigint, empresa_id bigint, cantidad bigint, primer_mensaje timestamp with time zone, ultimo_mensaje timestamp with time zone) as $$
begin
  if not public.fn_es_webmaster(auth.uid()) then raise exception 'SOLO_WEBMASTER'; end if;
  return query
    select m.conexion_id, m.empresa_id, count(*)::bigint, min(m.created_at), max(m.created_at)
    from public.mensajes m
    group by m.conexion_id, m.empresa_id;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 8. GUÍA (primer ingreso)
-- ───────────────────────────────────────────────────────────────
create or replace function public.marcar_guia_vista()
returns void as $$
begin
  if auth.uid() is null then raise exception 'NO_AUTENTICADO'; end if;
  update public.profiles set guia_vista = true where id = auth.uid() and not guia_vista;
end;
$$ language plpgsql security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 9. PERMISO DE WEBMASTER (extiende prevent_role_change de sql/001)
-- ───────────────────────────────────────────────────────────────
create or replace function public.prevent_role_change()
returns trigger as $$
begin
  -- (igual que en sql/001) un no-admin no puede cambiar roles: se ignora
  if NEW.role is distinct from OLD.role then
    if auth.uid() is not null
       and not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
      NEW.role := OLD.role;
    end if;
  end if;

  if NEW.is_webmaster is distinct from OLD.is_webmaster then
    if auth.uid() is not null then
      if not public.fn_es_webmaster(auth.uid()) then
        raise exception 'WEBMASTER_SOLO_WEBMASTER';
      end if;
      if auth.uid() = NEW.id then
        raise exception 'WEBMASTER_PROPIO';
      end if;
    end if;
    if NEW.is_webmaster and NEW.role <> 'admin' then
      raise exception 'WEBMASTER_REQUIERE_ADMIN';
    end if;
  end if;

  -- Quien deja de ser admin pierde también el permiso de webmaster.
  if NEW.role <> 'admin' then
    NEW.is_webmaster := false;
  end if;

  -- guia_vista solo la cambia cada usuario para sí mismo (o la consola).
  if NEW.guia_vista is distinct from OLD.guia_vista and auth.uid() is not null and auth.uid() <> NEW.id then
    NEW.guia_vista := OLD.guia_vista;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists prevent_role_change_trigger on public.profiles;
create trigger prevent_role_change_trigger
  before update on public.profiles
  for each row execute procedure public.prevent_role_change();

-- ───────────────────────────────────────────────────────────────
-- 10. TRIGGERS DE BITÁCORA SOBRE TABLAS EXISTENTES
-- ───────────────────────────────────────────────────────────────
create or replace function public.fn_log_profiles()
returns trigger as $$
declare
  v_cambios text[] := '{}';
  v_nombre text;
begin
  if TG_OP = 'INSERT' then
    perform public.fn_log('registro', 'usuario', NEW.id::text,
      jsonb_build_object('usuario', trim(NEW.nombre || ' ' || NEW.apellido), 'email', NEW.email), NEW.id);
    return NEW;
  end if;
  v_nombre := trim(NEW.nombre || ' ' || NEW.apellido);
  if NEW.role is distinct from OLD.role then
    perform public.fn_log('rol_cambio', 'usuario', NEW.id::text,
      jsonb_build_object('usuario', v_nombre, 'antes', OLD.role, 'despues', NEW.role));
  end if;
  if NEW.is_webmaster is distinct from OLD.is_webmaster then
    perform public.fn_log('webmaster_cambio', 'usuario', NEW.id::text,
      jsonb_build_object('usuario', v_nombre, 'webmaster', NEW.is_webmaster));
  end if;
  if NEW.nombre is distinct from OLD.nombre then v_cambios := array_append(v_cambios, 'nombre'); end if;
  if NEW.apellido is distinct from OLD.apellido then v_cambios := array_append(v_cambios, 'apellido'); end if;
  if NEW.tel is distinct from OLD.tel then v_cambios := array_append(v_cambios, 'telefono'); end if;
  if NEW.email is distinct from OLD.email then v_cambios := array_append(v_cambios, 'email'); end if;
  if array_length(v_cambios, 1) > 0 then
    perform public.fn_log('perfil_edicion', 'usuario', NEW.id::text,
      jsonb_build_object('usuario', v_nombre, 'campos', to_jsonb(v_cambios)));
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists log_profiles_trigger on public.profiles;
create trigger log_profiles_trigger
  after insert or update on public.profiles
  for each row execute procedure public.fn_log_profiles();

create or replace function public.fn_log_empresas()
returns trigger as $$
declare
  v_campos text[];
begin
  if TG_OP = 'INSERT' then
    perform public.fn_log('empresa_alta', 'empresa', NEW.id::text,
      jsonb_build_object('empresa', NEW.nombre, 'cuit', NEW.cuit));
    return NEW;
  elsif TG_OP = 'DELETE' then
    perform public.fn_log('empresa_baja', 'empresa', OLD.id::text,
      jsonb_build_object('empresa', OLD.nombre, 'cuit', OLD.cuit));
    return OLD;
  end if;
  -- UPDATE: lista de columnas que cambiaron (sin los valores, que ya
  -- están en la empresa; updated_at e items_migrados son internas).
  select coalesce(array_agg(n.key order by n.key), '{}') into v_campos
    from jsonb_each(to_jsonb(NEW)) n
    join jsonb_each(to_jsonb(OLD)) o using (key)
    -- El formulario guarda '' donde antes había NULL: no es un cambio real.
    where (case when n.value = '""'::jsonb then 'null'::jsonb else n.value end)
          is distinct from (case when o.value = '""'::jsonb then 'null'::jsonb else o.value end)
      and n.key not in ('updated_at', 'items_migrados');
  if array_length(v_campos, 1) > 0 then
    perform public.fn_log(
      case when NEW.uid is distinct from OLD.uid then 'empresa_cambio_titular' else 'empresa_edicion' end,
      'empresa', NEW.id::text,
      jsonb_build_object('empresa', NEW.nombre, 'campos', to_jsonb(v_campos)));
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists log_empresas_trigger on public.empresas;
create trigger log_empresas_trigger
  after insert or update or delete on public.empresas
  for each row execute procedure public.fn_log_empresas();

create or replace function public.fn_log_empresa_usuarios()
returns trigger as $$
declare
  v_row public.empresa_usuarios;
begin
  v_row := case when TG_OP = 'DELETE' then OLD else NEW end;
  perform public.fn_log(
    case when TG_OP = 'DELETE' then 'asociacion_baja' else 'asociacion_alta' end,
    'empresa', v_row.empresa_id::text,
    jsonb_build_object(
      'empresa', (select nombre from public.empresas where id = v_row.empresa_id),
      'usuario', (select trim(nombre || ' ' || apellido) from public.profiles where id = v_row.user_id)));
  return v_row;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists log_empresa_usuarios_trigger on public.empresa_usuarios;
create trigger log_empresa_usuarios_trigger
  after insert or delete on public.empresa_usuarios
  for each row execute procedure public.fn_log_empresa_usuarios();

create or replace function public.fn_log_categorias()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    perform public.fn_log('categoria_alta', 'categoria', NEW.id::text, jsonb_build_object('categoria', NEW.nombre));
    return NEW;
  elsif TG_OP = 'DELETE' then
    perform public.fn_log('categoria_baja', 'categoria', OLD.id::text, jsonb_build_object('categoria', OLD.nombre));
    return OLD;
  end if;
  if NEW.nombre is distinct from OLD.nombre or NEW.subcategorias is distinct from OLD.subcategorias then
    perform public.fn_log('categoria_edicion', 'categoria', NEW.id::text, jsonb_build_object(
      'categoria', NEW.nombre, 'nombre_anterior', case when NEW.nombre is distinct from OLD.nombre then OLD.nombre end,
      'subcategorias', to_jsonb(NEW.subcategorias)));
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists log_categorias_trigger on public.categorias;
create trigger log_categorias_trigger
  after insert or update or delete on public.categorias
  for each row execute procedure public.fn_log_categorias();

-- set_updated_at (sql/001) no debe tocar updated_at durante la migración.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  if current_setting('cupfi.sin_bitacora', true) = 'on' then
    return NEW;
  end if;
  NEW.updated_at := timezone('utc'::text, now());
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 11. MIGRACIÓN DE DATOS: ofertas / necesidades sin cubrir (texto libre)
--     → empresa_items. Solo empresas todavía no migradas. Lo que coincide
--     con el nombre de una categoría se asigna a esa categoría; el resto va
--     a "Otros › (texto original)" con la marca revisar = true.
--     No escribe en la bitácora ni cambia updated_at.
-- ───────────────────────────────────────────────────────────────
do $$
declare
  v_otros bigint;
begin
  perform set_config('cupfi.sin_bitacora', 'on', true);
  select id into v_otros from public.categorias where es_otros;

  insert into public.empresa_items (empresa_id, tipo, categoria_id, subcategoria, revisar)
  select x.empresa_id, x.tipo,
         coalesce(c.id, v_otros),
         case when c.id is null then left(x.texto, 120) else '' end,
         c.id is null
  from (
    select e.id as empresa_id, 'oferta'::text as tipo,
           trim(regexp_replace(t, '\s+', ' ', 'g')) as texto
      from public.empresas e, unnest(coalesce(e.ofertas, '{}')) t
     where not e.items_migrados
    union
    select e.id, 'necesidad', trim(regexp_replace(t, '\s+', ' ', 'g'))
      from public.empresas e, unnest(coalesce(e.needs_uncovered, '{}')) t
     where not e.items_migrados
  ) x
  left join public.categorias c on public.fn_norm(c.nombre) = public.fn_norm(x.texto) and not c.es_otros
  where x.texto <> ''
  on conflict do nothing;

  update public.empresas set items_migrados = true where not items_migrados;
  perform set_config('cupfi.sin_bitacora', 'off', true);
end $$;

-- ───────────────────────────────────────────────────────────────
-- 12. PERMISOS DE EJECUCIÓN DE FUNCIONES
-- Supabase da permiso de ejecutar funciones nuevas a anon y
-- authenticated por defecto. Las internas se cierran; las que usa la
-- app quedan solo para usuarios con sesión.
-- ───────────────────────────────────────────────────────────────
revoke execute on function public.fn_log(text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.fn_conexion_vigente(bigint, bigint, bigint) from public, anon;
revoke execute on function public.fn_usuarios_empresa(bigint) from public, anon;
revoke execute on function public.fn_mismo_titular(bigint, bigint) from public, anon;

revoke execute on function public.registrar_evento(text) from public, anon;
revoke execute on function public.guardar_items_empresa(bigint, jsonb) from public, anon;
revoke execute on function public.conexion_responder(bigint, bigint, bigint, text) from public, anon;
revoke execute on function public.enviar_mensaje(bigint, text) from public, anon;
revoke execute on function public.webmaster_contacto_resumen() from public, anon;
revoke execute on function public.marcar_guia_vista() from public, anon;

grant execute on function public.fn_es_admin(uuid) to authenticated;
grant execute on function public.fn_es_webmaster(uuid) to authenticated;
grant execute on function public.fn_es_usuario_empresa(bigint, uuid) to authenticated;
grant execute on function public.fn_conexion_vigente(bigint, bigint, bigint) to authenticated;
grant execute on function public.fn_usuarios_empresa(bigint) to authenticated;
grant execute on function public.fn_mismo_titular(bigint, bigint) to authenticated;
grant execute on function public.registrar_evento(text) to authenticated;
grant execute on function public.guardar_items_empresa(bigint, jsonb) to authenticated;
grant execute on function public.conexion_responder(bigint, bigint, bigint, text) to authenticated;
grant execute on function public.enviar_mensaje(bigint, text) to authenticated;
grant execute on function public.webmaster_contacto_resumen() to authenticated;
grant execute on function public.marcar_guia_vista() to authenticated;

-- Tablas nuevas: lectura para usuarios con sesión (filtrada por RLS).
-- Las escrituras de empresa_items / conexiones / mensajes / bitácora van
-- solo por las funciones de arriba. categorias sí admite escritura directa
-- (filtrada por RLS a webmasters).
grant select on public.bitacora, public.categorias, public.empresa_items, public.conexiones, public.mensajes to authenticated;
grant insert, update, delete on public.categorias to authenticated;
grant usage, select on sequence public.categorias_id_seq to authenticated;
revoke all on public.bitacora, public.categorias, public.empresa_items, public.conexiones, public.mensajes from anon;

-- ───────────────────────────────────────────────────────────────
-- PRIMER WEBMASTER (una sola vez, desde el SQL Editor; tiene que ser admin):
--   update public.profiles set is_webmaster = true where email = 'tu-email@ejemplo.com';
-- ───────────────────────────────────────────────────────────────
