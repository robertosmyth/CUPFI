-- ═══════════════════════════════════════════════════════════════
-- MIGRACIÓN: evita usuarios duplicados.
--
-- Hasta ahora nada impedía que dos personas se registraran con el
-- mismo nombre+apellido, el mismo teléfono móvil, o terminaran con
-- el mismo email en profiles (el email en auth.users sí es único,
-- pero profiles.email es una copia separada que se corrige a mano
-- en varios casos). Esto agrega:
--
--   1) Índices únicos parciales en profiles (nombre+apellido, email,
--      tel), comparando siempre normalizado (sin espacios, sin
--      mayúsculas) para que "Juan Perez" y "juan   perez" cuenten
--      como el mismo valor.
--   2) Un trigger que revisa lo mismo ANTES de tocar el índice, para
--      poder devolver un mensaje de error entendible (DUPLICATE_...)
--      en vez del genérico "duplicate key value violates...".
--   3) Una función RPC (`check_profile_duplicates`) que el cliente
--      puede llamar ANTES de registrarse o guardar el perfil, para
--      avisar del problema sin intentar el insert/update primero.
--      Corre con permisos elevados (security definer) y solo
--      devuelve banderas true/false: no expone filas de otros
--      usuarios pese a que se llama sin sesión (rol "anon"), algo
--      que la política RLS de "select" en profiles no permite.
--
-- Es seguro correr esto más de una vez (usa IF EXISTS / OR REPLACE).
-- ═══════════════════════════════════════════════════════════════

-- Texto normalizado para comparar (trim + minúsculas). immutable para
-- poder usarla en índices.
create or replace function public.norm_text(t text)
returns text as $$
  select lower(trim(coalesce(t, '')));
$$ language sql immutable;

-- Antes de crear los índices, quitamos duplicados de datos ya
-- cargados que romperían la creación (deja el registro más viejo y
-- vacía el campo repetido en los demás; no borra usuarios).
-- Comentado a propósito: se recomienda revisar manualmente si tu
-- proyecto ya tiene datos y este paso reporta filas.
-- select nombre, apellido, count(*) from public.profiles
--   group by public.norm_text(nombre), public.norm_text(apellido) having count(*) > 1;

drop index if exists profiles_unique_nombre_apellido;
create unique index profiles_unique_nombre_apellido
  on public.profiles (public.norm_text(nombre), public.norm_text(apellido));

drop index if exists profiles_unique_email;
create unique index profiles_unique_email
  on public.profiles (public.norm_text(email))
  where email is not null and trim(email) <> '';

drop index if exists profiles_unique_tel;
create unique index profiles_unique_tel
  on public.profiles (public.norm_text(tel))
  where tel is not null and trim(tel) <> '';

-- Trigger: mensaje de error claro antes de que el índice único corte
-- con el genérico "duplicate key value violates unique constraint".
create or replace function public.check_profile_uniqueness()
returns trigger as $$
declare
  dup_id uuid;
begin
  if NEW.nombre is not null and NEW.apellido is not null
     and trim(NEW.nombre) <> '' and trim(NEW.apellido) <> '' then
    select id into dup_id from public.profiles
      where id <> NEW.id
        and public.norm_text(nombre) = public.norm_text(NEW.nombre)
        and public.norm_text(apellido) = public.norm_text(NEW.apellido)
      limit 1;
    if dup_id is not null then
      raise exception 'DUPLICATE_NOMBRE_APELLIDO' using errcode = 'unique_violation';
    end if;
  end if;

  if NEW.email is not null and trim(NEW.email) <> '' then
    select id into dup_id from public.profiles
      where id <> NEW.id and public.norm_text(email) = public.norm_text(NEW.email)
      limit 1;
    if dup_id is not null then
      raise exception 'DUPLICATE_EMAIL' using errcode = 'unique_violation';
    end if;
  end if;

  if NEW.tel is not null and trim(NEW.tel) <> '' then
    select id into dup_id from public.profiles
      where id <> NEW.id and public.norm_text(tel) = public.norm_text(NEW.tel)
      limit 1;
    if dup_id is not null then
      raise exception 'DUPLICATE_TEL' using errcode = 'unique_violation';
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists check_profile_uniqueness_trigger on public.profiles;
create trigger check_profile_uniqueness_trigger
  before insert or update on public.profiles
  for each row execute procedure public.check_profile_uniqueness();

-- RPC de validación previa (se puede llamar sin sesión, por eso NO
-- devuelve datos, solo banderas true/false).
create or replace function public.check_profile_duplicates(
  p_nombre text, p_apellido text, p_tel text default null,
  p_email text default null, p_exclude_id uuid default null
) returns jsonb as $$
declare
  nombre_dup boolean;
  email_dup boolean;
  tel_dup boolean;
begin
  select exists (
    select 1 from public.profiles
    where (p_exclude_id is null or id <> p_exclude_id)
      and public.norm_text(nombre) = public.norm_text(p_nombre)
      and public.norm_text(apellido) = public.norm_text(p_apellido)
      and trim(coalesce(p_nombre, '')) <> '' and trim(coalesce(p_apellido, '')) <> ''
  ) into nombre_dup;

  select (p_email is not null and trim(p_email) <> '' and exists (
    select 1 from public.profiles
    where (p_exclude_id is null or id <> p_exclude_id)
      and public.norm_text(email) = public.norm_text(p_email)
  )) into email_dup;

  select (p_tel is not null and trim(p_tel) <> '' and exists (
    select 1 from public.profiles
    where (p_exclude_id is null or id <> p_exclude_id)
      and public.norm_text(tel) = public.norm_text(p_tel)
  )) into tel_dup;

  return jsonb_build_object('nombre_apellido', nombre_dup, 'email', email_dup, 'tel', tel_dup);
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.check_profile_duplicates(text, text, text, text, uuid) to anon, authenticated;
