// ══════════════════════════════════════════════
// Conexiones (doble aceptación) y chat privado.
// Toda escritura pasa por funciones de la base (sql/012) que validan
// quién puede responder en nombre de qué empresa y quién puede leer qué.
// ══════════════════════════════════════════════
import { getSupabase } from './supabaseClient.ts';
import type { ConexionAccion, ConexionRow, MensajeRow } from './types.ts';

// Las conexiones que el usuario puede ver (RLS: las de sus empresas, o
// todas si es webmaster).
export async function listConexiones(): Promise<ConexionRow[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('conexiones').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function responderConexion(
  necesitaId: number, ofreceId: number, categoriaId: number, accion: ConexionAccion,
): Promise<ConexionRow> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('conexion_responder', {
    p_necesita: necesitaId, p_ofrece: ofreceId, p_categoria: categoriaId, p_accion: accion,
  });
  if (error) throw error;
  return data as ConexionRow;
}

export async function listMensajes(conexionId: number): Promise<MensajeRow[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('mensajes').select('*')
    .eq('conexion_id', conexionId).order('created_at', { ascending: true }).limit(500);
  if (error) throw error;
  return data;
}

export async function enviarMensaje(conexionId: number, contenido: string): Promise<MensajeRow> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('enviar_mensaje', { p_conexion: conexionId, p_contenido: contenido });
  if (error) throw error;
  return data as MensajeRow;
}
