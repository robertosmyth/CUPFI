-- ═══════════════════════════════════════════════════════════════
-- MIGRACIÓN: permitir que los administradores cambien el rol de
-- otros usuarios desde el panel Admin de la app.
--
-- sql/003_lockdown_role_and_uid.sql bloqueó TODO cambio de rol desde
-- el cliente (para cerrar la auto-escalación de privilegios). En ese
-- momento todavía no existía una función de gestión de usuarios, así
-- que la restricción era total. Ahora que se agrega esa función, hay
-- que habilitar el cambio de rol PERO solo cuando quien lo hace ya es
-- admin. Un usuario común sigue sin poder tocar su propio rol ni el
-- de nadie.
--
-- Correr una sola vez en el SQL Editor de Supabase (después de haber
-- corrido 003_lockdown_role_and_uid.sql).
-- ═══════════════════════════════════════════════════════════════

-- 1) La política de UPDATE de profiles debe permitir que un admin
--    actualice CUALQUIER perfil, no solo el propio (para poder
--    cambiarle el rol a otro usuario).
drop policy if exists "Cada usuario edita su propio perfil" on public.profiles;
drop policy if exists "Cada usuario edita su propio perfil o admin edita cualquiera" on public.profiles;
create policy "Cada usuario edita su propio perfil o admin edita cualquiera"
  on public.profiles for update
  to authenticated using (
    auth.uid() = id or
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- 2) El trigger que protege la columna "role" ahora permite el cambio
--    SOLO si quien ejecuta la actualización ya es admin. Cualquier
--    otro intento de cambiar el rol (propio o ajeno) se sigue ignorando
--    en silencio, igual que antes.
create or replace function public.prevent_role_change()
returns trigger as $$
begin
  if NEW.role is distinct from OLD.role then
    if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
      NEW.role := OLD.role;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;
-- (el trigger en sí ya fue creado por 003_lockdown_role_and_uid.sql;
-- este CREATE OR REPLACE solo actualiza el comportamiento de la función)
