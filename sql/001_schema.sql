-- ═══════════════════════════════════════════════════════════════
-- CUPFI · Red de Vinculación Empresarial FI-UNLZ
-- Esquema completo de base de datos (idempotente).
-- Este archivo documenta el estado deseado completo del proyecto.
-- Si tu proyecto de Supabase ya tiene el esquema original, NO
-- vuelvas a correr este archivo entero: usá 002_migration_v2.sql,
-- que solo agrega lo nuevo (email en profiles + bucket de logos).
-- ═══════════════════════════════════════════════════════════════

-- ROLES: tabla de referencia (normaliza profiles.role)
create table if not exists public.roles (
  name text primary key,
  descripcion text not null
);

insert into public.roles (name, descripcion) values
  ('user',  'Graduado con acceso estándar: puede cargar y editar sus propias empresas.'),
  ('admin', 'Puede gestionar usuarios (cambiar roles) y editar o borrar cualquier empresa.')
on conflict (name) do nothing;

alter table public.roles enable row level security;

drop policy if exists "Roles visibles para todos los autenticados" on public.roles;
create policy "Roles visibles para todos los autenticados"
  on public.roles for select
  to authenticated using (true);

-- USUARIOS (extiende la autenticación de Supabase)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  nombre text not null,
  apellido text not null,
  email text,
  tel text,
  role text default 'user' references public.roles(name) on update cascade,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- EMPRESAS
create table if not exists public.empresas (
  id bigserial primary key,
  -- on delete SET NULL (no cascade): si se borra la cuenta del
  -- administrador principal, la empresa queda "sin administrador principal
  -- asignado" (estado ya soportado desde el panel Admin) en vez de
  -- desaparecer junto con los usuarios asociados que todavía la necesitan.
  uid uuid references public.profiles(id) on delete set null,
  cuit text unique not null,
  tipo text default 'Empresa',
  nombre text not null,
  sector text,
  calle text,
  ciudad text,
  provincia text,
  pais text default 'Argentina',
  referente text,
  cargo text,
  email_org text,
  tel text,
  web text,
  descripcion text,
  logo text,
  ofertas text[] default '{}',
  instalaciones text[] default '{}',
  needs_uncovered text[] default '{}',
  needs_covered text[] default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- SEGURIDAD: Row Level Security
alter table public.profiles enable row level security;
alter table public.empresas enable row level security;

-- POLÍTICAS PARA PROFILES
drop policy if exists "Profiles visibles para todos los autenticados" on public.profiles;
create policy "Profiles visibles para todos los autenticados"
  on public.profiles for select
  to authenticated using (true);

drop policy if exists "Cada usuario edita su propio perfil" on public.profiles;
drop policy if exists "Cada usuario edita su propio perfil o admin edita cualquiera" on public.profiles;
create policy "Cada usuario edita su propio perfil o admin edita cualquiera"
  on public.profiles for update
  to authenticated using (
    auth.uid() = id or
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Insert propio perfil" on public.profiles;
create policy "Insert propio perfil"
  on public.profiles for insert
  to authenticated with check (auth.uid() = id);

-- POLÍTICAS PARA EMPRESAS
drop policy if exists "Empresas visibles para todos los autenticados" on public.empresas;
create policy "Empresas visibles para todos los autenticados"
  on public.empresas for select
  to authenticated using (true);

drop policy if exists "Usuarios crean sus propias empresas" on public.empresas;
create policy "Usuarios crean sus propias empresas"
  on public.empresas for insert
  to authenticated with check (auth.uid() = uid);

drop policy if exists "Usuarios editan sus propias empresas" on public.empresas;
create policy "Usuarios editan sus propias empresas"
  on public.empresas for update
  to authenticated using (
    auth.uid() = uid or
    exists (select 1 from public.empresa_usuarios where empresa_id = empresas.id and user_id = auth.uid()) or
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Usuarios eliminan sus propias empresas" on public.empresas;
create policy "Usuarios eliminan sus propias empresas"
  on public.empresas for delete
  to authenticated using (
    auth.uid() = uid or
    exists (select 1 from public.empresa_usuarios where empresa_id = empresas.id and user_id = auth.uid()) or
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- FUNCIÓN: crear perfil automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, nombre, apellido, tel, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'apellido', ''),
    coalesce(new.raw_user_meta_data->>'tel', ''),
    new.email
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- TRIGGER: ejecutar función al crear usuario
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- STORAGE: bucket público para logos de empresas
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

drop policy if exists "Logos publicos de lectura" on storage.objects;
create policy "Logos publicos de lectura"
  on storage.objects for select
  to public
  using (bucket_id = 'logos');

drop policy if exists "Usuarios autenticados suben logos" on storage.objects;
create policy "Usuarios autenticados suben logos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'logos');

drop policy if exists "Usuarios autenticados actualizan sus logos" on storage.objects;
create policy "Usuarios autenticados actualizan sus logos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'logos' and owner = auth.uid());

drop policy if exists "Usuarios autenticados borran sus logos" on storage.objects;
create policy "Usuarios autenticados borran sus logos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'logos' and owner = auth.uid());

-- SEGURIDAD: nadie puede auto-promoverse a admin ni "transferir" una
-- empresa cambiando quién es su administrador principal desde el cliente.
-- Un admin sí puede cambiar
-- el rol de otros usuarios (panel Admin de la app) porque la condición
-- de abajo lo permite explícitamente. auth.uid() es NULL cuando el
-- cambio se hace directamente desde el SQL Editor / Table Editor de
-- Supabase (superusuario): en ese caso se permite siempre, porque solo
-- el dueño del proyecto tiene acceso a esa consola.
create or replace function public.prevent_role_change()
returns trigger as $$
begin
  if NEW.role is distinct from OLD.role then
    if auth.uid() is not null
       and not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
      NEW.role := OLD.role;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists prevent_role_change_trigger on public.profiles;
create trigger prevent_role_change_trigger
  before update on public.profiles
  for each row execute procedure public.prevent_role_change();

create or replace function public.prevent_empresa_uid_change()
returns trigger as $$
begin
  if NEW.uid is distinct from OLD.uid then
    if auth.uid() is not null
       and not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
      NEW.uid := OLD.uid;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists prevent_empresa_uid_change_trigger on public.empresas;
create trigger prevent_empresa_uid_change_trigger
  before update on public.empresas
  for each row execute procedure public.prevent_empresa_uid_change();

-- MANTENIMIENTO: mantener empresas.updated_at al día en cada edición.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  NEW.updated_at := timezone('utc'::text, now());
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists set_empresas_updated_at on public.empresas;
create trigger set_empresas_updated_at
  before update on public.empresas
  for each row execute procedure public.set_updated_at();

-- ASOCIACIÓN empresa <-> usuario: además del administrador principal
-- (empresas.uid), una empresa puede tener otros usuarios asociados
-- que también pueden editarla (por ejemplo varios socios con
-- cuentas separadas). Gestionado por un admin desde el panel.
create table if not exists public.empresa_usuarios (
  empresa_id bigint not null references public.empresas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  primary key (empresa_id, user_id)
);

alter table public.empresa_usuarios enable row level security;

drop policy if exists "Ver asociaciones empresa-usuario" on public.empresa_usuarios;
create policy "Ver asociaciones empresa-usuario"
  on public.empresa_usuarios for select
  to authenticated using (true);

drop policy if exists "Solo admin gestiona asociaciones" on public.empresa_usuarios;
create policy "Solo admin gestiona asociaciones"
  on public.empresa_usuarios for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- USUARIOS: evita duplicados por nombre+apellido, email o teléfono
-- móvil (ver sql/010_unique_profile_constraints.sql para más detalle
-- de por qué existe cada pieza).
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

-- ADMIN por defecto: se asigna manualmente desde el dashboard con:
-- update public.profiles set role = 'admin' where email = 'tu-email@fi.unlz.edu.ar';
