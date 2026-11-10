// ══════════════════════════════════════════════
// Funciones del permiso de webmaster: bitácora, resumen de contacto entre
// conexiones (sin contenido de mensajes) y otorgar/quitar el permiso.
// La base rechaza todo esto si quien llama no es webmaster (sql/012).
// ══════════════════════════════════════════════
import { getSupabase } from './supabaseClient.ts';
import type { BitacoraRow, ContactoResumenRow } from './types.ts';

export interface FiltroBitacora {
  userId?: string;
  accion?: string;
  desde?: string; // YYYY-MM-DD (inclusive)
  hasta?: string; // YYYY-MM-DD (inclusive)
}

export const BITACORA_PAGINA = 100;

export async function listBitacora(filtro: FiltroBitacora, offset = 0): Promise<BitacoraRow[]> {
  const supabase = await getSupabase();
  let q = supabase.from('bitacora').select('*').order('created_at', { ascending: false }).order('id', { ascending: false });
  if (filtro.userId) q = q.eq('user_id', filtro.userId);
  if (filtro.accion) q = q.eq('accion', filtro.accion);
  if (filtro.desde) q = q.gte('created_at', new Date(filtro.desde + 'T00:00:00').toISOString());
  if (filtro.hasta) q = q.lt('created_at', new Date(new Date(filtro.hasta + 'T00:00:00').getTime() + 86_400_000).toISOString());
  const { data, error } = await q.range(offset, offset + BITACORA_PAGINA - 1);
  if (error) throw error;
  return data;
}

export async function contactoResumen(): Promise<ContactoResumenRow[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('webmaster_contacto_resumen', {});
  if (error) throw error;
  return (data || []).map(r => ({ ...r, cantidad: Number(r.cantidad) }));
}

export async function setWebmaster(userId: string, valor: boolean): Promise<void> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('profiles').update({ is_webmaster: valor }).eq('id', userId).select('id, is_webmaster').maybeSingle();
  if (error) throw error;
  if (!data || data.is_webmaster !== valor) throw new Error('No se pudo cambiar el permiso de webmaster.');
}
