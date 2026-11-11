// ══════════════════════════════════════════════
// Pestaña "Webmaster" (solo admins con permiso de webmaster):
//  · Bitácora de movimientos, con filtros.
//  · Todas las conexiones, con su estado y si hubo contacto (cantidad de
//    mensajes y fechas; nunca el contenido, que la base no le entrega).
//  · Administración de categorías y subcategorías sugeridas.
// ══════════════════════════════════════════════
import * as Conexiones from './conexiones.ts';
import * as Empresas from './empresas.ts';
import * as Webmaster from './webmaster.ts';
import * as Solicitudes from './solicitudes.ts';
import { fraseSolicitud, nombreDestino, nombreOrigen } from './ui-solicitudes.ts';
import { renderModeracionBlog } from './ui-blog.ts';
import { app, fechaHora, nombreUsuario } from './contexto.ts';
import { estadoNeutral, type EstadoNeutral } from './matching.ts';
import { esc, friendlyError, normalizeTagKey } from './utils.ts';
import type { BitacoraRow, ConexionRow, ContactoResumenRow, SolicitudResumenRow, SolicitudRow } from './types.ts';

declare global {
  interface Window {
    renderWebmaster(): void;
    wmSeccion(el: HTMLElement, seccion: string): void;
    wmBuscarBitacora(): Promise<void>;
    wmMasBitacora(): Promise<void>;
    wmRenderConexiones(): void;
    wmRenderSolicitudes(): void;
    wmCrearCategoria(): Promise<void>;
    wmGuardarCategoria(id: number): Promise<void>;
    wmBorrarCategoria(id: number): Promise<void>;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

let seccion: 'bitacora' | 'conexiones' | 'solicitudes' | 'blog' | 'categorias' = 'bitacora';
let bitacora: BitacoraRow[] = [];
let bitacoraFin = false;
let wmConexiones: ConexionRow[] = [];
let wmContacto: ContactoResumenRow[] = [];
let wmSolicitudes: SolicitudRow[] = [];
let wmSolContacto: SolicitudResumenRow[] = [];

// Acciones registradas en la bitácora (ver sql/012), con su texto.
export const ACCIONES: Record<string, string> = {
  sesion_inicio: 'Inicio de sesión',
  sesion_cierre: 'Cierre de sesión',
  registro: 'Registro de cuenta',
  perfil_edicion: 'Edición de perfil',
  rol_cambio: 'Cambio de rol',
  webmaster_cambio: 'Cambio de permiso webmaster',
  empresa_alta: 'Alta de empresa',
  empresa_edicion: 'Edición de empresa',
  empresa_cambio_titular: 'Cambio de administrador principal',
  empresa_baja: 'Baja de empresa',
  empresa_items_cambio: 'Cambio de ofertas/necesidades',
  asociacion_alta: 'Usuario asociado a empresa',
  asociacion_baja: 'Usuario quitado de empresa',
  categoria_alta: 'Alta de categoría',
  categoria_edicion: 'Edición de categoría',
  categoria_baja: 'Baja de categoría',
  conexion_aceptada: 'Conexión aceptada',
  conexion_retirada: 'Aceptación retirada',
  conexion_rechazada: 'Conexión rechazada',
  conexion_match: 'Match',
  mensaje_enviado: 'Mensaje enviado (sin contenido)',
  solicitud_enviada: 'Solicitud enviada',
  solicitud_aceptada: 'Solicitud aceptada',
  solicitud_rechazada: 'Solicitud rechazada',
  solicitud_cancelada: 'Solicitud cancelada',
  solicitud_mensaje: 'Mensaje de solicitud (sin contenido)',
  solicitud_como_conexion: 'Solicitud sobre una coincidencia existente',
  blog_post_publicado: 'Blog: publicación',
  blog_post_editado: 'Blog: publicación editada',
  blog_post_borrado: 'Blog: publicación borrada',
  blog_comentario: 'Blog: comentario',
  blog_comentario_editado: 'Blog: comentario editado',
  blog_comentario_borrado: 'Blog: comentario borrado',
  blog_denuncia: 'Blog: denuncia',
  blog_moderacion: 'Blog: moderación',
  blog_denuncia_descartada: 'Blog: denuncia descartada',
};

const CAMPOS: Record<string, string> = {
  nombre: 'nombre', apellido: 'apellido', telefono: 'teléfono', email: 'email', tel: 'teléfono',
  email_org: 'email', web: 'sitio web', descripcion: 'descripción', logo: 'logo', cuit: 'CUIT', tipo: 'tipo',
  sector: 'sector', calle: 'calle', ciudad: 'ciudad', provincia: 'provincia', pais: 'país',
  referente: 'referente', cargo: 'cargo', instalaciones: 'instalaciones', needs_covered: 'necesidades cubiertas',
  uid: 'administrador principal', ofertas: 'ofertas (formato anterior)', needs_uncovered: 'necesidades (formato anterior)',
};

function txt(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

// Texto legible del detalle de un evento.
export function describirEvento(r: BitacoraRow): string {
  const d = r.detalle || {};
  const lista = (v: unknown) => Array.isArray(v) ? v.map(x => CAMPOS[txt(x)] || txt(x)).join(', ') : '';
  const items = (v: unknown) => Array.isArray(v)
    ? v.map(x => {
        const o = x as Record<string, unknown>;
        const et = o.subcategoria ? `${txt(o.categoria)} › ${txt(o.subcategoria)}` : txt(o.categoria);
        return `${o.tipo === 'oferta' ? 'oferta' : 'necesidad'} ${et}`;
      }).join('; ')
    : '';
  const conexion = () => `${txt(d.empresa_necesita)} necesita ${txt(d.categoria)} ← ${txt(d.empresa_ofrece)}`;
  switch (r.accion) {
    case 'registro': return `${txt(d.usuario)} (${txt(d.email)})`;
    case 'perfil_edicion': return `${txt(d.usuario)}: ${lista(d.campos)}`;
    case 'rol_cambio': return `${txt(d.usuario)}: ${txt(d.antes)} → ${txt(d.despues)}`;
    case 'webmaster_cambio': return `${txt(d.usuario)}: ${d.webmaster ? 'otorgado' : 'quitado'}`;
    case 'empresa_alta':
    case 'empresa_baja': return `${txt(d.empresa)} (CUIT ${txt(d.cuit)})`;
    case 'empresa_edicion':
    case 'empresa_cambio_titular': return `${txt(d.empresa)}: ${lista(d.campos)}`;
    case 'empresa_items_cambio': {
      const partes: string[] = [];
      const ag = items(d.agregados); const qu = items(d.quitados);
      if (ag) partes.push(`agregó ${ag}`);
      if (qu) partes.push(`quitó ${qu}`);
      return `${txt(d.empresa)}: ${partes.join(' · ')}`;
    }
    case 'asociacion_alta':
    case 'asociacion_baja': return `${txt(d.usuario)} ↔ ${txt(d.empresa)}`;
    case 'categoria_alta':
    case 'categoria_baja': return txt(d.categoria);
    case 'categoria_edicion': return d.nombre_anterior ? `${txt(d.nombre_anterior)} → ${txt(d.categoria)}` : `${txt(d.categoria)} (subcategorías)`;
    case 'conexion_aceptada':
    case 'conexion_retirada':
    case 'conexion_rechazada': return `${conexion()} · como ${txt(d.como_empresa)}`;
    case 'conexion_match': return conexion();
    case 'mensaje_enviado': return `${conexion()} · escribió ${txt(d.como_empresa)}`;
    case 'solicitud_enviada':
    case 'solicitud_aceptada':
    case 'solicitud_rechazada':
    case 'solicitud_cancelada':
    case 'solicitud_mensaje':
    case 'solicitud_como_conexion': {
      const que = d.subcategoria ? `${txt(d.categoria)} › ${txt(d.subcategoria)}` : txt(d.categoria);
      const base = d.tipo === 'ofrecer'
        ? `${txt(d.origen)} ofrece ${que} a ${txt(d.destino)}`
        : `${txt(d.origen)} quiere conseguir ${que} de ${txt(d.destino)}`;
      if (r.accion === 'solicitud_mensaje') return `${base} · escribió ${d.lado === 'destino' ? txt(d.destino) : txt(d.origen)}`;
      if (r.accion === 'solicitud_como_conexion') {
        const res: Record<string, string> = {
          conexion_aceptada: 'contó como aceptación de la conexión', conexion_match: 'generó match',
          conexion_ya_aceptada: 'la conexión ya estaba aceptada', conexion_en_match: 'ya estaban en match',
        };
        return `${base} · ${res[txt(d.resultado)] || txt(d.resultado)}`;
      }
      return base;
    }
    case 'blog_post_publicado': {
      const m = d.video ? ' con video' : Number(d.imagenes) ? ` con ${txt(d.imagenes)} imagen${Number(d.imagenes) !== 1 ? 'es' : ''}` : '';
      return `Publicó como ${txt(d.como)}${m} (#${txt(r.entidad_id)})`;
    }
    case 'blog_post_editado': return `Editó la publicación #${txt(r.entidad_id)} de ${txt(d.como)}`;
    case 'blog_post_borrado': return `${d.moderacion ? 'Borró por moderación' : 'Borró'} la publicación #${txt(r.entidad_id)} de ${txt(d.como)}`;
    case 'blog_comentario': return `${d.respuesta ? 'Respondió un comentario' : 'Comentó'} en la publicación #${txt(r.entidad_id)}`;
    case 'blog_comentario_editado': return `Editó un comentario en la publicación #${txt(r.entidad_id)}`;
    case 'blog_comentario_borrado': return `${d.moderacion ? 'Borró por moderación' : 'Borró'} un comentario de ${txt(d.autor)} en la publicación #${txt(r.entidad_id)}`;
    case 'blog_denuncia': return `Denunció ${d.tipo === 'post' ? 'la publicación' : 'un comentario'} de ${txt(d.autor)} (publicación #${txt(r.entidad_id)})`;
    case 'blog_moderacion': return `${d.accion === 'ocultar' ? 'Ocultó' : 'Volvió a mostrar'} ${d.tipo === 'post' ? 'la publicación' : 'un comentario'} de ${txt(d.autor)} (#${txt(r.entidad_id)})${d.motivo ? ': ' + txt(d.motivo) : ''}`;
    case 'blog_denuncia_descartada': return `Descartó una denuncia sobre ${d.tipo === 'post' ? 'la publicación' : 'el comentario'} #${txt(d.id)}`;
    default: return '';
  }
}

window.wmSeccion = function (el, s) {
  document.querySelectorAll('#wm-secciones .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  seccion = s === 'conexiones' ? 'conexiones' : s === 'solicitudes' ? 'solicitudes' : s === 'blog' ? 'blog' : s === 'categorias' ? 'categorias' : 'bitacora';
  window.renderWebmaster();
};

window.renderWebmaster = function () {
  const c = app();
  if (!c.currentProfile?.is_webmaster) return;
  (['bitacora', 'conexiones', 'solicitudes', 'blog', 'categorias'] as const).forEach(s => $('wm-sec-' + s).classList.toggle('hidden', s !== seccion));
  if (seccion === 'bitacora') {
    llenarFiltrosBitacora();
    if (!bitacora.length && !bitacoraFin) void window.wmBuscarBitacora();
    else renderBitacora();
  } else if (seccion === 'conexiones') {
    void cargarConexiones();
  } else if (seccion === 'solicitudes') {
    void cargarSolicitudes();
  } else if (seccion === 'blog') {
    void renderModeracionBlog();
  } else {
    renderCategorias();
  }
};

// ─── Bitácora ──────────────────────────────────────────────────────
function llenarFiltrosBitacora(): void {
  const selU = $<HTMLSelectElement>('wm-f-usuario');
  const prevU = selU.value;
  selU.innerHTML = '<option value="">Todos los usuarios</option>' +
    app().profiles.map(u => `<option value="${esc(u.id)}">${esc(`${u.nombre} ${u.apellido || ''}`.trim())} (${esc(u.email || '')})</option>`).join('');
  if ([...selU.options].some(o => o.value === prevU)) selU.value = prevU;
  const selA = $<HTMLSelectElement>('wm-f-accion');
  if (selA.options.length <= 1) {
    selA.innerHTML = '<option value="">Todas las acciones</option>' +
      Object.entries(ACCIONES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  }
}

function filtroActual(): Webmaster.FiltroBitacora {
  return {
    userId: $<HTMLSelectElement>('wm-f-usuario').value || undefined,
    accion: $<HTMLSelectElement>('wm-f-accion').value || undefined,
    desde: $<HTMLInputElement>('wm-f-desde').value || undefined,
    hasta: $<HTMLInputElement>('wm-f-hasta').value || undefined,
  };
}

window.wmBuscarBitacora = async function () {
  $('wm-bit-body').innerHTML = '<tr><td colspan="4" class="empty">Cargando…</td></tr>';
  try {
    bitacora = await Webmaster.listBitacora(filtroActual(), 0);
    bitacoraFin = bitacora.length < Webmaster.BITACORA_PAGINA;
    renderBitacora();
  } catch (e) {
    $('wm-bit-body').innerHTML = `<tr><td colspan="4" class="empty">${esc(friendlyError(e))}</td></tr>`;
  }
};

window.wmMasBitacora = async function () {
  try {
    const mas = await Webmaster.listBitacora(filtroActual(), bitacora.length);
    bitacora = bitacora.concat(mas);
    bitacoraFin = mas.length < Webmaster.BITACORA_PAGINA;
    renderBitacora();
  } catch (e) {
    alert(friendlyError(e));
  }
};

function renderBitacora(): void {
  $('wm-bit-count').textContent = String(bitacora.length) + (bitacoraFin ? '' : '+');
  $('wm-bit-mas').classList.toggle('hidden', bitacoraFin);
  $('wm-bit-body').innerHTML = bitacora.length
    ? bitacora.map(r => `<tr>
        <td class="td-sm nowrap">${esc(fechaHora(r.created_at))}</td>
        <td class="td-sm">${esc(r.user_nombre || '—')}${r.user_email ? `<div class="muted-sm">${esc(r.user_email)}</div>` : ''}</td>
        <td class="td-sm"><span class="wm-accion wm-accion--${esc(r.accion.split('_')[0])}">${esc(ACCIONES[r.accion] || r.accion)}</span></td>
        <td class="td-sm">${esc(describirEvento(r))}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="empty">Sin movimientos para ese criterio.</td></tr>';
}

// ─── Conexiones ────────────────────────────────────────────────────
const ESTADO_NEUTRAL_TXT: Record<EstadoNeutral, string> = {
  sugerida: 'Sin aceptaciones',
  acepto_necesita: 'Aceptó quien necesita',
  acepto_ofrece: 'Aceptó quien ofrece',
  match: 'Match',
  rechazada: 'Rechazada',
};

async function cargarConexiones(): Promise<void> {
  $('wm-con-body').innerHTML = '<tr><td colspan="7" class="empty">Cargando…</td></tr>';
  try {
    [wmConexiones, wmContacto] = await Promise.all([Conexiones.listConexiones(), Webmaster.contactoResumen()]);
    window.wmRenderConexiones();
  } catch (e) {
    $('wm-con-body').innerHTML = `<tr><td colspan="7" class="empty">${esc(friendlyError(e))}</td></tr>`;
  }
}

function aceptacion(at: string | null, por: string | null): string {
  return at ? `${esc(fechaHora(at))}<div class="muted-sm">${esc(nombreUsuario(por))}</div>` : '<span class="muted-sm">—</span>';
}

window.wmRenderConexiones = function () {
  const c = app();
  const orgName = (id: number) => c.orgs.find(o => o.id === id)?.nombre || `Empresa #${id}`;
  const fEstado = $<HTMLSelectElement>('wm-c-estado').value;
  const q = ($<HTMLInputElement>('wm-c-buscar').value || '').toLowerCase();
  const filas = wmConexiones.filter(r => {
    const est = estadoNeutral(r);
    if (fEstado === 'match_sin_contacto') {
      if (est !== 'match' || wmContacto.some(x => x.conexion_id === r.id)) return false;
    } else if (fEstado === 'pendiente') {
      if (est !== 'acepto_necesita' && est !== 'acepto_ofrece') return false;
    } else if (fEstado && est !== fEstado) return false;
    if (!q) return true;
    return [orgName(r.empresa_necesita_id), orgName(r.empresa_ofrece_id), c.categoriaById(r.categoria_id)?.nombre || ''].join(' ').toLowerCase().includes(q);
  });
  $('wm-con-count').textContent = String(filas.length);
  $('wm-con-body').innerHTML = filas.length
    ? filas.map(r => {
        const est = estadoNeutral(r);
        const cont = wmContacto.filter(x => x.conexion_id === r.id);
        let contacto = '<span class="muted-sm">—</span>';
        if (est === 'match') {
          if (!cont.length) {
            contacto = '<span class="wm-contacto wm-contacto--no">Sin contacto</span>';
          } else {
            const porEmp = (id: number) => cont.find(x => x.empresa_id === id)?.cantidad || 0;
            const primero = cont.map(x => x.primer_mensaje).sort()[0];
            const ultimo = cont.map(x => x.ultimo_mensaje).sort().slice(-1)[0];
            contacto = `<span class="wm-contacto wm-contacto--si">Hubo contacto</span>
              <div class="muted-sm">${esc(orgName(r.empresa_necesita_id))}: ${porEmp(r.empresa_necesita_id)} msj · ${esc(orgName(r.empresa_ofrece_id))}: ${porEmp(r.empresa_ofrece_id)} msj</div>
              <div class="muted-sm">Primero: ${esc(fechaHora(primero))} · Último: ${esc(fechaHora(ultimo))}</div>`;
          }
        }
        return `<tr>
          <td class="td-sm"><strong>${esc(orgName(r.empresa_necesita_id))}</strong></td>
          <td class="td-sm"><strong>${esc(orgName(r.empresa_ofrece_id))}</strong></td>
          <td class="td-sm">${esc(c.categoriaById(r.categoria_id)?.nombre || '—')}</td>
          <td class="td-sm"><span class="cx-badge cx-badge--${est === 'match' ? 'match' : est === 'rechazada' ? 'rechazada' : est === 'sugerida' ? 'sugerida' : 'esperando_otra'}">${ESTADO_NEUTRAL_TXT[est]}</span>
            ${r.match_at ? `<div class="muted-sm">${esc(fechaHora(r.match_at))}</div>` : ''}
            ${r.rechazada_at ? `<div class="muted-sm">por ${esc(orgName(r.rechazada_empresa_id || 0))}, ${esc(fechaHora(r.rechazada_at))}</div>` : ''}</td>
          <td class="td-sm">${aceptacion(r.acepta_necesita_at, r.acepta_necesita_por)}</td>
          <td class="td-sm">${aceptacion(r.acepta_ofrece_at, r.acepta_ofrece_por)}</td>
          <td class="td-sm">${contacto}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="7" class="empty">No hay conexiones para ese criterio.</td></tr>';
};

// ─── Solicitudes ───────────────────────────────────────────────────
// Hubo contacto = alguna de las partes escribió después de aceptada (el
// mensaje inicial no cuenta).
function huboContacto(s: SolicitudRow, cont: SolicitudResumenRow[]): boolean {
  return !!s.respondida_at && cont.some(x => new Date(x.ultimo_mensaje).getTime() > new Date(s.respondida_at!).getTime());
}

const SOL_ESTADO_TXT: Record<SolicitudRow['estado'], string> = {
  pendiente: 'Pendiente', aceptada: 'Aceptada', rechazada: 'Rechazada', cancelada: 'Cancelada',
};

async function cargarSolicitudes(): Promise<void> {
  $('wm-sol-body').innerHTML = '<tr><td colspan="6" class="empty">Cargando…</td></tr>';
  try {
    [wmSolicitudes, wmSolContacto] = await Promise.all([Solicitudes.listSolicitudes(), Solicitudes.resumenWebmaster()]);
    window.wmRenderSolicitudes();
  } catch (e) {
    $('wm-sol-body').innerHTML = `<tr><td colspan="6" class="empty">${esc(friendlyError(e))}</td></tr>`;
  }
}

window.wmRenderSolicitudes = function () {
  const c = app();
  const fEstado = $<HTMLSelectElement>('wm-s-estado').value;
  const q = ($<HTMLInputElement>('wm-s-buscar').value || '').toLowerCase();
  const filas = wmSolicitudes.filter(s => {
    const cont = wmSolContacto.filter(x => x.solicitud_id === s.id);
    if (fEstado === 'aceptada_sin_contacto') {
      if (s.estado !== 'aceptada' || huboContacto(s, cont)) return false;
    } else if (fEstado && s.estado !== fEstado) return false;
    if (!q) return true;
    return [nombreOrigen(s), nombreDestino(s), c.categoriaById(s.categoria_id)?.nombre || '', s.subcategoria].join(' ').toLowerCase().includes(q);
  });
  $('wm-sol-count').textContent = String(filas.length);
  $('wm-sol-body').innerHTML = filas.length
    ? filas.map(s => {
        const cont = wmSolContacto.filter(x => x.solicitud_id === s.id);
        const n = (lado: 'origen' | 'destino') => cont.find(x => x.lado === lado)?.cantidad || 0;
        let contacto = '<span class="muted-sm">—</span>';
        if (s.estado === 'aceptada') {
          contacto = huboContacto(s, cont)
            ? `<span class="wm-contacto wm-contacto--si">Hubo contacto</span>
               <div class="muted-sm">${esc(nombreOrigen(s))}: ${n('origen')} msj · ${esc(nombreDestino(s))}: ${n('destino')} msj</div>
               <div class="muted-sm">Último: ${esc(fechaHora(cont.map(x => x.ultimo_mensaje).sort().slice(-1)[0]))}</div>`
            : '<span class="wm-contacto wm-contacto--no">Sin contacto</span>';
        } else if (n('origen')) {
          contacto = '<span class="muted-sm">Con mensaje inicial</span>';
        }
        const badge = s.estado === 'aceptada' ? 'match' : s.estado === 'pendiente' ? 'esperando_otra' : 'rechazada';
        return `<tr>
          <td class="td-sm nowrap">${esc(fechaHora(s.created_at))}</td>
          <td class="td-sm"><strong>${esc(nombreOrigen(s))}</strong><div class="muted-sm">${esc(nombreUsuario(s.enviada_por))}</div></td>
          <td class="td-sm"><strong>${esc(nombreDestino(s))}</strong></td>
          <td class="td-sm">${fraseSolicitud(s)}</td>
          <td class="td-sm"><span class="cx-badge cx-badge--${badge}">${SOL_ESTADO_TXT[s.estado]}</span>
            ${s.respondida_at ? `<div class="muted-sm">${esc(fechaHora(s.respondida_at))} · ${esc(nombreUsuario(s.respondida_por))}</div>` : ''}</td>
          <td class="td-sm">${contacto}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="6" class="empty">No hay solicitudes para ese criterio.</td></tr>';
};

// ─── Categorías ────────────────────────────────────────────────────
function parseSubs(raw: string): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const s of raw.split(/[,\n]/)) {
    const v = s.trim().replace(/\s+/g, ' ');
    const k = normalizeTagKey(v);
    if (!v || vistos.has(k)) continue;
    vistos.add(k);
    out.push(v.slice(0, 120));
  }
  return out;
}

function usoCategoria(id: number): number {
  return app().orgs.reduce((n, o) => n + o.items.filter(i => i.categoriaId === id).length, 0);
}

function renderCategorias(): void {
  const cats = app().categorias;
  $('wm-cat-count').textContent = String(cats.length);
  $('wm-cat-body').innerHTML = cats.map(cat => {
    const uso = usoCategoria(cat.id);
    return `<tr>
      <td><input class="form-input" id="wm-cat-nombre-${cat.id}" value="${esc(cat.nombre)}" ${cat.esOtros ? 'disabled title="La categoría Otros no se puede renombrar"' : ''}></td>
      <td><textarea class="form-input wm-subs" id="wm-cat-subs-${cat.id}" ${cat.esOtros ? 'disabled' : ''} placeholder="Separadas por coma">${esc(cat.subcategorias.join(', '))}</textarea></td>
      <td class="td-sm">${uso}</td>
      <td><div class="action-btns">
        ${cat.esOtros ? '<span class="muted-sm">Categoría del sistema</span>' : `
        <button class="btn-edit-inline" onclick="wmGuardarCategoria(${cat.id})" title="Guardar cambios"><i class="ti ti-device-floppy"></i></button>
        <button class="btn-danger" onclick="wmBorrarCategoria(${cat.id})" ${uso ? 'disabled title="No se puede borrar: hay empresas que la usan"' : 'title="Borrar categoría"'}><i class="ti ti-trash"></i></button>`}
      </div></td>
    </tr>`;
  }).join('');
}

function catMsg(t: string, tipo: 'ok' | 'err'): void {
  const el = $('wm-cat-msg');
  el.textContent = t;
  el.className = `form-msg ${tipo}`;
  el.style.display = 'block';
}

window.wmCrearCategoria = async function () {
  const nombre = $<HTMLInputElement>('wm-cat-nueva').value.trim().replace(/\s+/g, ' ');
  const subs = parseSubs($<HTMLTextAreaElement>('wm-cat-nueva-subs').value);
  if (!nombre) { catMsg('Escribí el nombre de la categoría.', 'err'); return; }
  if (app().categorias.some(c => normalizeTagKey(c.nombre) === normalizeTagKey(nombre))) { catMsg('Ya existe una categoría con ese nombre.', 'err'); return; }
  try {
    await Empresas.crearCategoria(nombre, subs);
    await app().refresh();
    $<HTMLInputElement>('wm-cat-nueva').value = '';
    $<HTMLTextAreaElement>('wm-cat-nueva-subs').value = '';
    renderCategorias();
    catMsg(`✓ Categoría "${nombre}" creada.`, 'ok');
  } catch (e) {
    catMsg(friendlyError(e), 'err');
  }
};

window.wmGuardarCategoria = async function (id) {
  const cat = app().categoriaById(id);
  if (!cat) return;
  const nombre = $<HTMLInputElement>('wm-cat-nombre-' + id).value.trim().replace(/\s+/g, ' ');
  const subs = parseSubs($<HTMLTextAreaElement>('wm-cat-subs-' + id).value);
  if (!nombre) { catMsg('El nombre no puede quedar vacío.', 'err'); return; }
  if (app().categorias.some(c => c.id !== id && normalizeTagKey(c.nombre) === normalizeTagKey(nombre))) { catMsg('Ya existe otra categoría con ese nombre.', 'err'); return; }
  if (nombre !== cat.nombre && usoCategoria(id) &&
      !confirm(`¿Renombrar "${cat.nombre}" a "${nombre}"? Se actualiza en las ${usoCategoria(id)} ofertas/necesidades que la usan.`)) return;
  try {
    await Empresas.actualizarCategoria(id, nombre, subs);
    await app().refresh();
    renderCategorias();
    catMsg(`✓ Categoría "${nombre}" guardada.`, 'ok');
  } catch (e) {
    catMsg(friendlyError(e), 'err');
  }
};

window.wmBorrarCategoria = async function (id) {
  const cat = app().categoriaById(id);
  if (!cat) return;
  if (!confirm(`¿Borrar la categoría "${cat.nombre}"?`)) return;
  try {
    await Empresas.borrarCategoria(id);
    await app().refresh();
    renderCategorias();
    catMsg(`✓ Categoría "${cat.nombre}" borrada.`, 'ok');
  } catch (e) {
    catMsg(friendlyError(e), 'err');
  }
};

// Al salir de la app no debe quedar la bitácora de otro usuario en memoria.
export function resetWebmasterUI(): void {
  bitacora = [];
  bitacoraFin = false;
  wmConexiones = [];
  wmContacto = [];
  wmSolicitudes = [];
  wmSolContacto = [];
  seccion = 'bitacora';
  document.querySelectorAll('#wm-secciones .chip').forEach((c, i) => c.classList.toggle('active', i === 0));
}
