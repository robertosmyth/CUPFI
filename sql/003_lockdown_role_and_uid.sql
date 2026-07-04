-- ═══════════════════════════════════════════════════════════════
-- MIGRACIÓN: cerrar un hueco de seguridad en las políticas RLS.
--
-- Problema: las políticas de UPDATE de "profiles" y "empresas" solo
-- controlan QUIÉN puede editar una fila (auth.uid() = id / uid),
-- pero no QUÉ columnas puede cambiar. Eso permite que, técnicamente,
-- cualquier usuario autenticado llame directamente a la API de
-- Supabase (por ejemplo desde la consola del navegador, sin pasar
-- por la interfaz de la app) y:
--   a) ponga role = 'admin' en su propio perfil (auto-escalación), o
--   b) cambie el uid de una empresa para "transferirla" a otro dueño.
--
-- Solución: dos triggers BEFORE UPDATE que ignoran cualquier intento
-- de cambiar esas dos columnas desde el cliente. A partir de ahora,
-- el único lugar donde se puede cambiar el rol de un usuario es el
-- SQL Editor / Table Editor del dashboard de Supabase (que corre
-- como superusuario y no pasa por RLS ni por estos triggers).
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ═══════════════════════════════════════════════════════════════

-- PROFILES: nadie puede cambiar su propio rol (ni el de otros) desde el cliente
create or replace function public.prevent_role_change()
returns trigger as $$
begin
  if NEW.role is distinct from OLD.role then
    NEW.role := OLD.role;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists prevent_role_change_trigger on public.profiles;
create trigger prevent_role_change_trigger
  before update on public.profiles
  for each row execute procedure public.prevent_role_change();

-- EMPRESAS: nadie puede "transferir" una empresa cambiando su uid desde el cliente
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

-- Para cambiar el rol de un usuario (hacerlo admin o sacarle el admin),
-- seguí usando el dashboard:
-- update public.profiles set role = 'admin' where email = 'alguien@ejemplo.com';
