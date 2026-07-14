// ══════════════════════════════════════════════
// Cliente de Supabase
// ══════════════════════════════════════════════
// La "publishable key" (antes llamada "anon key") de Supabase está
// pensada para vivir en el navegador: es pública a propósito y la
// seguridad real la da Row Level Security (RLS) en la base de datos
// (ver sql/001_schema.sql). NUNCA pongas acá la "service_role key":
// esa sí es secreta y solo debe usarse en un backend/función server-side.
//
// @supabase/supabase-js es ahora una dependencia npm bundleada por Vite
// (antes se cargaba con un import() dinámico desde un CDN externo,
// esm.sh, específicamente para que un fallo de red en ese CDN no
// rompiera toda la app; ver el historial de este archivo si hace falta
// recuperar esa lógica). Con la librería empaquetada en el propio build
// ese riesgo desaparece: no hay ningún fetch externo en runtime para
// esto, así que el cliente se crea directo, sin capa de reintento.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types.ts';

export const SUPABASE_URL = 'https://qxsqjufhkdmhowshspgb.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wTc0eAf4X7Z6A3MRDPMNhg_vBYsDDsK';

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export async function getSupabase() {
  return supabase;
}
