// ══════════════════════════════════════════════
// AUTENTICACIÓN (Supabase Auth real, sin passwords en el cliente)
// ══════════════════════════════════════════════
import { getSupabase } from './supabaseClient.js';

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

// Perfil (public.profiles) del usuario autenticado, con su email real
export async function getCurrentProfile() {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (!data) return { id: user.id, nombre: '', apellido: '', tel: '', role: 'user', email: user.email };
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
