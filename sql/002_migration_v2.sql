-- ═══════════════════════════════════════════════════════════════
-- MIGRACIÓN A CORRER UNA SOLA VEZ en el SQL Editor de Supabase.
-- Tu proyecto ya tiene el esquema original (profiles + empresas +
-- RLS + trigger). Esto SOLO agrega lo nuevo que necesita la app:
--   1) columna email en profiles (para el directorio de graduados)
--   2) backfill de email para usuarios ya registrados
--   3) trigger actualizado para guardar el email en el alta
--   4) bucket de Storage "logos" (público) + políticas
-- Es seguro correrlo más de una vez (usa IF NOT EXISTS / OR REPLACE).
-- ═══════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

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

-- Recordatorio: para hacerte admin (una vez que te registres en la app):
-- update public.profiles set role = 'admin' where email = 'tu-email@ejemplo.com';
