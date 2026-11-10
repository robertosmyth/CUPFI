// ══════════════════════════════════════════════
// Pantalla "Vinculación": mis conexiones (con doble aceptación), toda la
// red (solo sugerencias, de lectura), aviso de match con recomendaciones
// y chat privado con una pestaña por conexión en match.
// ══════════════════════════════════════════════
import * as Conexiones from './conexiones.ts';
import { app, fechaHora, nombreUsuario } from './contexto.ts';
import {
  armarMisConexiones, calcularSugerencias, matchesEntre, recomendacionesPara, type ConexionVista,
} from './matching.ts';
import { esc, friendlyError } from './utils.ts';
import type { ConexionAccion, EstadoConexion, MensajeRow, ParCoincidencia, Sugerencia } from './types.ts';

declare global {
  interface Window {
    setVinVista(el: HTMLElement, vista: string): void;
    setVinFilter(el: HTMLElement, val: string): void;
    renderVin(): void;
    responderConexion(key: string, accion: ConexionAccion): Promise<void>;
    abrirChat(miEmpresaId: number, otraEmpresaId: number, conexionId?: number): void;
    chatTab(conexionId: number): void;
    enviarChat(): Promise<void>;
    cerrarChat(): void;
    cerrarMatch(): void;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

let vinVista: 'mias' | 'red' = 'mias';
let vinFiltro: 'todos' | 'exacta' | 'categoria' = 'todos';
let ultimasVistas: ConexionVista[] = [];

function misVistas(): ConexionVista[] {
  const c = app();
  const sug = calcularSugerencias(c.orgs, c.categorias);
  ultimasVistas = armarMisConexiones(sug, c.conexiones, c.orgs, c.categorias, c.misEmpresas());
  return ultimasVistas;
}

// ─── Fragmentos de HTML ────────────────────────────────────────────
function nivelBadge(nivel: 'exacta' | 'categoria'): string {
  return nivel === 'exacta'
    ? '<span class="match-strength match-strength--strong">Coincidencia exacta</span>'
    : '<span class="match-strength match-strength--weak">Misma categoría</span>';
}

// Ramificación categoría → pares de subcategorías.
function arbolHtml(necesitaNombre: string, categoria: string, pares: ParCoincidencia[], vigente = true): string {
  if (!vigente) {
    return `<div class="cx-tree"><div class="cx-tree-root">${esc(necesitaNombre)} necesita <strong>${esc(categoria)}</strong></div>
      <div class="cx-aviso"><i class="ti ti-alert-triangle"></i> Ya no hay coincidencias actuales: alguna de las dos empresas cambió sus ofertas o necesidades.</div></div>`;
  }
  return `<div class="cx-tree">
    <div class="cx-tree-root">${esc(necesitaNombre)} necesita <strong>${esc(categoria)}</strong></div>
    ${pares.map(p => `<div class="cx-tree-row">
      <span class="cx-tree-branch">└</span>
      <span class="tag tag-need">${esc(p.necesidad || 'Sin subcategoría')}</span>
      <i class="ti ti-arrows-left-right icon-sm"></i>
      <span class="tag tag-offer">${esc(p.oferta || 'Sin subcategoría')}</span>
      ${nivelBadge(p.nivel)}
    </div>`).join('')}
  </div>`;
}

const ESTADO_TXT: Record<EstadoConexion, string> = {
  sugerida: 'Sugerida',
  esperando_otra: 'Esperando a la otra empresa',
  otra_acepto: 'La otra empresa ya aceptó',
  match: 'Match',
  rechazada: 'Rechazada',
};

function aceptacionesHtml(v: ConexionVista): string {
  const r = v.row;
  if (!r) return '';
  const partes: string[] = [];
  if (r.acepta_necesita_at) partes.push(`${esc(v.necesita.nombre)} aceptó el ${esc(fechaHora(r.acepta_necesita_at))} (${esc(nombreUsuario(r.acepta_necesita_por))})`);
  if (r.acepta_ofrece_at) partes.push(`${esc(v.ofrece.nombre)} aceptó el ${esc(fechaHora(r.acepta_ofrece_at))} (${esc(nombreUsuario(r.acepta_ofrece_por))})`);
  if (r.rechazada_at) {
    const quien = r.rechazada_empresa_id === v.necesita.id ? v.necesita.nombre : v.ofrece.nombre;
    partes.push(`Rechazada por ${esc(quien)} el ${esc(fechaHora(r.rechazada_at))}`);
  }
  return partes.length ? `<div class="cx-meta">${partes.join('<br>')}</div>` : '';
}

function accionesHtml(v: ConexionVista): string {
  const k = esc(v.key);
  const rechazar = `<button class="btn-out btn-sm-txt" onclick="responderConexion('${k}','rechazar')"><i class="ti ti-x"></i> Rechazar</button>`;
  switch (v.estado) {
    case 'sugerida':
      return v.vigente
        ? `<button class="btn-prim btn-sm-txt" onclick="responderConexion('${k}','aceptar')"><i class="ti ti-check"></i> Aceptar</button>${rechazar}`
        : rechazar;
    case 'otra_acepto':
      return (v.vigente
        ? `<button class="btn-prim btn-sm-txt" onclick="responderConexion('${k}','aceptar')"><i class="ti ti-check"></i> Aceptar y hacer match</button>`
        : '') + rechazar;
    case 'esperando_otra':
      return `<button class="btn-out btn-sm-txt" onclick="responderConexion('${k}','retirar')"><i class="ti ti-arrow-back-up"></i> Retirar mi aceptación</button>${rechazar}`;
    case 'match': {
      const mia = v.lado === 'necesita' ? v.necesita : v.ofrece;
      const otra = v.lado === 'necesita' ? v.ofrece : v.necesita;
      return `<button class="btn-prim btn-sm-txt" onclick="abrirChat(${mia.id},${otra.id},${v.row!.id})"><i class="ti ti-message-circle"></i> Abrir chat</button>
        <span class="cx-contacto">${app().contactButtonsHtml(otra)}</span>`;
    }
    default:
      return '';
  }
}

function cardHtml(v: ConexionVista): string {
  const mia = v.lado === 'necesita' ? v.necesita : v.ofrece;
  return `<div class="cx-card cx-${v.estado}">
    <div class="vc">
      <div>
        <div class="vc-label">necesita</div>
        <div class="vc-name" onclick="openDetail(${v.necesita.id})">${esc(v.necesita.nombre)}</div>
        <div class="vc-ref">${v.lado === 'necesita' ? '<span class="badge-self">Tu empresa</span>' : esc(v.necesita.referente)}</div>
      </div>
      <div class="vc-arrow"><i class="ti ti-arrow-left"></i></div>
      <div>
        <div class="vc-label">ofrece</div>
        <div class="vc-name" onclick="openDetail(${v.ofrece.id})">${esc(v.ofrece.nombre)}</div>
        <div class="vc-ref">${v.lado === 'ofrece' ? '<span class="badge-self">Tu empresa</span>' : esc(v.ofrece.referente)}</div>
      </div>
    </div>
    ${arbolHtml(v.necesita.nombre, v.categoria.nombre, v.pares, v.vigente)}
    <div class="cx-estado"><span class="cx-badge cx-badge--${v.estado}">${ESTADO_TXT[v.estado]}</span>
      <span class="muted-sm">Respondés como <strong>${esc(mia.nombre)}</strong></span></div>
    ${aceptacionesHtml(v)}
    <div class="cx-actions">${accionesHtml(v)}</div>
  </div>`;
}

function redCardHtml(s: Sugerencia): string {
  return `<div class="vin-row">
    <div class="vc">
      <div><div class="vc-label">necesita</div><div class="vc-name" onclick="openDetail(${s.necesita.id})">${esc(s.necesita.nombre)}</div><div class="vc-ref">${esc(s.necesita.referente)}</div></div>
      <div class="vc-arrow"><i class="ti ti-arrow-left"></i></div>
      <div><div class="vc-label">ofrece</div><div class="vc-name" onclick="openDetail(${s.ofrece.id})">${esc(s.ofrece.nombre)}</div><div class="vc-ref">${esc(s.ofrece.referente)}</div></div>
    </div>
    ${arbolHtml(s.necesita.nombre, s.categoria.nombre, s.pares)}
  </div>`;
}

function coincideBusqueda(q: string, necesita: string, ofrece: string, categoria: string, pares: ParCoincidencia[], extra: string[] = []): boolean {
  if (!q) return true;
  return [necesita, ofrece, categoria, ...pares.map(p => p.necesidad), ...pares.map(p => p.oferta), ...extra].join(' ').toLowerCase().includes(q);
}

// ─── Pantalla ──────────────────────────────────────────────────────
window.setVinVista = function (el, vista) {
  document.querySelectorAll('#vin-vistas .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  vinVista = vista === 'red' ? 'red' : 'mias';
  window.renderVin();
};

window.setVinFilter = function (el, val) {
  document.querySelectorAll('#vin-filtros .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  vinFiltro = val === 'exacta' || val === 'categoria' ? val : 'todos';
  window.renderVin();
};

window.renderVin = function () {
  const c = app();
  const q = ($<HTMLInputElement>('search-vin').value || '').toLowerCase();
  const list = $('vin-list');
  $('vin-hint-mias').classList.toggle('hidden', vinVista !== 'mias');
  $('vin-hint-red').classList.toggle('hidden', vinVista !== 'red');

  if (vinVista === 'red') {
    const todas = calcularSugerencias(c.orgs, c.categorias);
    const sug = todas.filter(s =>
      (vinFiltro === 'todos' || s.nivel === vinFiltro) &&
      coincideBusqueda(q, s.necesita.nombre, s.ofrece.nombre, s.categoria.nombre, s.pares, [s.necesita.referente, s.ofrece.referente]));
    $('vin-count').textContent = String(sug.length);
    list.innerHTML = sug.length
      ? sug.map(redCardHtml).join('')
      : `<div class="empty"><i class="ti ti-arrows-exchange"></i>${todas.length ? 'Sin resultados para ese criterio.' : 'No se detectaron vinculaciones aún.'}</div>`;
    return;
  }

  if (!c.misEmpresas().size) {
    $('vin-count').textContent = '0';
    list.innerHTML = `<div class="empty"><i class="ti ti-building-plus"></i>Para tener conexiones primero cargá tu empresa con lo que ofrece y lo que necesita.<br><br>
      <button class="btn-prim" onclick="showScreen('registrar')">Agregar empresa</button></div>`;
    return;
  }

  const vistas = misVistas().filter(v =>
    (vinFiltro === 'todos' || v.nivel === vinFiltro) &&
    coincideBusqueda(q, v.necesita.nombre, v.ofrece.nombre, v.categoria.nombre, v.pares));
  $('vin-count').textContent = String(vistas.length);

  const secciones: Array<{ estado: EstadoConexion; titulo: string; icono: string }> = [
    { estado: 'otra_acepto', titulo: 'Esperan tu respuesta', icono: 'ti-bell-ringing' },
    { estado: 'sugerida', titulo: 'Sugeridas para tus empresas', icono: 'ti-bulb' },
    { estado: 'esperando_otra', titulo: 'Esperando a la otra empresa', icono: 'ti-hourglass' },
    { estado: 'match', titulo: 'Match', icono: 'ti-heart-handshake' },
    { estado: 'rechazada', titulo: 'Rechazadas', icono: 'ti-ban' },
  ];
  const html = secciones.map(sec => {
    const items = vistas.filter(v => v.estado === sec.estado);
    if (!items.length) return '';
    const cuerpo = items.map(cardHtml).join('');
    if (sec.estado === 'rechazada') {
      return `<details class="cx-seccion"><summary class="cx-seccion-titulo"><i class="ti ${sec.icono}"></i> ${sec.titulo} <span class="count-pill">${items.length}</span></summary>${cuerpo}</details>`;
    }
    return `<div class="cx-seccion"><div class="cx-seccion-titulo"><i class="ti ${sec.icono}"></i> ${sec.titulo} <span class="count-pill">${items.length}</span></div>${cuerpo}</div>`;
  }).join('');
  list.innerHTML = html || '<div class="empty"><i class="ti ti-arrows-exchange"></i>Todavía no hay conexiones para tus empresas. Cuantas más ofertas y necesidades cargues (con categoría y subcategoría), más coincidencias vas a encontrar.</div>';
};

window.responderConexion = async function (key, accion) {
  const v = ultimasVistas.find(x => x.key === key);
  if (!v) return;
  if (accion === 'rechazar' && !confirm(`¿Rechazar la conexión "${v.necesita.nombre} necesita ${v.categoria.nombre} ← ${v.ofrece.nombre}"?\n\nDeja de sugerirse a ambas empresas y no se puede deshacer.`)) return;
  if (accion === 'retirar' && !confirm('¿Retirar tu aceptación? La otra empresa dejará de ver que aceptaste.')) return;
  try {
    const row = await Conexiones.responderConexion(v.necesita.id, v.ofrece.id, v.categoria.id, accion);
    await app().refresh();
    window.renderVin();
    if (accion === 'aceptar' && row.match_at) abrirMatch(key);
    else if (matchKeyAbierto && $('modal-match').classList.contains('open')) abrirMatch(matchKeyAbierto);
  } catch (e) {
    alert(friendlyError(e));
    await app().refresh().catch(() => undefined);
    window.renderVin();
  }
};

// ─── Aviso de match + recomendaciones ──────────────────────────────
let matchKeyAbierto: string | null = null;

function abrirMatch(key: string): void {
  matchKeyAbierto = key;
  const vistas = misVistas();
  const v = vistas.find(x => x.key === key);
  if (!v || !v.row) return;
  const mia = v.lado === 'necesita' ? v.necesita : v.ofrece;
  const otra = v.lado === 'necesita' ? v.ofrece : v.necesita;
  const rec = recomendacionesPara(vistas, v.necesita.id, v.ofrece.id, key);
  $('match-body').innerHTML = `
    <div class="match-hero"><i class="ti ti-heart-handshake"></i>
      <div><strong>${esc(v.necesita.nombre)}</strong> y <strong>${esc(v.ofrece.nombre)}</strong> aceptaron la conexión
      <strong>${esc(v.categoria.nombre)}</strong>. Ya pueden conversar por el chat privado.</div></div>
    <div class="action-row"><button class="btn-prim" onclick="cerrarMatch();abrirChat(${mia.id},${otra.id},${v.row.id})"><i class="ti ti-message-circle"></i> Abrir chat</button></div>
    ${rec.length ? `<div class="dsec"><div class="dsec-title">También podrían vincularse en</div>
      <p class="hint-text hint-tight">Otras coincidencias entre estas dos empresas. Si las aceptan las dos, se suman como otra pestaña del mismo chat.</p>
      ${rec.map(cardHtml).join('')}</div>` : ''}`;
  $('modal-match').classList.add('open');
}

window.cerrarMatch = function () {
  matchKeyAbierto = null;
  $('modal-match').classList.remove('open');
};

// ─── Chat ──────────────────────────────────────────────────────────
interface ChatEstado { mia: number; otra: number; activa: number | null; ultimoId: number }
let chat: ChatEstado | null = null;
let chatTimer: ReturnType<typeof setInterval> | null = null;
const CHAT_REFRESCO_MS = 6000;

function pestanasChat(): ConexionVista[] {
  if (!chat) return [];
  return matchesEntre(misVistas(), chat.mia, chat.otra);
}

window.abrirChat = function (miEmpresaId, otraEmpresaId, conexionId) {
  chat = { mia: miEmpresaId, otra: otraEmpresaId, activa: conexionId ?? null, ultimoId: 0 };
  const tabs = pestanasChat();
  if (!tabs.length) { chat = null; alert('Todavía no hay conexiones en match con esta empresa.'); return; }
  if (!chat.activa || !tabs.some(t => t.row!.id === chat!.activa)) chat.activa = tabs[0].row!.id;
  const otra = app().orgs.find(o => o.id === otraEmpresaId);
  const mia = app().orgs.find(o => o.id === miEmpresaId);
  $('chat-title').textContent = `Chat con ${otra?.nombre || 'la empresa'}`;
  $('chat-sub').textContent = `Escribís como ${mia?.nombre || 'tu empresa'}`;
  ($<HTMLTextAreaElement>('chat-input')).value = '';
  $('chat-msg').style.display = 'none';
  renderChatTabs();
  $('modal-chat').classList.add('open');
  void cargarMensajes(true);
  if (chatTimer) clearInterval(chatTimer);
  chatTimer = setInterval(() => { void cargarMensajes(false); }, CHAT_REFRESCO_MS);
};

window.cerrarChat = function () {
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  chat = null;
  $('modal-chat').classList.remove('open');
};

function renderChatTabs(): void {
  if (!chat) return;
  const tabs = pestanasChat();
  $('chat-tabs').innerHTML = tabs.map(t => `<button class="chat-tab${t.row!.id === chat!.activa ? ' active' : ''}" onclick="chatTab(${t.row!.id})"
      title="${esc(t.necesita.nombre)} necesita ${esc(t.categoria.nombre)}">
      <span class="chat-tab-cat">${esc(t.categoria.nombre)}</span>
      <span class="chat-tab-dir">${esc(t.necesita.nombre)} necesita</span>
    </button>`).join('');
  const activa = tabs.find(t => t.row!.id === chat!.activa);
  $('chat-contexto').innerHTML = activa ? arbolHtml(activa.necesita.nombre, activa.categoria.nombre, activa.pares, activa.vigente) : '';
  const rec = recomendacionesPara(misVistas(), chat.mia, chat.otra);
  $('chat-rec').innerHTML = rec.length
    ? `<i class="ti ti-bulb"></i> Hay ${rec.length} coincidencia${rec.length !== 1 ? 's' : ''} más con esta empresa. Aceptala${rec.length !== 1 ? 's' : ''} desde <a href="#" onclick="event.preventDefault();cerrarChat();showScreen('vinculacion')">Vinculación</a> para sumar pestañas a este chat.`
    : '';
}

window.chatTab = function (conexionId) {
  if (!chat) return;
  chat.activa = conexionId;
  chat.ultimoId = 0;
  renderChatTabs();
  void cargarMensajes(true);
};

async function cargarMensajes(forzar: boolean): Promise<void> {
  if (!chat || !chat.activa) return;
  const conexionId = chat.activa;
  try {
    const msgs = await Conexiones.listMensajes(conexionId);
    if (!chat || chat.activa !== conexionId) return; // cambió de pestaña mientras cargaba
    const ultimo = msgs.length ? msgs[msgs.length - 1].id : 0;
    if (!forzar && ultimo === chat.ultimoId) return;
    chat.ultimoId = ultimo;
    renderMensajes(msgs);
  } catch (e) {
    if (forzar) $('chat-mensajes').innerHTML = `<div class="empty">${esc(friendlyError(e))}</div>`;
  }
}

function renderMensajes(msgs: MensajeRow[]): void {
  if (!chat) return;
  const box = $('chat-mensajes');
  const abajo = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const orgs = app().orgs;
  box.innerHTML = msgs.length
    ? msgs.map(m => {
        const propio = m.empresa_id === chat!.mia;
        const emp = orgs.find(o => o.id === m.empresa_id);
        return `<div class="chat-burbuja${propio ? ' propio' : ''}">
          <div class="chat-autor">${esc(nombreUsuario(m.autor_id))} · ${esc(emp?.nombre || '')}</div>
          <div class="chat-texto">${esc(m.contenido)}</div>
          <div class="chat-hora">${esc(fechaHora(m.created_at))}</div>
        </div>`;
      }).join('')
    : '<div class="chat-vacio">Todavía no hay mensajes en esta conexión. ¡Escribí el primero!</div>';
  if (abajo || msgs.length <= 1) box.scrollTop = box.scrollHeight;
}

window.enviarChat = async function () {
  if (!chat || !chat.activa) return;
  const input = $<HTMLTextAreaElement>('chat-input');
  const texto = input.value.trim();
  if (!texto) return;
  if (texto.length > 4000) { mostrarChatMsg('El mensaje es demasiado largo (máximo 4000 caracteres).'); return; }
  const btn = $<HTMLButtonElement>('chat-send');
  btn.disabled = true;
  try {
    await Conexiones.enviarMensaje(chat.activa, texto);
    input.value = '';
    $('chat-msg').style.display = 'none';
    await cargarMensajes(true);
    const box = $('chat-mensajes');
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    mostrarChatMsg(friendlyError(e));
  } finally {
    btn.disabled = false;
    input.focus();
  }
};

function mostrarChatMsg(t: string): void {
  const el = $('chat-msg');
  el.textContent = t;
  el.className = 'form-msg err';
  el.style.display = 'block';
}

export function initConexionesUI(): void {
  $('modal-chat').addEventListener('click', function (e) { if (e.target === this) window.cerrarChat(); });
  $('modal-match').addEventListener('click', function (e) { if (e.target === this) window.cerrarMatch(); });
  $<HTMLTextAreaElement>('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void window.enviarChat(); }
  });
}

// Para cerrar el chat al salir de la app (logout) sin dejar el refresco andando.
export function resetConexionesUI(): void {
  window.cerrarChat();
  window.cerrarMatch();
}
