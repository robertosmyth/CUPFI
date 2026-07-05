-- ═══════════════════════════════════════════════════════════════
-- MIGRACIÓN: mantener empresas.updated_at al día automáticamente.
--
-- La columna existía en el esquema desde el principio pero nada la
-- actualizaba: quedaba siempre con la fecha de creación, aunque la
-- empresa se hubiera editado después. Esto es útil para saber qué
-- empresas tienen datos más recientes (por ejemplo, para priorizar
-- cuáles mostrar primero o para detectar perfiles desactualizados).
--
-- Correr una sola vez en el SQL Editor de Supabase.
-- ═══════════════════════════════════════════════════════════════

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
