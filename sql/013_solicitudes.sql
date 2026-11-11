-- ═══════════════════════════════════════════════════════════════
-- CUPFI · Solicitudes y carga rápida de ofertas/necesidades
--
-- Se corre DESPUÉS de sql/012_etapa1_conexiones.sql. Es idempotente.
-- No modifica ninguna tabla ni función de 012: solo agrega.
--
-- 1. Carga rápida: agregar o quitar UN servicio/producto o necesidad
--    desde el detalle de la empresa (sin pasar por el formulario).
-- 2. Solicitudes: un usuario busca un servicio/producto o una necesidad,
--    ve qué empresas lo tienen y les manda una solicitud, en nombre de una
--    de sus empresas o a su propio nombre (persona). La empresa que la
--    recibe la acepta o la rechaza; si la acepta se habilita un chat
--    privado entre las dos partes.
--      · tipo 'conseguir': quien la manda quiere conseguir algo que la
--        otra empresa OFRECE.
--      · tipo 'ofrecer': quien la manda ofrece algo que la otra empresa
--        NECESITA.
--    Si quien la manda es una empresa y ya existe una coincidencia
--    automática con la otra en esa categoría (ver conexiones en 012), NO
--    se crea una solicitud: cuenta como la aceptación de esa conexión y el
--    mensaje inicial queda guardado para el chat de la conexión.
--
-- Reglas que hace cumplir la base:
--  · Solo los usuarios de una empresa mandan solicitudes en su nombre y
--    solo los usuarios de la empresa destino las aceptan o rechazan.
--  · Una sola solicitud pendiente por remitente, destino y tema; si la
--    otra parte la rechazó, el mismo tema no se puede volver a pedir, y si
--    la aceptó ya tienen el chat (tampoco se repite). Si el remitente la
--    canceló, sí puede volver a mandarla.
--  · El chat de una solicitud solo lo leen las dos partes (ni admins ni
--    webmasters). El webmaster solo ve que existió y cuántos mensajes hubo.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1. CARGA RÁPIDA DE ÍTEMS
-- ───────────────────────────────────────────────────────────────

-- Interna: agrega un ítem si no existe. Devuelve el id (null si ya
-- existía). Valida igual que guardar_items_empresa. No revisa permisos
-- (lo hacen quienes la llaman) y no se expone al navegador.
create or replace function public.fn_item_agregar(
  p_empresa bigint, p_tipo text, p_categoria bigint, p_subcategoria text
) returns bigint as $$
declare
  v_sub text := trim(regexp_replace(coalesce(p_subcategoria, ''), '\s+', ' ', 'g'));
  v_es_otros boolean;
  v_id bigint;
begin
  if coalesce(p_tipo, '') not in ('oferta', 'necesidad') then raise exception 'ITEMS_INVALIDOS'; end if;
  select es_otros into v_es_otros from public.categorias where id = p_categoria;
  if not found then raise exception 'CATEGORIA_INEXISTENTE'; end if;
  if char_length(v_sub) > 120 then raise exception 'SUBCATEGORIA_LARGA'; end if;
  if v_es_otros and v_sub = '' then raise exception 'OTROS_REQUIERE_DETALLE'; end if;
  if exists (
    select 1 from public.empresa_items
    where empresa_id = p_empresa and tipo = p_tipo and categoria_id = p_categoria
      and public.fn_norm(subcategoria) = public.fn_norm(v_sub)
  ) then
    return null;
  end if;
  if (select count(*) from public.empresa_items where empresa_id = p_empresa) >= 120 then
    raise exception 'DEMASIADOS_ITEMS';
  end if;
  insert into public.empresa_items (empresa_id, tipo, categoria_id, subcategoria)
    values (p_empresa, p_tipo, p_categoria, v_sub)
    on conflict do nothing
    returning id into v_id;
  if v_id is not null then
    perform public.fn_log('empresa_items_cambio', 'empresa', p_empresa::text, jsonb_build_object(
      'empresa', (select nombre from public.empresas where id = p_empresa),
      'agregados', jsonb_build_array(jsonb_build_object('tipo', p_tipo,
        'categoria', (select nombre from public.categorias where id = p_categoria), 'subcategoria', v_sub)),
      'quitados', '[]'::jsonb));
  end if;
  return v_id;
end;
$$ language plpgsql security definer set search_path = public;

-- Agregar un ítem desde el detalle de la empresa.
create or replace function public.empresa_item_agregar(
  p_empresa bigint, p_tipo text, p_categoria bigint, p_subcategoria text
) returns public.empresa_items as $$
declare
  v_uid uuid := auth.uid();
  v_row public.empresa_items;
  v_sub text := trim(regexp_replace(coalesce(p_subcategoria, ''), '\s+', ' ', 'g'));
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'EMPRESA_INEXISTENTE'; end if;
  if not (public.fn_es_usuario_empresa(p_empresa, v_uid) or public.fn_es_admin(v_uid)) then
    raise exception 'SIN_PERMISO_EMPRESA';
  end if;
  if public.fn_item_agregar(p_empresa, p_tipo, p_categoria, v_sub) is null then
    raise exception 'ITEM_YA_EXISTE';
  end if;
  update public.empresas set items_migrados = true where id = p_empresa and not items_migrados;
  select * into v_row from public.empresa_items
    where empresa_id = p_empresa and tipo = p_tipo and categoria_id = p_categoria
      and public.fn_norm(subcategoria) = public.fn_norm(v_sub);
  return v_row;
end;
$$ language plpgsql security definer set search_path = public;

-- Quitar un ítem desde el detalle de la empresa.
create or replace function public.empresa_item_quitar(p_item bigint)
returns void as $$
declare
  v_uid uuid := auth.uid();
  v_row public.empresa_items;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  select * into v_row from public.empresa_items where id = p_item;
  if not found then raise exception 'ITEM_INEXISTENTE'; end if;
  if not (public.fn_es_usuario_empresa(v_row.empresa_id, v_uid) or public.fn_es_admin(v_uid)) then
    raise exception 'SIN_PERMISO_EMPRESA';
  end if;
  delete from public.empresa_items where id = p_item;
  perform public.fn_log('empresa_items_cambio', 'empresa', v_row.empresa_id::text, jsonb_build_object(
    'empresa', (select nombre from public.empresas where id = v_row.empresa_id),
    'agregados', '[]'::jsonb,
    'quitados', jsonb_build_array(jsonb_build_object('tipo', v_row.tipo,
      'categoria', (select nombre from public.categorias where id = v_row.categoria_id), 'subcategoria', v_row.subcategoria))));
end;
$$ language plpgsql security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 2. SOLICITUDES
-- ───────────────────────────────────────────────────────────────
create table if not exists public.solicitudes (
  id bigserial primary key,
  tipo text not null check (tipo in ('conseguir', 'ofrecer')),
  -- Remitente: una empresa O una persona (exactamente uno de los dos).
  origen_empresa_id bigint references public.empresas(id) on delete cascade,
  origen_persona_id uuid references public.profiles(id) on delete cascade,
  enviada_por uuid references public.profiles(id) on delete set null,
  destino_empresa_id bigint not null references public.empresas(id) on delete cascade,
  categoria_id bigint not null references public.categorias(id) on delete restrict,
  subcategoria text not null default '' check (char_length(subcategoria) <= 120),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada', 'cancelada')),
  respondida_at timestamp with time zone,
  respondida_por uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint solicitudes_un_remitente check ((origen_empresa_id is null) <> (origen_persona_id is null)),
  constraint solicitudes_distintas check (origen_empresa_id is null or origen_empresa_id <> destino_empresa_id)
);

create index if not exists solicitudes_destino_idx on public.solicitudes (destino_empresa_id, estado);
create index if not exists solicitudes_origen_emp_idx on public.solicitudes (origen_empresa_id);
create index if not exists solicitudes_origen_per_idx on public.solicitudes (origen_persona_id);
-- Una sola pendiente por remitente, destino y tema.
create unique index if not exists solicitudes_pendiente_empresa
  on public.solicitudes (origen_empresa_id, destino_empresa_id, tipo, categoria_id, public.fn_norm(subcategoria))
  where estado = 'pendiente' and origen_empresa_id is not null;
create unique index if not exists solicitudes_pendiente_persona
  on public.solicitudes (origen_persona_id, destino_empresa_id, tipo, categoria_id, public.fn_norm(subcategoria))
  where estado = 'pendiente' and origen_persona_id is not null;

alter table public.solicitudes enable row level security;

-- ¿p_uid es parte del lado remitente de la solicitud?
create or replace function public.fn_es_origen_solicitud(p_sol public.solicitudes, p_uid uuid)
returns boolean as $$
  select p_uid is not null and (
    (p_sol.origen_persona_id is not null and p_sol.origen_persona_id = p_uid)
    or (p_sol.origen_empresa_id is not null and public.fn_es_usuario_empresa(p_sol.origen_empresa_id, p_uid))
  );
$$ language sql stable security definer set search_path = public;

drop policy if exists "Solicitudes visibles para sus partes o webmaster" on public.solicitudes;
create policy "Solicitudes visibles para sus partes o webmaster"
  on public.solicitudes for select to authenticated using (
    origen_persona_id = auth.uid()
    or public.fn_es_usuario_empresa(origen_empresa_id, auth.uid())
    or public.fn_es_usuario_empresa(destino_empresa_id, auth.uid())
    or public.fn_es_webmaster(auth.uid())
  );
-- Sin políticas de escritura directa: solo las funciones de abajo.

create table if not exists public.solicitud_mensajes (
  id bigserial primary key,
  solicitud_id bigint not null references public.solicitudes(id) on delete cascade,
  lado text not null check (lado in ('origen', 'destino')),
  autor_id uuid references public.profiles(id) on delete set null,
  contenido text not null check (char_length(contenido) between 1 and 4000),
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists solicitud_mensajes_idx on public.solicitud_mensajes (solicitud_id, created_at);

alter table public.solicitud_mensajes enable row level security;

-- Solo las dos partes. A propósito NO incluye admins ni webmasters.
drop policy if exists "Mensajes de solicitud solo para sus partes" on public.solicitud_mensajes;
create policy "Mensajes de solicitud solo para sus partes"
  on public.solicitud_mensajes for select to authenticated using (
    exists (
      select 1 from public.solicitudes s
      where s.id = solicitud_mensajes.solicitud_id
        and (s.origen_persona_id = auth.uid()
             or public.fn_es_usuario_empresa(s.origen_empresa_id, auth.uid())
             or public.fn_es_usuario_empresa(s.destino_empresa_id, auth.uid()))
    )
  );

-- Datos del evento para la bitácora (nunca el texto de los mensajes).
create or replace function public.fn_solicitud_detalle(p_sol public.solicitudes)
returns jsonb as $$
  select jsonb_build_object(
    'tipo', p_sol.tipo,
    'origen', coalesce(
      (select nombre from public.empresas where id = p_sol.origen_empresa_id),
      (select trim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) || ' (persona)' from public.profiles where id = p_sol.origen_persona_id)),
    'destino', (select nombre from public.empresas where id = p_sol.destino_empresa_id),
    'categoria', (select nombre from public.categorias where id = p_sol.categoria_id),
    'subcategoria', p_sol.subcategoria);
$$ language sql stable security definer set search_path = public;

-- Enviar una solicitud.
--   p_tipo: 'conseguir' | 'ofrecer'
--   p_origen_empresa: una de mis empresas, o null para mandarla a mi nombre
--   p_destino, p_categoria, p_subcategoria: el ítem de la empresa destino
--     (una oferta suya si quiero conseguirlo; una necesidad suya si quiero
--     ofrecerlo).
--   p_mensaje: mensaje inicial opcional (hasta 1000 caracteres)
--   p_agregar_item: true = sumar el ítem a mi empresa (como necesidad si
--     quiero conseguirlo, como oferta si quiero ofrecerlo)
-- Devuelve {resultado, solicitud_id, conexion_id, item_agregado} donde
-- resultado es 'solicitud' | 'conexion_aceptada' | 'conexion_match' |
-- 'conexion_ya_aceptada' | 'conexion_en_match'.
create or replace function public.solicitud_enviar(
  p_tipo text, p_origen_empresa bigint, p_destino bigint, p_categoria bigint,
  p_subcategoria text, p_mensaje text default null, p_agregar_item boolean default false
) returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_sub text := trim(regexp_replace(coalesce(p_subcategoria, ''), '\s+', ' ', 'g'));
  v_msg text := trim(coalesce(p_mensaje, ''));
  v_tipo_destino text;
  v_tipo_mio text;
  v_item_agregado boolean := false;
  v_necesita bigint;
  v_ofrece bigint;
  v_con public.conexiones;
  v_estado_previo text;
  v_sol public.solicitudes;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if coalesce(p_tipo, '') not in ('conseguir', 'ofrecer') then raise exception 'SOLICITUD_TIPO_INVALIDO'; end if;
  if not exists (select 1 from public.empresas where id = p_destino) then raise exception 'EMPRESA_INEXISTENTE'; end if;
  if char_length(v_msg) > 1000 then raise exception 'MENSAJE_LARGO'; end if;

  -- Remitente
  if p_origen_empresa is not null then
    if not exists (select 1 from public.empresas where id = p_origen_empresa) then raise exception 'EMPRESA_INEXISTENTE'; end if;
    if not public.fn_es_usuario_empresa(p_origen_empresa, v_uid) then raise exception 'SIN_PERMISO_EMPRESA'; end if;
    if p_origen_empresa = p_destino or public.fn_mismo_titular(p_origen_empresa, p_destino) then
      raise exception 'MISMO_TITULAR';
    end if;
  else
    if p_agregar_item then raise exception 'ITEM_REQUIERE_EMPRESA'; end if;
    if public.fn_es_usuario_empresa(p_destino, v_uid) then raise exception 'MISMO_TITULAR'; end if;
  end if;

  -- Destino: tiene que tener ese ítem y alguien que pueda responder.
  v_tipo_destino := case when p_tipo = 'conseguir' then 'oferta' else 'necesidad' end;
  v_tipo_mio := case when p_tipo = 'conseguir' then 'necesidad' else 'oferta' end;
  if not exists (
    select 1 from public.empresa_items
    where empresa_id = p_destino and tipo = v_tipo_destino and categoria_id = p_categoria
      and public.fn_norm(subcategoria) = public.fn_norm(v_sub)
  ) then
    raise exception 'SOLICITUD_SIN_ITEM';
  end if;
  if not exists (select 1 from public.fn_usuarios_empresa(p_destino)) then
    raise exception 'EMPRESA_SIN_USUARIOS';
  end if;

  if p_agregar_item then
    v_item_agregado := public.fn_item_agregar(p_origen_empresa, v_tipo_mio, p_categoria, v_sub) is not null;
  end if;

  -- Empresa → empresa con coincidencia automática: cuenta como aceptación.
  if p_origen_empresa is not null then
    v_necesita := case when p_tipo = 'conseguir' then p_origen_empresa else p_destino end;
    v_ofrece := case when p_tipo = 'conseguir' then p_destino else p_origen_empresa end;
    select * into v_con from public.conexiones
      where empresa_necesita_id = v_necesita and empresa_ofrece_id = v_ofrece and categoria_id = p_categoria;
    if found then
      if v_con.rechazada_at is not null then raise exception 'CONEXION_RECHAZADA'; end if;
      if v_con.match_at is not null then
        v_estado_previo := 'conexion_en_match';
      elsif (p_tipo = 'conseguir' and v_con.acepta_necesita_at is not null)
         or (p_tipo = 'ofrecer' and v_con.acepta_ofrece_at is not null) then
        v_estado_previo := 'conexion_ya_aceptada';
      end if;
    end if;
    if v_estado_previo is null and public.fn_conexion_vigente(v_necesita, v_ofrece, p_categoria) then
      -- conexion_responder valida permisos y vigencia, y registra en la bitácora.
      v_con := public.conexion_responder(v_necesita, v_ofrece, p_categoria, 'aceptar');
      v_estado_previo := case when v_con.match_at is not null then 'conexion_match' else 'conexion_aceptada' end;
    end if;
    -- Sin coincidencia vigente ni conexión aceptada: sigue como solicitud.
    if v_estado_previo is not null then
      select * into v_con from public.conexiones
        where empresa_necesita_id = v_necesita and empresa_ofrece_id = v_ofrece and categoria_id = p_categoria;
      if v_msg <> '' then
        -- Queda en el chat de la conexión (se ve cuando haya match).
        insert into public.mensajes (conexion_id, empresa_id, autor_id, contenido)
          values (v_con.id, p_origen_empresa, v_uid, v_msg);
      end if;
      perform public.fn_log('solicitud_como_conexion', 'conexion', v_con.id::text, jsonb_build_object(
        'tipo', p_tipo,
        'origen', (select nombre from public.empresas where id = p_origen_empresa),
        'destino', (select nombre from public.empresas where id = p_destino),
        'categoria', (select nombre from public.categorias where id = p_categoria),
        'subcategoria', v_sub, 'resultado', v_estado_previo, 'con_mensaje', v_msg <> ''));
      return jsonb_build_object('resultado', v_estado_previo, 'solicitud_id', null,
        'conexion_id', v_con.id, 'item_agregado', v_item_agregado);
    end if;
  end if;

  -- Solicitud nueva
  if exists (
    select 1 from public.solicitudes s
    where s.destino_empresa_id = p_destino and s.tipo = p_tipo and s.categoria_id = p_categoria
      and public.fn_norm(s.subcategoria) = public.fn_norm(v_sub)
      and s.estado in ('pendiente', 'rechazada', 'aceptada')
      and ((p_origen_empresa is not null and s.origen_empresa_id = p_origen_empresa)
        or (p_origen_empresa is null and s.origen_persona_id = v_uid))
  ) then
    if exists (
      select 1 from public.solicitudes s
      where s.destino_empresa_id = p_destino and s.tipo = p_tipo and s.categoria_id = p_categoria
        and public.fn_norm(s.subcategoria) = public.fn_norm(v_sub) and s.estado = 'aceptada'
        and ((p_origen_empresa is not null and s.origen_empresa_id = p_origen_empresa)
          or (p_origen_empresa is null and s.origen_persona_id = v_uid))
    ) then
      raise exception 'SOLICITUD_YA_ACEPTADA';
    end if;
    if exists (
      select 1 from public.solicitudes s
      where s.destino_empresa_id = p_destino and s.tipo = p_tipo and s.categoria_id = p_categoria
        and public.fn_norm(s.subcategoria) = public.fn_norm(v_sub) and s.estado = 'rechazada'
        and ((p_origen_empresa is not null and s.origen_empresa_id = p_origen_empresa)
          or (p_origen_empresa is null and s.origen_persona_id = v_uid))
    ) then
      raise exception 'SOLICITUD_RECHAZADA_ANTES';
    end if;
    raise exception 'SOLICITUD_YA_PENDIENTE';
  end if;
  -- Freno al envío masivo: hasta 30 pendientes por remitente.
  if (select count(*) from public.solicitudes s where s.estado = 'pendiente'
        and ((p_origen_empresa is not null and s.origen_empresa_id = p_origen_empresa)
          or (p_origen_empresa is null and s.origen_persona_id = v_uid))) >= 30 then
    raise exception 'DEMASIADAS_SOLICITUDES';
  end if;

  insert into public.solicitudes (tipo, origen_empresa_id, origen_persona_id, enviada_por,
      destino_empresa_id, categoria_id, subcategoria)
    values (p_tipo, p_origen_empresa, case when p_origen_empresa is null then v_uid end, v_uid,
      p_destino, p_categoria, v_sub)
    returning * into v_sol;
  if v_msg <> '' then
    insert into public.solicitud_mensajes (solicitud_id, lado, autor_id, contenido)
      values (v_sol.id, 'origen', v_uid, v_msg);
  end if;
  perform public.fn_log('solicitud_enviada', 'solicitud', v_sol.id::text,
    public.fn_solicitud_detalle(v_sol) || jsonb_build_object('con_mensaje', v_msg <> ''));
  return jsonb_build_object('resultado', 'solicitud', 'solicitud_id', v_sol.id,
    'conexion_id', null, 'item_agregado', v_item_agregado);
end;
$$ language plpgsql security definer set search_path = public;

-- Responder: la empresa destino 'aceptar' | 'rechazar'; el remitente 'cancelar'.
create or replace function public.solicitud_responder(p_solicitud bigint, p_accion text)
returns public.solicitudes as $$
declare
  v_uid uuid := auth.uid();
  v_sol public.solicitudes;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if coalesce(p_accion, '') not in ('aceptar', 'rechazar', 'cancelar') then raise exception 'ACCION_INVALIDA'; end if;
  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found then raise exception 'SOLICITUD_INEXISTENTE'; end if;
  if p_accion = 'cancelar' then
    if not public.fn_es_origen_solicitud(v_sol, v_uid) then raise exception 'SIN_PERMISO_EMPRESA'; end if;
  elsif not public.fn_es_usuario_empresa(v_sol.destino_empresa_id, v_uid) then
    raise exception 'SIN_PERMISO_EMPRESA';
  end if;
  if v_sol.estado <> 'pendiente' then raise exception 'SOLICITUD_YA_RESPONDIDA'; end if;

  update public.solicitudes set
    estado = case p_accion when 'aceptar' then 'aceptada' when 'rechazar' then 'rechazada' else 'cancelada' end,
    respondida_at = timezone('utc'::text, now()), respondida_por = v_uid,
    updated_at = timezone('utc'::text, now())
  where id = p_solicitud
  returning * into v_sol;

  perform public.fn_log(
    case p_accion when 'aceptar' then 'solicitud_aceptada' when 'rechazar' then 'solicitud_rechazada' else 'solicitud_cancelada' end,
    'solicitud', v_sol.id::text, public.fn_solicitud_detalle(v_sol));
  return v_sol;
end;
$$ language plpgsql security definer set search_path = public;

-- Chat de una solicitud aceptada.
create or replace function public.solicitud_enviar_mensaje(p_solicitud bigint, p_contenido text)
returns public.solicitud_mensajes as $$
declare
  v_uid uuid := auth.uid();
  v_sol public.solicitudes;
  v_lado text;
  v_texto text := trim(coalesce(p_contenido, ''));
  v_row public.solicitud_mensajes;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  select * into v_sol from public.solicitudes where id = p_solicitud;
  if not found then raise exception 'SOLICITUD_INEXISTENTE'; end if;
  if public.fn_es_origen_solicitud(v_sol, v_uid) then
    v_lado := 'origen';
  elsif public.fn_es_usuario_empresa(v_sol.destino_empresa_id, v_uid) then
    v_lado := 'destino';
  else
    raise exception 'SIN_PERMISO_EMPRESA';
  end if;
  if v_sol.estado <> 'aceptada' then raise exception 'CHAT_SIN_ACEPTAR'; end if;
  if char_length(v_texto) = 0 then raise exception 'MENSAJE_VACIO'; end if;
  if char_length(v_texto) > 4000 then raise exception 'MENSAJE_LARGO'; end if;

  insert into public.solicitud_mensajes (solicitud_id, lado, autor_id, contenido)
    values (p_solicitud, v_lado, v_uid, v_texto)
    returning * into v_row;
  perform public.fn_log('solicitud_mensaje', 'solicitud', p_solicitud::text,
    public.fn_solicitud_detalle(v_sol) || jsonb_build_object('lado', v_lado));
  return v_row;
end;
$$ language plpgsql security definer set search_path = public;

-- Para el webmaster: cuántos mensajes hubo en cada solicitud, sin contenido.
create or replace function public.webmaster_solicitudes_resumen()
returns table (solicitud_id bigint, lado text, cantidad bigint, primer_mensaje timestamp with time zone, ultimo_mensaje timestamp with time zone) as $$
begin
  if not public.fn_es_webmaster(auth.uid()) then raise exception 'SOLO_WEBMASTER'; end if;
  return query
    select m.solicitud_id, m.lado, count(*)::bigint, min(m.created_at), max(m.created_at)
    from public.solicitud_mensajes m
    group by m.solicitud_id, m.lado;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 3. PERMISOS
-- ───────────────────────────────────────────────────────────────
revoke execute on function public.fn_item_agregar(bigint, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.fn_solicitud_detalle(public.solicitudes) from public, anon, authenticated;
revoke execute on function public.fn_es_origen_solicitud(public.solicitudes, uuid) from public, anon, authenticated;
revoke execute on function public.empresa_item_agregar(bigint, text, bigint, text) from public, anon;
revoke execute on function public.empresa_item_quitar(bigint) from public, anon;
revoke execute on function public.solicitud_enviar(text, bigint, bigint, bigint, text, text, boolean) from public, anon;
revoke execute on function public.solicitud_responder(bigint, text) from public, anon;
revoke execute on function public.solicitud_enviar_mensaje(bigint, text) from public, anon;
revoke execute on function public.webmaster_solicitudes_resumen() from public, anon;

grant execute on function public.empresa_item_agregar(bigint, text, bigint, text) to authenticated;
grant execute on function public.empresa_item_quitar(bigint) to authenticated;
grant execute on function public.solicitud_enviar(text, bigint, bigint, bigint, text, text, boolean) to authenticated;
grant execute on function public.solicitud_responder(bigint, text) to authenticated;
grant execute on function public.solicitud_enviar_mensaje(bigint, text) to authenticated;
grant execute on function public.webmaster_solicitudes_resumen() to authenticated;

grant select on public.solicitudes, public.solicitud_mensajes to authenticated;
revoke all on public.solicitudes, public.solicitud_mensajes from anon;
