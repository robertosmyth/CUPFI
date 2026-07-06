// ══════════════════════════════════════════════
// AUTENTICACIÓN (Supabase Auth real, sin passwords en el cliente)
// ══════════════════════════════════════════════
import { getSupabase } from './supabaseClient.js';

// Chequea ANTES de registrarse o guardar el perfil si nombre+apellido,
// email o teléfono ya están usados por otra cuenta. Llama a una función
// de la base (security definer) porque RLS no deja leer profiles sin
// sesión (necesario para validar esto durante el registro, donde
// todavía no hay usuario logueado). Ver sql/010_unique_profile_constraints.sql.
export async function checkProfileDuplicates({ nombre, apellido, tel, email, excludeId } = {}) {
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

export async function signUp({ nombre, apellido, email, tel, password }) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nombre, apellido, tel } },
  });
  if (error) throw error;
  return data; // data.session es null si el proyecto requiere confirmar email
}

export async function signIn({ email, password }) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// El callback recibe (event, session). El evento 'PASSWORD_RECOVERY' es el
// que dispara Supabase cuando el usuario vuelve del link de "restablecer
// contraseña" que le llega por email.
export async function onAuthStateChange(cb) {
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
export async function getCurrentProfile() {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (!data) return { id: user.id, nombre: '', apellido: '', tel: '', role: 'user', email: user.email };
  if (user.email && data.email !== user.email) {
    try {
      const synced = await syncEmailFromAuth();
      if (synced) return { ...synced, email: synced.email || user.email };
    } catch (e) {
      console.error('No se pudo sincronizar el email con auth.users:', e);
    }
  }
  return { ...data, email: data.email || user.email };
}

// Todos los perfiles visibles (requiere estar autenticado, ver RLS)
export async function listProfiles() {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

// Cambia el rol de un usuario. Solo funciona si quien llama ya es admin:
// la base de datos lo hace cumplir con RLS + un trigger (ver
// sql/003_lockdown_role_and_uid.sql y sql/004_admin_role_management.sql),
// no es una regla que dependa del código del cliente.
export async function setUserRole(userId, role) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('profiles').update({ role }).eq('id', userId).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('No se pudo cambiar el rol (¿ya no sos admin, o el usuario no existe?).');
  return data;
}

// Actualiza los datos propios del perfil (nombre, apellido, teléfono).
// Permitido por RLS porque auth.uid() = id (ver sql/001_schema.sql).
export async function updateOwnProfile({ nombre, apellido, tel }) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No hay sesión activa.');
  const { data, error } = await supabase
    .from('profiles')
    .update({ nombre, apellido, tel })
    .eq('id', user.id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Envía el email de "restablecer contraseña". redirectTo apunta a la misma
// página (Site URL configurado en Supabase); al volver, Supabase dispara
// el evento 'PASSWORD_RECOVERY' que main.js escucha para mostrar el
// formulario de nueva contraseña.
export async function resetPasswordForEmail(email) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// Inicia un cambio de email: Supabase le manda un correo de confirmación a
// la dirección NUEVA (y, si el proyecto tiene activado "Secure email
// change", también uno a la dirección anterior). El email real de
// auth.users no cambia hasta que el usuario confirma desde ese link.
export async function updateEmail(newEmail) {
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
export async function syncEmailFromAuth() {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .update({ email: user.email })
    .eq('id', user.id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}
