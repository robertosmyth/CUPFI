-- ═══════════════════════════════════════════════════════════════
-- CUPFI · sql/017 — Datos completos sin el corte de 1000 filas
--
-- 1. sugerencias_conexion(): las vinculaciones posibles (quién necesita
--    lo que otra ofrece) se calculan en la base. Cada usuario recibe las de
--    sus empresas; admins y webmasters pueden consultar toda la red de a
--    páginas (con búsqueda) o solo el total. Mismas
--    reglas que matching.ts y fn_conexion_vigente (sql/012):
--      - pares necesidad × oferta de la misma categoría; "exacta" si la
--        subcategoría coincide (normalizada como normalizeTagKey: f_tag);
--      - en "Otros" solo pares exactos con subcategoría no vacía;
--      - nunca entre empresas que comparten algún usuario.
-- 2. CUIT único sin importar guiones o espacios, y cuit_disponible() para
--    avisar en el formulario antes de guardar.
-- 3. Mensajes de chat: índices para traer los más recientes primero.
-- 4. Las funciones de disparadores no se pueden llamar desde la API.
--
-- Requiere sql/016. Se puede correr más de una vez. No cambia datos.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Vinculaciones posibles ──────────────────────────────────────
drop function if exists public.sugerencias_conexion();
-- Parámetros (todos opcionales):
--   red      true = toda la red (solo admins y webmasters)
--   empresa  id: solo lo que esa empresa necesita (admins/webmasters o sus usuarios)
--   q, nivel ('exacta' | 'categoria'), limite (≤ 200), desde, solo_total
-- Sin red ni empresa: las de las empresas de quien llama, todas.
-- Devuelve { total, items: [{ necesita_id, ofrece_id, categoria_id, pares, nivel }] }.
create or replace function public.sugerencias_conexion(p jsonb default '{}'::jsonb)
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_priv boolean;
  v_red boolean := coalesce((p ->> 'red')::boolean, false);
  v_emp bigint := nullif(p ->> 'empresa', '')::bigint;
  v_w text[] := public.fn_palabras(coalesce(p ->> 'q', ''));
  v_nivel text := nullif(p ->> 'nivel', '');
  v_solo_total boolean := coalesce((p ->> 'solo_total')::boolean, false);
  v_lim int;
  v_off int := greatest(coalesce((p ->> 'desde')::int, 0), 0);
  v_res jsonb;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  v_priv := public.fn_es_admin(v_uid) or public.fn_es_webmaster(v_uid);
  if v_red and not v_priv then raise exception 'SOLO_ADMIN'; end if;
  if v_emp is not null and not v_priv and not public.fn_es_usuario_empresa(v_emp, v_uid) then raise exception 'SIN_PERMISO'; end if;
  -- Las propias van completas; la red y una empresa ajena, de a páginas.
  v_lim := case when v_red or v_emp is not null then least(greatest(coalesce((p ->> 'limite')::int, 50), 1), 200) else 100000 end;
  with
  usuarios_emp as (
    select e.id, e.uid as u from public.empresas e where e.uid is not null
    union select a.empresa_id, a.user_id from public.empresa_usuarios a
  ),
  mias as (select distinct id from usuarios_emp where u = v_uid),
  -- pares de empresas con algún usuario en común (no se conectan entre sí)
  mismo_titular as materialized (
    select distinct a.id as x, b.id as y from usuarios_emp a join usuarios_emp b on b.u = a.u and b.id <> a.id
  ),
  nec as materialized (
    select i.id, i.empresa_id, i.categoria_id, i.subcategoria, public.f_tag(i.subcategoria) t
    from public.empresa_items i
    where i.tipo = 'necesidad' and (v_emp is null or i.empresa_id = v_emp)
  ),
  ofe as materialized (
    select i.id, i.empresa_id, i.categoria_id, i.subcategoria, public.f_tag(i.subcategoria) t
    from public.empresa_items i where i.tipo = 'oferta'
  ),
  pares as materialized (
    select n.empresa_id as necesita_id, o.empresa_id as ofrece_id, n.categoria_id,
           n.id as nid, o.id as oid, n.subcategoria as necesidad, o.subcategoria as oferta,
           (n.t = o.t) as exacta
    from nec n
    join ofe o on o.categoria_id = n.categoria_id and o.empresa_id <> n.empresa_id
    join public.categorias k on k.id = n.categoria_id
    left join mismo_titular mt on mt.x = n.empresa_id and mt.y = o.empresa_id
    where mt.x is null
      and (not k.es_otros or (n.t = o.t and n.t <> ''))
      and (v_red or v_emp is not null or n.empresa_id in (select id from mias) or o.empresa_id in (select id from mias))
  ),
  grupos as (
    select necesita_id, ofrece_id, categoria_id, bool_or(exacta) as exacta, min(nid) as primera,
      case when cardinality(v_w) > 0 then string_agg(necesidad || ' ' || oferta, ' ') end as subs
    from pares group by necesita_id, ofrece_id, categoria_id
  ),
  ok as (
    select g.necesita_id, g.ofrece_id, g.categoria_id, g.exacta, g.primera, en.created_at as en_f, eo.created_at as eo_f
    from grupos g
    join public.empresas en on en.id = g.necesita_id
    join public.empresas eo on eo.id = g.ofrece_id
    join public.categorias k on k.id = g.categoria_id
    where (v_nivel is null or (v_nivel = 'exacta') = g.exacta)
      and (cardinality(v_w) = 0 or (select bool_and(public.f_norm(concat_ws(' ', en.nombre, eo.nombre, k.nombre, g.subs, en.referente, eo.referente)) like '%' || w || '%') from unnest(v_w) w))
  ),
  pagina as (
    select * from ok where not v_solo_total
    order by en_f desc, necesita_id desc, eo_f desc, ofrece_id desc, primera
    offset v_off limit v_lim
  )
  select jsonb_build_object(
    'total', (select count(*) from ok),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'necesita_id', x.necesita_id, 'ofrece_id', x.ofrece_id, 'categoria_id', x.categoria_id,
          'pares', x.pares, 'nivel', case when x.exacta then 'exacta' else 'categoria' end)
        order by x.en_f desc, x.necesita_id desc, x.eo_f desc, x.ofrece_id desc, x.primera)
      from (
        select pg.*, jsonb_agg(jsonb_build_object('necesidad', pr.necesidad, 'oferta', pr.oferta,
                                                  'nivel', case when pr.exacta then 'exacta' else 'categoria' end)
                               order by (not pr.exacta), pr.nid, pr.oid) as pares
        from pagina pg
        join pares pr on pr.necesita_id = pg.necesita_id and pr.ofrece_id = pg.ofrece_id and pr.categoria_id = pg.categoria_id
        group by pg.necesita_id, pg.ofrece_id, pg.categoria_id, pg.exacta, pg.primera, pg.en_f, pg.eo_f
      ) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$ language plpgsql stable security definer set search_path = public, extensions set jit = off;

revoke execute on function public.sugerencias_conexion(jsonb) from public, anon;
grant execute on function public.sugerencias_conexion(jsonb) to authenticated;

create index if not exists empresa_items_tipo_cat_idx on public.empresa_items (tipo, categoria_id, empresa_id);

-- ── 2. CUIT único (sin guiones ni espacios) ─────────────────────────
create or replace function public.f_cuit(t text)
returns text as $$
  select regexp_replace(coalesce(t, ''), '\D', '', 'g');
$$ language sql immutable parallel safe set search_path = '';

-- Falla si ya hubiera dos con los mismos dígitos (hoy no hay ninguno).
create unique index if not exists empresas_cuit_digitos_uq on public.empresas (public.f_cuit(cuit));

create or replace function public.cuit_disponible(p_cuit text, p_excluir bigint default null)
returns boolean as $$
begin
  if auth.uid() is null then raise exception 'NO_AUTENTICADO'; end if;
  return not exists (
    select 1 from public.empresas
    where public.f_cuit(cuit) = public.f_cuit(p_cuit) and id is distinct from p_excluir);
end;
$$ language plpgsql stable security definer set search_path = public;

revoke execute on function public.cuit_disponible(text, bigint) from public, anon;
grant execute on function public.cuit_disponible(text, bigint) to authenticated;

-- ── 3. Chats: los mensajes más recientes primero ───────────────────
create index if not exists mensajes_conexion_fecha_idx on public.mensajes (conexion_id, created_at desc, id desc);
create index if not exists solicitud_mensajes_fecha_idx on public.solicitud_mensajes (solicitud_id, created_at desc, id desc);

-- ── 4. Funciones de disparadores: solo las usa la base ─────────────
-- (los disparadores siguen funcionando: no necesitan este permiso)
revoke execute on function public.check_profile_uniqueness() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.prevent_empresa_uid_change() from public, anon, authenticated;
revoke execute on function public.prevent_role_change() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
