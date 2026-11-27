-- ═══════════════════════════════════════════════════════════════
-- CUPFI · Búsqueda escalable, sectores y ubicación normalizada
--
-- Se corre DESPUÉS de sql/015_normas_seguridad.sql. Es idempotente y
-- compatible con la versión anterior del sitio (se puede correr antes de
-- publicar el sitio nuevo).
--
-- 1. Funciones de normalización de texto (sin acentos, minúsculas).
-- 2. Provincias (lista oficial, 24 jurisdicciones, códigos INDEC/Georef).
-- 3. Sectores: lista fija que administra el webmaster; cada empresa tiene
--    un sector principal y uno secundario opcional. Se agrupan los sectores
--    de texto libre que había.
-- 4. Ubicación normalizada: provincia, partido/departamento, localidad (con
--    los códigos del servicio oficial Georef) y coordenadas.
-- 5. Índice de búsqueda por empresa (texto sin acentos + búsqueda en
--    español + fragmentos/errores de tipeo), mantenido por triggers.
-- 6. buscar_empresas(): búsqueda + filtros combinables + contadores por
--    filtro + orden + páginas, todo resuelto en la base.
-- 7. Búsquedas paginadas para Admin, Graduados y Webmaster.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
-- Como en Supabase: los roles de la API pueden usar las funciones de extensions
-- (los disparadores de empresas/perfiles normalizan texto con unaccent).
grant usage on schema extensions to anon, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────
-- 1. NORMALIZACIÓN DE TEXTO
-- ───────────────────────────────────────────────────────────────
-- Minúsculas y sin acentos (para buscar "metalurgica" y encontrar "Metalúrgica").
create or replace function public.f_norm(t text)
returns text as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')));
$$ language sql immutable parallel safe set search_path = '';

-- Igual que normalizeTagKey() del sitio (utils.ts): así la regla de
-- coincidencia exacta de subcategorías es la misma en la base y en la página.
create or replace function public.f_tag(t text)
returns text as $$
  select btrim(regexp_replace(regexp_replace(
    translate(lower(coalesce(t, '')), 'áàäéèëíìïóòöúùü', 'aaaeeeiiiooouuu'),
    '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g'));
$$ language sql immutable parallel safe set search_path = '';

-- ───────────────────────────────────────────────────────────────
-- 2. PROVINCIAS
-- ───────────────────────────────────────────────────────────────
create table if not exists public.provincias (
  id text primary key,          -- código INDEC / Georef (2 dígitos)
  nombre text not null unique,
  orden int not null default 0
);
insert into public.provincias (id, nombre, orden) values
  ('02', 'Ciudad Autónoma de Buenos Aires', 1), ('06', 'Buenos Aires', 2), ('10', 'Catamarca', 3),
  ('22', 'Chaco', 4), ('26', 'Chubut', 5), ('14', 'Córdoba', 6), ('18', 'Corrientes', 7),
  ('30', 'Entre Ríos', 8), ('34', 'Formosa', 9), ('38', 'Jujuy', 10), ('42', 'La Pampa', 11),
  ('46', 'La Rioja', 12), ('50', 'Mendoza', 13), ('54', 'Misiones', 14), ('58', 'Neuquén', 15),
  ('62', 'Río Negro', 16), ('66', 'Salta', 17), ('70', 'San Juan', 18), ('74', 'San Luis', 19),
  ('78', 'Santa Cruz', 20), ('82', 'Santa Fe', 21), ('86', 'Santiago del Estero', 22),
  ('94', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur', 23), ('90', 'Tucumán', 24)
on conflict (id) do update set nombre = excluded.nombre, orden = excluded.orden;
alter table public.provincias enable row level security;
drop policy if exists "Provincias visibles" on public.provincias;
create policy "Provincias visibles" on public.provincias for select to authenticated using (true);
revoke all on public.provincias from anon, authenticated;
grant select on public.provincias to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 3. SECTORES
-- ───────────────────────────────────────────────────────────────
create table if not exists public.sectores (
  id bigserial primary key,
  nombre text not null unique check (char_length(btrim(nombre)) between 2 and 80),
  orden int not null default 0,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);
-- Sin duplicados aunque cambien mayúsculas, acentos o espacios.
create unique index if not exists sectores_nombre_norm_uq on public.sectores (public.f_norm(btrim(nombre)));
alter table public.sectores enable row level security;
drop policy if exists "Sectores visibles" on public.sectores;
create policy "Sectores visibles" on public.sectores for select to authenticated using (true);
drop policy if exists "Webmasters crean sectores" on public.sectores;
create policy "Webmasters crean sectores" on public.sectores for insert to authenticated
  with check (public.fn_es_webmaster(auth.uid()));
drop policy if exists "Webmasters editan sectores" on public.sectores;
create policy "Webmasters editan sectores" on public.sectores for update to authenticated
  using (public.fn_es_webmaster(auth.uid())) with check (public.fn_es_webmaster(auth.uid()));
drop policy if exists "Webmasters borran sectores" on public.sectores;
create policy "Webmasters borran sectores" on public.sectores for delete to authenticated
  using (public.fn_es_webmaster(auth.uid()));
revoke all on public.sectores from anon;
grant select, insert, update, delete on public.sectores to authenticated;
grant usage, select on sequence public.sectores_id_seq to authenticated;

insert into public.sectores (nombre, orden) values
  ('Consultoría e ingeniería', 1), ('Educación e instituciones', 2), ('Electricidad y electrotecnia', 3),
  ('Mantenimiento e inspección', 4), ('Materiales', 5), ('Metalmecánica', 6),
  ('Oil & Gas y Minería', 7), ('Salud', 8), ('Transporte y logística', 9)
on conflict (nombre) do nothing;

-- ───────────────────────────────────────────────────────────────
-- 4. COLUMNAS NUEVAS DE EMPRESAS
-- ───────────────────────────────────────────────────────────────
alter table public.empresas
  add column if not exists sector_id bigint references public.sectores(id) on delete restrict,
  add column if not exists sector2_id bigint references public.sectores(id) on delete restrict,
  add column if not exists sector_original text,
  add column if not exists provincia_id text references public.provincias(id),
  add column if not exists departamento text,
  add column if not exists departamento_id text,
  add column if not exists localidad_id text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists ubicacion_precision text;

alter table public.empresas drop constraint if exists empresas_sectores_distintos;
alter table public.empresas add constraint empresas_sectores_distintos
  check (sector2_id is null or sector2_id <> sector_id);
alter table public.empresas drop constraint if exists empresas_coordenadas;
alter table public.empresas add constraint empresas_coordenadas check (
  (lat is null and lng is null and ubicacion_precision is null)
  or (lat is not null and lng is not null and ubicacion_precision is not null
      and lat between -90 and 90 and lng between -180 and 180
      and ubicacion_precision in ('direccion', 'localidad', 'manual')));

create index if not exists empresas_sector_idx on public.empresas (sector_id);
create index if not exists empresas_sector2_idx on public.empresas (sector2_id);
create index if not exists empresas_provincia_idx on public.empresas (provincia_id);
create index if not exists empresas_lat_idx on public.empresas (lat);
create index if not exists empresa_items_empresa_idx on public.empresa_items (empresa_id);
create index if not exists empresa_items_cat_idx on public.empresa_items (categoria_id, tipo);
create index if not exists empresas_uid_idx on public.empresas (uid);
create index if not exists empresa_usuarios_user_idx on public.empresa_usuarios (user_id);
create index if not exists bitacora_user_fecha_idx on public.bitacora (user_id, created_at desc, id desc);
create index if not exists bitacora_accion_fecha_idx on public.bitacora (accion, created_at desc, id desc);
create index if not exists conexiones_actualizada_idx on public.conexiones (updated_at desc, id desc);
create index if not exists solicitudes_fecha_idx on public.solicitudes (created_at desc, id desc);

-- Pasaje de los sectores de texto libre a la lista (solo los que todavía
-- no tienen sector asignado; se guarda el texto original).
-- (Estos cambios de datos no se anotan en la bitácora: no los hizo un usuario.)
-- De sesión (no solo de la sentencia): así vale igual corrido de a una
-- sentencia o dentro de una transacción. Se apaga al final.
select set_config('cupfi.sin_bitacora', 'on', false);
update public.empresas set sector_original = sector where sector_original is null and sector is not null;
update public.empresas e set sector_id = s.id
from public.sectores s
where e.sector_id is null and s.nombre = case
  when e.sector in ('Oil & Gas', 'Oil & Gas / Minería') then 'Oil & Gas y Minería'
  when e.sector in ('Consultoría', 'Consultoría – Oil & Gas') then 'Consultoría e ingeniería'
  when e.sector in ('Autopartista', 'Microfusión', 'Transmisión mecánica') then 'Metalmecánica'
  when e.sector in ('Electrotecnia', 'Herramientas eléctricas') then 'Electricidad y electrotecnia'
  when e.sector in ('Ingeniería y mantenimiento industrial', 'Inspección de infraestructura', 'Mantenimiento portuario') then 'Mantenimiento e inspección'
  when e.sector in ('Materiales compuestos – PRFV') then 'Materiales'
  when e.sector in ('Transporte ferroviario') then 'Transporte y logística'
  when e.sector in ('Insumos sanitarios') then 'Salud'
  when e.sector in ('Universidad', 'Institución profesional') then 'Educación e instituciones'
end;
update public.empresas e set sector2_id = s.id
from public.sectores s
where e.sector2_id is null and e.sector_original = 'Consultoría – Oil & Gas' and s.nombre = 'Oil & Gas y Minería';
update public.empresas e set provincia_id = p.id
from public.provincias p
where e.provincia_id is null and public.f_norm(e.provincia) = public.f_norm(p.nombre);

-- Antes de guardar una empresa: el sector y la provincia se toman de las
-- listas; si cambió la dirección sin coordenadas nuevas, las viejas se
-- descartan (y con el sitio anterior, que manda texto, se busca el id).
create or replace function public.fn_empresa_normalizar()
returns trigger as $$
declare v_id bigint; v_txt text;
begin
  if new.sector_id is null and coalesce(btrim(new.sector), '') <> '' then
    select id into v_id from public.sectores where public.f_norm(nombre) = public.f_norm(new.sector);
    new.sector_id := v_id;
  end if;
  if new.sector2_id = new.sector_id then new.sector2_id := null; end if;
  if new.sector_id is not null then
    select nombre into new.sector from public.sectores where id = new.sector_id;
  end if;

  if new.provincia_id is not null and (tg_op = 'INSERT' or new.provincia_id is distinct from old.provincia_id) then
    select nombre into v_txt from public.provincias where id = new.provincia_id;
    new.provincia := v_txt;
  elsif coalesce(new.provincia, '') <> '' and (tg_op = 'INSERT' or new.provincia is distinct from old.provincia) then
    select id into new.provincia_id from public.provincias where public.f_norm(nombre) = public.f_norm(new.provincia);
  elsif coalesce(new.provincia, '') = '' then
    new.provincia_id := null;
  end if;

  if tg_op = 'UPDATE' then
    if new.ciudad is distinct from old.ciudad and new.localidad_id is not distinct from old.localidad_id then
      new.localidad_id := null;
    end if;
    if new.provincia_id is distinct from old.provincia_id and new.departamento_id is not distinct from old.departamento_id then
      new.departamento_id := null; new.departamento := null;
    end if;
    if (new.calle, new.ciudad, new.provincia_id) is distinct from (old.calle, old.ciudad, old.provincia_id)
       and (new.lat, new.lng) is not distinct from (old.lat, old.lng) then
      new.lat := null; new.lng := null; new.ubicacion_precision := null;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function public.fn_empresa_normalizar() from public, anon, authenticated;
drop trigger if exists empresa_normalizar_trigger on public.empresas;
create trigger empresa_normalizar_trigger before insert or update on public.empresas
  for each row execute function public.fn_empresa_normalizar();

-- Re-normaliza las filas existentes (asigna el nombre oficial de sector y provincia).
update public.empresas set sector_id = sector_id where sector_id is not null or provincia is not null;

-- ───────────────────────────────────────────────────────────────
-- 5. ÍNDICE DE BÚSQUEDA
-- ───────────────────────────────────────────────────────────────
create table if not exists public.empresas_indice (
  empresa_id bigint primary key references public.empresas(id) on delete cascade,
  texto text not null default '',
  tsv tsvector not null default ''::tsvector,
  nombre_norm text not null default '',
  of_c bigint[] not null default '{}',   -- categorías que ofrece
  ne_c bigint[] not null default '{}',   -- categorías que necesita
  of_s text[] not null default '{}',     -- "categoria|subcategoría" que ofrece
  ne_s text[] not null default '{}'      -- "categoria|subcategoría" que necesita
);
create index if not exists empresas_indice_trgm on public.empresas_indice using gin (texto extensions.gin_trgm_ops);
create index if not exists empresas_indice_tsv on public.empresas_indice using gin (tsv);
create index if not exists empresas_indice_nombre on public.empresas_indice (nombre_norm, empresa_id);
alter table public.empresas_indice enable row level security;
revoke all on public.empresas_indice from anon, authenticated;

create or replace function public.fn_empresa_indexar(p_id bigint)
returns void as $$
declare v_txt text;
begin
  if not exists (select 1 from public.empresas where id = p_id) then
    delete from public.empresas_indice where empresa_id = p_id;
    return;
  end if;
  select public.f_norm(concat_ws(' ',
      e.nombre, e.tipo, s1.nombre, s2.nombre, e.sector_original, e.cuit, regexp_replace(coalesce(e.cuit, ''), '\D', '', 'g'),
      e.referente, e.cargo, e.descripcion, e.calle, e.ciudad, e.departamento, e.provincia, e.email_org, e.web,
      array_to_string(e.instalaciones, ' '),
      (select string_agg(c.nombre || ' ' || i.subcategoria, ' ')
         from public.empresa_items i join public.categorias c on c.id = i.categoria_id
        where i.empresa_id = e.id)))
    into v_txt
    from public.empresas e
    left join public.sectores s1 on s1.id = e.sector_id
    left join public.sectores s2 on s2.id = e.sector2_id
   where e.id = p_id;

  insert into public.empresas_indice as x (empresa_id, texto, tsv, nombre_norm, of_c, ne_c, of_s, ne_s)
  select p_id, v_txt, to_tsvector('spanish', v_txt),
         (select public.f_norm(nombre) from public.empresas where id = p_id),
         coalesce(array(select distinct categoria_id from public.empresa_items where empresa_id = p_id and tipo = 'oferta'), '{}'),
         coalesce(array(select distinct categoria_id from public.empresa_items where empresa_id = p_id and tipo = 'necesidad'), '{}'),
         coalesce(array(select distinct categoria_id || '|' || public.f_tag(subcategoria) from public.empresa_items where empresa_id = p_id and tipo = 'oferta'), '{}'),
         coalesce(array(select distinct categoria_id || '|' || public.f_tag(subcategoria) from public.empresa_items where empresa_id = p_id and tipo = 'necesidad'), '{}')
  on conflict (empresa_id) do update set texto = excluded.texto, tsv = excluded.tsv, nombre_norm = excluded.nombre_norm,
    of_c = excluded.of_c, ne_c = excluded.ne_c, of_s = excluded.of_s, ne_s = excluded.ne_s;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.fn_indexar_empresa_trg()
returns trigger as $$
begin
  if tg_table_name = 'empresas' then
    if tg_op <> 'DELETE' then perform public.fn_empresa_indexar(new.id); end if;
  elsif tg_table_name = 'categorias' then
    perform public.fn_empresa_indexar(i.empresa_id) from (select distinct empresa_id from public.empresa_items where categoria_id = new.id) i;
  elsif tg_table_name = 'sectores' then
    perform public.fn_empresa_indexar(e.id) from public.empresas e where e.sector_id = new.id or e.sector2_id = new.id;
    update public.empresas set sector = new.nombre where sector_id = new.id and sector is distinct from new.nombre;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;
-- Ítems: una sola reindexación por empresa y por operación (aunque se
-- guarden muchos ítems juntos).
create or replace function public.fn_indexar_items_ins()
returns trigger as $$
begin
  perform public.fn_empresa_indexar(e) from (select distinct empresa_id e from nuevos) t;
  return null;
end;
$$ language plpgsql security definer set search_path = public;
create or replace function public.fn_indexar_items_del()
returns trigger as $$
begin
  perform public.fn_empresa_indexar(e) from (select distinct empresa_id e from viejos) t;
  return null;
end;
$$ language plpgsql security definer set search_path = public;
create or replace function public.fn_indexar_items_upd()
returns trigger as $$
begin
  perform public.fn_empresa_indexar(e) from (select empresa_id e from nuevos union select empresa_id from viejos) t;
  return null;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function public.fn_indexar_items_ins() from public, anon, authenticated;
revoke execute on function public.fn_indexar_items_del() from public, anon, authenticated;
revoke execute on function public.fn_indexar_items_upd() from public, anon, authenticated;
revoke execute on function public.fn_empresa_indexar(bigint) from public, anon, authenticated;
revoke execute on function public.fn_indexar_empresa_trg() from public, anon, authenticated;

drop trigger if exists empresa_indexar_trigger on public.empresas;
create trigger empresa_indexar_trigger after insert or update on public.empresas
  for each row execute function public.fn_indexar_empresa_trg();
drop trigger if exists empresa_items_indexar_trigger on public.empresa_items;
drop trigger if exists empresa_items_indexar_ins on public.empresa_items;
create trigger empresa_items_indexar_ins after insert on public.empresa_items
  referencing new table as nuevos for each statement execute function public.fn_indexar_items_ins();
drop trigger if exists empresa_items_indexar_del on public.empresa_items;
create trigger empresa_items_indexar_del after delete on public.empresa_items
  referencing old table as viejos for each statement execute function public.fn_indexar_items_del();
drop trigger if exists empresa_items_indexar_upd on public.empresa_items;
create trigger empresa_items_indexar_upd after update on public.empresa_items
  referencing new table as nuevos old table as viejos for each statement execute function public.fn_indexar_items_upd();
drop trigger if exists categoria_indexar_trigger on public.categorias;
create trigger categoria_indexar_trigger after update of nombre on public.categorias
  for each row execute function public.fn_indexar_empresa_trg();
drop trigger if exists sector_indexar_trigger on public.sectores;
create trigger sector_indexar_trigger after update of nombre on public.sectores
  for each row execute function public.fn_indexar_empresa_trg();

select public.fn_empresa_indexar(id) from public.empresas;
select set_config('cupfi.sin_bitacora', 'off', false);

-- Perfiles: índice para buscar usuarios por nombre, apellido o email.
create index if not exists profiles_busqueda_trgm on public.profiles
  using gin ((public.f_norm(coalesce(nombre, '') || ' ' || coalesce(apellido, '') || ' ' || coalesce(email, ''))) extensions.gin_trgm_ops);

-- ───────────────────────────────────────────────────────────────
-- 6. BUSCAR EMPRESAS
-- ───────────────────────────────────────────────────────────────
-- Arreglo de texto desde un campo JSON (null si no vino o vino vacío).
create or replace function public.fn_json_txt(p jsonb, k text)
returns text[] as $$
  select case when jsonb_typeof(p -> k) = 'array' and jsonb_array_length(p -> k) > 0
    then array(select jsonb_array_elements_text(p -> k)) end;
$$ language sql immutable set search_path = '';

-- Palabras de una búsqueda (sin acentos, 2 letras o más).
create or replace function public.fn_palabras(q text)
returns text[] as $$
  select coalesce(array(select w from regexp_split_to_table(regexp_replace(public.f_norm(q), '[^a-z0-9 ]', ' ', 'g'), '\s+') w
                         where length(w) >= 2 limit 8), '{}');
$$ language sql immutable set search_path = '';

-- Parámetros (todos opcionales): q, sectores[], provincias[], departamentos[],
-- localidades[], tipos[], ofrece[] / necesita[] (ids de categoría),
-- ofrece_sub[] / necesita_sub[] ("<categoría>|<subcategoría normalizada>"),
-- con_necesidades, mis_empresas, compatibles (booleanos),
-- cerca {lat, lng, km}, orden (relevancia | nombre | recientes |
-- coincidencias | distancia), limite (1-100, 25), desde (0),
-- solo_mapa (devuelve solo los puntos con coordenadas, sin página).
-- Admin/webmaster: usuario (uuid) + relacion (principal | asociado).
create or replace function public.buscar_empresas(p jsonb default '{}'::jsonb)
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_q text := btrim(coalesce(p ->> 'q', ''));
  v_w text[] := public.fn_palabras(coalesce(p ->> 'q', ''));
  v_tsq tsquery;
  v_qn text;
  v_pat text[];
  v_difusa boolean := false;
  v_sec bigint[] := public.fn_json_txt(p, 'sectores')::bigint[];
  v_prov text[] := public.fn_json_txt(p, 'provincias');
  v_dep text[] := public.fn_json_txt(p, 'departamentos');
  v_loc text[] := public.fn_json_txt(p, 'localidades');
  v_tip text[] := public.fn_json_txt(p, 'tipos');
  v_ofc bigint[] := public.fn_json_txt(p, 'ofrece')::bigint[];
  v_nec bigint[] := public.fn_json_txt(p, 'necesita')::bigint[];
  v_ofs text[] := public.fn_json_txt(p, 'ofrece_sub');
  v_nes text[] := public.fn_json_txt(p, 'necesita_sub');
  v_connec boolean := coalesce((p ->> 'con_necesidades')::boolean, false);
  v_mias boolean := coalesce((p ->> 'mis_empresas')::boolean, false);
  v_compat boolean := coalesce((p ->> 'compatibles')::boolean, false);
  v_lat double precision := (p -> 'cerca' ->> 'lat')::double precision;
  v_lng double precision := (p -> 'cerca' ->> 'lng')::double precision;
  v_km double precision := least(greatest(coalesce((p -> 'cerca' ->> 'km')::double precision, 50), 1), 2000);
  v_cerca boolean;
  v_usr uuid;
  v_rel text := p ->> 'relacion';
  v_orden text := coalesce(nullif(p ->> 'orden', ''), 'auto');
  v_lim int := least(greatest(coalesce((p ->> 'limite')::int, 25), 1), 100);
  v_off int := greatest(coalesce((p ->> 'desde')::int, 0), 0);
  v_mapa boolean := coalesce((p ->> 'solo_mapa')::boolean, false);
  v_res jsonb;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  v_admin := public.fn_es_admin(v_uid) or public.fn_es_webmaster(v_uid);
  if v_admin and coalesce(p ->> 'usuario', '') <> '' then v_usr := (p ->> 'usuario')::uuid; end if;
  v_cerca := v_lat is not null and v_lng is not null;
  if cardinality(v_w) = 0 then v_q := ''; end if;
  v_qn := array_to_string(v_w, ' ');
  v_pat := array(select '%' || w || '%' from unnest(v_w) w);
  if v_q <> '' then
    v_tsq := plainto_tsquery('spanish', v_qn);
    -- Primero se busca lo escrito tal cual (rápido, con índices). Solo si no
    -- aparece nada se buscan palabras parecidas (errores de tipeo).
    v_difusa := not exists (select 1 from public.empresas_indice x where x.tsv @@ v_tsq or x.texto like all (v_pat));
  end if;
  if v_orden = 'auto' then v_orden := case when v_q <> '' then 'relevancia' when v_cerca then 'distancia' else 'nombre' end; end if;
  if v_orden = 'relevancia' and v_q = '' then v_orden := 'nombre'; end if;
  if v_orden = 'distancia' and not v_cerca then v_orden := 'nombre'; end if;

  with
  mias as (
    select e.id from public.empresas e
    where e.uid = v_uid or exists (select 1 from public.empresa_usuarios a where a.empresa_id = e.id and a.user_id = v_uid)
  ),
  mis_items as (
    select i.empresa_id s, i.tipo, i.categoria_id c, public.f_tag(i.subcategoria) t, k.es_otros
    from public.empresa_items i join public.categorias k on k.id = i.categoria_id
    where i.empresa_id in (select id from mias)
  ),
  -- Usuarios de cada empresa (titular + asociados), para no sugerir
  -- coincidencias entre empresas de la misma persona (igual que la página).
  usuarios_emp as (
    select e.id, e.uid as u from public.empresas e where e.uid is not null
    union select a.empresa_id, a.user_id from public.empresa_usuarios a
  ),
  vecinas as (
    select distinct mu.id as s, ue.id as e
    from usuarios_emp mu join usuarios_emp ue on ue.u = mu.u
    where mu.id in (select id from mias)
  ),
  -- Coincidencias con mis empresas, calculadas de una sola vez: mismos
  -- criterios que calcularSugerencias() (matching.ts): misma categoría,
  -- tipos opuestos, y en "Otros" solo la misma subcategoría.
  coinc_t as (
    select i.empresa_id, count(*) as n
    from public.empresa_items i
    join mis_items m on m.c = i.categoria_id and m.tipo <> i.tipo
    where (not m.es_otros or (m.t <> '' and m.t = public.f_tag(i.subcategoria)))
      and i.empresa_id not in (select id from mias)
      and not exists (select 1 from vecinas v where v.s = m.s and v.e = i.empresa_id)
    group by i.empresa_id
  ),
  cand as (
    select e.id, e.uid, e.nombre, e.tipo, e.sector_id, e.sector2_id, e.cuit, e.referente, e.cargo, e.calle, e.ciudad,
           e.departamento, e.departamento_id, e.localidad_id, e.provincia, e.provincia_id, e.logo, e.created_at,
           e.lat, e.lng, e.ubicacion_precision, x.of_c, x.ne_c, x.of_s, x.ne_s, x.nombre_norm,
           case when v_q = '' then 0::real
                else ts_rank_cd(x.tsv, v_tsq)
                     + case when v_difusa then extensions.word_similarity(v_qn, x.texto) else 0 end
                     + 2 * extensions.similarity(v_qn, x.nombre_norm)
                     + case when x.nombre_norm like v_qn || '%' then 1 else 0 end end as rel,
           (e.id in (select id from mias)) as es_mia
    from public.empresas e join public.empresas_indice x on x.empresa_id = e.id
    where v_q = ''
       or (not v_difusa and (x.tsv @@ v_tsq or x.texto like all (v_pat)))
       or (v_difusa and v_qn operator(extensions.<%) x.texto)
  ),
  attr as (
    select c.*,
      case when v_cerca then 2 * 6371 * asin(sqrt(
             power(sin(radians(c.lat - v_lat) / 2), 2)
             + cos(radians(v_lat)) * cos(radians(c.lat)) * power(sin(radians(c.lng - v_lng) / 2), 2))) end as dist,
      coalesce(ct.n, 0) as coinc
    from cand c left join coinc_t ct on ct.empresa_id = c.id
  ),
  f as (
    select a.*,
      (v_sec is null or a.sector_id = any(v_sec) or a.sector2_id = any(v_sec)) as f_sec,
      (v_prov is null or a.provincia_id = any(v_prov)) as f_prov,
      (v_dep is null or a.departamento_id = any(v_dep)) as f_dep,
      (v_loc is null or a.localidad_id = any(v_loc)) as f_loc,
      (v_tip is null or a.tipo = any(v_tip)) as f_tip,
      ((v_ofc is null or a.of_c && v_ofc) and (v_ofs is null or a.of_s && v_ofs)) as f_of,
      ((v_nec is null or a.ne_c && v_nec) and (v_nes is null or a.ne_s && v_nes)) as f_ne,
      ((not v_connec or cardinality(a.ne_c) > 0) and (not v_mias or a.es_mia) and (not v_compat or a.coinc > 0)) as f_est,
      (not v_cerca or a.dist <= v_km) as f_cer,
      (v_usr is null
        or (coalesce(v_rel, '') in ('', 'principal') and a.uid = v_usr)
        or (coalesce(v_rel, '') in ('', 'asociado') and exists (
              select 1 from public.empresa_usuarios u where u.empresa_id = a.id and u.user_id = v_usr))) as f_usr
    from attr a
  ),
  ok as (select * from f where f_sec and f_prov and f_dep and f_loc and f_tip and f_of and f_ne and f_est and f_cer and f_usr),
  pagina as (
    select * from ok
    where not v_mapa
    order by
      case when v_orden = 'relevancia' then rel end desc nulls last,
      case when v_orden = 'coincidencias' then coinc end desc nulls last,
      case when v_orden = 'distancia' then dist end asc nulls last,
      case when v_orden = 'recientes' then created_at end desc nulls last,
      nombre_norm asc, id asc
    offset v_off limit v_lim + 1
  )
  select jsonb_build_object(
    'total', (select count(*) from ok),
    'orden', v_orden,
    'aproximada', v_difusa,
    'hay_mas', (select count(*) from pagina) > v_lim,
    'items', case when v_mapa then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'uid', g.uid, 'nombre', g.nombre, 'tipo', g.tipo, 'sector_id', g.sector_id, 'sector2_id', g.sector2_id,
        'cuit', g.cuit, 'referente', g.referente, 'cargo', g.cargo, 'calle', g.calle, 'ciudad', g.ciudad,
        'departamento', g.departamento, 'provincia', g.provincia, 'provincia_id', g.provincia_id, 'logo', g.logo,
        'created_at', g.created_at, 'lat', g.lat, 'lng', g.lng, 'es_mia', g.es_mia, 'coincidencias', g.coinc,
        'distancia_km', round(g.dist::numeric, 1),
        'items', coalesce((select jsonb_agg(jsonb_build_object('tipo', i.tipo, 'categoria_id', i.categoria_id, 'subcategoria', i.subcategoria) order by i.id)
                           from public.empresa_items i where i.empresa_id = g.id), '[]'::jsonb)
      ) order by g.ord)
      from (select pg.*, row_number() over (order by
              case when v_orden = 'relevancia' then pg.rel end desc nulls last,
              case when v_orden = 'coincidencias' then pg.coinc end desc nulls last,
              case when v_orden = 'distancia' then pg.dist end asc nulls last,
              case when v_orden = 'recientes' then pg.created_at end desc nulls last,
              pg.nombre_norm asc, pg.id asc) as ord
            from pagina pg) g
      where g.ord <= v_lim), '[]'::jsonb) end,
    'puntos', case when v_mapa then coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.nombre, 'sector_id', o.sector_id, 'lat', o.lat, 'lng', o.lng,
                                          'precision', o.ubicacion_precision, 'logo', o.logo, 'ciudad', o.ciudad, 'provincia', o.provincia))
      from ok o where o.lat is not null), '[]'::jsonb) else null end,
    'facetas', jsonb_build_object(
      'sectores', coalesce((select jsonb_object_agg(sid, n) from (
          select s.sid, count(*) n from f, unnest(array[f.sector_id, f.sector2_id]) s(sid)
          where s.sid is not null and f_prov and f_dep and f_loc and f_tip and f_of and f_ne and f_est and f_cer and f_usr
          group by s.sid) t), '{}'::jsonb),
      'provincias', coalesce((select jsonb_object_agg(provincia_id, n) from (
          select provincia_id, count(*) n from f
          where provincia_id is not null and f_sec and f_tip and f_of and f_ne and f_est and f_cer and f_usr
          group by provincia_id) t), '{}'::jsonb),
      'departamentos', case when v_prov is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', departamento_id, 'nombre', departamento, 'provincia_id', provincia_id, 'n', n) order by departamento) from (
          select departamento_id, max(departamento) departamento, max(provincia_id) provincia_id, count(*) n from f
          where departamento_id is not null and f_prov and f_sec and f_tip and f_of and f_ne and f_est and f_cer and f_usr
          group by departamento_id) t), '[]'::jsonb) end,
      'localidades', case when v_dep is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', localidad_id, 'nombre', ciudad, 'departamento_id', departamento_id, 'n', n) order by ciudad) from (
          select localidad_id, max(ciudad) ciudad, max(departamento_id) departamento_id, count(*) n from f
          where localidad_id is not null and f_prov and f_dep and f_sec and f_tip and f_of and f_ne and f_est and f_cer and f_usr
          group by localidad_id) t), '[]'::jsonb) end,
      'tipos', coalesce((select jsonb_object_agg(tipo, n) from (
          select tipo, count(*) n from f
          where tipo is not null and f_sec and f_prov and f_dep and f_loc and f_of and f_ne and f_est and f_cer and f_usr
          group by tipo) t), '{}'::jsonb),
      'ofrece', coalesce((select jsonb_object_agg(cid, n) from (
          select c.cid, count(*) n from f, unnest(f.of_c) c(cid)
          where f_sec and f_prov and f_dep and f_loc and f_tip and f_ne and f_est and f_cer and f_usr
          group by c.cid) t), '{}'::jsonb),
      'necesita', coalesce((select jsonb_object_agg(cid, n) from (
          select c.cid, count(*) n from f, unnest(f.ne_c) c(cid)
          where f_sec and f_prov and f_dep and f_loc and f_tip and f_of and f_est and f_cer and f_usr
          group by c.cid) t), '{}'::jsonb),
      'ofrece_sub', case when v_ofc is null then '{}'::jsonb else coalesce((select jsonb_object_agg(sid, n) from (
          select s.sid, count(*) n from f, unnest(f.of_s) s(sid)
          where split_part(s.sid, '|', 1)::bigint = any(v_ofc)
            and f_sec and f_prov and f_dep and f_loc and f_tip and f_ne and f_est and f_cer and f_usr
            and (v_ofc is null or f.of_c && v_ofc)
          group by s.sid) t), '{}'::jsonb) end,
      'necesita_sub', case when v_nec is null then '{}'::jsonb else coalesce((select jsonb_object_agg(sid, n) from (
          select s.sid, count(*) n from f, unnest(f.ne_s) s(sid)
          where split_part(s.sid, '|', 1)::bigint = any(v_nec)
            and f_sec and f_prov and f_dep and f_loc and f_tip and f_of and f_est and f_cer and f_usr
            and (v_nec is null or f.ne_c && v_nec)
          group by s.sid) t), '{}'::jsonb) end,
      'con_necesidades', (select count(*) from f where cardinality(ne_c) > 0 and (not v_mias or es_mia) and (not v_compat or coinc > 0)
                            and f_sec and f_prov and f_dep and f_loc and f_tip and f_of and f_ne and f_cer and f_usr),
      'mis_empresas', (select count(*) from f where es_mia and (not v_connec or cardinality(ne_c) > 0) and (not v_compat or coinc > 0)
                         and f_sec and f_prov and f_dep and f_loc and f_tip and f_of and f_ne and f_cer and f_usr),
      'compatibles', (select count(*) from f where coinc > 0 and (not v_connec or cardinality(ne_c) > 0) and (not v_mias or es_mia)
                        and f_sec and f_prov and f_dep and f_loc and f_tip and f_of and f_ne and f_cer and f_usr),
      'tengo_empresas', exists (select 1 from mias)
    )
  ) into v_res;
  return v_res;
end;
$$ language plpgsql stable security definer set search_path = public, extensions set jit = off;

-- ───────────────────────────────────────────────────────────────
-- 7. USUARIOS, GRADUADOS Y LISTAS DEL WEBMASTER
-- ───────────────────────────────────────────────────────────────
-- Sugerencias de usuarios mientras se escribe (admin y webmaster).
create or replace function public.sugerir_usuarios(p_q text, p_limite int default 8)
returns table (id uuid, nombre text, apellido text, email text) as $$
declare v_w text[] := public.fn_palabras(p_q);
begin
  if not (public.fn_es_admin(auth.uid()) or public.fn_es_webmaster(auth.uid())) then raise exception 'SOLO_ADMIN'; end if;
  if cardinality(v_w) = 0 then return; end if;
  return query
    select p.id, p.nombre, p.apellido, p.email from public.profiles p
    where (select bool_and(public.f_norm(coalesce(p.nombre, '') || ' ' || coalesce(p.apellido, '') || ' ' || coalesce(p.email, '')) like '%' || w || '%') from unnest(v_w) w)
    order by extensions.similarity(array_to_string(v_w, ' '), public.f_norm(coalesce(p.nombre, '') || ' ' || coalesce(p.apellido, ''))) desc, p.apellido, p.nombre
    limit least(greatest(coalesce(p_limite, 8), 1), 20);
end;
$$ language plpgsql stable security definer set search_path = public, extensions set jit = off;

-- Usuarios para el panel Admin. Parámetros: q, rol (admin | user),
-- webmaster (bool), con_empresa (bool), orden (nombre | recientes |
-- ultimo_ingreso), limite, desde.
create or replace function public.buscar_usuarios(p jsonb default '{}'::jsonb)
returns jsonb as $$
declare
  v_w text[] := public.fn_palabras(coalesce(p ->> 'q', ''));
  v_rol text := nullif(p ->> 'rol', '');
  v_wm boolean := (p ->> 'webmaster')::boolean;
  v_emp boolean := (p ->> 'con_empresa')::boolean;
  v_orden text := coalesce(nullif(p ->> 'orden', ''), 'nombre');
  v_lim int := least(greatest(coalesce((p ->> 'limite')::int, 25), 1), 100);
  v_off int := greatest(coalesce((p ->> 'desde')::int, 0), 0);
  v_res jsonb;
begin
  if not public.fn_es_admin(auth.uid()) then raise exception 'SOLO_ADMIN'; end if;
  with base as (
    select p.id, p.nombre, p.apellido, p.email, p.tel, p.role, p.is_webmaster, p.created_at, u.last_sign_in_at,
      (select count(*) from public.empresas e where e.uid = p.id) + (select count(*) from public.empresa_usuarios a where a.user_id = p.id) as empresas
    from public.profiles p left join auth.users u on u.id = p.id
    where (cardinality(v_w) = 0 or (select bool_and(
            public.f_norm(coalesce(p.nombre, '') || ' ' || coalesce(p.apellido, '') || ' ' || coalesce(p.email, '') || ' ' || coalesce(p.tel, ''))
            like '%' || w || '%') from unnest(v_w) w))
      and (v_rol is null or p.role = v_rol)
      and (v_wm is null or p.is_webmaster = v_wm)
  ), ok as (
    select * from base where v_emp is null or (empresas > 0) = v_emp
  )
  select jsonb_build_object(
    'total', (select count(*) from ok),
    'items', coalesce((select jsonb_agg(to_jsonb(x) - 'ord' order by x.ord) from (
      select ok.*, row_number() over (order by
        case when v_orden = 'recientes' then ok.created_at end desc nulls last,
        case when v_orden = 'ultimo_ingreso' then ok.last_sign_in_at end desc nulls last,
        public.f_norm(ok.apellido), public.f_norm(ok.nombre), ok.id) ord
      from ok order by ord offset v_off limit v_lim) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$ language plpgsql stable security definer set search_path = public, extensions set jit = off;

-- Graduados (todos los usuarios con sesión). Email y teléfono solo si el
-- que busca tiene permiso de verlos (misma regla que perfiles_contacto).
-- Parámetros: q, orden (nombre | recientes), limite, desde.
create or replace function public.buscar_graduados(p jsonb default '{}'::jsonb)
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_w text[] := public.fn_palabras(coalesce(p ->> 'q', ''));
  v_orden text := coalesce(nullif(p ->> 'orden', ''), 'nombre');
  -- Igual que antes de 016: los admins no figuran salvo que se pida.
  v_admins boolean := coalesce((p ->> 'incluir_admins')::boolean, false);
  v_lim int := least(greatest(coalesce((p ->> 'limite')::int, 24), 1), 100);
  v_off int := greatest(coalesce((p ->> 'desde')::int, 0), 0);
  v_res jsonb;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  with base as (
    select p.id, p.nombre, p.apellido, p.role, p.created_at,
      public.fn_puede_ver_contacto(v_uid, p.id) as ver,
      p.email, p.tel,
      coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'logo', e.logo, 'sector_id', e.sector_id, 'ciudad', e.ciudad) order by e.nombre)
        from public.empresas e
        where e.uid = p.id or exists (select 1 from public.empresa_usuarios a where a.empresa_id = e.id and a.user_id = p.id)), '[]'::jsonb) as empresas
    from public.profiles p
  ), ok as (
    select * from base b
    where (v_admins or b.role <> 'admin')
      and (cardinality(v_w) = 0 or (select bool_and(
      public.f_norm(coalesce(b.nombre, '') || ' ' || coalesce(b.apellido, '') || ' '
        || coalesce((select string_agg(x ->> 'nombre', ' ') from jsonb_array_elements(b.empresas) x), '')
        || case when b.ver then ' ' || coalesce(b.email, '') else '' end)
      like '%' || w || '%') from unnest(v_w) w))
  )
  select jsonb_build_object(
    'total', (select count(*) from ok),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'apellido', x.apellido, 'role', x.role,
        'email', case when x.ver then x.email end, 'tel', case when x.ver then x.tel end, 'empresas', x.empresas) order by x.ord)
      from (select ok.*, row_number() over (order by
              case when v_orden = 'recientes' then ok.created_at end desc nulls last,
              public.f_norm(ok.apellido), public.f_norm(ok.nombre), ok.id) ord
            from ok order by ord offset v_off limit v_lim) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$ language plpgsql stable security definer set search_path = public, extensions set jit = off;

-- Conexiones para el webmaster. Parámetros: q (empresas o categoría),
-- estado (match | match_sin_contacto | pendiente | rechazada | sugerida),
-- limite, desde. Incluye el resumen de mensajes (sin contenido).
create or replace function public.wm_buscar_conexiones(p jsonb default '{}'::jsonb)
returns jsonb as $$
declare
  v_w text[] := public.fn_palabras(coalesce(p ->> 'q', ''));
  v_est text := nullif(p ->> 'estado', '');
  v_lim int := least(greatest(coalesce((p ->> 'limite')::int, 25), 1), 100);
  v_off int := greatest(coalesce((p ->> 'desde')::int, 0), 0);
  v_res jsonb;
begin
  if not public.fn_es_webmaster(auth.uid()) then raise exception 'SOLO_WEBMASTER'; end if;
  with base as (
    select c.*, en.nombre as necesita_nombre, eo.nombre as ofrece_nombre, k.nombre as categoria_nombre, er.nombre as rechazada_empresa_nombre,
      case when c.rechazada_at is not null then 'rechazada' when c.match_at is not null then 'match'
           when c.acepta_necesita_at is not null then 'acepto_necesita' when c.acepta_ofrece_at is not null then 'acepto_ofrece'
           else 'sugerida' end as estado,
      (select jsonb_agg(jsonb_build_object('empresa_id', m.empresa_id, 'cantidad', m.n, 'primer_mensaje', m.primero, 'ultimo_mensaje', m.ultimo))
         from (select empresa_id, count(*) n, min(created_at) primero, max(created_at) ultimo
               from public.mensajes where conexion_id = c.id group by empresa_id) m) as contacto,
      (select trim(coalesce(pp.nombre, '') || ' ' || coalesce(pp.apellido, '')) from public.profiles pp where pp.id = c.acepta_necesita_por) as acepta_necesita_nombre,
      (select trim(coalesce(pp.nombre, '') || ' ' || coalesce(pp.apellido, '')) from public.profiles pp where pp.id = c.acepta_ofrece_por) as acepta_ofrece_nombre
    from public.conexiones c
    left join public.empresas en on en.id = c.empresa_necesita_id
    left join public.empresas eo on eo.id = c.empresa_ofrece_id
    left join public.empresas er on er.id = c.rechazada_empresa_id
    left join public.categorias k on k.id = c.categoria_id
  ), ok as (
    select * from base b
    where (cardinality(v_w) = 0 or (select bool_and(public.f_norm(coalesce(b.necesita_nombre, '') || ' ' || coalesce(b.ofrece_nombre, '') || ' ' || coalesce(b.categoria_nombre, '')) like '%' || w || '%') from unnest(v_w) w))
      and (v_est is null
        or (v_est = 'match_sin_contacto' and b.estado = 'match' and b.contacto is null)
        or (v_est = 'pendiente' and b.estado in ('acepto_necesita', 'acepto_ofrece'))
        or b.estado = v_est)
  )
  select jsonb_build_object(
    'total', (select count(*) from ok),
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc nulls last, x.id desc)
      from (select * from ok order by updated_at desc nulls last, id desc offset v_off limit v_lim) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$ language plpgsql stable security definer set search_path = public, extensions set jit = off;

-- Solicitudes para el webmaster. Parámetros: q, estado (pendiente |
-- aceptada | aceptada_sin_contacto | rechazada | cancelada), limite, desde.
create or replace function public.wm_buscar_solicitudes(p jsonb default '{}'::jsonb)
returns jsonb as $$
declare
  v_w text[] := public.fn_palabras(coalesce(p ->> 'q', ''));
  v_est text := nullif(p ->> 'estado', '');
  v_lim int := least(greatest(coalesce((p ->> 'limite')::int, 25), 1), 100);
  v_off int := greatest(coalesce((p ->> 'desde')::int, 0), 0);
  v_res jsonb;
begin
  if not public.fn_es_webmaster(auth.uid()) then raise exception 'SOLO_WEBMASTER'; end if;
  with base as (
    select s.*, k.nombre as categoria_nombre, ed.nombre as destino_nombre,
      coalesce(eo.nombre, trim(coalesce(po.nombre, '') || ' ' || coalesce(po.apellido, '')) || ' (a título personal)') as origen_nombre,
      trim(coalesce(pe.nombre, '') || ' ' || coalesce(pe.apellido, '')) as enviada_por_nombre,
      trim(coalesce(pr.nombre, '') || ' ' || coalesce(pr.apellido, '')) as respondida_por_nombre,
      (select jsonb_agg(jsonb_build_object('lado', m.lado, 'cantidad', m.n, 'primer_mensaje', m.primero, 'ultimo_mensaje', m.ultimo))
         from (select lado, count(*) n, min(created_at) primero, max(created_at) ultimo
               from public.solicitud_mensajes where solicitud_id = s.id group by lado) m) as contacto,
      (s.respondida_at is not null and exists (select 1 from public.solicitud_mensajes m where m.solicitud_id = s.id and m.created_at > s.respondida_at)) as hubo_contacto
    from public.solicitudes s
    left join public.categorias k on k.id = s.categoria_id
    left join public.empresas ed on ed.id = s.destino_empresa_id
    left join public.empresas eo on eo.id = s.origen_empresa_id
    left join public.profiles po on po.id = s.origen_persona_id
    left join public.profiles pe on pe.id = s.enviada_por
    left join public.profiles pr on pr.id = s.respondida_por
  ), ok as (
    select * from base b
    where (cardinality(v_w) = 0 or (select bool_and(public.f_norm(coalesce(b.origen_nombre, '') || ' ' || coalesce(b.destino_nombre, '') || ' ' || coalesce(b.categoria_nombre, '') || ' ' || coalesce(b.subcategoria, '')) like '%' || w || '%') from unnest(v_w) w))
      and (v_est is null
        or (v_est = 'aceptada_sin_contacto' and b.estado = 'aceptada' and not b.hubo_contacto)
        or b.estado = v_est)
  )
  select jsonb_build_object(
    'total', (select count(*) from ok),
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc)
      from (select * from ok order by created_at desc, id desc offset v_off limit v_lim) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$ language plpgsql stable security definer set search_path = public, extensions set jit = off;

-- ───────────────────────────────────────────────────────────────
-- PERMISOS
-- ───────────────────────────────────────────────────────────────
revoke execute on function public.fn_json_txt(jsonb, text) from public, anon;
revoke execute on function public.fn_palabras(text) from public, anon;
revoke execute on function public.buscar_empresas(jsonb) from public, anon;
revoke execute on function public.sugerir_usuarios(text, int) from public, anon;
revoke execute on function public.buscar_usuarios(jsonb) from public, anon;
revoke execute on function public.buscar_graduados(jsonb) from public, anon;
revoke execute on function public.wm_buscar_conexiones(jsonb) from public, anon;
revoke execute on function public.wm_buscar_solicitudes(jsonb) from public, anon;
grant execute on function public.buscar_empresas(jsonb) to authenticated;
grant execute on function public.sugerir_usuarios(text, int) to authenticated;
grant execute on function public.buscar_usuarios(jsonb) to authenticated;
grant execute on function public.buscar_graduados(jsonb) to authenticated;
grant execute on function public.wm_buscar_conexiones(jsonb) to authenticated;
grant execute on function public.wm_buscar_solicitudes(jsonb) to authenticated;
