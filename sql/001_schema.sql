-- ═══════════════════════════════════════════════════════════════
-- CUPFI · Red de Vinculación Empresarial FI-UNLZ
-- Esquema completo de base de datos (idempotente).
-- Este archivo documenta el estado deseado completo del proyecto.
-- Si tu proyecto de Supabase ya tiene el esquema original, NO
-- vuelvas a correr este archivo entero: usá 002_migration_v2.sql,
-- que solo agrega lo nuevo (email en profiles + bucket de logos).
-- ═══════════════════════════════════════════════════════════════

-- USUARIOS (extiende la autenticación de Supabase)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  nombre text not null,
  apellido text not null,
  email text,
  tel text,
  role text default 'user' check (role in ('user','admin')),
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
create policy "Cada usuario edita su propio perfil"
  on public.profiles for update
  to authenticated using (auth.uid() = id);

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

-- ADMIN por defecto: se asigna manualmente desde el dashboard con:
-- update public.profiles set role = 'admin' where email = 'tu-email@fi.unlz.edu.ar';
