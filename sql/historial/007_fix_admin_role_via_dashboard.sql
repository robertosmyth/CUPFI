-- ═══════════════════════════════════════════════════════════════
-- FIX: permitir cambiar profiles.role directamente desde el
-- Table Editor / SQL Editor de Supabase (como superusuario).
--
-- Síntoma que soluciona: al editar la fila de un usuario en el
-- Table Editor y poner role = 'admin', el valor se revertía solo a
-- 'user' sin ningún error visible.
--
-- Causa: el trigger prevent_role_change_trigger (sql/003 y 004)
-- solo permite el cambio si auth.uid() corresponde a un admin. Pero
-- una edición hecha directamente en el SQL Editor / Table Editor de
-- Supabase corre como superusuario (postgres), sin sesión de
-- PostgREST: ahí auth.uid() es NULL. El trigger interpretaba "no es
-- admin" y revertía el cambio, aunque en los hechos quien edita ahí
-- ya tiene control total de la base (acceso al dashboard).
--
-- Corrre esto una sola vez en el SQL Editor de Supabase. No afecta
-- la protección contra auto-escalación desde la app: un usuario
-- común autenticado sigue sin poder tocar su propio rol ni el de
-- otros (auth.uid() ahí SIEMPRE es su propio id, nunca NULL).
-- ═══════════════════════════════════════════════════════════════

create or replace function public.prevent_role_change()
returns trigger as $$
begin
  if NEW.role is distinct from OLD.role then
    -- auth.uid() es NULL cuando la edición viene del SQL Editor /
    -- Table Editor de Supabase (superusuario) en vez de la app: en
    -- ese caso confiamos en el cambio, porque solo el dueño del
    -- proyecto tiene acceso a esa consola.
    if auth.uid() is not null
       and not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
      NEW.role := OLD.role;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;
