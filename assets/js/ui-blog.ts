// ══════════════════════════════════════════════
// Pestaña "Blog" (sql/014): publicar (como empresa o a título personal)
// con hasta 4 imágenes o 1 video (subido o link de YouTube/Vimeo), feed,
// "me gusta" (con lista de quién), comentarios con un nivel de respuestas,
// edición y borrado de lo propio, denuncias y moderación de webmasters.
// ══════════════════════════════════════════════
import * as Blog from './blog.ts';
import { app, fechaHora, nombreUsuario } from './contexto.ts';
import { esc, friendlyError } from './utils.ts';
import type { BlogComentarioRow, BlogDenunciaRow, BlogPostRow, BlogTipo, Empresa } from './types.ts';

type Prefijo = 'bn' | 'be'; // bn = nueva publicación, be = edición

declare global {
  interface Window {
    renderBlog(): void;
    blogFiltro(el: HTMLElement, f: string): void;
    blogMas(): Promise<void>;
    blogElegirArchivo(p: Prefijo, tipo: 'imagen' | 'video'): void;
    blogArchivos(p: Prefijo, tipo: 'imagen' | 'video'): void;
    blogQuitarAdjunto(p: Prefijo, cual: string): void;
    blogToggleLink(p: Prefijo): void;
    blogPublicar(): Promise<void>;
    blogEditar(id: number): void;
    blogGuardarEdicion(): Promise<void>;
    blogCerrarEdicion(): void;
    blogBorrar(id: number): Promise<void>;
    blogMeGusta(tipo: BlogTipo, id: number): Promise<void>;
    blogVerLikes(tipo: BlogTipo, id: number): void;
    blogToggleComentarios(id: number): void;
    blogComentar(postId: number, parentId: number | null): Promise<void>;
    blogResponder(postId: number, comId: number): void;
    blogEditarComentario(id: number): void;
    blogGuardarComentario(id: number): Promise<void>;
    blogCancelarComentario(): void;
    blogBorrarComentario(id: number): Promise<void>;
    blogPedirMotivo(accion: 'denunciar' | 'ocultar', tipo: BlogTipo, id: number): void;
    blogMotivoConfirmar(): Promise<void>;
    blogMostrar(tipo: BlogTipo, id: number): Promise<void>;
    blogCerrarModal(id: string): void;
    blogVerImagen(postId: number, idx: number): void;
    blogVideo(postId: number): void;
    blogVerMas(id: number): void;
    blogModDescartar(id: number): Promise<void>;
    blogModBorrar(tipo: BlogTipo, id: number): Promise<void>;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// ─── Estado ────────────────────────────────────────────────────────
let posts: BlogPostRow[] = [];
let fin = false;
let filtro: 'todos' | 'mios' = 'todos';
let det: Blog.DetallesPosts = { comentarios: [], likes: [], likesComentarios: [] };
const urls = new Map<string, string>();
const abiertos = new Set<number>();      // posteos con comentarios desplegados
const expandidos = new Set<number>();    // "ver más" del texto
const videoActivo = new Set<number>();   // link de video ya reproducido
let respondiendo: { post: number; com: number } | null = null;
let editandoCom: number | null = null;
let cargando = false;

interface Adjunto { path?: string; file?: File; preview: string }
interface Composer { imagenes: Adjunto[]; video: Adjunto | null; link: string; mostrarLink: boolean }
const comp: Record<Prefijo, Composer> = {
  bn: { imagenes: [], video: null, link: '', mostrarLink: false },
  be: { imagenes: [], video: null, link: '', mostrarLink: false },
};
let editPostId: number | null = null;

// ─── Ayudas ────────────────────────────────────────────────────────
function uid(): string { return app().currentProfile?.id || ''; }
function esWebmaster(): boolean {
  const p = app().currentProfile;
  return !!p && p.role === 'admin' && !!p.is_webmaster;
}
function empresa(id: number | null): Empresa | undefined {
  return id ? app().orgs.find(o => o.id === id) : undefined;
}
function iniciales(t: string): string {
  return t.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}
function avatarHtml(p: BlogPostRow): string {
  const o = empresa(p.empresa_id);
  if (o?.logo) return `<img class="bp-avatar" src="${esc(o.logo)}" alt="">`;
  const nombre = o ? o.nombre : nombreUsuario(p.autor_id);
  return `<span class="bp-avatar bp-avatar--txt${o ? '' : ' bp-avatar--persona'}">${esc(iniciales(nombre))}</span>`;
}
function msg(id: string, t: string, tipo: 'ok' | 'err' = 'err'): void {
  const el = $(id);
  if (!el) return;
  el.textContent = t;
  el.className = `form-msg ${tipo}`;
  el.style.display = t ? 'block' : 'none';
}
const comsDe = (postId: number) => det.comentarios.filter(c => c.post_id === postId);
const likesDe = (postId: number) => det.likes.filter(l => l.post_id === postId);
const likesCom = (comId: number) => det.likesComentarios.filter(l => l.comentario_id === comId);

// Reemplaza los datos (comentarios y me gusta) de esos posteos.
function mezclarDetalles(ids: number[], nuevos: Blog.DetallesPosts): void {
  const set = new Set(ids);
  const comViejos = new Set(det.comentarios.filter(c => set.has(c.post_id)).map(c => c.id));
  det = {
    comentarios: det.comentarios.filter(c => !set.has(c.post_id)).concat(nuevos.comentarios),
    likes: det.likes.filter(l => !set.has(l.post_id)).concat(nuevos.likes),
    likesComentarios: det.likesComentarios.filter(l => !comViejos.has(l.comentario_id)).concat(nuevos.likesComentarios),
  };
}

async function firmar(lista: BlogPostRow[]): Promise<void> {
  const faltan = lista.flatMap(p => [...p.imagenes, ...(p.video_path ? [p.video_path] : [])]).filter(x => !urls.has(x));
  if (!faltan.length) return;
  try {
    const m = await Blog.urlsFirmadas(faltan);
    m.forEach((v, k) => urls.set(k, v));
  } catch (e) {
    console.warn('No se pudieron preparar las imágenes del blog:', friendlyError(e));
  }
}

// ─── Carga del feed ────────────────────────────────────────────────
async function cargarInicio(): Promise<void> {
  if (cargando) return;
  cargando = true;
  $('blog-lista').innerHTML = '<div class="empty">Cargando…</div>';
  try {
    urls.clear();
    posts = await Blog.listPosts(filtro === 'mios' ? { autorId: uid() } : {});
    fin = posts.length < Blog.BLOG_PAGINA;
    det = await Blog.detallesDe(posts.map(p => p.id));
    await firmar(posts);
    renderLista();
  } catch (e) {
    $('blog-lista').innerHTML = `<div class="empty">${esc(friendlyError(e))}</div>`;
  } finally {
    cargando = false;
  }
}

window.blogMas = async function () {
  if (cargando || fin || !posts.length) return;
  cargando = true;
  try {
    const ult = posts[posts.length - 1];
    const mas = await Blog.listPosts({ ...(filtro === 'mios' ? { autorId: uid() } : {}), antesDe: { created_at: ult.created_at, id: ult.id } });
    fin = mas.length < Blog.BLOG_PAGINA;
    const nuevos = mas.filter(p => !posts.some(x => x.id === p.id));
    mezclarDetalles(nuevos.map(p => p.id), await Blog.detallesDe(nuevos.map(p => p.id)));
    await firmar(nuevos);
    posts = posts.concat(nuevos);
    renderLista();
  } catch (e) {
    alert(friendlyError(e));
  } finally {
    cargando = false;
  }
};

// Vuelve a leer un posteo (y sus comentarios/me gusta) y redibuja su tarjeta.
async function recargarPost(id: number): Promise<void> {
  const p = await Blog.getPost(id);
  if (!p) {
    posts = posts.filter(x => x.id !== id);
    mezclarDetalles([id], { comentarios: [], likes: [], likesComentarios: [] });
    renderLista();
    return;
  }
  mezclarDetalles([id], await Blog.detallesDe([id]));
  await firmar([p]);
  const i = posts.findIndex(x => x.id === id);
  if (i >= 0) posts[i] = p; else posts.unshift(p);
  const el = document.getElementById('bp-' + id);
  if (el && i >= 0) el.outerHTML = postHtml(p); else renderLista();
}

window.renderBlog = function () {
  renderComposerNuevo();
  void cargarInicio();
};

window.blogFiltro = function (el, f) {
  document.querySelectorAll('#blog-filtros .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  filtro = f === 'mios' ? 'mios' : 'todos';
  void cargarInicio();
};

function renderLista(): void {
  $('blog-count').textContent = String(posts.length) + (fin ? '' : '+');
  $('blog-lista').innerHTML = posts.length
    ? posts.map(postHtml).join('')
    : `<div class="empty"><i class="ti ti-news"></i>${filtro === 'mios' ? 'Todavía no publicaste nada.' : 'Todavía no hay publicaciones. ¡Escribí la primera!'}</div>`;
  $('blog-mas').classList.toggle('hidden', fin || !posts.length);
}

// ─── Tarjeta de un posteo ──────────────────────────────────────────
function mediaHtml(p: BlogPostRow): string {
  if (p.imagenes.length) {
    return `<div class="bp-grid bp-grid-${p.imagenes.length}">${p.imagenes.map((path, i) => {
      const u = urls.get(path);
      return `<button class="bp-img" onclick="blogVerImagen(${p.id},${i})" aria-label="Ver imagen ${i + 1}">${u
        ? `<img src="${esc(u)}" alt="Imagen ${i + 1} de la publicación" loading="lazy">`
        : '<span class="bp-img-falta"><i class="ti ti-photo-off"></i></span>'}</button>`;
    }).join('')}</div>`;
  }
  if (p.video_path) {
    const u = urls.get(p.video_path);
    return u
      ? `<video class="bp-video" controls preload="metadata" playsinline src="${esc(u)}"></video>`
      : '<div class="bp-img-falta bp-video-falta"><i class="ti ti-video-off"></i></div>';
  }
  const v = Blog.videoExterno(p.video_url);
  if (v) {
    if (videoActivo.has(p.id)) {
      return `<div class="bp-embed"><iframe src="${esc(Blog.urlEmbed(v))}" title="Video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    }
    const thumb = v.tipo === 'youtube' ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : '';
    return `<button class="bp-play" onclick="blogVideo(${p.id})" aria-label="Reproducir video">
      ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}
      <span class="bp-play-icon"><i class="ti ti-player-play-filled"></i></span>
      <span class="bp-play-fuente">${v.tipo === 'youtube' ? 'YouTube' : 'Vimeo'}</span></button>`;
  }
  return '';
}

function textoPostHtml(p: BlogPostRow): string {
  if (!p.texto) return '';
  const largo = p.texto.length > 400 && !expandidos.has(p.id);
  const t = largo ? p.texto.slice(0, 400).replace(/\s+\S*$/, '') + '…' : p.texto;
  return `<div class="bp-texto">${Blog.textoHtml(t)}${largo ? ` <button class="bp-link" onclick="blogVerMas(${p.id})">ver más</button>` : ''}</div>`;
}

function menuPostHtml(p: BlogPostRow): string {
  const mio = p.autor_id === uid();
  const wm = esWebmaster();
  const ops: string[] = [];
  if (mio && !p.oculto) ops.push(`<button onclick="blogEditar(${p.id})"><i class="ti ti-pencil"></i> Editar</button>`);
  if (mio) ops.push(`<button onclick="blogBorrar(${p.id})"><i class="ti ti-trash"></i> Borrar</button>`);
  if (!mio && !p.oculto) ops.push(`<button onclick="blogPedirMotivo('denunciar','post',${p.id})"><i class="ti ti-flag"></i> Denunciar</button>`);
  if (wm) {
    ops.push(p.oculto
      ? `<button onclick="blogMostrar('post',${p.id})"><i class="ti ti-eye"></i> Mostrar (moderación)</button>`
      : `<button onclick="blogPedirMotivo('ocultar','post',${p.id})"><i class="ti ti-eye-off"></i> Ocultar (moderación)</button>`);
    if (!mio) ops.push(`<button onclick="blogBorrar(${p.id})"><i class="ti ti-trash"></i> Borrar (moderación)</button>`);
  }
  return ops.length
    ? `<details class="bp-menu"><summary aria-label="Opciones"><i class="ti ti-dots"></i></summary><div class="bp-menu-ops">${ops.join('')}</div></details>`
    : '';
}

function postHtml(p: BlogPostRow): string {
  const o = empresa(p.empresa_id);
  const persona = nombreUsuario(p.autor_id);
  const likes = likesDe(p.id);
  const yoLike = likes.some(l => l.user_id === uid());
  const coms = comsDe(p.id);
  const nombre = o
    ? `<button class="bp-nombre" onclick="openDetail(${o.id})">${esc(o.nombre)}</button><div class="bp-sub">por ${esc(persona)}`
    : `<span class="bp-nombre">${esc(persona)}</span><div class="bp-sub">a título personal`;
  return `<article class="bp-card${p.oculto ? ' bp-oculto' : ''}" id="bp-${p.id}">
    <header class="bp-head">
      ${avatarHtml(p)}
      <div class="bp-autor">${nombre} · <span title="${esc(fechaHora(p.created_at))}">${esc(Blog.tiempoRelativo(p.created_at))}</span>${p.editado_at ? ' · editado' : ''}</div></div>
      ${menuPostHtml(p)}
    </header>
    ${p.oculto ? `<div class="bp-aviso"><i class="ti ti-eye-off"></i> Oculto por un webmaster${p.oculto_motivo ? ': ' + esc(p.oculto_motivo) : ''}. Solo lo ven su autor y los webmasters.</div>` : ''}
    ${textoPostHtml(p)}
    ${mediaHtml(p)}
    <div class="bp-stats">
      ${likes.length ? `<button class="bp-link" onclick="blogVerLikes('post',${p.id})"><i class="ti ti-thumb-up"></i> ${likes.length}</button>` : '<span></span>'}
      ${coms.length ? `<button class="bp-link" onclick="blogToggleComentarios(${p.id})">${coms.length} comentario${coms.length !== 1 ? 's' : ''}</button>` : ''}
    </div>
    <div class="bp-acciones">
      <button class="bp-accion${yoLike ? ' activo' : ''}" onclick="blogMeGusta('post',${p.id})" ${p.oculto ? 'disabled' : ''}><i class="ti ti-thumb-up"></i> Me gusta</button>
      <button class="bp-accion" onclick="blogToggleComentarios(${p.id})"><i class="ti ti-message-circle"></i> Comentar</button>
    </div>
    ${abiertos.has(p.id) ? comentariosHtml(p) : ''}
  </article>`;
}

// ─── Comentarios ───────────────────────────────────────────────────
function comentarioHtml(c: BlogComentarioRow, p: BlogPostRow, esRespuesta: boolean): string {
  const mio = c.autor_id === uid();
  const wm = esWebmaster();
  const lk = likesCom(c.id);
  const yo = lk.some(l => l.user_id === uid());
  const editando = editandoCom === c.id;
  const ops: string[] = [];
  const disponible = !c.oculto && !p.oculto;
  ops.push(`<button class="bp-link${yo ? ' activo' : ''}" onclick="blogMeGusta('comentario',${c.id})" ${disponible ? '' : 'disabled'}>Me gusta</button>`);
  if (lk.length) ops.push(`<button class="bp-link" onclick="blogVerLikes('comentario',${c.id})"><i class="ti ti-thumb-up"></i> ${lk.length}</button>`);
  if (!esRespuesta && disponible) ops.push(`<button class="bp-link" onclick="blogResponder(${p.id},${c.id})">Responder</button>`);
  if (mio && !c.oculto) ops.push(`<button class="bp-link" onclick="blogEditarComentario(${c.id})">Editar</button>`);
  if (mio || wm) ops.push(`<button class="bp-link" onclick="blogBorrarComentario(${c.id})">Borrar</button>`);
  if (!mio && disponible) ops.push(`<button class="bp-link" onclick="blogPedirMotivo('denunciar','comentario',${c.id})">Denunciar</button>`);
  if (wm) ops.push(c.oculto
    ? `<button class="bp-link" onclick="blogMostrar('comentario',${c.id})">Mostrar</button>`
    : `<button class="bp-link" onclick="blogPedirMotivo('ocultar','comentario',${c.id})">Ocultar</button>`);
  return `<div class="bc${esRespuesta ? ' bc-resp' : ''}${c.oculto ? ' bc-oculto' : ''}" id="bc-${c.id}">
    <div class="bc-burbuja">
      <div class="bc-autor">${esc(nombreUsuario(c.autor_id))} <span class="bp-sub" title="${esc(fechaHora(c.created_at))}">${esc(Blog.tiempoRelativo(c.created_at))}${c.editado_at ? ' · editado' : ''}</span></div>
      ${c.oculto ? `<div class="bp-aviso"><i class="ti ti-eye-off"></i> Oculto por un webmaster${c.oculto_motivo ? ': ' + esc(c.oculto_motivo) : ''}.</div>` : ''}
      ${editando
        ? `<textarea class="form-input bc-input" id="bce-${c.id}" maxlength="${Blog.MAX_COMENTARIO}" aria-label="Editar comentario">${esc(c.texto)}</textarea>
           <div class="bc-ops"><button class="btn-prim btn-sm-txt" onclick="blogGuardarComentario(${c.id})">Guardar</button>
           <button class="btn-out btn-sm-txt" onclick="blogCancelarComentario()">Cancelar</button></div>`
        : `<div class="bc-texto">${Blog.textoHtml(c.texto)}</div>`}
    </div>
    ${editando ? '' : `<div class="bc-ops">${ops.join('')}</div>`}
  </div>`;
}

function formComentarioHtml(postId: number, parentId: number | null): string {
  const idf = `bcf-${postId}-${parentId ?? 0}`;
  return `<div class="bc-form${parentId ? ' bc-resp' : ''}">
    <textarea class="form-input bc-input" id="${idf}" rows="1" maxlength="${Blog.MAX_COMENTARIO}"
      placeholder="${parentId ? 'Escribí una respuesta…' : 'Escribí un comentario…'}" aria-label="${parentId ? 'Respuesta' : 'Comentario'}"
      onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();blogComentar(${postId},${parentId ?? 'null'})}"></textarea>
    <button class="btn-prim btn-sm-txt" onclick="blogComentar(${postId},${parentId ?? 'null'})"><i class="ti ti-send"></i></button>
  </div>`;
}

function comentariosHtml(p: BlogPostRow): string {
  const hilos = Blog.armarHilos(comsDe(p.id));
  return `<div class="bp-coms">
    ${p.oculto ? '' : formComentarioHtml(p.id, null)}
    ${hilos.map(h => `${comentarioHtml(h.c, p, false)}
      ${h.respuestas.map(r => comentarioHtml(r, p, true)).join('')}
      ${respondiendo && respondiendo.com === h.c.id ? formComentarioHtml(p.id, h.c.id) : ''}`).join('')}
    <div class="form-msg" id="bp-msg-${p.id}"></div>
  </div>`;
}

window.blogToggleComentarios = function (id) {
  if (abiertos.has(id)) abiertos.delete(id); else abiertos.add(id);
  const p = posts.find(x => x.id === id);
  const el = document.getElementById('bp-' + id);
  if (p && el) el.outerHTML = postHtml(p);
  if (abiertos.has(id)) (document.getElementById(`bcf-${id}-0`) as HTMLTextAreaElement | null)?.focus();
};

window.blogResponder = function (postId, comId) {
  respondiendo = { post: postId, com: comId };
  const p = posts.find(x => x.id === postId);
  const el = document.getElementById('bp-' + postId);
  if (p && el) el.outerHTML = postHtml(p);
  (document.getElementById(`bcf-${postId}-${comId}`) as HTMLTextAreaElement | null)?.focus();
};

window.blogComentar = async function (postId, parentId) {
  const input = document.getElementById(`bcf-${postId}-${parentId ?? 0}`) as HTMLTextAreaElement | null;
  if (!input) return;
  const texto = input.value.trim();
  if (!texto) return;
  if (texto.length > Blog.MAX_COMENTARIO) { msg(`bp-msg-${postId}`, 'El comentario puede tener hasta 2000 caracteres.'); return; }
  input.disabled = true;
  try {
    await Blog.comentar(postId, parentId, texto);
    if (parentId) respondiendo = null;
    abiertos.add(postId);
    await recargarPost(postId);
  } catch (e) {
    input.disabled = false;
    msg(`bp-msg-${postId}`, friendlyError(e));
  }
};

window.blogEditarComentario = function (id) {
  editandoCom = id;
  const c = det.comentarios.find(x => x.id === id);
  const p = c && posts.find(x => x.id === c.post_id);
  const el = p && document.getElementById('bp-' + p.id);
  if (p && el) el.outerHTML = postHtml(p);
  (document.getElementById('bce-' + id) as HTMLTextAreaElement | null)?.focus();
};

window.blogCancelarComentario = function () {
  const c = det.comentarios.find(x => x.id === editandoCom);
  editandoCom = null;
  const p = c && posts.find(x => x.id === c.post_id);
  const el = p && document.getElementById('bp-' + p.id);
  if (p && el) el.outerHTML = postHtml(p);
};

window.blogGuardarComentario = async function (id) {
  const c = det.comentarios.find(x => x.id === id);
  const input = document.getElementById('bce-' + id) as HTMLTextAreaElement | null;
  if (!c || !input) return;
  try {
    await Blog.editarComentario(id, input.value);
    editandoCom = null;
    await recargarPost(c.post_id);
  } catch (e) {
    msg(`bp-msg-${c.post_id}`, friendlyError(e));
  }
};

window.blogBorrarComentario = async function (id) {
  const c = det.comentarios.find(x => x.id === id);
  if (!c) return;
  const tieneResp = det.comentarios.some(x => x.parent_id === id);
  if (!confirm(`¿Borrar este comentario${tieneResp ? ' y sus respuestas' : ''}? No se puede deshacer.`)) return;
  try {
    await Blog.borrarComentario(id);
    await recargarPost(c.post_id);
    if ($('wm-sec-blog') && !$('wm-sec-blog').classList.contains('hidden')) void renderModeracionBlog();
  } catch (e) {
    alert(friendlyError(e));
  }
};

// ─── Me gusta ──────────────────────────────────────────────────────
window.blogMeGusta = async function (tipo, id) {
  const postId = tipo === 'post' ? id : det.comentarios.find(c => c.id === id)?.post_id;
  if (!postId) return;
  try {
    await Blog.meGusta(tipo, id);
    await recargarPost(postId);
  } catch (e) {
    alert(friendlyError(e));
  }
};

window.blogVerLikes = function (tipo, id) {
  const lista = tipo === 'post' ? likesDe(id) : likesCom(id);
  $('blog-likes-titulo').textContent = `Les gusta (${lista.length})`;
  $('blog-likes-lista').innerHTML = lista.length
    ? lista.map(l => {
        const u = app().getProfileById(l.user_id);
        const emps = u ? app().orgs.filter(o => (o.usuarios || []).includes(u.id)).map(o => o.nombre) : [];
        return `<li><i class="ti ti-thumb-up"></i> <strong>${esc(nombreUsuario(l.user_id))}</strong>${emps.length ? ` <span class="muted-sm">· ${esc(emps.join(', '))}</span>` : ''}</li>`;
      }).join('')
    : '<li class="muted-sm">Nadie todavía.</li>';
  $('modal-blog-likes').classList.add('open');
};

// ─── Medios ────────────────────────────────────────────────────────
window.blogVerImagen = function (postId, idx) {
  const p = posts.find(x => x.id === postId);
  const u = p && urls.get(p.imagenes[idx]);
  if (!u) return;
  $<HTMLImageElement>('blog-imagen-grande').src = u;
  $('modal-blog-imagen').classList.add('open');
};

window.blogVideo = function (postId) {
  videoActivo.add(postId);
  const p = posts.find(x => x.id === postId);
  const el = document.getElementById('bp-' + postId);
  if (p && el) el.outerHTML = postHtml(p);
};

window.blogVerMas = function (id) {
  expandidos.add(id);
  const p = posts.find(x => x.id === id);
  const el = document.getElementById('bp-' + id);
  if (p && el) el.outerHTML = postHtml(p);
};

window.blogCerrarModal = function (id) {
  $(id).classList.remove('open');
  if (id === 'modal-blog-imagen') $<HTMLImageElement>('blog-imagen-grande').removeAttribute('src');
};

// ─── Publicar / editar ─────────────────────────────────────────────
function composerHtml(p: Prefijo): string {
  return `<textarea class="form-input bp-composer-texto" id="${p}-texto" maxlength="${Blog.MAX_TEXTO}"
      placeholder="¿Qué querés compartir con la red? Novedades, logros, búsquedas, eventos…" aria-label="Texto de la publicación"></textarea>
    <div class="bp-adjuntos" id="${p}-adjuntos"></div>
    <div class="bp-link-wrap hidden" id="${p}-link-wrap">
      <input class="form-input" id="${p}-link" type="url" maxlength="300" placeholder="Link de YouTube o Vimeo (https://…)" aria-label="Link de video"
        oninput="this.dataset.tocado='1'">
    </div>
    <div class="bp-composer-barra">
      <button type="button" class="btn-out btn-sm-txt" onclick="blogElegirArchivo('${p}','imagen')"><i class="ti ti-photo"></i> Fotos</button>
      <button type="button" class="btn-out btn-sm-txt" onclick="blogElegirArchivo('${p}','video')"><i class="ti ti-video"></i> Video</button>
      <button type="button" class="btn-out btn-sm-txt" onclick="blogToggleLink('${p}')"><i class="ti ti-brand-youtube"></i> Link de video</button>
      <input type="file" id="${p}-file-imagen" class="hidden" accept="${Blog.TIPOS_IMAGEN.join(',')}" multiple onchange="blogArchivos('${p}','imagen')">
      <input type="file" id="${p}-file-video" class="hidden" accept="${Blog.TIPOS_VIDEO.join(',')}" onchange="blogArchivos('${p}','video')">
    </div>
    <p class="hint-text hint-tight">Hasta 4 fotos (5 MB c/u) o 1 video (MP4/WebM hasta 50 MB, o un link de YouTube/Vimeo).</p>
    <div class="form-msg" id="${p}-msg"></div>`;
}

function renderComposerNuevo(): void {
  const c = app();
  const sel = $<HTMLSelectElement>('bn-como');
  const prev = sel.value;
  const mias = c.orgs.filter(o => c.misEmpresas().has(o.id));
  sel.innerHTML = mias.map(o => `<option value="${o.id}">${esc(o.nombre)}</option>`).join('') +
    `<option value="">A mi nombre (${esc(`${c.currentProfile?.nombre || ''} ${c.currentProfile?.apellido || ''}`.trim())})</option>`;
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  renderAdjuntos('bn');
}

function renderAdjuntos(p: Prefijo): void {
  const c = comp[p];
  const partes: string[] = [];
  c.imagenes.forEach((a, i) => partes.push(`<div class="bp-adj"><img src="${esc(a.preview)}" alt="Imagen ${i + 1}">
    <button type="button" onclick="blogQuitarAdjunto('${p}','img-${i}')" aria-label="Quitar imagen ${i + 1}">×</button></div>`));
  if (c.video) partes.push(`<div class="bp-adj bp-adj-video"><video src="${esc(c.video.preview)}" muted preload="metadata"></video>
    <button type="button" onclick="blogQuitarAdjunto('${p}','video')" aria-label="Quitar video">×</button></div>`);
  $(`${p}-adjuntos`).innerHTML = partes.join('');
  $(`${p}-link-wrap`).classList.toggle('hidden', !c.mostrarLink);
}

window.blogElegirArchivo = function (p, tipo) {
  $<HTMLInputElement>(`${p}-file-${tipo}`).click();
};

window.blogArchivos = function (p, tipo) {
  const input = $<HTMLInputElement>(`${p}-file-${tipo}`);
  const files = [...(input.files || [])];
  input.value = '';
  const c = comp[p];
  msg(`${p}-msg`, '');
  const hayLink = c.mostrarLink && $<HTMLInputElement>(`${p}-link`).value.trim() !== '';
  for (const f of files) {
    const err = Blog.validarArchivo(f, tipo);
    if (err) { msg(`${p}-msg`, err); continue; }
    if (tipo === 'imagen') {
      if (c.video || hayLink) { msg(`${p}-msg`, 'Una publicación lleva fotos o un video, no las dos cosas.'); break; }
      if (c.imagenes.length >= Blog.MAX_IMAGENES) { msg(`${p}-msg`, 'Podés agregar hasta 4 fotos.'); break; }
      c.imagenes.push({ file: f, preview: URL.createObjectURL(f) });
    } else {
      if (c.imagenes.length || hayLink) { msg(`${p}-msg`, 'Una publicación lleva fotos o un video, no las dos cosas.'); break; }
      if (c.video?.file) URL.revokeObjectURL(c.video.preview);
      c.video = { file: f, preview: URL.createObjectURL(f) };
    }
  }
  renderAdjuntos(p);
};

window.blogQuitarAdjunto = function (p, cual) {
  const c = comp[p];
  if (cual === 'video') {
    if (c.video?.file) URL.revokeObjectURL(c.video.preview);
    c.video = null;
  } else {
    const i = Number(cual.replace('img-', ''));
    const a = c.imagenes[i];
    if (a?.file) URL.revokeObjectURL(a.preview);
    c.imagenes.splice(i, 1);
  }
  renderAdjuntos(p);
};

window.blogToggleLink = function (p) {
  const c = comp[p];
  c.mostrarLink = !c.mostrarLink;
  if (!c.mostrarLink) $<HTMLInputElement>(`${p}-link`).value = '';
  renderAdjuntos(p);
  if (c.mostrarLink) $<HTMLInputElement>(`${p}-link`).focus();
};

function limpiarComposer(p: Prefijo): void {
  const c = comp[p];
  c.imagenes.forEach(a => { if (a.file) URL.revokeObjectURL(a.preview); });
  if (c.video?.file) URL.revokeObjectURL(c.video.preview);
  comp[p] = { imagenes: [], video: null, link: '', mostrarLink: false };
  $<HTMLTextAreaElement>(`${p}-texto`).value = '';
  $<HTMLInputElement>(`${p}-link`).value = '';
  renderAdjuntos(p);
}

// Valida, sube los archivos nuevos y devuelve lo que hay que mandar a la base.
async function prepararEnvio(p: Prefijo): Promise<{ texto: string; media: Blog.MediaPost; subidos: string[] } | null> {
  const c = comp[p];
  const texto = $<HTMLTextAreaElement>(`${p}-texto`).value.trim();
  const link = c.mostrarLink ? $<HTMLInputElement>(`${p}-link`).value.trim() : '';
  if (!texto && !c.imagenes.length && !c.video && !link) { msg(`${p}-msg`, 'Escribí algo o agregá una foto o un video.'); return null; }
  if (texto.length > Blog.MAX_TEXTO) { msg(`${p}-msg`, 'El texto puede tener hasta 5000 caracteres.'); return null; }
  if (link && !Blog.videoUrlValida(link)) { msg(`${p}-msg`, 'El link tiene que ser de un video de YouTube o Vimeo (https://…).'); return null; }
  if ((c.imagenes.length && (c.video || link)) || (c.video && link)) { msg(`${p}-msg`, 'Una publicación lleva fotos o un video, no las dos cosas.'); return null; }
  const nuevos = [...c.imagenes.filter(a => a.file), ...(c.video?.file ? [c.video] : [])];
  const subidos: string[] = [];
  try {
    for (let i = 0; i < nuevos.length; i++) {
      msg(`${p}-msg`, `Subiendo ${i + 1} de ${nuevos.length}…`, 'ok');
      const path = await Blog.subirArchivo(uid(), nuevos[i].file!);
      nuevos[i].path = path;
      subidos.push(path);
    }
  } catch (e) {
    await Blog.borrarArchivos(subidos);
    nuevos.forEach(a => { if (subidos.includes(a.path || '')) delete a.path; });
    msg(`${p}-msg`, 'No se pudo subir el archivo: ' + friendlyError(e));
    return null;
  }
  return {
    texto,
    media: { imagenes: c.imagenes.map(a => a.path!).filter(Boolean), videoPath: c.video?.path || null, videoUrl: link || null },
    subidos,
  };
}

window.blogPublicar = async function () {
  const btn = $<HTMLButtonElement>('bn-publicar');
  btn.disabled = true;
  try {
    const env = await prepararEnvio('bn');
    if (!env) return;
    const empresaId = $<HTMLSelectElement>('bn-como').value ? Number($<HTMLSelectElement>('bn-como').value) : null;
    try {
      await Blog.publicar(empresaId, env.texto, env.media);
    } catch (e) {
      await Blog.borrarArchivos(env.subidos);
      comp.bn.imagenes.forEach(a => { if (a.file) delete a.path; });
      if (comp.bn.video?.file) delete comp.bn.video.path;
      msg('bn-msg', friendlyError(e));
      return;
    }
    limpiarComposer('bn');
    msg('bn-msg', '✓ Publicado.', 'ok');
    setTimeout(() => msg('bn-msg', ''), 2500);
    await cargarInicio();
  } finally {
    btn.disabled = false;
  }
};

window.blogEditar = function (id) {
  const p = posts.find(x => x.id === id);
  if (!p) return;
  editPostId = id;
  comp.be = {
    imagenes: p.imagenes.map(path => ({ path, preview: urls.get(path) || '' })),
    video: p.video_path ? { path: p.video_path, preview: urls.get(p.video_path) || '' } : null,
    link: p.video_url || '',
    mostrarLink: !!p.video_url,
  };
  $<HTMLTextAreaElement>('be-texto').value = p.texto;
  $<HTMLInputElement>('be-link').value = p.video_url || '';
  const o = empresa(p.empresa_id);
  $('be-como').textContent = o ? `Publicado como ${o.nombre}` : 'Publicado a tu nombre';
  msg('be-msg', '');
  renderAdjuntos('be');
  $('modal-blog-editar').classList.add('open');
};

window.blogCerrarEdicion = function () {
  limpiarComposer('be');
  editPostId = null;
  $('modal-blog-editar').classList.remove('open');
};

window.blogGuardarEdicion = async function () {
  if (!editPostId) return;
  const id = editPostId;
  const btn = $<HTMLButtonElement>('be-guardar');
  btn.disabled = true;
  try {
    const env = await prepararEnvio('be');
    if (!env) return;
    let r: { quitados: string[] };
    try {
      r = await Blog.editar(id, env.texto, env.media);
    } catch (e) {
      await Blog.borrarArchivos(env.subidos);
      comp.be.imagenes.forEach(a => { if (a.file) delete a.path; });
      if (comp.be.video?.file) delete comp.be.video.path;
      msg('be-msg', friendlyError(e));
      return;
    }
    await Blog.borrarArchivos(r.quitados || []);
    window.blogCerrarEdicion();
    await recargarPost(id);
  } finally {
    btn.disabled = false;
  }
};

window.blogBorrar = async function (id) {
  const p = posts.find(x => x.id === id);
  const ajeno = p && p.autor_id !== uid();
  if (!confirm(ajeno ? '¿Borrar esta publicación de otro usuario (moderación)? No se puede deshacer.' : '¿Borrar tu publicación? No se puede deshacer.')) return;
  try {
    const archivos = await Blog.borrar(id);
    await Blog.borrarArchivos(archivos);
    posts = posts.filter(x => x.id !== id);
    mezclarDetalles([id], { comentarios: [], likes: [], likesComentarios: [] });
    renderLista();
    if ($('wm-sec-blog') && !$('wm-sec-blog').classList.contains('hidden')) void renderModeracionBlog();
  } catch (e) {
    alert(friendlyError(e));
  }
};

// ─── Denunciar / ocultar (con motivo) ──────────────────────────────
let motivoPendiente: { accion: 'denunciar' | 'ocultar'; tipo: BlogTipo; id: number } | null = null;

window.blogPedirMotivo = function (accion, tipo, id) {
  motivoPendiente = { accion, tipo, id };
  const que = tipo === 'post' ? 'esta publicación' : 'este comentario';
  $('blog-motivo-titulo').textContent = accion === 'denunciar' ? `Denunciar ${que}` : `Ocultar ${que}`;
  $('blog-motivo-ayuda').textContent = accion === 'denunciar'
    ? 'Contale a los webmasters por qué no debería estar en la red. Tu denuncia es privada.'
    : 'Deja de verse para todos (salvo su autor y los webmasters). Podés volver a mostrarlo cuando quieras.';
  $<HTMLTextAreaElement>('blog-motivo-texto').value = '';
  $<HTMLTextAreaElement>('blog-motivo-texto').placeholder = accion === 'denunciar' ? 'Motivo (obligatorio)' : 'Motivo (opcional, lo ve el autor)';
  $('blog-motivo-ok').innerHTML = accion === 'denunciar' ? '<i class="ti ti-flag"></i> Denunciar' : '<i class="ti ti-eye-off"></i> Ocultar';
  msg('blog-motivo-msg', '');
  $('modal-blog-motivo').classList.add('open');
  $<HTMLTextAreaElement>('blog-motivo-texto').focus();
};

window.blogMotivoConfirmar = async function () {
  if (!motivoPendiente) return;
  const { accion, tipo, id } = motivoPendiente;
  const motivo = $<HTMLTextAreaElement>('blog-motivo-texto').value.trim();
  if (accion === 'denunciar' && !motivo) { msg('blog-motivo-msg', 'Escribí el motivo de la denuncia.'); return; }
  try {
    if (accion === 'denunciar') await Blog.denunciar(tipo, id, motivo);
    else await Blog.moderar(tipo, id, 'ocultar', motivo || null);
    motivoPendiente = null;
    $('modal-blog-motivo').classList.remove('open');
    await despuesDeModerar(tipo, id);
    if (accion === 'denunciar') alert('Gracias. Los webmasters van a revisar la denuncia.');
  } catch (e) {
    msg('blog-motivo-msg', friendlyError(e));
  }
};

window.blogMostrar = async function (tipo, id) {
  try {
    await Blog.moderar(tipo, id, 'mostrar', null);
    await despuesDeModerar(tipo, id);
  } catch (e) {
    alert(friendlyError(e));
  }
};

async function despuesDeModerar(tipo: BlogTipo, id: number): Promise<void> {
  const postId = tipo === 'post' ? id : det.comentarios.find(c => c.id === id)?.post_id;
  if (postId && posts.some(p => p.id === postId)) await recargarPost(postId);
  if ($('wm-sec-blog') && !$('wm-sec-blog').classList.contains('hidden')) await renderModeracionBlog();
}

// ─── Panel de moderación (pestaña Webmaster → Blog) ────────────────
function extracto(t: string, n = 160): string {
  return t.length > n ? t.slice(0, n) + '…' : t;
}

export async function renderModeracionBlog(): Promise<void> {
  const cuerpo = $('wm-blog-denuncias');
  const ocultos = $('wm-blog-ocultos');
  cuerpo.innerHTML = '<tr><td colspan="5" class="empty">Cargando…</td></tr>';
  try {
    const [den, oc] = await Promise.all([Blog.listDenunciasAbiertas(), Blog.listOcultos()]);
    const postIds = [...new Set(den.filter(d => d.post_id).map(d => d.post_id!))];
    const comIds = [...new Set(den.filter(d => d.comentario_id).map(d => d.comentario_id!))];
    const [ps, cs] = await Promise.all([Blog.postsPorId(postIds), Blog.comentariosPorId(comIds)]);
    const describir = (d: BlogDenunciaRow) => {
      if (d.post_id) {
        const p = ps.find(x => x.id === d.post_id);
        const o = p && empresa(p.empresa_id);
        return p ? `<strong>Publicación</strong> de ${esc(o ? o.nombre : nombreUsuario(p.autor_id))}<div class="muted-sm">${esc(extracto(p.texto || '(solo imagen o video)'))}</div>` : '—';
      }
      const c = cs.find(x => x.id === d.comentario_id);
      return c ? `<strong>Comentario</strong> de ${esc(nombreUsuario(c.autor_id))}<div class="muted-sm">${esc(extracto(c.texto))}</div>` : '—';
    };
    $('wm-blog-count').textContent = String(den.length);
    cuerpo.innerHTML = den.length
      ? den.map(d => {
          const tipo: BlogTipo = d.post_id ? 'post' : 'comentario';
          const id = (d.post_id || d.comentario_id)!;
          return `<tr>
            <td class="td-sm nowrap">${esc(fechaHora(d.created_at))}</td>
            <td class="td-sm">${esc(nombreUsuario(d.denunciante_id))}</td>
            <td class="td-sm">${describir(d)}</td>
            <td class="td-sm">${esc(d.motivo)}</td>
            <td><div class="action-btns">
              <button class="btn-out btn-sm-txt" onclick="blogPedirMotivo('ocultar','${tipo}',${id})"><i class="ti ti-eye-off"></i> Ocultar</button>
              <button class="btn-out btn-sm-txt" onclick="blogModDescartar(${d.id})">Descartar</button>
              <button class="btn-danger btn-sm-txt" onclick="blogModBorrar('${tipo}',${id})"><i class="ti ti-trash"></i></button>
            </div></td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="5" class="empty">No hay denuncias abiertas.</td></tr>';
    const filas = [
      ...oc.posts.map(p => ({ tipo: 'post' as BlogTipo, id: p.id, quien: empresa(p.empresa_id)?.nombre || nombreUsuario(p.autor_id), texto: p.texto || '(solo imagen o video)', motivo: p.oculto_motivo, at: p.oculto_at })),
      ...oc.comentarios.map(c => ({ tipo: 'comentario' as BlogTipo, id: c.id, quien: nombreUsuario(c.autor_id), texto: c.texto, motivo: c.oculto_motivo, at: c.oculto_at })),
    ];
    ocultos.innerHTML = filas.length
      ? filas.map(f => `<tr>
          <td class="td-sm nowrap">${esc(fechaHora(f.at))}</td>
          <td class="td-sm"><strong>${f.tipo === 'post' ? 'Publicación' : 'Comentario'}</strong> de ${esc(f.quien)}<div class="muted-sm">${esc(extracto(f.texto))}</div></td>
          <td class="td-sm">${esc(f.motivo || '—')}</td>
          <td><div class="action-btns">
            <button class="btn-out btn-sm-txt" onclick="blogMostrar('${f.tipo}',${f.id})"><i class="ti ti-eye"></i> Mostrar</button>
            <button class="btn-danger btn-sm-txt" onclick="blogModBorrar('${f.tipo}',${f.id})"><i class="ti ti-trash"></i></button>
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="empty">No hay contenido oculto.</td></tr>';
  } catch (e) {
    cuerpo.innerHTML = `<tr><td colspan="5" class="empty">${esc(friendlyError(e))}</td></tr>`;
  }
}

window.blogModDescartar = async function (id) {
  try {
    await Blog.descartarDenuncia(id);
    await renderModeracionBlog();
  } catch (e) {
    alert(friendlyError(e));
  }
};

window.blogModBorrar = async function (tipo, id) {
  if (!confirm(`¿Borrar ${tipo === 'post' ? 'esta publicación' : 'este comentario'} definitivamente? No se puede deshacer.`)) return;
  try {
    if (tipo === 'post') {
      await Blog.borrarArchivos(await Blog.borrar(id));
      posts = posts.filter(x => x.id !== id);
    } else {
      const postId = det.comentarios.find(c => c.id === id)?.post_id;
      await Blog.borrarComentario(id);
      if (postId) await recargarPost(postId);
    }
    await renderModeracionBlog();
  } catch (e) {
    alert(friendlyError(e));
  }
};

// ─── Inicio / salida ───────────────────────────────────────────────
export function initBlogUI(): void {
  $('bn-composer').innerHTML = composerHtml('bn');
  $('be-composer').innerHTML = composerHtml('be');
  for (const id of ['modal-blog-editar', 'modal-blog-likes', 'modal-blog-imagen', 'modal-blog-motivo']) {
    $(id).addEventListener('click', function (e) {
      if (e.target === this) {
        if (id === 'modal-blog-editar') window.blogCerrarEdicion(); else window.blogCerrarModal(id);
      }
    });
  }
  // Cerrar el menú de opciones al tocar fuera.
  document.addEventListener('click', e => {
    document.querySelectorAll<HTMLDetailsElement>('.bp-menu[open]').forEach(d => { if (!d.contains(e.target as Node)) d.open = false; });
  });
}

export function resetBlogUI(): void {
  posts = [];
  fin = false;
  filtro = 'todos';
  det = { comentarios: [], likes: [], likesComentarios: [] };
  urls.clear();
  abiertos.clear();
  expandidos.clear();
  videoActivo.clear();
  respondiendo = null;
  editandoCom = null;
  motivoPendiente = null;
  if (document.getElementById('bn-texto')) limpiarComposer('bn');
  if (document.getElementById('be-texto')) window.blogCerrarEdicion();
  document.querySelectorAll('#blog-filtros .chip').forEach((c, i) => c.classList.toggle('active', i === 0));
  const l = document.getElementById('blog-lista');
  if (l) l.innerHTML = '';
}
