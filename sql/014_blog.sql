-- ═══════════════════════════════════════════════════════════════
-- CUPFI · Etapa 2: blog universal de la red (estilo LinkedIn)
--
-- Se corre DESPUÉS de sql/013_solicitudes.sql. Es idempotente y solo
-- agrega: no modifica tablas ni funciones existentes.
--
-- · Posteos en nombre de una empresa (de la que el usuario es usuario) o
--   a título personal: texto + hasta 4 imágenes (5 MB c/u) o 1 video
--   (subido, hasta 50 MB, o link de YouTube/Vimeo).
-- · Comentarios con un nivel de respuestas; "me gusta" en posteos y
--   comentarios (se puede ver quién dio me gusta).
-- · Cada usuario edita y borra lo suyo. Los webmasters moderan: ocultan,
--   vuelven a mostrar o borran posteos y comentarios, y atienden las
--   denuncias de los usuarios.
-- · Solo lo ven usuarios con sesión. Los archivos van a un bucket PRIVADO
--   ('blog'); el navegador los muestra con URLs firmadas temporales.
-- · Supabase no deja borrar archivos desde SQL: al borrar un posteo, la
--   función devuelve las rutas y la página las borra del almacenamiento.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1. TABLAS
-- ───────────────────────────────────────────────────────────────
create table if not exists public.blog_posts (
  id bigserial primary key,
  autor_id uuid not null references public.profiles(id) on delete cascade,
  empresa_id bigint references public.empresas(id) on delete cascade, -- null = a título personal
  texto text not null default '' check (char_length(texto) <= 5000),
  imagenes text[] not null default '{}' check (cardinality(imagenes) <= 4),
  video_path text,
  video_url text check (video_url is null or char_length(video_url) <= 300),
  oculto boolean not null default false,
  oculto_por uuid references public.profiles(id) on delete set null,
  oculto_at timestamp with time zone,
  oculto_motivo text check (oculto_motivo is null or char_length(oculto_motivo) <= 500),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  editado_at timestamp with time zone,
  constraint blog_posts_media check (cardinality(imagenes) = 0 or (video_path is null and video_url is null)),
  constraint blog_posts_un_video check (video_path is null or video_url is null)
);
create index if not exists blog_posts_fecha_idx on public.blog_posts (created_at desc);
create index if not exists blog_posts_autor_idx on public.blog_posts (autor_id);
create index if not exists blog_posts_empresa_idx on public.blog_posts (empresa_id);

create table if not exists public.blog_comentarios (
  id bigserial primary key,
  post_id bigint not null references public.blog_posts(id) on delete cascade,
  parent_id bigint references public.blog_comentarios(id) on delete cascade, -- respuesta (un solo nivel)
  autor_id uuid not null references public.profiles(id) on delete cascade,
  texto text not null check (char_length(texto) between 1 and 2000),
  oculto boolean not null default false,
  oculto_por uuid references public.profiles(id) on delete set null,
  oculto_at timestamp with time zone,
  oculto_motivo text check (oculto_motivo is null or char_length(oculto_motivo) <= 500),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  editado_at timestamp with time zone
);
create index if not exists blog_comentarios_post_idx on public.blog_comentarios (post_id, created_at);

create table if not exists public.blog_post_likes (
  post_id bigint not null references public.blog_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  primary key (post_id, user_id)
);

create table if not exists public.blog_comentario_likes (
  comentario_id bigint not null references public.blog_comentarios(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  primary key (comentario_id, user_id)
);

create table if not exists public.blog_denuncias (
  id bigserial primary key,
  post_id bigint references public.blog_posts(id) on delete cascade,
  comentario_id bigint references public.blog_comentarios(id) on delete cascade,
  denunciante_id uuid not null references public.profiles(id) on delete cascade,
  motivo text not null check (char_length(motivo) between 1 and 500),
  estado text not null default 'abierta' check (estado in ('abierta', 'resuelta')),
  resolucion text check (resolucion is null or resolucion in ('ocultado', 'mostrado', 'descartada')),
  resuelta_por uuid references public.profiles(id) on delete set null,
  resuelta_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint blog_denuncias_un_objetivo check ((post_id is null) <> (comentario_id is null))
);
create unique index if not exists blog_denuncias_abierta_post
  on public.blog_denuncias (denunciante_id, post_id) where estado = 'abierta' and post_id is not null;
create unique index if not exists blog_denuncias_abierta_comentario
  on public.blog_denuncias (denunciante_id, comentario_id) where estado = 'abierta' and comentario_id is not null;

-- ───────────────────────────────────────────────────────────────
-- 2. LECTURA (RLS). Escrituras: solo por las funciones de abajo.
-- Las subconsultas a blog_posts / blog_comentarios dentro de las
-- políticas también pasan por su RLS, así que un posteo oculto arrastra
-- sus comentarios y "me gusta".
-- ───────────────────────────────────────────────────────────────
alter table public.blog_posts enable row level security;
alter table public.blog_comentarios enable row level security;
alter table public.blog_post_likes enable row level security;
alter table public.blog_comentario_likes enable row level security;
alter table public.blog_denuncias enable row level security;

drop policy if exists "Blog: posteos visibles" on public.blog_posts;
create policy "Blog: posteos visibles" on public.blog_posts for select to authenticated using (
  not oculto or autor_id = auth.uid() or public.fn_es_webmaster(auth.uid())
);
drop policy if exists "Blog: comentarios visibles" on public.blog_comentarios;
create policy "Blog: comentarios visibles" on public.blog_comentarios for select to authenticated using (
  exists (select 1 from public.blog_posts p where p.id = blog_comentarios.post_id)
  and (not oculto or autor_id = auth.uid() or public.fn_es_webmaster(auth.uid()))
);
drop policy if exists "Blog: me gusta de posteos visibles" on public.blog_post_likes;
create policy "Blog: me gusta de posteos visibles" on public.blog_post_likes for select to authenticated using (
  exists (select 1 from public.blog_posts p where p.id = blog_post_likes.post_id)
);
drop policy if exists "Blog: me gusta de comentarios visibles" on public.blog_comentario_likes;
create policy "Blog: me gusta de comentarios visibles" on public.blog_comentario_likes for select to authenticated using (
  exists (select 1 from public.blog_comentarios c where c.id = blog_comentario_likes.comentario_id)
);
drop policy if exists "Blog: denuncias propias o webmaster" on public.blog_denuncias;
create policy "Blog: denuncias propias o webmaster" on public.blog_denuncias for select to authenticated using (
  denunciante_id = auth.uid() or public.fn_es_webmaster(auth.uid())
);

-- ───────────────────────────────────────────────────────────────
-- 3. ALMACENAMIENTO: bucket privado 'blog'
-- Cada usuario sube solo dentro de su carpeta (<uid>/...). Lo lee
-- cualquier usuario con sesión; lo borra su dueño o un webmaster.
-- ───────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog', 'blog', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Blog: leer archivos con sesion" on storage.objects;
create policy "Blog: leer archivos con sesion" on storage.objects for select to authenticated
  using (bucket_id = 'blog');
drop policy if exists "Blog: subir a la carpeta propia" on storage.objects;
create policy "Blog: subir a la carpeta propia" on storage.objects for insert to authenticated
  with check (bucket_id = 'blog' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Blog: borrar archivos propios o webmaster" on storage.objects;
create policy "Blog: borrar archivos propios o webmaster" on storage.objects for delete to authenticated
  using (bucket_id = 'blog' and (owner = auth.uid() or public.fn_es_webmaster(auth.uid())));

-- ───────────────────────────────────────────────────────────────
-- 4. FUNCIONES INTERNAS
-- ───────────────────────────────────────────────────────────────

-- Valida imágenes / video de un posteo: archivos subidos por el mismo
-- usuario a su carpeta del bucket 'blog', del tipo y tamaño correctos y
-- sin usar en otro posteo; o un link de YouTube / Vimeo.
create or replace function public.fn_blog_validar_media(
  p_uid uuid, p_imagenes text[], p_video_path text, p_video_url text, p_post bigint
) returns void as $$
declare
  v_path text;
  v_obj record;
begin
  if cardinality(p_imagenes) > 4 then raise exception 'BLOG_DEMASIADAS_IMAGENES'; end if;
  if (select count(distinct x) from unnest(p_imagenes) x) <> cardinality(p_imagenes)
     or exists (select 1 from unnest(p_imagenes) x where x is null or x = '') then
    raise exception 'BLOG_MEDIA_INVALIDA';
  end if;
  if cardinality(p_imagenes) > 0 and (p_video_path is not null or p_video_url is not null) then
    raise exception 'BLOG_IMAGEN_O_VIDEO';
  end if;
  if p_video_path is not null and p_video_url is not null then raise exception 'BLOG_IMAGEN_O_VIDEO'; end if;

  for v_path in select x from unnest(p_imagenes || case when p_video_path is null then '{}'::text[] else array[p_video_path] end) x loop
    if v_path not like p_uid::text || '/%' then raise exception 'BLOG_ARCHIVO_INEXISTENTE'; end if;
    select o.metadata->>'mimetype' as mime, coalesce((o.metadata->>'size')::bigint, 0) as size
      into v_obj from storage.objects o
      where o.bucket_id = 'blog' and o.name = v_path and o.owner = p_uid;
    if not found then raise exception 'BLOG_ARCHIVO_INEXISTENTE'; end if;
    if v_path = p_video_path then
      if coalesce(v_obj.mime, '') not in ('video/mp4', 'video/webm') then raise exception 'BLOG_ARCHIVO_TIPO'; end if;
      if v_obj.size > 52428800 then raise exception 'BLOG_ARCHIVO_GRANDE'; end if;
    else
      if coalesce(v_obj.mime, '') not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif') then raise exception 'BLOG_ARCHIVO_TIPO'; end if;
      if v_obj.size > 5242880 then raise exception 'BLOG_ARCHIVO_GRANDE'; end if;
    end if;
    if exists (
      select 1 from public.blog_posts b
      where b.id <> coalesce(p_post, -1) and (v_path = any(b.imagenes) or b.video_path = v_path)
    ) then
      raise exception 'BLOG_ARCHIVO_EN_USO';
    end if;
  end loop;

  if p_video_url is not null and p_video_url !~ (
    '^https://(www\.|m\.)?(youtube\.com/(watch\?v=|shorts/|embed/)[A-Za-z0-9_-]{11}([?&#][^\s<>"]*)?'
    || '|youtu\.be/[A-Za-z0-9_-]{11}([?&#][^\s<>"]*)?'
    || '|vimeo\.com/[0-9]{3,12}([/?#][^\s<>"]*)?)$'
  ) then
    raise exception 'BLOG_VIDEO_URL_INVALIDA';
  end if;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Nombre con el que figura el autor de un posteo (para la bitácora).
create or replace function public.fn_blog_como(p_empresa bigint, p_uid uuid)
returns text as $$
  select coalesce(
    (select nombre from public.empresas where id = p_empresa),
    (select trim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) || ' (persona)' from public.profiles where id = p_uid));
$$ language sql stable security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 5. POSTEOS
-- ───────────────────────────────────────────────────────────────
create or replace function public.blog_publicar(
  p_empresa bigint, p_texto text, p_imagenes text[] default '{}',
  p_video_path text default null, p_video_url text default null
) returns public.blog_posts as $$
declare
  v_uid uuid := auth.uid();
  v_texto text := trim(coalesce(p_texto, ''));
  v_imgs text[] := coalesce(p_imagenes, '{}');
  v_vpath text := nullif(trim(coalesce(p_video_path, '')), '');
  v_vurl text := nullif(trim(coalesce(p_video_url, '')), '');
  v_row public.blog_posts;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if p_empresa is not null then
    if not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'EMPRESA_INEXISTENTE'; end if;
    if not public.fn_es_usuario_empresa(p_empresa, v_uid) then raise exception 'SIN_PERMISO_EMPRESA'; end if;
  end if;
  if v_texto = '' and cardinality(v_imgs) = 0 and v_vpath is null and v_vurl is null then raise exception 'BLOG_VACIO'; end if;
  if char_length(v_texto) > 5000 then raise exception 'BLOG_TEXTO_LARGO'; end if;
  perform public.fn_blog_validar_media(v_uid, v_imgs, v_vpath, v_vurl, null);
  -- Freno al envío masivo: hasta 10 posteos cada 10 minutos.
  if (select count(*) from public.blog_posts where autor_id = v_uid
        and created_at > timezone('utc'::text, now()) - interval '10 minutes') >= 10 then
    raise exception 'BLOG_DEMASIADO_RAPIDO';
  end if;
  insert into public.blog_posts (autor_id, empresa_id, texto, imagenes, video_path, video_url)
    values (v_uid, p_empresa, v_texto, v_imgs, v_vpath, v_vurl)
    returning * into v_row;
  perform public.fn_log('blog_post_publicado', 'blog_post', v_row.id::text, jsonb_build_object(
    'como', public.fn_blog_como(p_empresa, v_uid),
    'imagenes', cardinality(v_imgs), 'video', v_vpath is not null or v_vurl is not null));
  return v_row;
end;
$$ language plpgsql security definer set search_path = public;

-- Editar un posteo propio. Devuelve los archivos que dejó de usar para
-- que la página los borre del almacenamiento.
create or replace function public.blog_editar(
  p_post bigint, p_texto text, p_imagenes text[] default '{}',
  p_video_path text default null, p_video_url text default null
) returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_old public.blog_posts;
  v_row public.blog_posts;
  v_texto text := trim(coalesce(p_texto, ''));
  v_imgs text[] := coalesce(p_imagenes, '{}');
  v_vpath text := nullif(trim(coalesce(p_video_path, '')), '');
  v_vurl text := nullif(trim(coalesce(p_video_url, '')), '');
  v_quitados text[];
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  select * into v_old from public.blog_posts where id = p_post for update;
  if not found then raise exception 'BLOG_INEXISTENTE'; end if;
  if v_old.autor_id <> v_uid then raise exception 'BLOG_SIN_PERMISO'; end if;
  if v_old.oculto then raise exception 'BLOG_OCULTO'; end if;
  if v_texto = '' and cardinality(v_imgs) = 0 and v_vpath is null and v_vurl is null then raise exception 'BLOG_VACIO'; end if;
  if char_length(v_texto) > 5000 then raise exception 'BLOG_TEXTO_LARGO'; end if;
  perform public.fn_blog_validar_media(v_uid, v_imgs, v_vpath, v_vurl, p_post);
  v_quitados := array(
    select x from unnest(v_old.imagenes || case when v_old.video_path is null then '{}'::text[] else array[v_old.video_path] end) x
    where not (x = any(v_imgs)) and x is distinct from v_vpath);
  update public.blog_posts set texto = v_texto, imagenes = v_imgs, video_path = v_vpath, video_url = v_vurl,
      editado_at = timezone('utc'::text, now())
    where id = p_post returning * into v_row;
  perform public.fn_log('blog_post_editado', 'blog_post', p_post::text, jsonb_build_object(
    'como', public.fn_blog_como(v_row.empresa_id, v_uid)));
  return jsonb_build_object('post', to_jsonb(v_row), 'quitados', to_jsonb(v_quitados));
end;
$$ language plpgsql security definer set search_path = public;

-- Borrar: el autor, o un webmaster (moderación). Devuelve los archivos
-- del posteo para que la página los borre del almacenamiento.
create or replace function public.blog_borrar(p_post bigint)
returns text[] as $$
declare
  v_uid uuid := auth.uid();
  v_row public.blog_posts;
  v_wm boolean;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  select * into v_row from public.blog_posts where id = p_post for update;
  if not found then raise exception 'BLOG_INEXISTENTE'; end if;
  v_wm := public.fn_es_webmaster(v_uid);
  if v_row.autor_id <> v_uid and not v_wm then raise exception 'BLOG_SIN_PERMISO'; end if;
  delete from public.blog_posts where id = p_post;
  perform public.fn_log('blog_post_borrado', 'blog_post', p_post::text, jsonb_build_object(
    'como', public.fn_blog_como(v_row.empresa_id, v_row.autor_id),
    'moderacion', v_row.autor_id <> v_uid));
  return v_row.imagenes || case when v_row.video_path is null then '{}'::text[] else array[v_row.video_path] end;
end;
$$ language plpgsql security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 6. COMENTARIOS
-- ───────────────────────────────────────────────────────────────
create or replace function public.blog_comentar(p_post bigint, p_parent bigint, p_texto text)
returns public.blog_comentarios as $$
declare
  v_uid uuid := auth.uid();
  v_texto text := trim(coalesce(p_texto, ''));
  v_parent public.blog_comentarios;
  v_row public.blog_comentarios;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if not exists (select 1 from public.blog_posts where id = p_post and not oculto) then
    raise exception 'BLOG_NO_DISPONIBLE';
  end if;
  if p_parent is not null then
    select * into v_parent from public.blog_comentarios where id = p_parent;
    if not found or v_parent.post_id <> p_post or v_parent.parent_id is not null then
      raise exception 'BLOG_RESPUESTA_INVALIDA';
    end if;
    if v_parent.oculto then raise exception 'BLOG_NO_DISPONIBLE'; end if;
  end if;
  if v_texto = '' then raise exception 'MENSAJE_VACIO'; end if;
  if char_length(v_texto) > 2000 then raise exception 'BLOG_COMENTARIO_LARGO'; end if;
  if (select count(*) from public.blog_comentarios where autor_id = v_uid
        and created_at > timezone('utc'::text, now()) - interval '10 minutes') >= 30 then
    raise exception 'BLOG_DEMASIADO_RAPIDO';
  end if;
  insert into public.blog_comentarios (post_id, parent_id, autor_id, texto)
    values (p_post, p_parent, v_uid, v_texto) returning * into v_row;
  perform public.fn_log('blog_comentario', 'blog_post', p_post::text, jsonb_build_object(
    'comentario_id', v_row.id, 'respuesta', p_parent is not null));
  return v_row;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.blog_editar_comentario(p_comentario bigint, p_texto text)
returns public.blog_comentarios as $$
declare
  v_uid uuid := auth.uid();
  v_texto text := trim(coalesce(p_texto, ''));
  v_row public.blog_comentarios;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  select * into v_row from public.blog_comentarios where id = p_comentario for update;
  if not found then raise exception 'BLOG_INEXISTENTE'; end if;
  if v_row.autor_id <> v_uid then raise exception 'BLOG_SIN_PERMISO'; end if;
  if v_row.oculto then raise exception 'BLOG_OCULTO'; end if;
  if v_texto = '' then raise exception 'MENSAJE_VACIO'; end if;
  if char_length(v_texto) > 2000 then raise exception 'BLOG_COMENTARIO_LARGO'; end if;
  update public.blog_comentarios set texto = v_texto, editado_at = timezone('utc'::text, now())
    where id = p_comentario returning * into v_row;
  perform public.fn_log('blog_comentario_editado', 'blog_post', v_row.post_id::text, jsonb_build_object('comentario_id', v_row.id));
  return v_row;
end;
$$ language plpgsql security definer set search_path = public;

-- Borrar un comentario (y sus respuestas): el autor o un webmaster.
create or replace function public.blog_borrar_comentario(p_comentario bigint)
returns void as $$
declare
  v_uid uuid := auth.uid();
  v_row public.blog_comentarios;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  select * into v_row from public.blog_comentarios where id = p_comentario for update;
  if not found then raise exception 'BLOG_INEXISTENTE'; end if;
  if v_row.autor_id <> v_uid and not public.fn_es_webmaster(v_uid) then raise exception 'BLOG_SIN_PERMISO'; end if;
  delete from public.blog_comentarios where id = p_comentario;
  perform public.fn_log('blog_comentario_borrado', 'blog_post', v_row.post_id::text, jsonb_build_object(
    'comentario_id', v_row.id, 'autor', public.fn_blog_como(null, v_row.autor_id), 'moderacion', v_row.autor_id <> v_uid));
end;
$$ language plpgsql security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 7. ME GUSTA (alterna: si ya había, lo saca). Devuelve el estado final.
-- ───────────────────────────────────────────────────────────────
create or replace function public.blog_me_gusta(p_tipo text, p_id bigint)
returns boolean as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if p_tipo = 'post' then
    if not exists (select 1 from public.blog_posts where id = p_id and not oculto) then raise exception 'BLOG_NO_DISPONIBLE'; end if;
    if exists (select 1 from public.blog_post_likes where post_id = p_id and user_id = v_uid) then
      delete from public.blog_post_likes where post_id = p_id and user_id = v_uid;
      return false;
    end if;
    insert into public.blog_post_likes (post_id, user_id) values (p_id, v_uid) on conflict do nothing;
    return true;
  elsif p_tipo = 'comentario' then
    if not exists (
      select 1 from public.blog_comentarios c join public.blog_posts p on p.id = c.post_id
      where c.id = p_id and not c.oculto and not p.oculto
    ) then raise exception 'BLOG_NO_DISPONIBLE'; end if;
    if exists (select 1 from public.blog_comentario_likes where comentario_id = p_id and user_id = v_uid) then
      delete from public.blog_comentario_likes where comentario_id = p_id and user_id = v_uid;
      return false;
    end if;
    insert into public.blog_comentario_likes (comentario_id, user_id) values (p_id, v_uid) on conflict do nothing;
    return true;
  end if;
  raise exception 'ACCION_INVALIDA';
end;
$$ language plpgsql security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 8. DENUNCIAS Y MODERACIÓN
-- ───────────────────────────────────────────────────────────────
create or replace function public.blog_denunciar(p_tipo text, p_id bigint, p_motivo text)
returns public.blog_denuncias as $$
declare
  v_uid uuid := auth.uid();
  v_motivo text := trim(coalesce(p_motivo, ''));
  v_autor uuid;
  v_post bigint;
  v_row public.blog_denuncias;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if p_tipo = 'post' then
    select autor_id, id into v_autor, v_post from public.blog_posts where id = p_id and not oculto;
  elsif p_tipo = 'comentario' then
    select c.autor_id, c.post_id into v_autor, v_post from public.blog_comentarios c
      join public.blog_posts p on p.id = c.post_id where c.id = p_id and not c.oculto and not p.oculto;
  else
    raise exception 'ACCION_INVALIDA';
  end if;
  if v_autor is null then raise exception 'BLOG_NO_DISPONIBLE'; end if;
  if v_autor = v_uid then raise exception 'BLOG_DENUNCIA_PROPIA'; end if;
  if v_motivo = '' then raise exception 'BLOG_DENUNCIA_SIN_MOTIVO'; end if;
  if char_length(v_motivo) > 500 then raise exception 'BLOG_DENUNCIA_LARGA'; end if;
  if exists (select 1 from public.blog_denuncias where denunciante_id = v_uid and estado = 'abierta'
             and ((p_tipo = 'post' and post_id = p_id) or (p_tipo = 'comentario' and comentario_id = p_id))) then
    raise exception 'BLOG_YA_DENUNCIADO';
  end if;
  insert into public.blog_denuncias (post_id, comentario_id, denunciante_id, motivo)
    values (case when p_tipo = 'post' then p_id end, case when p_tipo = 'comentario' then p_id end, v_uid, v_motivo)
    returning * into v_row;
  perform public.fn_log('blog_denuncia', 'blog_post', v_post::text, jsonb_build_object(
    'tipo', p_tipo, 'id', p_id, 'autor', public.fn_blog_como(null, v_autor)));
  return v_row;
end;
$$ language plpgsql security definer set search_path = public;

-- Webmaster: ocultar o volver a mostrar un posteo o comentario. Cierra
-- las denuncias abiertas sobre ese contenido.
create or replace function public.blog_moderar(p_tipo text, p_id bigint, p_accion text, p_motivo text default null)
returns void as $$
declare
  v_uid uuid := auth.uid();
  v_oculto boolean;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_autor uuid;
  v_post bigint;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if not public.fn_es_webmaster(v_uid) then raise exception 'SOLO_WEBMASTER'; end if;
  if coalesce(p_accion, '') not in ('ocultar', 'mostrar') then raise exception 'ACCION_INVALIDA'; end if;
  if char_length(coalesce(v_motivo, '')) > 500 then raise exception 'BLOG_DENUNCIA_LARGA'; end if;
  v_oculto := p_accion = 'ocultar';
  if p_tipo = 'post' then
    update public.blog_posts set oculto = v_oculto,
        oculto_por = case when v_oculto then v_uid end, oculto_at = case when v_oculto then timezone('utc'::text, now()) end,
        oculto_motivo = case when v_oculto then v_motivo end
      where id = p_id returning autor_id, id into v_autor, v_post;
    if v_autor is null then raise exception 'BLOG_INEXISTENTE'; end if;
    update public.blog_denuncias set estado = 'resuelta', resolucion = case when v_oculto then 'ocultado' else 'mostrado' end,
        resuelta_por = v_uid, resuelta_at = timezone('utc'::text, now())
      where post_id = p_id and estado = 'abierta';
  elsif p_tipo = 'comentario' then
    update public.blog_comentarios set oculto = v_oculto,
        oculto_por = case when v_oculto then v_uid end, oculto_at = case when v_oculto then timezone('utc'::text, now()) end,
        oculto_motivo = case when v_oculto then v_motivo end
      where id = p_id returning autor_id, post_id into v_autor, v_post;
    if v_autor is null then raise exception 'BLOG_INEXISTENTE'; end if;
    update public.blog_denuncias set estado = 'resuelta', resolucion = case when v_oculto then 'ocultado' else 'mostrado' end,
        resuelta_por = v_uid, resuelta_at = timezone('utc'::text, now())
      where comentario_id = p_id and estado = 'abierta';
  else
    raise exception 'ACCION_INVALIDA';
  end if;
  perform public.fn_log('blog_moderacion', 'blog_post', v_post::text, jsonb_build_object(
    'tipo', p_tipo, 'id', p_id, 'accion', p_accion, 'autor', public.fn_blog_como(null, v_autor), 'motivo', v_motivo));
end;
$$ language plpgsql security definer set search_path = public;

-- Webmaster: descartar una denuncia sin tocar el contenido.
create or replace function public.blog_descartar_denuncia(p_denuncia bigint)
returns void as $$
declare
  v_uid uuid := auth.uid();
  v_row public.blog_denuncias;
begin
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if not public.fn_es_webmaster(v_uid) then raise exception 'SOLO_WEBMASTER'; end if;
  update public.blog_denuncias set estado = 'resuelta', resolucion = 'descartada',
      resuelta_por = v_uid, resuelta_at = timezone('utc'::text, now())
    where id = p_denuncia and estado = 'abierta' returning * into v_row;
  if not found then raise exception 'BLOG_INEXISTENTE'; end if;
  perform public.fn_log('blog_denuncia_descartada', 'blog_denuncia', p_denuncia::text, jsonb_build_object(
    'tipo', case when v_row.post_id is not null then 'post' else 'comentario' end,
    'id', coalesce(v_row.post_id, v_row.comentario_id)));
end;
$$ language plpgsql security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 9. PERMISOS
-- ───────────────────────────────────────────────────────────────
revoke execute on function public.fn_blog_validar_media(uuid, text[], text, text, bigint) from public, anon, authenticated;
revoke execute on function public.fn_blog_como(bigint, uuid) from public, anon, authenticated;
revoke execute on function public.blog_publicar(bigint, text, text[], text, text) from public, anon;
revoke execute on function public.blog_editar(bigint, text, text[], text, text) from public, anon;
revoke execute on function public.blog_borrar(bigint) from public, anon;
revoke execute on function public.blog_comentar(bigint, bigint, text) from public, anon;
revoke execute on function public.blog_editar_comentario(bigint, text) from public, anon;
revoke execute on function public.blog_borrar_comentario(bigint) from public, anon;
revoke execute on function public.blog_me_gusta(text, bigint) from public, anon;
revoke execute on function public.blog_denunciar(text, bigint, text) from public, anon;
revoke execute on function public.blog_moderar(text, bigint, text, text) from public, anon;
revoke execute on function public.blog_descartar_denuncia(bigint) from public, anon;

grant execute on function public.blog_publicar(bigint, text, text[], text, text) to authenticated;
grant execute on function public.blog_editar(bigint, text, text[], text, text) to authenticated;
grant execute on function public.blog_borrar(bigint) to authenticated;
grant execute on function public.blog_comentar(bigint, bigint, text) to authenticated;
grant execute on function public.blog_editar_comentario(bigint, text) to authenticated;
grant execute on function public.blog_borrar_comentario(bigint) to authenticated;
grant execute on function public.blog_me_gusta(text, bigint) to authenticated;
grant execute on function public.blog_denunciar(text, bigint, text) to authenticated;
grant execute on function public.blog_moderar(text, bigint, text, text) to authenticated;
grant execute on function public.blog_descartar_denuncia(bigint) to authenticated;

grant select on public.blog_posts, public.blog_comentarios, public.blog_post_likes,
  public.blog_comentario_likes, public.blog_denuncias to authenticated;
revoke all on public.blog_posts, public.blog_comentarios, public.blog_post_likes,
  public.blog_comentario_likes, public.blog_denuncias from anon;
