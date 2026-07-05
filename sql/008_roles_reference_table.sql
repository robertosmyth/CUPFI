-- ═══════════════════════════════════════════════════════════════
-- NORMALIZACIÓN: tabla de referencia para los roles existentes.
--
-- Antes: profiles.role era un texto libre limitado por un
-- check (role in ('user','admin')). Funciona, pero no es una
-- normalización "de verdad" (no hay tabla, no se puede agregar
-- descripción, no se puede consultar la lista de roles válidos con
-- una simple consulta a una tabla).
--
-- Ahora: se crea public.roles con una fila por rol, y profiles.role
-- pasa a ser una foreign key contra esa tabla en lugar de un check.
-- No cambia el tipo de dato (sigue siendo texto: 'user' / 'admin'),
-- así que no hace falta tocar nada del código de la app: todo el
-- JS que lee o escribe profiles.role sigue funcionando igual.
--
-- Corré esto una sola vez en el SQL Editor de Supabase, después de
-- 003 y 004.
-- ═══════════════════════════════════════════════════════════════

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

-- Reemplaza el check constraint por una foreign key real.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_role_fkey;
alter table public.profiles
  add constraint profiles_role_fkey
  foreign key (role) references public.roles(name)
  on update cascade;

alter table public.profiles alter column role set default 'user';
