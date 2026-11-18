-- ═══════════════════════════════════════════════════════════════
-- CUPFI · Normas de seguridad y datos personales
-- (ISO/IEC 27001-27002, OWASP ASVS, Ley 25.326)
--
-- Se corre DESPUÉS de sql/014_blog.sql. Es idempotente.
--
-- 1. Datos de contacto personales (email y teléfono de los usuarios):
--    ya no se leen directo de la tabla. Cada usuario ve los suyos; admins
--    y webmasters ven todos; el resto solo los de las personas con las
--    que tiene una vinculación (match) o una solicitud ACEPTADA.
-- 2. El email del perfil solo puede ser el email real de la cuenta.
-- 3. Links de empresas: solo http/https (bloquea "javascript:" y otros).
-- 4. Bucket de logos: tamaño y tipos de imagen limitados en el servidor
--    y cada usuario sube solo a su carpeta.
-- 5. Claves temporales: aviso para sugerir el cambio.
-- 6. Bitácora: cambio de contraseña y cierre por inactividad.
-- 7. Defensa en profundidad: el rol anónimo no tiene permisos sobre las
--    tablas (igual ya lo bloqueaba RLS).
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1. CONTACTO PERSONAL
-- ───────────────────────────────────────────────────────────────
revoke select on public.profiles from authenticated;
grant select (id, nombre, apellido, role, created_at, is_webmaster, guia_vista) on public.profiles to authenticated;

-- ¿p_uid puede ver el email/teléfono de p_otro?
create or replace function public.fn_puede_ver_contacto(p_uid uuid, p_otro uuid)
returns boolean as $$
  select p_uid is not null and (
    p_uid = p_otro
    or public.fn_es_admin(p_uid)
    or public.fn_es_webmaster(p_uid)
    -- vinculación (match) aceptada por las dos empresas
    or exists (
      select 1 from public.conexiones c
      where c.match_at is not null and c.rechazada_at is null
        and (
          (p_uid in (select public.fn_usuarios_empresa(c.empresa_necesita_id))
            and p_otro in (select public.fn_usuarios_empresa(c.empresa_ofrece_id)))
          or (p_uid in (select public.fn_usuarios_empresa(c.empresa_ofrece_id))
            and p_otro in (select public.fn_usuarios_empresa(c.empresa_necesita_id)))
        )
    )
    -- solicitud aceptada (de una empresa o de una persona a una empresa)
    or exists (
      select 1 from public.solicitudes s
      where s.estado = 'aceptada'
        and (
          ((s.origen_persona_id = p_uid or p_uid in (select public.fn_usuarios_empresa(s.origen_empresa_id)))
            and p_otro in (select public.fn_usuarios_empresa(s.destino_empresa_id)))
          or (p_uid in (select public.fn_usuarios_empresa(s.destino_empresa_id))
            and (s.origen_persona_id = p_otro or p_otro in (select public.fn_usuarios_empresa(s.origen_empresa_id))))
        )
    )
  );
$$ language sql stable security definer set search_path = public;

-- Email y teléfono de los perfiles que el usuario actual puede ver.
create or replace function public.perfiles_contacto()
returns table (id uuid, email text, tel text) as $$
  select p.id, p.email, p.tel from public.profiles p
  where auth.uid() is not null and public.fn_puede_ver_contacto(auth.uid(), p.id);
$$ language sql stable security definer set search_path = public;

revoke execute on function public.fn_puede_ver_contacto(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.perfiles_contacto() from public, anon;
grant execute on function public.perfiles_contacto() to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 2. EMAIL DEL PERFIL = EMAIL REAL DE LA CUENTA
-- ───────────────────────────────────────────────────────────────
create or replace function public.fn_profile_email_real()
returns trigger as $$
begin
  if new.email is distinct from old.email
     and new.email is distinct from (select u.email from auth.users u where u.id = new.id) then
    raise exception 'PERFIL_EMAIL_NO_COINCIDE';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists profile_email_real_trigger on public.profiles;
create trigger profile_email_real_trigger before update of email on public.profiles
  for each row execute function public.fn_profile_email_real();
revoke execute on function public.fn_profile_email_real() from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────
-- 3. LINKS DE EMPRESAS
-- ───────────────────────────────────────────────────────────────
alter table public.empresas drop constraint if exists empresas_web_http;
alter table public.empresas add constraint empresas_web_http
  check (web is null or web = '' or web ~* '^https?://[^\s<>"]+$');
alter table public.empresas drop constraint if exists empresas_logo_https;
alter table public.empresas add constraint empresas_logo_https
  check (logo is null or logo = '' or logo ~* '^https://[^\s<>"]+$');

-- ───────────────────────────────────────────────────────────────
-- 4. BUCKET DE LOGOS
-- ───────────────────────────────────────────────────────────────
update storage.buckets set file_size_limit = 819200,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'logos';

drop policy if exists "Usuarios autenticados suben logos" on storage.objects;
create policy "Usuarios autenticados suben logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ───────────────────────────────────────────────────────────────
-- 5. CLAVES TEMPORALES
-- ───────────────────────────────────────────────────────────────
create table if not exists public.claves_temporales (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);
alter table public.claves_temporales enable row level security;
drop policy if exists "Claves temporales: la propia" on public.claves_temporales;
create policy "Claves temporales: la propia" on public.claves_temporales for select to authenticated
  using (user_id = auth.uid());
revoke all on public.claves_temporales from anon, authenticated;
grant select on public.claves_temporales to authenticated;

-- El usuario ya eligió su propia contraseña: se quita el aviso y queda en
-- la bitácora (sin la contraseña, obviamente).
create or replace function public.clave_cambiada()
returns void as $$
begin
  if auth.uid() is null then raise exception 'NO_AUTENTICADO'; end if;
  delete from public.claves_temporales where user_id = auth.uid();
  perform public.fn_log('clave_cambiada', 'usuario', auth.uid()::text, '{}'::jsonb);
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function public.clave_cambiada() from public, anon;
grant execute on function public.clave_cambiada() to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 6. BITÁCORA: eventos de sesión que puede registrar el navegador
-- ───────────────────────────────────────────────────────────────
create or replace function public.registrar_evento(p_accion text)
returns void as $$
begin
  if auth.uid() is null then
    raise exception 'NO_AUTENTICADO';
  end if;
  if coalesce(p_accion, '') not in ('sesion_inicio', 'sesion_cierre', 'sesion_inactividad') then
    raise exception 'EVENTO_NO_PERMITIDO';
  end if;
  perform public.fn_log(p_accion, 'sesion', null, '{}'::jsonb);
end;
$$ language plpgsql security definer set search_path = public;

-- ───────────────────────────────────────────────────────────────
-- 7. ROL ANÓNIMO SIN PERMISOS SOBRE LAS TABLAS
-- ───────────────────────────────────────────────────────────────
revoke all on public.profiles, public.empresas, public.empresa_usuarios, public.roles from anon;
