// ══════════════════════════════════════════════
// Cliente de Supabase
// ══════════════════════════════════════════════
// La "publishable key" (antes llamada "anon key") de Supabase está
// pensada para vivir en el navegador: es pública a propósito y la
// seguridad real la da Row Level Security (RLS) en la base de datos
// (ver sql/001_schema.sql). NUNCA pongas acá la "service_role key":
// esa sí es secreta y solo debe usarse en un backend/función server-side.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://qxsqjufhkdmhowshspgb.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wTc0eAf4X7Z6A3MRDPMNhg_vBYsDDsK';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
