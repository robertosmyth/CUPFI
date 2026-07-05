// ══════════════════════════════════════════════
// CRUD de empresas + subida de logos (Supabase real)
// Mapea entre camelCase (JS) y snake_case (columnas Postgres)
// ══════════════════════════════════════════════
import { getSupabase } from './supabaseClient.js';

function fromDb(row) {
  return {
    id: row.id,
    uid: row.uid,
    cuit: row.cuit,
    tipo: row.tipo,
    nombre: row.nombre,
    sector: row.sector,
    calle: row.calle,
    ciudad: row.ciudad,
    provincia: row.provincia,
    pais: row.pais,
    referente: row.referente,
    cargo: row.cargo,
    emailOrg: row.email_org,
    tel: row.tel,
    web: row.web,
    desc: row.descripcion,
    logo: row.logo,
    ofertas: row.ofertas || [],
    instalaciones: row.instalaciones || [],
    needsUncovered: row.needs_uncovered || [],
    needsCovered: row.needs_covered || [],
  };
}

function toDb(o) {
  const out = {};
  if ('cuit' in o) out.cuit = o.cuit;
  if ('tipo' in o) out.tipo = o.tipo;
  if ('nombre' in o) out.nombre = o.nombre;
  if ('sector' in o) out.sector = o.sector;
  if ('calle' in o) out.calle = o.calle;
  if ('ciudad' in o) out.ciudad = o.ciudad;
  if ('provincia' in o) out.provincia = o.provincia;
  if ('pais' in o) out.pais = o.pais;
  if ('referente' in o) out.referente = o.referente;
  if ('cargo' in o) out.cargo = o.cargo;
  if ('emailOrg' in o) out.email_org = o.emailOrg;
  if ('tel' in o) out.tel = o.tel;
  if ('web' in o) out.web = o.web;
  if ('desc' in o) out.descripcion = o.desc;
  if ('logo' in o) out.logo = o.logo;
  if ('ofertas' in o) out.ofertas = o.ofertas;
  if ('instalaciones' in o) out.instalaciones = o.instalaciones;
  if ('needsUncovered' in o) out.needs_uncovered = o.needsUncovered;
  if ('needsCovered' in o) out.needs_covered = o.needsCovered;
  return out;
}

export async function listEmpresas() {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('empresas').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(fromDb);
}

export async function createEmpresa(uid, payload) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('empresas').insert({ uid, ...toDb(payload) }).select().single();
  if (error) throw error;
  return fromDb(data);
}

export async function updateEmpresa(id, payload) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('empresas').update(toDb(payload)).eq('id', id).select().single();
  if (error) throw error;
  return fromDb(data);
}

export async function deleteEmpresa(id) {
  const supabase = await getSupabase();
  const { error } = await supabase.from('empresas').delete().eq('id', id);
  if (error) throw error;
}

// ══════════════════════════════════════════════
// ASIGNACIÓN DE EMPRESAS A USUARIOS (solo admin, ver sql/009)
// ══════════════════════════════════════════════

// Cambia el dueño principal de una empresa (empresas.uid).
// userId puede ser null para dejarla sin dueño asignado.
export async function reasignarDueno(empresaId, userId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('empresas').update({ uid: userId }).eq('id', empresaId).select().single();
  if (error) throw error;
  return fromDb(data);
}

// Trae todas las asociaciones empresa↔usuario adicionales (además del dueño principal).
export async function listAsociaciones() {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('empresa_usuarios').select('*');
  if (error) throw error;
  return data;
}

export async function asignarUsuario(empresaId, userId) {
  const supabase = await getSupabase();
  const { error } = await supabase.from('empresa_usuarios').insert({ empresa_id: empresaId, user_id: userId });
  if (error) throw error;
}

export async function desasignarUsuario(empresaId, userId) {
  const supabase = await getSupabase();
  const { error } = await supabase.from('empresa_usuarios').delete().eq('empresa_id', empresaId).eq('user_id', userId);
  if (error) throw error;
}

const MAX_LOGO_BYTES = 800_000; // 800 KB
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];

export function validateLogoFile(file) {
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    throw new Error('Formato de imagen no soportado. Usá PNG, JPG, WEBP, GIF o SVG.');
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error('El logo es demasiado grande. Usá una imagen menor a 800 KB.');
  }
}

// Sube el logo al bucket público "logos" (ver sql/002_migration_v2.sql)
// y devuelve la URL pública para guardar en empresas.logo
export async function uploadLogo(file, uid) {
  validateLogoFile(file);
  const supabase = await getSupabase();
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('logos').upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('logos').getPublicUrl(path);
  return data.publicUrl;
}
