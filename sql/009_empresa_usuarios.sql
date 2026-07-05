-- ═══════════════════════════════════════════════════════════════
-- 1) Permitir que un admin reasigne el administrador principal de una
--    empresa (empresas.uid). Hasta ahora el trigger lo bloqueaba
--    SIEMPRE, sin excepción para admins (a diferencia del trigger
--    equivalente de profiles.role, que sql/004 ya había corregido).
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 2) Tabla de relación empresa ↔ usuario: una empresa puede tener
--    además del administrador principal (empresas.uid) otros usuarios
--    asociados que también pueden editarla (por ejemplo, varios
--    socios de una misma empresa con cuentas separadas).
-- ═══════════════════════════════════════════════════════════════
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

-- Solo un admin puede asociar/desasociar usuarios a una empresa.
drop policy if exists "Solo admin gestiona asociaciones" on public.empresa_usuarios;
create policy "Solo admin gestiona asociaciones"
  on public.empresa_usuarios for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ═══════════════════════════════════════════════════════════════
-- 3) Los usuarios asociados (no solo el administrador principal) también
--    pueden editar / eliminar la empresa.
-- ═══════════════════════════════════════════════════════════════
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
