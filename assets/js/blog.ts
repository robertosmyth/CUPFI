// ══════════════════════════════════════════════
// Blog (sql/014): datos, archivos y reglas que no dependen del DOM.
// Toda escritura pasa por funciones de la base, que validan permisos,
// tamaños y tipos de archivo, y registran en la bitácora. Los archivos
// van al bucket PRIVADO 'blog' y se muestran con URLs firmadas.
// ══════════════════════════════════════════════
import { getSupabase } from './supabaseClient.ts';
import { esc } from './utils.ts';
import type {
  BlogComentarioLikeRow, BlogComentarioRow, BlogDenunciaRow, BlogPostLikeRow, BlogPostRow, BlogTipo,
} from './types.ts';

export const BLOG_PAGINA = 15;
export const MAX_IMAGENES = 4;
export const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_TEXTO = 5000;
export const MAX_COMENTARIO = 2000;
export const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const TIPOS_VIDEO = ['video/mp4', 'video/webm'];
const BUCKET = 'blog';

// ─── Reglas puras (también las valida la base) ─────────────────────

// Mismo patrón que fn_blog_validar_media en sql/014.
const RE_VIDEO_URL = new RegExp(
  '^https://(www\\.|m\\.)?(youtube\\.com/(watch\\?v=|shorts/|embed/)[A-Za-z0-9_-]{11}([?&#][^\\s<>"]*)?'
  + '|youtu\\.be/[A-Za-z0-9_-]{11}([?&#][^\\s<>"]*)?'
  + '|vimeo\\.com/[0-9]{3,12}([/?#][^\\s<>"]*)?)$');

export function videoUrlValida(url: string): boolean {
  return RE_VIDEO_URL.test(url.trim());
}

export type VideoExterno = { tipo: 'youtube' | 'vimeo'; id: string };

export function videoExterno(url: string | null | undefined): VideoExterno | null {
  if (!url || !videoUrlValida(url)) return null;
  const yt = /(?:v=|shorts\/|embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url);
  if (yt) return { tipo: 'youtube', id: yt[1] };
  const vm = /vimeo\.com\/([0-9]{3,12})/.exec(url);
  return vm ? { tipo: 'vimeo', id: vm[1] } : null;
}

export function urlEmbed(v: VideoExterno): string {
  return v.tipo === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0`
    : `https://player.vimeo.com/video/${v.id}?autoplay=1`;
}

// Devuelve un mensaje de error (en español) o null si el archivo sirve.
export function validarArchivo(f: { type: string; size: number }, tipo: 'imagen' | 'video'): string | null {
  if (tipo === 'imagen') {
    if (!TIPOS_IMAGEN.includes(f.type)) return 'Las imágenes tienen que ser JPG, PNG, WebP o GIF.';
    if (f.size > MAX_IMAGEN_BYTES) return 'Cada imagen puede pesar hasta 5 MB.';
  } else {
    if (!TIPOS_VIDEO.includes(f.type)) return 'El video tiene que ser MP4 o WebM.';
    if (f.size > MAX_VIDEO_BYTES) return 'El video puede pesar hasta 50 MB.';
  }
  return null;
}

// Texto escapado, con saltos de línea y links http(s) clickeables.
export function textoHtml(texto: string): string {
  return esc(texto)
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow ugc">${u}</a>`)
    .replace(/\n/g, '<br>');
}

export function tiempoRelativo(iso: string, ahora = Date.now()): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.round((ahora - t) / 1000));
  if (s < 60) return 'recién';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `hace ${d} d`;
  return new Date(t).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Comentarios de un posteo agrupados: principales en orden, con sus respuestas.
export function armarHilos(coms: BlogComentarioRow[]): Array<{ c: BlogComentarioRow; respuestas: BlogComentarioRow[] }> {
  const orden = [...coms].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  const principales = orden.filter(c => c.parent_id === null);
  return principales.map(c => ({ c, respuestas: orden.filter(r => r.parent_id === c.id) }));
}

export function extension(f: { name: string; type: string }): string {
  const porTipo: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm',
  };
  return porTipo[f.type] || (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
}

// ─── Lectura ───────────────────────────────────────────────────────
export interface FiltroBlog { autorId?: string; antesDe?: { created_at: string; id: number } }

export async function listPosts(f: FiltroBlog = {}): Promise<BlogPostRow[]> {
  const supabase = await getSupabase();
  let q = supabase.from('blog_posts').select('*');
  if (f.autorId) q = q.eq('autor_id', f.autorId);
  if (f.antesDe) q = q.lte('created_at', f.antesDe.created_at);
  const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(BLOG_PAGINA + 5);
  if (error) throw error;
  // Paginado por fecha: se descartan los ya mostrados con la misma fecha.
  const filas = f.antesDe ? data.filter(p => p.created_at < f.antesDe!.created_at || p.id < f.antesDe!.id) : data;
  return filas.slice(0, BLOG_PAGINA);
}

export async function getPost(id: number): Promise<BlogPostRow | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('blog_posts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export interface DetallesPosts {
  comentarios: BlogComentarioRow[];
  likes: BlogPostLikeRow[];
  likesComentarios: BlogComentarioLikeRow[];
}

export async function detallesDe(postIds: number[]): Promise<DetallesPosts> {
  if (!postIds.length) return { comentarios: [], likes: [], likesComentarios: [] };
  const supabase = await getSupabase();
  const [c, l] = await Promise.all([
    supabase.from('blog_comentarios').select('*').in('post_id', postIds).order('created_at', { ascending: true }),
    supabase.from('blog_post_likes').select('*').in('post_id', postIds),
  ]);
  if (c.error) throw c.error;
  if (l.error) throw l.error;
  const comIds = c.data.map(x => x.id);
  let likesComentarios: BlogComentarioLikeRow[] = [];
  if (comIds.length) {
    const lc = await supabase.from('blog_comentario_likes').select('*').in('comentario_id', comIds);
    if (lc.error) throw lc.error;
    likesComentarios = lc.data;
  }
  return { comentarios: c.data, likes: l.data, likesComentarios };
}

// URLs firmadas (1 hora) para mostrar archivos del bucket privado.
export async function urlsFirmadas(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  for (const d of data || []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

// ─── Archivos ──────────────────────────────────────────────────────
export async function subirArchivo(uid: string, file: File): Promise<string> {
  const supabase = await getSupabase();
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension(file)}`;
  // Se manda el contenido crudo con su tipo (Supabase lo acepta igual que un File).
  const { error } = await supabase.storage.from(BUCKET).upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

// Borra archivos del almacenamiento. Nunca rompe el flujo: si falla solo avisa en consola.
export async function borrarArchivos(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) console.warn('No se pudieron borrar archivos del blog:', error.message);
  } catch (e) {
    console.warn('No se pudieron borrar archivos del blog:', e);
  }
}

// ─── Escritura ─────────────────────────────────────────────────────
export interface MediaPost { imagenes: string[]; videoPath: string | null; videoUrl: string | null }

export async function publicar(empresaId: number | null, texto: string, m: MediaPost): Promise<BlogPostRow> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('blog_publicar', {
    p_empresa: empresaId, p_texto: texto, p_imagenes: m.imagenes, p_video_path: m.videoPath, p_video_url: m.videoUrl,
  });
  if (error) throw error;
  return data as BlogPostRow;
}

export async function editar(postId: number, texto: string, m: MediaPost): Promise<{ post: BlogPostRow; quitados: string[] }> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('blog_editar', {
    p_post: postId, p_texto: texto, p_imagenes: m.imagenes, p_video_path: m.videoPath, p_video_url: m.videoUrl,
  });
  if (error) throw error;
  return data as { post: BlogPostRow; quitados: string[] };
}

export async function borrar(postId: number): Promise<string[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('blog_borrar', { p_post: postId });
  if (error) throw error;
  return (data as string[]) || [];
}

export async function comentar(postId: number, parentId: number | null, texto: string): Promise<BlogComentarioRow> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('blog_comentar', { p_post: postId, p_parent: parentId, p_texto: texto });
  if (error) throw error;
  return data as BlogComentarioRow;
}

export async function editarComentario(id: number, texto: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc('blog_editar_comentario', { p_comentario: id, p_texto: texto });
  if (error) throw error;
}

export async function borrarComentario(id: number): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc('blog_borrar_comentario', { p_comentario: id });
  if (error) throw error;
}

export async function meGusta(tipo: BlogTipo, id: number): Promise<boolean> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('blog_me_gusta', { p_tipo: tipo, p_id: id });
  if (error) throw error;
  return !!data;
}

export async function denunciar(tipo: BlogTipo, id: number, motivo: string): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc('blog_denunciar', { p_tipo: tipo, p_id: id, p_motivo: motivo });
  if (error) throw error;
}

// ─── Moderación (webmasters) ───────────────────────────────────────
export async function moderar(tipo: BlogTipo, id: number, accion: 'ocultar' | 'mostrar', motivo: string | null): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc('blog_moderar', { p_tipo: tipo, p_id: id, p_accion: accion, p_motivo: motivo });
  if (error) throw error;
}

export async function descartarDenuncia(id: number): Promise<void> {
  const supabase = await getSupabase();
  const { error } = await supabase.rpc('blog_descartar_denuncia', { p_denuncia: id });
  if (error) throw error;
}

export async function listDenunciasAbiertas(): Promise<BlogDenunciaRow[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('blog_denuncias').select('*').eq('estado', 'abierta').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function listOcultos(): Promise<{ posts: BlogPostRow[]; comentarios: BlogComentarioRow[] }> {
  const supabase = await getSupabase();
  const [p, c] = await Promise.all([
    supabase.from('blog_posts').select('*').eq('oculto', true).order('oculto_at', { ascending: false }),
    supabase.from('blog_comentarios').select('*').eq('oculto', true).order('oculto_at', { ascending: false }),
  ]);
  if (p.error) throw p.error;
  if (c.error) throw c.error;
  return { posts: p.data, comentarios: c.data };
}

export async function postsPorId(ids: number[]): Promise<BlogPostRow[]> {
  if (!ids.length) return [];
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('blog_posts').select('*').in('id', ids);
  if (error) throw error;
  return data;
}

export async function comentariosPorId(ids: number[]): Promise<BlogComentarioRow[]> {
  if (!ids.length) return [];
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('blog_comentarios').select('*').in('id', ids);
  if (error) throw error;
  return data;
}
