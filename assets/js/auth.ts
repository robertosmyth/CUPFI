// ══════════════════════════════════════════════
// AUTENTICACIÓN (Supabase Auth real, sin passwords en el cliente)
// ══════════════════════════════════════════════
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { traerTodo } from './paginar.ts';
import { getSupabase } from './supabaseClient.ts';
import type { CheckProfileDuplicatesResult, PerfilPublico, Profile } from './types.ts';

export interface CheckProfileDuplicatesArgs {
  nombre?: string | null;
  apellido?: string | null;
  tel?: string | null;
  email?: string | null;
  excludeId?: string | null;
}

// Chequea ANTES de registrarse o guardar el perfil si nombre+apellido,
// email o teléfono ya están usados por otra cuenta. Llama a una función
// de la base (security definer) porque RLS no deja leer profiles sin
// sesión (necesario para validar esto durante el registro, donde
// todavía no hay usuario logueado). Ver sql/historial/010_unique_profile_constraints.sql.
export async function checkProfileDuplicates(
  { nombre, apellido, tel, email, excludeId }: CheckProfileDuplicatesArgs = {}
): Promise<CheckProfileDuplicatesResult> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('check_profile_duplicates', {
    p_nombre: nombre ?? null,
    p_apellido: apellido ?? null,
    p_tel: tel ?? null,
    p_email: email ?? null,
    p_exclude_id: excludeId ?? null,
  });
  if (error) throw error;
  return data || { nombre_apellido: false, email: false, tel: false };
}

// Columnas de profiles que cualquier usuario con sesión puede leer. El
// email y el teléfono personales NO están acá: se piden aparte con
// perfiles_contacto(), que solo devuelve los que el usuario tiene permitido
// ver (ver sql/015_normas_seguridad.sql, Ley 25.326).
export const PERFIL_COLS = 'id, nombre, apellido, role, created_at, is_webmaster, guia_vista';

type ContactoRow = { id: string; email: string | null; tel: string | null };

// Email y teléfono visibles para el usuario actual. Si la base todavía no
// tiene sql/015, se leen como antes (todas las columnas eran visibles).
export async function listContactos(): Promise<ContactoRow[]> {
  const supabase = await getSupabase();
  try {
    return await traerTodo<ContactoRow>((d, h) => supabase.rpc('perfiles_contacto', {}).order('id').range(d, h) as never);
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (!/perfiles_contacto|PGRST202|function .* does not exist|Could not find the function/i.test(`${e.code} ${e.message}`)) throw error;
  }
  return traerTodo<ContactoRow>((d, h) => supabase.from('profiles').select('id, email, tel').order('id').range(d, h));
}

function conContacto<T extends { id: string }>(perfil: T, contactos: ContactoRow[] | Map<string, ContactoRow>): T & { email: string | null; tel: string | null } {
  const c = contactos instanceof Map ? contactos.get(perfil.id) : contactos.find(x => x.id === perfil.id);
  return { ...perfil, email: c?.email ?? null, tel: c?.tel ?? null };
}

export interface SignUpArgs {
  nombre: string;
  apellido: string;
  email: string;
  tel: string;
  password: string;
}

// Versión del aviso de privacidad que acepta quien se registra (queda
// guardada en su cuenta junto con la fecha, como constancia del
// consentimiento — Ley 25.326 art. 5).
export const PRIVACIDAD_VERSION = 1;

export async function signUp({ nombre, apellido, email, tel, password }: SignUpArgs) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nombre, apellido, tel, privacidad_version: PRIVACIDAD_VERSION, privacidad_aceptada_at: new Date().toISOString() } },
  });
  if (error) throw error;
  return data; // data.session es null si el proyecto requiere confirmar email
}

export async function signIn({ email, password }: { email: string; password: string }) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// El callback recibe (event, session). El evento 'PASSWORD_RECOVERY' es el
// que dispara Supabase cuando el usuario vuelve del link de "restablecer
// contraseña" que le llega por email.
export async function onAuthStateChange(cb: (event: AuthChangeEvent, session: Session | null) => void) {
  const supabase = await getSupabase();
  return supabase.auth.onAuthStateChange((event, session) => cb(event, session));
}

// Perfil (public.profiles) del usuario autenticado, con su email real.
//
// BUG arreglado acá: antes se confiaba en cachear profiles.email
// únicamente cuando el evento 'USER_UPDATED' se agarraba al vuelo en
// la pestaña donde se pidió el cambio (ver onAuthStateChange en
// main.js). En la práctica el link de confirmación casi siempre se
// abre desde el mail en OTRA pestaña/dispositivo, así que ese evento
// nunca llegaba a la sesión original y profiles.email se quedaba
// para siempre con el valor viejo aunque el usuario ya hubiera
// confirmado el cambio en auth.users (podía iniciar sesión con el
// email nuevo, pero la app seguía mostrando/usando el viejo). Acá
// comparamos siempre contra el email real de auth.users (fuente de
// verdad) y, si no coincide, lo sincronizamos en el momento.
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: base, error } = await supabase.from('profiles').select(PERFIL_COLS).eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (!base) return { id: user.id, nombre: '', apellido: '', tel: '', role: 'user', email: user.email ?? null };
  const data = conContacto(base as Profile, await listContactos());
  if (user.email && data.email !== user.email) {
    try {
      const synced = await syncEmailFromAuth();
      if (synced) return { ...data, ...synced, email: user.email };
    } catch (e) {
      console.error('No se pudo sincronizar el email con auth.users:', e);
    }
  }
  return { ...data, email: data.email || user.email || null };
}

// Todos los perfiles visibles (requiere estar autenticado, ver RLS)
export async function listProfiles(): Promise<Profile[]> {
  const supabase = await getSupabase();
  const [perfiles, contactos] = await Promise.all([
    traerTodo<Profile>((d, h) => supabase.from('profiles').select(PERFIL_COLS)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(d, h) as never),
    listContactos(),
  ]);
  const porId = new Map(contactos.map(c => [c.id, c]));
  return perfiles.map(p => conContacto(p, porId));
}

// Cambia el rol de un usuario. Solo funciona si quien llama ya es admin:
// la base de datos lo hace cumplir con RLS + un trigger (ver
// sql/001_schema.sql, con el historial de refinamiento en
// sql/historial/003_lockdown_role_and_uid.sql y
// sql/historial/004_admin_role_management.sql), no es una regla que
// dependa del código del cliente.
export async function setUserRole(userId: string, role: string): Promise<PerfilPublico> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('profiles').update({ role }).eq('id', userId).select(PERFIL_COLS).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('No se pudo cambiar el rol (¿ya no sos admin, o el usuario no existe?).');
  return data;
}

export interface UpdateOwnProfileArgs {
  nombre: string;
  apellido: string;
  tel: string;
}

// Actualiza los datos propios del perfil (nombre, apellido, teléfono).
// Permitido por RLS porque auth.uid() = id (ver sql/001_schema.sql).
export async function updateOwnProfile({ nombre, apellido, tel }: UpdateOwnProfileArgs): Promise<PerfilPublico | null> {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No hay sesión activa.');
  const { data, error } = await supabase
    .from('profiles')
    .update({ nombre, apellido, tel })
    .eq('id', user.id)
    .select(PERFIL_COLS)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface AdminUpdateProfileArgs {
  nombre: string;
  apellido: string;
  tel: string;
}

// Igual que updateOwnProfile, pero para que un admin edite el perfil de
// OTRO usuario (nombre/apellido/tel). Permitido por RLS porque la
// política de UPDATE de profiles ya deja pasar "auth.uid() = id or es
// admin" (ver sql/001_schema.sql) — no hace falta la Edge Function para
// esto, a diferencia de email/password (ver adminUpdateUserAuth).
export async function adminUpdateProfile(userId: string, { nombre, apellido, tel }: AdminUpdateProfileArgs): Promise<PerfilPublico | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .update({ nombre, apellido, tel })
    .eq('id', userId)
    .select(PERFIL_COLS)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface AdminUpdateUserAuthArgs {
  email?: string;
  password?: string;
}

// Cambia el email y/o la contraseña de OTRO usuario SIN pasar por el
// flujo normal de verificación (sin link de confirmación, sin email de
// reset) — se aplica al instante. A propósito esto no se puede hacer solo
// con código de cliente: requiere la Admin API de Supabase Auth, que
// necesita la service_role key (nunca debe estar en el navegador). Por
// eso delega en la Edge Function "admin-update-user"
// (ver supabase/functions/admin-update-user/index.ts), que valida del
// lado del servidor que quien llama es admin antes de usar esa clave.
export async function adminUpdateUserAuth(userId: string, { email, password }: AdminUpdateUserAuthArgs): Promise<void> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke('admin-update-user', {
    body: { userId, email, password },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}

// Envía el email de "restablecer contraseña". redirectTo apunta a la misma
// página (Site URL configurado en Supabase); al volver, Supabase dispara
// el evento 'PASSWORD_RECOVERY' que main.js escucha para mostrar el
// formulario de nueva contraseña.
export async function resetPasswordForEmail(email: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  await claveCambiada();
}

// Cambio de contraseña con la sesión iniciada: primero se confirma la
// contraseña actual (así nadie que encuentre la sesión abierta puede
// cambiarla), después se guarda la nueva.
export async function cambiarClave(email: string, actual: string, nueva: string): Promise<void> {
  const supabase = await getSupabase();
  const { error: e1 } = await supabase.auth.signInWithPassword({ email, password: actual });
  if (e1) throw new Error(/invalid login credentials/i.test(e1.message) ? 'La contraseña actual no es correcta.' : e1.message);
  await updatePassword(nueva);
}

// Quita el aviso de "contraseña temporal" y deja constancia en la bitácora.
// Si la base todavía no tiene sql/015 no pasa nada.
async function claveCambiada(): Promise<void> {
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('clave_cambiada', {});
    if (error) console.warn('No se pudo registrar el cambio de contraseña:', error.message);
  } catch (e) { console.warn('No se pudo registrar el cambio de contraseña:', e); }
}

// ¿El usuario tiene una contraseña temporal asignada por el administrador?
export async function tieneClaveTemporal(): Promise<boolean> {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.from('claves_temporales').select('user_id').limit(1);
    if (error) return false;
    return (data || []).length > 0;
  } catch { return false; }
}

// Inicia un cambio de email: Supabase le manda un correo de confirmación a
// la dirección NUEVA (y, si el proyecto tiene activado "Secure email
// change", también uno a la dirección anterior). El email real de
// auth.users no cambia hasta que el usuario confirma desde ese link.
export async function updateEmail(newEmail: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: window.location.origin + window.location.pathname }
  );
  if (error) throw error;
}

// Sincroniza public.profiles.email con el email confirmado en auth.users.
// Se usa después del evento 'USER_UPDATED' (el usuario volvió de confirmar
// un cambio de email por correo).
export async function syncEmailFromAuth(): Promise<PerfilPublico | null> {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .update({ email: user.email })
    .eq('id', user.id)
    .select(PERFIL_COLS)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Registra en la bitácora el inicio o cierre de sesión (solo esos dos
// eventos se pueden registrar desde el navegador, ver registrar_evento en
// sql/012). Nunca debe romper el login/logout: los errores se ignoran.
export async function registrarEvento(accion: 'sesion_inicio' | 'sesion_cierre' | 'sesion_inactividad'): Promise<void> {
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc('registrar_evento', { p_accion: accion });
    if (error) console.warn('No se pudo registrar el evento en la bitácora:', error.message);
  } catch (e) {
    console.warn('No se pudo registrar el evento en la bitácora:', e);
  }
}

// Marca que el usuario ya vio la guía del primer ingreso (se guarda en su
// cuenta, así no reaparece al entrar desde otro dispositivo).
export async function marcarGuiaVista(): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc('marcar_guia_vista', {});
  if (error) throw error;
}
