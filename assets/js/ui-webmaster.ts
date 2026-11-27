// ══════════════════════════════════════════════
// Pestaña "Webmaster" (solo admins con permiso de webmaster):
//  · Bitácora de movimientos, con filtros.
//  · Todas las conexiones, con su estado y si hubo contacto (cantidad de
//    mensajes y fechas; nunca el contenido, que la base no le entrega).
//  · Administración de categorías y subcategorías sugeridas.
// ══════════════════════════════════════════════
import * as Empresas from './empresas.ts';
import * as Webmaster from './webmaster.ts';
import { buscarEmpresas, filtrosVacios, limpiarCache, listSectores } from './directorio.ts';
import { getSupabase } from './supabaseClient.ts';
import { buscadorUsuario, paginadorHtml } from './ui-listas.ts';
import { renderModeracionBlog } from './ui-blog.ts';
import { app, fechaHora } from './contexto.ts';
import { etiquetaItem, type EstadoNeutral } from './matching.ts';
import { esc, friendlyError, normalizeTagKey } from './utils.ts';
import type { BitacoraRow, ConexionRow, SectorRow, SolicitudRow } from './types.ts';

declare global {
  interface Window {
    renderWebmaster(): void;
    wmSeccion(el: HTMLElement, seccion: string): void;
    wmBuscarBitacora(): Promise<void>;
    wmBitIr(n: number): void;
    wmBitTam(n: number): void;
    wmConIr(n: number): void;
    wmConTam(n: number): void;
    wmSolIr(n: number): void;
    wmSolTam(n: number): void;
    wmCrearSector(): Promise<void>;
    wmGuardarSector(id: number): Promise<void>;
    wmBorrarSector(id: number): Promise<void>;
    wmRenderConexiones(): void;
    wmRenderSolicitudes(): void;
    wmCrearCategoria(): Promise<void>;
    wmGuardarCategoria(id: number): Promise<void>;
    wmBorrarCategoria(id: number): Promise<void>;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

type Seccion = 'bitacora' | 'conexiones' | 'solicitudes' | 'blog' | 'categorias' | 'sectores';
let seccion: Seccion = 'bitacora';
let bitacora: BitacoraRow[] = [];
const bit = { pagina: 1, tamano: 25, total: 0, cargada: false, pedido: 0, usuario: null as string | null };
const con = { pagina: 1, tamano: 25, pedido: 0 };
const sol = { pagina: 1, tamano: 25, pedido: 0 };
let filtrosListos = false;

// Acciones registradas en la bitácora (ver sql/012), con su texto.
export const ACCIONES: Record<string, string> = {
  sesion_inicio: 'Inicio de sesión',
  sesion_cierre: 'Cierre de sesión',
  sesion_inactividad: 'Cierre por inactividad',
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
  seccion = (['conexiones', 'solicitudes', 'blog', 'categorias', 'sectores'] as const).find(x => x === s) || 'bitacora';
  window.renderWebmaster();
};

window.renderWebmaster = function () {
  const c = app();
  if (!c.currentProfile?.is_webmaster) return;
  (['bitacora', 'conexiones', 'solicitudes', 'blog', 'categorias', 'sectores'] as const).forEach(s => $('wm-sec-' + s).classList.toggle('hidden', s !== seccion));
  iniciarFiltros();
  if (seccion === 'bitacora') {
    if (!bit.cargada) void window.wmBuscarBitacora();
    else renderBitacora();
  } else if (seccion === 'sectores') {
    void renderSectores();
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
// Filtros: usuario con sugerencias (no una lista con todos), acción y
// fechas. Se aplican solos al cambiar. Páginas numeradas.
function iniciarFiltros(): void {
  if (filtrosListos) return;
  filtrosListos = true;
  const selA = $<HTMLSelectElement>('wm-f-accion');
  selA.innerHTML = '<option value="">Todas las acciones</option>' +
    Object.entries(ACCIONES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  buscadorUsuario($<HTMLInputElement>('wm-f-usuario'), u => { bit.usuario = u?.id ?? null; void window.wmBuscarBitacora(); });
  ['wm-f-accion', 'wm-f-desde', 'wm-f-hasta'].forEach(id => $(id).addEventListener('change', () => void window.wmBuscarBitacora()));
  let tc: number | undefined;
  $('wm-c-buscar').addEventListener('input', () => { window.clearTimeout(tc); tc = window.setTimeout(() => { con.pagina = 1; void cargarConexiones(); }, 250); });
  $('wm-c-estado').addEventListener('change', () => { con.pagina = 1; void cargarConexiones(); });
  let ts: number | undefined;
  $('wm-s-buscar').addEventListener('input', () => { window.clearTimeout(ts); ts = window.setTimeout(() => { sol.pagina = 1; void cargarSolicitudes(); }, 250); });
  $('wm-s-estado').addEventListener('change', () => { sol.pagina = 1; void cargarSolicitudes(); });
}

function filtroActual(): Webmaster.FiltroBitacora {
  return {
    userId: bit.usuario || undefined,
    accion: $<HTMLSelectElement>('wm-f-accion').value || undefined,
    desde: $<HTMLInputElement>('wm-f-desde').value || undefined,
    hasta: $<HTMLInputElement>('wm-f-hasta').value || undefined,
  };
}

async function cargarBitacora(): Promise<void> {
  const mio = ++bit.pedido;
  $('wm-bit-body').setAttribute('aria-busy', 'true');
  try {
    const r = await Webmaster.listBitacora(filtroActual(), (bit.pagina - 1) * bit.tamano, bit.tamano);
    if (mio !== bit.pedido) return;
    bitacora = r.filas;
    bit.total = r.total;
    bit.cargada = true;
    renderBitacora();
  } catch (e) {
    if (mio === bit.pedido) $('wm-bit-body').innerHTML = `<tr><td colspan="4" class="empty">${esc(friendlyError(e))}</td></tr>`;
  } finally {
    $('wm-bit-body').removeAttribute('aria-busy');
  }
}

window.wmBuscarBitacora = async function () {
  bit.pagina = 1;
  await cargarBitacora();
};

const pagina = (est: { pagina: number }, cargar: () => Promise<void>, ancla: string) => (n: number) => {
  est.pagina = Math.max(1, n);
  void cargar().then(() => $(ancla).scrollIntoView({ block: 'start', behavior: 'smooth' }));
};
const tamano = (est: { pagina: number; tamano: number }, cargar: () => Promise<void>) => (n: number) => {
  est.tamano = n; est.pagina = 1; void cargar();
};
window.wmBitIr = pagina(bit, cargarBitacora, 'wm-sec-bitacora');
window.wmBitTam = tamano(bit, cargarBitacora);

function renderBitacora(): void {
  $('wm-bit-count').textContent = bit.total.toLocaleString('es-AR');
  $('wm-bit-pag').innerHTML = bit.total > 25 ? paginadorHtml({ id: 'pag-wm-bit', pagina: bit.pagina, tamano: bit.tamano, total: bit.total, onIr: 'wmBitIr', onTamano: 'wmBitTam', etiqueta: 'la bitácora' }) : '';
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

interface ConexionWm extends ConexionRow {
  necesita_nombre: string | null; ofrece_nombre: string | null; categoria_nombre: string | null; rechazada_empresa_nombre: string | null;
  estado: EstadoNeutral; acepta_necesita_nombre: string | null; acepta_ofrece_nombre: string | null;
  contacto: { empresa_id: number; cantidad: number; primer_mensaje: string; ultimo_mensaje: string }[] | null;
}

async function rpcLista<T>(fn: 'wm_buscar_conexiones' | 'wm_buscar_solicitudes', p: Record<string, unknown>): Promise<{ total: number; items: T[] }> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc(fn, { p });
  if (error) throw error;
  return data as { total: number; items: T[] };
}

async function cargarConexiones(): Promise<void> {
  const mio = ++con.pedido;
  const body = $('wm-con-body');
  body.setAttribute('aria-busy', 'true');
  try {
    const r = await rpcLista<ConexionWm>('wm_buscar_conexiones', {
      q: $<HTMLInputElement>('wm-c-buscar').value, estado: $<HTMLSelectElement>('wm-c-estado').value,
      limite: con.tamano, desde: (con.pagina - 1) * con.tamano,
    });
    if (mio !== con.pedido) return;
    $('wm-con-count').textContent = r.total.toLocaleString('es-AR');
    $('wm-con-pag').innerHTML = r.total > 25 ? paginadorHtml({ id: 'pag-wm-con', pagina: con.pagina, tamano: con.tamano, total: r.total, onIr: 'wmConIr', onTamano: 'wmConTam', etiqueta: 'conexiones' }) : '';
    body.innerHTML = r.items.length ? r.items.map(filaConexion).join('') : '<tr><td colspan="7" class="empty">No hay conexiones para ese criterio.</td></tr>';
  } catch (e) {
    if (mio === con.pedido) body.innerHTML = `<tr><td colspan="7" class="empty">${esc(friendlyError(e))}</td></tr>`;
  } finally {
    body.removeAttribute('aria-busy');
  }
}
window.wmConIr = pagina(con, cargarConexiones, 'wm-sec-conexiones');
window.wmConTam = tamano(con, cargarConexiones);
window.wmRenderConexiones = function () { con.pagina = 1; void cargarConexiones(); };

function aceptacion(at: string | null, nombre: string | null): string {
  return at ? `${esc(fechaHora(at))}<div class="muted-sm">${esc(nombre || 'Usuario')}</div>` : '<span class="muted-sm">—</span>';
}

function filaConexion(r: ConexionWm): string {
  const est = r.estado;
  const nec = r.necesita_nombre || `Empresa #${r.empresa_necesita_id}`;
  const ofe = r.ofrece_nombre || `Empresa #${r.empresa_ofrece_id}`;
  const cont = r.contacto || [];
  let contacto = '<span class="muted-sm">—</span>';
  if (est === 'match') {
    if (!cont.length) {
      contacto = '<span class="wm-contacto wm-contacto--no">Sin contacto</span>';
    } else {
      const porEmp = (id: number) => cont.find(x => x.empresa_id === id)?.cantidad || 0;
      const primero = cont.map(x => x.primer_mensaje).sort()[0];
      const ultimo = cont.map(x => x.ultimo_mensaje).sort().slice(-1)[0];
      contacto = `<span class="wm-contacto wm-contacto--si">Hubo contacto</span>
        <div class="muted-sm">${esc(nec)}: ${porEmp(r.empresa_necesita_id)} msj · ${esc(ofe)}: ${porEmp(r.empresa_ofrece_id)} msj</div>
        <div class="muted-sm">Primero: ${esc(fechaHora(primero))} · Último: ${esc(fechaHora(ultimo))}</div>`;
    }
  }
  return `<tr>
    <td class="td-sm"><strong>${esc(nec)}</strong></td>
    <td class="td-sm"><strong>${esc(ofe)}</strong></td>
    <td class="td-sm">${esc(r.categoria_nombre || '—')}</td>
    <td class="td-sm"><span class="cx-badge cx-badge--${est === 'match' ? 'match' : est === 'rechazada' ? 'rechazada' : est === 'sugerida' ? 'sugerida' : 'esperando_otra'}">${ESTADO_NEUTRAL_TXT[est]}</span>
      ${r.match_at ? `<div class="muted-sm">${esc(fechaHora(r.match_at))}</div>` : ''}
      ${r.rechazada_at ? `<div class="muted-sm">por ${esc(r.rechazada_empresa_nombre || 'una empresa')}, ${esc(fechaHora(r.rechazada_at))}</div>` : ''}</td>
    <td class="td-sm">${aceptacion(r.acepta_necesita_at, r.acepta_necesita_nombre)}</td>
    <td class="td-sm">${aceptacion(r.acepta_ofrece_at, r.acepta_ofrece_nombre)}</td>
    <td class="td-sm">${contacto}</td>
  </tr>`;
}

// ─── Solicitudes ───────────────────────────────────────────────────
interface SolicitudWm extends SolicitudRow {
  categoria_nombre: string | null; destino_nombre: string | null; origen_nombre: string | null;
  enviada_por_nombre: string | null; respondida_por_nombre: string | null; hubo_contacto: boolean;
  contacto: { lado: 'origen' | 'destino'; cantidad: number; primer_mensaje: string; ultimo_mensaje: string }[] | null;
}

const SOL_ESTADO_TXT: Record<SolicitudRow['estado'], string> = {
  pendiente: 'Pendiente', aceptada: 'Aceptada', rechazada: 'Rechazada', cancelada: 'Cancelada',
};

async function cargarSolicitudes(): Promise<void> {
  const mio = ++sol.pedido;
  const body = $('wm-sol-body');
  body.setAttribute('aria-busy', 'true');
  try {
    const r = await rpcLista<SolicitudWm>('wm_buscar_solicitudes', {
      q: $<HTMLInputElement>('wm-s-buscar').value, estado: $<HTMLSelectElement>('wm-s-estado').value,
      limite: sol.tamano, desde: (sol.pagina - 1) * sol.tamano,
    });
    if (mio !== sol.pedido) return;
    $('wm-sol-count').textContent = r.total.toLocaleString('es-AR');
    $('wm-sol-pag').innerHTML = r.total > 25 ? paginadorHtml({ id: 'pag-wm-sol', pagina: sol.pagina, tamano: sol.tamano, total: r.total, onIr: 'wmSolIr', onTamano: 'wmSolTam', etiqueta: 'solicitudes' }) : '';
    body.innerHTML = r.items.length ? r.items.map(filaSolicitud).join('') : '<tr><td colspan="6" class="empty">No hay solicitudes para ese criterio.</td></tr>';
  } catch (e) {
    if (mio === sol.pedido) body.innerHTML = `<tr><td colspan="6" class="empty">${esc(friendlyError(e))}</td></tr>`;
  } finally {
    body.removeAttribute('aria-busy');
  }
}
window.wmSolIr = pagina(sol, cargarSolicitudes, 'wm-sec-solicitudes');
window.wmSolTam = tamano(sol, cargarSolicitudes);
window.wmRenderSolicitudes = function () { sol.pagina = 1; void cargarSolicitudes(); };

function filaSolicitud(s: SolicitudWm): string {
  const cont = s.contacto || [];
  const n = (lado: 'origen' | 'destino') => cont.find(x => x.lado === lado)?.cantidad || 0;
  const origen = s.origen_nombre || '—';
  const destino = s.destino_nombre || '—';
  let contacto = '<span class="muted-sm">—</span>';
  if (s.estado === 'aceptada') {
    contacto = s.hubo_contacto
      ? `<span class="wm-contacto wm-contacto--si">Hubo contacto</span>
         <div class="muted-sm">${esc(origen)}: ${n('origen')} msj · ${esc(destino)}: ${n('destino')} msj</div>
         <div class="muted-sm">Último: ${esc(fechaHora(cont.map(x => x.ultimo_mensaje).sort().slice(-1)[0]))}</div>`
      : '<span class="wm-contacto wm-contacto--no">Sin contacto</span>';
  } else if (n('origen')) {
    contacto = '<span class="muted-sm">Con mensaje inicial</span>';
  }
  const badge = s.estado === 'aceptada' ? 'match' : s.estado === 'pendiente' ? 'esperando_otra' : 'rechazada';
  return `<tr>
    <td class="td-sm nowrap">${esc(fechaHora(s.created_at))}</td>
    <td class="td-sm"><strong>${esc(origen)}</strong><div class="muted-sm">${esc(s.enviada_por_nombre || '')}</div></td>
    <td class="td-sm"><strong>${esc(destino)}</strong></td>
    <td class="td-sm">${s.tipo === 'conseguir' ? 'Quiere conseguir' : 'Ofrece'} <span class="tag ${s.tipo === 'conseguir' ? 'tag-offer' : 'tag-need'}">${esc(etiquetaItem(s.categoria_nombre || '?', s.subcategoria))}</span></td>
    <td class="td-sm"><span class="cx-badge cx-badge--${badge}">${SOL_ESTADO_TXT[s.estado]}</span>
      ${s.respondida_at ? `<div class="muted-sm">${esc(fechaHora(s.respondida_at))} · ${esc(s.respondida_por_nombre || '')}</div>` : ''}</td>
    <td class="td-sm">${contacto}</td>
  </tr>`;
}

// ─── Sectores ──────────────────────────────────────────────────────
async function renderSectores(): Promise<void> {
  const body = $('wm-sec-body');
  try {
    const [secs, r] = await Promise.all([listSectores(true), buscarEmpresas(filtrosVacios(), { limite: 1 })]);
    $('wm-sec-count').textContent = String(secs.length);
    body.innerHTML = secs.map((sc: SectorRow) => {
      const uso = r.facetas.sectores[sc.id] || 0;
      return `<tr>
        <td><input class="form-input wm-orden" type="number" min="0" max="999" id="wm-sec-orden-${sc.id}" value="${sc.orden}" aria-label="Orden de ${esc(sc.nombre)}"></td>
        <td><input class="form-input" id="wm-sec-nombre-${sc.id}" value="${esc(sc.nombre)}" maxlength="80" aria-label="Nombre del sector"></td>
        <td class="td-sm">${uso}</td>
        <td><div class="action-btns">
          <button class="btn-edit-inline" onclick="wmGuardarSector(${sc.id})" title="Guardar cambios" aria-label="Guardar ${esc(sc.nombre)}"><i class="ti ti-device-floppy"></i></button>
          <button class="btn-danger" onclick="wmBorrarSector(${sc.id})" ${uso ? 'disabled title="No se puede borrar: hay organizaciones en este sector"' : 'title="Borrar sector"'} aria-label="Borrar ${esc(sc.nombre)}"><i class="ti ti-trash"></i></button>
        </div></td>
      </tr>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="4" class="empty">${esc(friendlyError(e))}</td></tr>`;
  }
}

function msgSector(t: string, tipo: 'ok' | 'err'): void {
  const m = $('wm-sec-msg');
  m.textContent = t; m.className = 'form-msg ' + tipo; m.style.display = 'block';
}

async function trasCambioSectores(texto: string): Promise<void> {
  limpiarCache();
  await listSectores(true);
  msgSector(texto, 'ok');
  await renderSectores();
}

window.wmCrearSector = async function () {
  const nombre = $<HTMLInputElement>('wm-sec-nuevo').value.trim().replace(/\s+/g, ' ');
  if (nombre.length < 2) { msgSector('Escribí el nombre del sector.', 'err'); return; }
  if ((await listSectores()).some(x => normalizeTagKey(x.nombre) === normalizeTagKey(nombre))) { msgSector('Ya existe un sector con ese nombre.', 'err'); return; }
  try {
    const supabase = await getSupabase();
    const secs = await listSectores();
    const { error } = await supabase.from('sectores').insert({ nombre, orden: Math.max(0, ...secs.map(x => x.orden)) + 1 });
    if (error) throw error;
    $<HTMLInputElement>('wm-sec-nuevo').value = '';
    await trasCambioSectores(`✓ Sector "${nombre}" creado.`);
  } catch (e) {
    msgSector(/duplicate|unique/i.test(String((e as Error).message)) ? 'Ya existe un sector con ese nombre.' : friendlyError(e), 'err');
  }
};

window.wmGuardarSector = async function (id) {
  const nombre = $<HTMLInputElement>(`wm-sec-nombre-${id}`).value.trim().replace(/\s+/g, ' ');
  const orden = Number($<HTMLInputElement>(`wm-sec-orden-${id}`).value) || 0;
  if (nombre.length < 2) { msgSector('El nombre del sector no puede quedar vacío.', 'err'); return; }
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.from('sectores').update({ nombre, orden }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo guardar el sector.');
    await trasCambioSectores('✓ Sector guardado. Las organizaciones ya lo muestran con el nombre nuevo.');
  } catch (e) {
    msgSector(/duplicate|unique/i.test(String((e as Error).message)) ? 'Ya existe un sector con ese nombre.' : friendlyError(e), 'err');
  }
};

window.wmBorrarSector = async function (id) {
  const nombre = $<HTMLInputElement>(`wm-sec-nombre-${id}`).value;
  if (!confirm(`¿Borrar el sector "${nombre}"?`)) return;
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.from('sectores').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo borrar el sector.');
    await trasCambioSectores('✓ Sector borrado.');
  } catch (e) {
    msgSector(/foreign key|violates/i.test(String((e as Error).message)) ? 'No se puede borrar: hay organizaciones en este sector.' : friendlyError(e), 'err');
  }
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
  bit.cargada = false; bit.pagina = 1; bit.total = 0;
  con.pagina = 1; sol.pagina = 1;
  seccion = 'bitacora';
  document.querySelectorAll('#wm-secciones .chip').forEach((c, i) => c.classList.toggle('active', i === 0));
}
