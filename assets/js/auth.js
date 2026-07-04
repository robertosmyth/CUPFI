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

export async function onAuthStateChange(cb) {
  const supabase = await getSupabase();
  return supabase.auth.onAuthStateChange((_event, session) => cb(session));
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
