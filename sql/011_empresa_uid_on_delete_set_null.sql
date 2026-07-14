-- ═══════════════════════════════════════════════════════════════
-- FIX: no borrar una empresa entera si se borra la cuenta de su
-- administrador principal.
--
-- Problema: empresas.uid tiene "on delete cascade" contra profiles. Si
-- alguna vez se borra la cuenta de un usuario desde el dashboard de
-- Supabase (Authentication → Users; es la única forma de borrar cuentas,
-- ver README), Postgres borra en cascada TODAS las empresas de las que
-- era administrador principal — incluso si esa empresa tenía otros
-- usuarios asociados (empresa_usuarios) que todavía la necesitaban. Se
-- pierden datos que nadie pidió borrar.
--
-- Solución: "on delete set null" en vez de "on delete cascade". La
-- empresa sobrevive y queda "sin administrador principal asignado" — un
-- estado que la app ya soporta (Admin → Usuarios asociados →
-- reasignarDueno con null), así que no hace falta ningún cambio de
-- código para esto.
--
-- Correr una sola vez en el SQL Editor de Supabase. No borra ni modifica
-- datos existentes, solo cambia el comportamiento futuro de la foreign
-- key.
-- ═══════════════════════════════════════════════════════════════

alter table public.empresas drop constraint if exists empresas_uid_fkey;
alter table public.empresas
  add constraint empresas_uid_fkey
  foreign key (uid) references public.profiles(id)
  on delete set null;
