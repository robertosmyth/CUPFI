// ══════════════════════════════════════════════
// Solicitudes (sql/013) en la pantalla "Vinculación":
//  · Buscador preciso "quiero conseguir / quiero ofrecer" por categoría y
//    subcategoría, sobre lo que cargaron las empresas.
//  · Ventana para enviar una solicitud (en nombre de una empresa o a
//    título personal), con mensaje inicial y opción de sumar el ítem.
//  · Tarjetas de solicitudes recibidas / enviadas / aceptadas / cerradas
//    que se muestran dentro de "Mis conexiones".
// El chat de una solicitud aceptada usa la misma ventana de chat que las
// conexiones (ver abrirChatSolicitud en ui-conexiones.ts).
// ══════════════════════════════════════════════
import * as Solicitudes from './solicitudes.ts';
import { app, fechaHora, nombreUsuario } from './contexto.ts';
import { buscarEmpresas, type NivelBusqueda, type ResultadoBusqueda } from './busqueda.ts';
import { etiquetaItem } from './matching.ts';
import { esc, friendlyError, normalizeTagKey } from './utils.ts';
import type { Empresa, EmpresaItem, SolicitudAccion, SolicitudRow, SolicitudTipo } from './types.ts';

declare global {
  interface Window {
    solModo(el: HTMLElement, modo: SolicitudTipo): void;
    solCategoriaCambio(): void;
    solBuscar(): void;
    abrirSolicitud(destinoId: number, itemId?: number): void;
    solFormCambio(): void;
    enviarSolicitud(): Promise<void>;
    cerrarSolicitud(): void;
    responderSolicitud(id: number, accion: SolicitudAccion): Promise<void>;
    abrirChatSolicitud(id: number): void;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

let modo: SolicitudTipo = 'conseguir';
let buscado: { categoriaId: number; sub: string } | null = null;

// ─── Ayudas ────────────────────────────────────────────────────────
function itemTxt(categoriaId: number, sub: string): string {
  return etiquetaItem(app().categoriaById(categoriaId)?.nombre || '?', sub);
}

export function nombreOrigen(s: SolicitudRow): string {
  if (s.origen_empresa_id) return app().orgs.find(o => o.id === s.origen_empresa_id)?.nombre || 'Empresa';
  return `${nombreUsuario(s.origen_persona_id)} (a título personal)`;
}
export function nombreDestino(s: SolicitudRow): string {
  return app().orgs.find(o => o.id === s.destino_empresa_id)?.nombre || 'Empresa';
}

// De qué lado de la solicitud está el usuario actual (null = no es parte;
// por ejemplo un webmaster, que las ve todas pero no participa).
export function miLado(s: SolicitudRow): 'origen' | 'destino' | null {
  const c = app();
  const uid = c.currentProfile?.id;
  if (!uid) return null;
  const mias = c.misEmpresas();
  if (s.origen_persona_id === uid || (s.origen_empresa_id && mias.has(s.origen_empresa_id))) return 'origen';
  if (mias.has(s.destino_empresa_id)) return 'destino';
  return null;
}

export function contarSolicitudesPendientesRecibidas(): number {
  return app().solicitudes.filter(s => s.estado === 'pendiente' && miLado(s) === 'destino').length;
}

// Tema de una solicitud: tipo + categoría + subcategoría (normalizada).
function mismoTema(s: SolicitudRow, tipo: SolicitudTipo, categoriaId: number, sub: string): boolean {
  return s.tipo === tipo && s.categoria_id === categoriaId && normalizeTagKey(s.subcategoria) === normalizeTagKey(sub);
}

// Solicitud mía (de mis empresas o a mi nombre) a esa empresa sobre ese tema.
function miSolicitudSobre(destinoId: number, tipo: SolicitudTipo, categoriaId: number, sub: string, origenEmpresaId?: number | null): SolicitudRow | undefined {
  const uid = app().currentProfile?.id;
  const estados = ['pendiente', 'aceptada', 'rechazada'];
  return app().solicitudes.find(s => s.destino_empresa_id === destinoId && estados.includes(s.estado)
    && mismoTema(s, tipo, categoriaId, sub)
    && (origenEmpresaId === undefined
      ? miLado(s) === 'origen'
      : origenEmpresaId === null ? s.origen_persona_id === uid : s.origen_empresa_id === origenEmpresaId));
}

const ESTADO_TXT: Record<SolicitudRow['estado'], string> = {
  pendiente: 'Pendiente', aceptada: 'Aceptada', rechazada: 'Rechazada', cancelada: 'Cancelada',
};
const NIVEL_TXT: Record<NivelBusqueda, [string, string]> = {
  exacta: ['Coincidencia exacta', 'match-strength--strong'],
  parecida: ['Parecida', 'match-strength--strong'],
  categoria: ['Misma categoría', 'match-strength--weak'],
};

// ─── Buscador ──────────────────────────────────────────────────────
export function renderBuscar(): void {
  const c = app();
  const sel = $<HTMLSelectElement>('sol-cat');
  if (sel.options.length !== c.categorias.length + 1) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">Elegí una categoría…</option>' +
      c.categorias.map(cat => `<option value="${cat.id}">${esc(cat.nombre)}</option>`).join('');
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  }
  document.querySelectorAll('#sol-modos .chip').forEach(ch => ch.classList.toggle('active', ch.getAttribute('data-modo') === modo));
  $('sol-ayuda').innerHTML = modo === 'conseguir'
    ? 'Buscá un servicio o producto que necesites: te mostramos las empresas que lo <strong>ofrecen</strong>, aunque no lo tengas cargado en tu empresa.'
    : 'Buscá algo que puedas ofrecer: te mostramos las empresas que lo <strong>necesitan</strong>, aunque no lo tengas cargado en tu empresa.';
  renderSubsSugeridas();
  renderResultados();
}

function renderSubsSugeridas(): void {
  const cat = app().categoriaById(Number($<HTMLSelectElement>('sol-cat').value));
  $('sol-subs').innerHTML = (cat?.subcategorias || []).map(s => `<option value="${esc(s)}">`).join('');
  $<HTMLInputElement>('sol-sub').placeholder = cat?.esOtros ? 'Describí qué buscás (obligatorio en "Otros")' : 'Subcategoría (opcional, ej: TIG)';
}

window.solModo = function (el, m) {
  modo = m === 'ofrecer' ? 'ofrecer' : 'conseguir';
  document.querySelectorAll('#sol-modos .chip').forEach(ch => ch.classList.remove('active'));
  el.classList.add('active');
  renderBuscar();
};

window.solCategoriaCambio = function () {
  renderSubsSugeridas();
};

window.solBuscar = function () {
  const catId = Number($<HTMLSelectElement>('sol-cat').value);
  const sub = $<HTMLInputElement>('sol-sub').value.trim();
  const cat = app().categoriaById(catId);
  const msg = $('sol-buscar-msg');
  if (!cat) { msg.textContent = 'Elegí una categoría.'; msg.className = 'form-msg err'; msg.style.display = 'block'; return; }
  if (cat.esOtros && !sub) { msg.textContent = 'En "Otros" escribí qué buscás.'; msg.className = 'form-msg err'; msg.style.display = 'block'; return; }
  msg.style.display = 'none';
  buscado = { categoriaId: catId, sub };
  renderResultados();
};

function renderResultados(): void {
  const box = $('sol-resultados');
  const c = app();
  const cat = buscado ? c.categoriaById(buscado.categoriaId) : undefined;
  if (!buscado || !cat) {
    box.innerHTML = '';
    $('vin-count').textContent = '0';
    return;
  }
  const res = buscarEmpresas(c.orgs, cat, buscado.sub, modo, c.misEmpresas());
  $('vin-count').textContent = String(res.length);
  const que = etiquetaItem(cat.nombre, buscado.sub);
  box.innerHTML = res.length
    ? `<p class="hint-text">${res.length} empresa${res.length !== 1 ? 's' : ''} ${modo === 'conseguir' ? 'ofrece' : 'necesita'}${res.length !== 1 ? 'n' : ''} <strong>${esc(que)}</strong>.</p>` + res.map(resultadoHtml).join('')
    : `<div class="empty"><i class="ti ti-search"></i>Ninguna empresa ${modo === 'conseguir' ? 'ofrece' : 'necesita'} <strong>${esc(que)}</strong> por ahora.${buscado.sub && !cat.esOtros ? '<br>Probá sin subcategoría para ver todo el rubro.' : ''}</div>`;
}

function resultadoHtml(r: ResultadoBusqueda): string {
  const o = r.empresa;
  const filas = r.items.map(({ item, nivel }) => {
    const prev = item.id ? miSolicitudSobre(o.id, modo, item.categoriaId, item.subcategoria) : undefined;
    const [ntxt, ncls] = NIVEL_TXT[nivel];
    const accion = r.sinUsuarios
      ? ''
      : prev
        ? `<span class="cx-badge cx-badge--${prev.estado === 'aceptada' ? 'match' : prev.estado === 'rechazada' ? 'rechazada' : 'esperando_otra'}">Solicitud ${ESTADO_TXT[prev.estado].toLowerCase()}</span>`
        : `<button class="btn-prim btn-sm-txt" onclick="abrirSolicitud(${o.id},${item.id})"><i class="ti ti-send"></i> ${modo === 'conseguir' ? 'Solicitar' : 'Ofrecer'}</button>`;
    return `<div class="sol-item-row">
      <span class="tag ${item.tipo === 'oferta' ? 'tag-offer' : 'tag-need'}">${esc(itemTxt(item.categoriaId, item.subcategoria))}</span>
      <span class="match-strength ${ncls}">${ntxt}</span>
      <span class="sol-item-accion">${accion}</span>
    </div>`;
  }).join('');
  return `<div class="cx-card sol-resultado">
    <div class="sol-res-head">
      <div><div class="vc-name" onclick="openDetail(${o.id})">${esc(o.nombre)}</div>
      <div class="muted-sm">${esc([o.sector, o.ciudad].filter(Boolean).join(' · '))}</div></div>
    </div>
    ${filas}
    ${r.sinUsuarios ? `<div class="cx-aviso"><i class="ti ti-info-circle"></i> Esta empresa todavía no tiene usuarios en la red que puedan responder solicitudes. Contactala por sus datos:</div>
      <div class="cx-contacto">${app().contactButtonsHtml(o)}</div>` : ''}
  </div>`;
}

// ─── Enviar solicitud ──────────────────────────────────────────────
interface FormSolicitud { destino: Empresa; opciones: Array<{ tipo: SolicitudTipo; item: EmpresaItem }> }
let form: FormSolicitud | null = null;

window.abrirSolicitud = function (destinoId, itemId) {
  const c = app();
  const destino = c.orgs.find(o => o.id === destinoId);
  if (!destino || !c.currentProfile) return;
  const opciones = (destino.items || []).filter(i => i.id).map(i => ({ tipo: (i.tipo === 'oferta' ? 'conseguir' : 'ofrecer') as SolicitudTipo, item: i }));
  if (!opciones.length) { alert('Esta empresa todavía no cargó servicios ni necesidades.'); return; }
  form = { destino, opciones };
  $('sol-modal-title').textContent = `Solicitud a ${destino.nombre}`;
  const grupo = (t: SolicitudTipo, label: string) => {
    const ops = opciones.map((op, idx) => ({ op, idx })).filter(x => x.op.tipo === t);
    return ops.length ? `<optgroup label="${label}">${ops.map(({ op, idx }) =>
      `<option value="${idx}">${esc(itemTxt(op.item.categoriaId, op.item.subcategoria))}</option>`).join('')}</optgroup>` : '';
  };
  const qSel = $<HTMLSelectElement>('sol-f-que');
  qSel.innerHTML = grupo('conseguir', 'Quiero conseguir (lo ofrece)') + grupo('ofrecer', 'Quiero ofrecerle (lo necesita)');
  const pre = opciones.findIndex(op => op.item.id === itemId);
  if (pre >= 0) qSel.value = String(pre);
  // Remitente: mis empresas (salvo la destino) o a título personal.
  const mias = c.orgs.filter(o => c.misEmpresas().has(o.id) && o.id !== destino.id);
  const dSel = $<HTMLSelectElement>('sol-f-de');
  dSel.innerHTML = mias.map(o => `<option value="${o.id}">${esc(o.nombre)}</option>`).join('') +
    `<option value="">A mi nombre (${esc(`${c.currentProfile.nombre} ${c.currentProfile.apellido || ''}`.trim())})</option>`;
  $<HTMLTextAreaElement>('sol-f-msg').value = '';
  $<HTMLInputElement>('sol-f-agregar').checked = false;
  $('sol-f-res').textContent = '';
  $('sol-f-res').style.display = 'none';
  $<HTMLButtonElement>('sol-f-enviar').disabled = false;
  window.solFormCambio();
  $('modal-solicitud').classList.add('open');
};

function opcionElegida(): { tipo: SolicitudTipo; item: EmpresaItem } | null {
  if (!form) return null;
  return form.opciones[Number($<HTMLSelectElement>('sol-f-que').value)] || null;
}
function origenElegido(): number | null {
  const v = $<HTMLSelectElement>('sol-f-de').value;
  return v ? Number(v) : null;
}

// Actualiza avisos y la casilla "sumar a mi empresa" según lo elegido.
window.solFormCambio = function () {
  if (!form) return;
  const op = opcionElegida();
  const origen = origenElegido();
  const aviso = $('sol-f-aviso');
  const wrap = $('sol-f-agregar-wrap');
  const btn = $<HTMLButtonElement>('sol-f-enviar');
  aviso.innerHTML = '';
  btn.disabled = false;
  if (!op) return;
  if (!(form.destino.usuarios || []).length) {
    aviso.innerHTML = '<i class="ti ti-info-circle"></i> Esta empresa todavía no tiene usuarios en la red que puedan responder. Contactala por sus datos de contacto.';
    btn.disabled = true;
  }
  const previa = miSolicitudSobre(form.destino.id, op.tipo, op.item.categoriaId, op.item.subcategoria, origen);
  if (previa && previa.estado !== 'cancelada') {
    aviso.innerHTML = previa.estado === 'pendiente'
      ? '<i class="ti ti-hourglass"></i> Ya enviaste esta solicitud y espera respuesta.'
      : previa.estado === 'aceptada'
        ? '<i class="ti ti-message-circle"></i> Esta solicitud ya fue aceptada: seguí la conversación desde su chat.'
        : '<i class="ti ti-ban"></i> Esta empresa ya rechazó esta solicitud.';
    btn.disabled = true;
  }
  // Sumar el ítem a mi empresa: solo con remitente empresa y si no lo tiene.
  const miEmp = origen ? app().orgs.find(o => o.id === origen) : undefined;
  const miTipo = op.tipo === 'conseguir' ? 'necesidad' : 'oferta';
  const yaLoTiene = !!miEmp && (miEmp.items || []).some(i => i.tipo === miTipo && i.categoriaId === op.item.categoriaId
    && normalizeTagKey(i.subcategoria) === normalizeTagKey(op.item.subcategoria));
  wrap.classList.toggle('hidden', !miEmp || yaLoTiene);
  if (miEmp && !yaLoTiene) {
    $('sol-f-agregar-label').textContent = `Sumar «${itemTxt(op.item.categoriaId, op.item.subcategoria)}» a ${miTipo === 'necesidad' ? 'las necesidades' : 'los servicios y productos'} de ${miEmp.nombre}`;
  } else {
    $<HTMLInputElement>('sol-f-agregar').checked = false;
  }
};

const RESULTADO_TXT: Record<string, string> = {
  solicitud: '✓ Solicitud enviada. Te avisamos acá cuando la respondan.',
  conexion_aceptada: '✓ Ya había una coincidencia con esta empresa: registramos tu aceptación (queda esperando a la otra empresa) y tu mensaje se va a ver en el chat cuando haya match. La encontrás en "Mis conexiones".',
  conexion_match: '✓ ¡Match! La otra empresa ya había aceptado esta coincidencia. Ya pueden conversar por el chat desde "Mis conexiones".',
  conexion_ya_aceptada: '✓ Tu empresa ya había aceptado esta coincidencia y espera a la otra empresa. Sumamos tu mensaje para el chat.',
  conexion_en_match: '✓ Ya tienen match en esta categoría: tu mensaje se envió a su chat.',
};

window.enviarSolicitud = async function () {
  if (!form) return;
  const op = opcionElegida();
  const res = $('sol-f-res');
  const mensaje = $<HTMLTextAreaElement>('sol-f-msg').value;
  const mostrar = (t: string, tipo: 'ok' | 'err') => { res.textContent = t; res.className = `form-msg ${tipo}`; res.style.display = 'block'; };
  if (!op) { mostrar('Elegí qué querés solicitar u ofrecer.', 'err'); return; }
  if (mensaje.trim().length > 1000) { mostrar('El mensaje inicial puede tener hasta 1000 caracteres.', 'err'); return; }
  const btn = $<HTMLButtonElement>('sol-f-enviar');
  btn.disabled = true;
  try {
    const r = await Solicitudes.enviarSolicitud({
      tipo: op.tipo, origenEmpresaId: origenElegido(), destinoEmpresaId: form.destino.id,
      categoriaId: op.item.categoriaId, subcategoria: op.item.subcategoria, mensaje,
      agregarItem: !$('sol-f-agregar-wrap').classList.contains('hidden') && $<HTMLInputElement>('sol-f-agregar').checked,
    });
    await app().refresh();
    mostrar((RESULTADO_TXT[r.resultado] || '✓ Listo.') + (r.item_agregado ? ' También sumamos el ítem a tu empresa.' : ''), 'ok');
    window.renderVin();
  } catch (e) {
    mostrar(friendlyError(e), 'err');
    btn.disabled = false;
  }
};

window.cerrarSolicitud = function () {
  form = null;
  $('modal-solicitud').classList.remove('open');
};

// ─── Tarjetas en "Mis conexiones" ──────────────────────────────────
// "X quiere conseguir Y de Z" / "X ofrece Y a Z" (HTML ya escapado).
export function fraseSolicitud(s: SolicitudRow): string {
  const que = itemTxt(s.categoria_id, s.subcategoria);
  return s.tipo === 'conseguir'
    ? `<strong>${esc(nombreOrigen(s))}</strong> quiere conseguir <span class="tag tag-offer">${esc(que)}</span> de <strong>${esc(nombreDestino(s))}</strong>`
    : `<strong>${esc(nombreOrigen(s))}</strong> ofrece <span class="tag tag-need">${esc(que)}</span> a <strong>${esc(nombreDestino(s))}</strong>`;
}

function tarjetaHtml(s: SolicitudRow, lado: 'origen' | 'destino'): string {
  const c = app();
  const frase = fraseSolicitud(s);
  const meta = [`Enviada el ${esc(fechaHora(s.created_at))} por ${esc(nombreUsuario(s.enviada_por))}`];
  if (s.respondida_at) {
    const verbo = s.estado === 'aceptada' ? 'Aceptada' : s.estado === 'rechazada' ? 'Rechazada' : 'Cancelada';
    meta.push(`${verbo} el ${esc(fechaHora(s.respondida_at))} por ${esc(nombreUsuario(s.respondida_por))}`);
  }
  // Remitente persona: sus datos de contacto para la empresa que la recibe.
  let contactoPersona = '';
  if (lado === 'destino' && s.origen_persona_id) {
    const p = c.getProfileById(s.origen_persona_id);
    if (p) contactoPersona = `<div class="muted-sm"><i class="ti ti-user"></i> ${esc(p.email || '')}${p.tel ? ' · ' + esc(p.tel) : ''}</div>`;
  }
  let acciones = '';
  if (s.estado === 'pendiente' && lado === 'destino') {
    acciones = `<button class="btn-prim btn-sm-txt" onclick="responderSolicitud(${s.id},'aceptar')"><i class="ti ti-check"></i> Aceptar</button>
      <button class="btn-out btn-sm-txt" onclick="responderSolicitud(${s.id},'rechazar')"><i class="ti ti-x"></i> Rechazar</button>`;
  } else if (s.estado === 'pendiente') {
    acciones = `<button class="btn-out btn-sm-txt" onclick="responderSolicitud(${s.id},'cancelar')"><i class="ti ti-arrow-back-up"></i> Cancelar solicitud</button>`;
  } else if (s.estado === 'aceptada') {
    acciones = `<button class="btn-prim btn-sm-txt" onclick="abrirChatSolicitud(${s.id})"><i class="ti ti-message-circle"></i> Abrir chat</button>`;
  }
  const badge = s.estado === 'aceptada' ? 'match' : s.estado === 'pendiente' ? (lado === 'destino' ? 'otra_acepto' : 'esperando_otra') : 'rechazada';
  return `<div class="cx-card sol-card sol-${s.estado}" data-sol="${s.id}">
    <div class="sol-frase"><i class="ti ti-send"></i> ${frase}</div>
    ${contactoPersona}
    ${s.estado === 'pendiente' && lado === 'destino' ? `<div class="sol-msg-inicial" id="sol-msg-${s.id}"></div>` : ''}
    <div class="cx-estado"><span class="cx-badge cx-badge--${badge}">Solicitud ${ESTADO_TXT[s.estado].toLowerCase()}</span>
      <span class="muted-sm">${lado === 'destino' ? 'Recibida' : 'Enviada'}</span></div>
    <div class="cx-meta">${meta.join('<br>')}</div>
    <div class="cx-actions">${acciones}</div>
  </div>`;
}

function seccion(titulo: string, icono: string, items: string[], colapsada = false): string {
  if (!items.length) return '';
  const head = `<i class="ti ${icono}"></i> ${titulo} <span class="count-pill">${items.length}</span>`;
  return colapsada
    ? `<details class="cx-seccion"><summary class="cx-seccion-titulo">${head}</summary>${items.join('')}</details>`
    : `<div class="cx-seccion"><div class="cx-seccion-titulo">${head}</div>${items.join('')}</div>`;
}

export interface SeccionesSolicitudes { recibidas: string; enviadas: string; aceptadas: string; cerradas: string; total: number }

export function seccionesSolicitudes(q: string): SeccionesSolicitudes {
  const mias = app().solicitudes
    .map(s => ({ s, lado: miLado(s) }))
    .filter((x): x is { s: SolicitudRow; lado: 'origen' | 'destino' } => x.lado !== null)
    .filter(({ s }) => !q || [nombreOrigen(s), nombreDestino(s), itemTxt(s.categoria_id, s.subcategoria)].join(' ').toLowerCase().includes(q));
  const html = (f: (x: { s: SolicitudRow; lado: 'origen' | 'destino' }) => boolean) => mias.filter(f).map(x => tarjetaHtml(x.s, x.lado));
  return {
    recibidas: seccion('Solicitudes recibidas', 'ti-inbox', html(x => x.s.estado === 'pendiente' && x.lado === 'destino')),
    enviadas: seccion('Solicitudes enviadas', 'ti-send', html(x => x.s.estado === 'pendiente' && x.lado === 'origen')),
    aceptadas: seccion('Solicitudes aceptadas', 'ti-message-circle', html(x => x.s.estado === 'aceptada')),
    cerradas: seccion('Solicitudes rechazadas o canceladas', 'ti-archive', html(x => x.s.estado === 'rechazada' || x.s.estado === 'cancelada'), true),
    total: mias.length,
  };
}

// Muestra el mensaje inicial en las solicitudes recibidas pendientes
// (para decidir antes de aceptar). Se carga después de dibujar.
export async function cargarMensajesIniciales(): Promise<void> {
  const ids = [...document.querySelectorAll<HTMLElement>('.sol-msg-inicial')].map(el => Number(el.id.replace('sol-msg-', '')));
  for (const id of ids) {
    try {
      const msgs = await Solicitudes.listMensajes(id);
      const el = document.getElementById('sol-msg-' + id);
      if (el && msgs.length) el.innerHTML = `<i class="ti ti-quote"></i> ${esc(msgs[0].contenido)}`;
    } catch { /* sin mensaje no pasa nada */ }
  }
}

window.responderSolicitud = async function (id, accion) {
  const s = app().solicitudes.find(x => x.id === id);
  if (!s) return;
  if (accion === 'rechazar' && !confirm(`¿Rechazar la solicitud de ${nombreOrigen(s)}?\n\nNo se va a poder volver a enviar la misma solicitud.`)) return;
  if (accion === 'cancelar' && !confirm('¿Cancelar esta solicitud?')) return;
  try {
    await Solicitudes.responderSolicitud(id, accion);
    await app().refresh();
    window.renderVin();
    if (accion === 'aceptar') window.abrirChatSolicitud(id);
  } catch (e) {
    alert(friendlyError(e));
    await app().refresh().catch(() => undefined);
    window.renderVin();
  }
};

export function resetSolicitudesUI(): void {
  modo = 'conseguir';
  buscado = null;
  window.cerrarSolicitud();
  const r = document.getElementById('sol-resultados');
  if (r) r.innerHTML = '';
}

export function initSolicitudesUI(): void {
  $('modal-solicitud').addEventListener('click', function (e) { if (e.target === this) window.cerrarSolicitud(); });
  $<HTMLInputElement>('sol-sub').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); window.solBuscar(); } });
}
