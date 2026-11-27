// ══════════════════════════════════════════════
// Conexiones (doble aceptación) y chat privado.
// Toda escritura pasa por funciones de la base (sql/012) que validan
// quién puede responder en nombre de qué empresa y quién puede leer qué.
// ══════════════════════════════════════════════
import { traerTodo } from './paginar.ts';
import { getSupabase } from './supabaseClient.ts';
import type { SugerenciaBase } from './matching.ts';
import type { ConexionAccion, ConexionRow, MensajeRow } from './types.ts';

// Las conexiones que el usuario puede ver (RLS: las de sus empresas, o
// todas si es webmaster).
export async function listConexiones(): Promise<ConexionRow[]> {
  const supabase = await getSupabase();
  return traerTodo<ConexionRow>((d, h) => supabase.from('conexiones').select('*')
    .order('updated_at', { ascending: false }).order('id', { ascending: false }).range(d, h));
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

// Vinculaciones posibles calculadas en la base (sql/017).
// Sin parámetros: las de mis empresas. red/empresa (admins): de a páginas.
export interface FiltroSugerencias { red?: boolean; empresa?: number; q?: string; nivel?: string; limite?: number; desde?: number; solo_total?: boolean }
export async function listSugerencias(f: FiltroSugerencias = {}): Promise<{ total: number; items: SugerenciaBase[] }> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('sugerencias_conexion', { p: f as Record<string, unknown> });
  if (error) throw error;
  const r = data as { total: number; items: SugerenciaBase[] };
  return { total: r.total, items: r.items || [] };
}

// Los `limite` mensajes más recientes, en orden de lectura (el más viejo
// primero). hayMas indica que hay mensajes anteriores sin traer.
export const MENSAJES_PAGINA = 100;
export async function listMensajes(conexionId: number, limite = MENSAJES_PAGINA): Promise<{ msgs: MensajeRow[]; hayMas: boolean }> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('mensajes').select('*')
    .eq('conexion_id', conexionId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limite + 1);
  if (error) throw error;
  return { msgs: data.slice(0, limite).reverse(), hayMas: data.length > limite };
}

export async function enviarMensaje(conexionId: number, contenido: string): Promise<MensajeRow> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('enviar_mensaje', { p_conexion: conexionId, p_contenido: contenido });
  if (error) throw error;
  return data as MensajeRow;
}
