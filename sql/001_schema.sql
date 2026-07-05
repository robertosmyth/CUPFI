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
  uid uuid references public.profiles(id) on delete cascade,
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
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Usuarios eliminan sus propias empresas" on public.empresas;
create policy "Usuarios eliminan sus propias empresas"
  on public.empresas for delete
  to authenticated using (
    auth.uid() = uid or
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
-- empresa cambiando su dueño desde el cliente. Un admin sí puede cambiar
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
  NEW.uid := OLD.uid;
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

-- ADMIN por defecto: se asigna manualmente desde el dashboard con:
-- update public.profiles set role = 'admin' where email = 'tu-email@fi.unlz.edu.ar';
