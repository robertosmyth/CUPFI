// ══════════════════════════════════════════════
// Cliente de Supabase
// ══════════════════════════════════════════════
// La "publishable key" (antes llamada "anon key") de Supabase está
// pensada para vivir en el navegador: es pública a propósito y la
// seguridad real la da Row Level Security (RLS) en la base de datos
// (ver sql/001_schema.sql). NUNCA pongas acá la "service_role key":
// esa sí es secreta y solo debe usarse en un backend/función server-side.
//
// OJO: la librería de Supabase se carga desde un CDN externo
// (esm.sh). Si la importáramos con un "import" estático de nivel
// superior y esa carga fallara (red lenta, bloqueador de anuncios,
// CDN caído un instante), TODO el módulo que la importe dejaría de
// funcionar de forma silenciosa, incluyendo cosas que no dependen de
// Supabase (como cambiar de pestaña en la pantalla de login). Por
// eso la cargamos de forma diferida (dynamic import) y memorizada:
// así un fallo de red solo afecta a las acciones que de verdad
// necesitan Supabase, y se puede mostrar un mensaje de error claro
// en vez de romper toda la página.
export const SUPABASE_URL = 'https://qxsqjufhkdmhowshspgb.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wTc0eAf4X7Z6A3MRDPMNhg_vBYsDDsK';

let clientPromise = null;

export function getSupabase() {
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }))
      .catch(err => {
        clientPromise = null; // permite reintentar en la próxima acción
        console.error('No se pudo cargar la librería de Supabase desde el CDN:', err);
        throw new Error('No se pudo conectar con el servidor. Revisá tu conexión a internet (o un bloqueador de anuncios) y volvé a intentar.');
      });
  }
  return clientPromise;
}
