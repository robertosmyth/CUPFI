// ══════════════════════════════════════════════
// Solicitudes (sql/013): buscar un servicio/producto o una necesidad y
// pedirle a una empresa que lo tiene. Toda escritura pasa por funciones
// de la base, que validan quién puede mandar, responder y leer qué.
// ══════════════════════════════════════════════
import { getSupabase } from './supabaseClient.ts';
import type {
  SolicitudAccion, SolicitudEnvioResultado, SolicitudMensajeRow, SolicitudResumenRow, SolicitudRow, SolicitudTipo,
} from './types.ts';

// Las que el usuario puede ver (RLS: enviadas por él o sus empresas,
// recibidas por sus empresas, o todas si es webmaster).
export async function listSolicitudes(): Promise<SolicitudRow[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('solicitudes').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export interface EnviarSolicitudArgs {
  tipo: SolicitudTipo;
  origenEmpresaId: number | null; // null = a mi nombre (persona)
  destinoEmpresaId: number;
  categoriaId: number;
  subcategoria: string;
  mensaje: string;
  agregarItem: boolean;
}

export async function enviarSolicitud(a: EnviarSolicitudArgs): Promise<SolicitudEnvioResultado> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('solicitud_enviar', {
    p_tipo: a.tipo, p_origen_empresa: a.origenEmpresaId, p_destino: a.destinoEmpresaId,
    p_categoria: a.categoriaId, p_subcategoria: a.subcategoria,
    p_mensaje: a.mensaje.trim() || null, p_agregar_item: a.agregarItem,
  });
  if (error) throw error;
  return data as SolicitudEnvioResultado;
}

export async function responderSolicitud(id: number, accion: SolicitudAccion): Promise<SolicitudRow> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('solicitud_responder', { p_solicitud: id, p_accion: accion });
  if (error) throw error;
  return data as SolicitudRow;
}

export async function listMensajes(solicitudId: number): Promise<SolicitudMensajeRow[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('solicitud_mensajes').select('*')
    .eq('solicitud_id', solicitudId).order('created_at', { ascending: true }).limit(500);
  if (error) throw error;
  return data;
}

export async function enviarMensaje(solicitudId: number, contenido: string): Promise<SolicitudMensajeRow> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('solicitud_enviar_mensaje', { p_solicitud: solicitudId, p_contenido: contenido });
  if (error) throw error;
  return data as SolicitudMensajeRow;
}

// Solo webmasters: cuántos mensajes hubo en cada solicitud (sin contenido).
export async function resumenWebmaster(): Promise<SolicitudResumenRow[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('webmaster_solicitudes_resumen', {});
  if (error) throw error;
  return data || [];
}
