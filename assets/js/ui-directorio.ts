// ══════════════════════════════════════════════
// PANTALLA "EMPRESAS": buscador + filtros combinables + "Ver más", y el
// mapa (que muestra lo mismo que el directorio filtrado).
// Todo se resuelve en la base (directorio.ts → buscar_empresas); acá solo
// se arma la pantalla.
// ══════════════════════════════════════════════
import { app } from './contexto.ts';
import {
  buscarEmpresas, buscarLocalidades, cantidadFiltros, filtrosVacios, listProvincias, listSectores,
  type EmpresaResultado, type Facetas, type FiltrosEmpresas, type LocalidadGeoref, type PuntoMapa, type ResultadoBusqueda,
} from './directorio.ts';
import type { ProvinciaRow, SectorRow } from './types.ts';
import { esc, friendlyError, ini, normalizeTagKey } from './utils.ts';

const PAGINA = 24;
const TIPOS = [
  { v: 'Empresa', t: 'Empresa' },
  { v: 'Emprendedor/Egresado', t: 'Emprendedor / Egresado' },
  { v: 'Facultad', t: 'Facultad / Área institucional' },
];
const KM = [5, 10, 25, 50, 100, 250];
const VISIBLES = 8; // opciones por grupo antes de "Ver todas"

let f: FiltrosEmpresas = filtrosVacios();
let res: ResultadoBusqueda | null = null;
let items: EmpresaResultado[] = [];
let sectores: SectorRow[] = [];
let provincias: ProvinciaRow[] = [];
let ctrl: AbortController | null = null;
let timerTexto: number | undefined;
let pedido = 0;
const expandidos = new Set<string>();
const gruposAbiertos = new Set<string>(['estado', 'sector', 'ubicacion', 'ofrece', 'necesita']);

const $ = (id: string) => document.getElementById(id) as HTMLElement;

declare global {
  interface Window {
    dirToggle: (grupo: string, valor: string) => void;
    dirQuitar: (grupo: string, valor: string) => void;
    dirLimpiar: () => void;
    dirMas: () => Promise<void>;
    dirVerTodas: (grupo: string) => void;
    dirOrden: (v: string) => void;
    dirAbrirFiltros: (abrir: boolean) => void;
    dirGrupo: (grupo: string, abierto: boolean) => void;
    dirCercaElegir: (i: number) => void;
    dirCercaKm: (km: string) => void;
    dirVerMapa: () => void;
  }
}

// ── Nombres para mostrar ──
const nombreSector = (id: number | string) => sectores.find(s => s.id === Number(id))?.nombre || 'Sector';
const nombreProvincia = (id: string) => provincias.find(p => p.id === id)?.nombre || id;
const nombreCategoria = (id: number | string) => app().categoriaById(Number(id))?.nombre || 'Categoría';
function nombreSub(clave: string): string {
  const [cat, sub] = clave.split('|');
  const c = app().categoriaById(Number(cat));
  const original = c?.subcategorias.find(s => normalizeTagKey(s) === sub);
  const txt = original || (sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : 'Sin especificar');
  return txt;
}
const nombreTipo = (v: string) => TIPOS.find(t => t.v === v)?.t || v;
function nombreLugar(grupo: 'departamentos' | 'localidades', id: string): string {
  const lista = grupo === 'departamentos' ? res?.facetas.departamentos : res?.facetas.localidades;
  return lista?.find(x => x.id === id)?.nombre || lugaresConocidos.get(id) || id;
}
const lugaresConocidos = new Map<string, string>();

// ── Búsqueda ──
async function buscar(opts: { append?: boolean } = {}): Promise<void> {
  ctrl?.abort();
  ctrl = new AbortController();
  const mio = ++pedido;
  const grid = $('org-grid');
  if (!opts.append) {
    grid.setAttribute('aria-busy', 'true');
    if (!items.length) grid.innerHTML = esqueleto();
  }
  try {
    const r = await buscarEmpresas(f, { limite: PAGINA, desde: opts.append ? items.length : 0, signal: ctrl.signal });
    if (mio !== pedido) return;
    res = r;
    (r.facetas.departamentos || []).forEach(d => lugaresConocidos.set(d.id, d.nombre));
    (r.facetas.localidades || []).forEach(d => lugaresConocidos.set(d.id, d.nombre));
    items = opts.append ? [...items, ...r.items] : r.items;
    pintar();
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' || /abort/i.test(String((e as Error)?.message))) return;
    grid.innerHTML = `<div class="empty empty--full"><i class="ti ti-alert-triangle"></i>${esc(friendlyError(e))}</div>`;
  } finally {
    if (mio === pedido) grid.removeAttribute('aria-busy');
  }
}

function esqueleto(): string {
  return Array.from({ length: 6 }, () => '<div class="org-card org-card--esqueleto" aria-hidden="true"><span></span><span></span><span></span></div>').join('');
}

function cambio(): void {
  window.clearTimeout(timerTexto);
  void buscar();
}

// ── Pintar todo ──
function pintar(): void {
  if (!res) return;
  pintarResumen();
  pintarChips();
  pintarFiltros(res.facetas);
  pintarOrden();
  pintarTarjetas();
}

function pintarResumen(): void {
  const r = res!;
  const n = r.total;
  $('dir-count').textContent = String(n);
  $('dir-resumen').textContent = `${n.toLocaleString('es-AR')} ${n === 1 ? 'organización' : 'organizaciones'}`;
  const aviso = $('dir-aviso');
  aviso.classList.toggle('hidden', !r.aproximada);
  aviso.innerHTML = r.aproximada
    ? `<i class="ti ti-wand"></i> No encontramos "<strong>${esc(f.q)}</strong>" tal cual: te mostramos resultados parecidos.`
    : '';
  const nf = cantidadFiltros(f);
  const badge = $('dir-filtros-n');
  badge.textContent = String(nf);
  badge.classList.toggle('hidden', !nf);
}

function chip(grupo: string, valor: string, texto: string): string {
  return `<span class="fchip">${esc(texto)}<button type="button" onclick="dirQuitar('${grupo}','${esc(valor)}')" aria-label="Quitar filtro ${esc(texto)}"><i class="ti ti-x"></i></button></span>`;
}

function pintarChips(): void {
  const c: string[] = [];
  if (f.conNecesidades) c.push(chip('estado', 'conNecesidades', 'Con necesidades'));
  if (f.misEmpresas) c.push(chip('estado', 'misEmpresas', 'Mis empresas'));
  if (f.compatibles) c.push(chip('estado', 'compatibles', 'Compatibles conmigo'));
  f.sectores.forEach(id => c.push(chip('sectores', String(id), nombreSector(id))));
  f.provincias.forEach(id => c.push(chip('provincias', id, nombreProvincia(id))));
  f.departamentos.forEach(id => c.push(chip('departamentos', id, nombreLugar('departamentos', id))));
  f.localidades.forEach(id => c.push(chip('localidades', id, nombreLugar('localidades', id))));
  if (f.cerca) c.push(chip('cerca', '', `A ${f.cerca.km} km de ${f.cerca.nombre}`));
  f.ofrece.forEach(id => c.push(chip('ofrece', String(id), 'Ofrece: ' + nombreCategoria(id))));
  f.ofreceSub.forEach(k => c.push(chip('ofreceSub', k, 'Ofrece: ' + nombreSub(k))));
  f.necesita.forEach(id => c.push(chip('necesita', String(id), 'Necesita: ' + nombreCategoria(id))));
  f.necesitaSub.forEach(k => c.push(chip('necesitaSub', k, 'Necesita: ' + nombreSub(k))));
  f.tipos.forEach(v => c.push(chip('tipos', v, nombreTipo(v))));
  if (c.length) c.push('<button type="button" class="fchip-limpiar" onclick="dirLimpiar()">Limpiar filtros</button>');
  $('dir-chips').innerHTML = c.join('');
  $('dir-chips').classList.toggle('hidden', !c.length);
}

function opcion(grupo: string, valor: string, texto: string, n: number | undefined, marcado: boolean): string {
  const id = `fo-${grupo}-${valor}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cant = n ?? 0;
  return `<label class="fopt${!cant && !marcado ? ' fopt--vacia' : ''}" for="${id}">
    <input type="checkbox" id="${id}" ${marcado ? 'checked' : ''} onchange="dirToggle('${grupo}','${esc(valor)}')">
    <span class="fopt-txt">${esc(texto)}</span><span class="fopt-n">${cant.toLocaleString('es-AR')}</span>
  </label>`;
}

// Lista de opciones con contador: primero las elegidas, después las de más
// resultados; las que no tienen resultados quedan al final. Se muestran
// VISIBLES y el resto con "Ver todas".
function lista(grupo: string, ops: { v: string; t: string; n: number; sel: boolean }[]): string {
  const orden = [...ops].sort((a, b) => Number(b.sel) - Number(a.sel) || b.n - a.n || a.t.localeCompare(b.t, 'es'));
  const todas = expandidos.has(grupo);
  const vis = todas ? orden : orden.slice(0, VISIBLES);
  let h = vis.map(o => opcion(grupo, o.v, o.t, o.n, o.sel)).join('');
  if (orden.length > VISIBLES) {
    h += `<button type="button" class="fver-todas" onclick="dirVerTodas('${grupo}')">${todas ? 'Ver menos' : `Ver todas (${orden.length})`}</button>`;
  }
  return h || '<div class="fvacio">Sin opciones</div>';
}

function grupo(id: string, titulo: string, cuerpo: string, activos: number): string {
  return `<details class="fgrupo" ${gruposAbiertos.has(id) ? 'open' : ''} ontoggle="dirGrupo('${id}', this.open)">
    <summary>${esc(titulo)}${activos ? `<span class="fgrupo-n">${activos}</span>` : ''}</summary>
    <div class="fgrupo-cuerpo">${cuerpo}</div>
  </details>`;
}

function pintarFiltros(fa: Facetas): void {
  const g: string[] = [];
  // Estado
  const est = [
    opcion('estado', 'conNecesidades', 'Con necesidades publicadas', fa.con_necesidades, f.conNecesidades),
  ];
  if (fa.tengo_empresas) {
    est.unshift(opcion('estado', 'compatibles', 'Compatibles conmigo', fa.compatibles, f.compatibles));
    est.push(opcion('estado', 'misEmpresas', 'Mis empresas', fa.mis_empresas, f.misEmpresas));
  }
  g.push(grupo('estado', 'Destacados', est.join('') + (fa.tengo_empresas ? '<p class="fayuda">"Compatibles conmigo": ofrecen lo que tus empresas necesitan, o necesitan lo que ofrecen.</p>' : ''),
    Number(f.conNecesidades) + Number(f.misEmpresas) + Number(f.compatibles)));
  // Sector
  g.push(grupo('sector', 'Sector', lista('sectores', sectores.map(s => ({ v: String(s.id), t: s.nombre, n: fa.sectores[s.id] || 0, sel: f.sectores.includes(s.id) }))), f.sectores.length));
  // Ubicación
  let ub = '<div class="fsub">Provincia</div>' + lista('provincias', provincias
    .filter(p => fa.provincias[p.id] || f.provincias.includes(p.id))
    .map(p => ({ v: p.id, t: p.nombre, n: fa.provincias[p.id] || 0, sel: f.provincias.includes(p.id) })));
  if (f.provincias.length) {
    ub += '<div class="fsub">Partido / departamento</div>' + lista('departamentos', fa.departamentos.map(d => ({ v: d.id, t: d.nombre, n: d.n, sel: f.departamentos.includes(d.id) }))
      .concat(f.departamentos.filter(id => !fa.departamentos.some(d => d.id === id)).map(id => ({ v: id, t: nombreLugar('departamentos', id), n: 0, sel: true }))));
  }
  if (f.departamentos.length) {
    ub += '<div class="fsub">Localidad</div>' + lista('localidades', fa.localidades.map(d => ({ v: d.id, t: d.nombre, n: d.n, sel: f.localidades.includes(d.id) }))
      .concat(f.localidades.filter(id => !fa.localidades.some(d => d.id === id)).map(id => ({ v: id, t: nombreLugar('localidades', id), n: 0, sel: true }))));
  }
  ub += `<div class="fsub">Cerca de</div>
    <div class="fcerca">
      <input type="search" id="dir-cerca-q" class="fi-sm" placeholder="Escribí una localidad…" autocomplete="off"
        aria-label="Localidad de referencia" aria-autocomplete="list" aria-controls="dir-cerca-sug" value="${esc(f.cerca?.nombre || '')}">
      <select id="dir-cerca-km" class="fi-sm" aria-label="Distancia máxima" onchange="dirCercaKm(this.value)">
        ${KM.map(k => `<option value="${k}" ${(f.cerca?.km || 50) === k ? 'selected' : ''}>${k} km</option>`).join('')}
      </select>
      <ul class="fsug hidden" id="dir-cerca-sug" role="listbox"></ul>
    </div>`;
  g.push(grupo('ubicacion', 'Ubicación', ub, f.provincias.length + f.departamentos.length + f.localidades.length + (f.cerca ? 1 : 0)));
  // Ofrece / Necesita
  for (const [k, titulo, cats, subs, fac, facSub] of [
    ['ofrece', 'Ofrece', f.ofrece, f.ofreceSub, fa.ofrece, fa.ofrece_sub],
    ['necesita', 'Necesita', f.necesita, f.necesitaSub, fa.necesita, fa.necesita_sub],
  ] as const) {
    let cuerpo = lista(k, app().categorias.map(c => ({ v: String(c.id), t: c.nombre, n: fac[c.id] || 0, sel: cats.includes(c.id) })));
    if (cats.length) {
      const subOps = Object.entries(facSub || {}).map(([clave, n]) => ({ v: clave, t: nombreSub(clave), n, sel: subs.includes(clave) }))
        .concat(subs.filter(s => !(s in (facSub || {}))).map(s => ({ v: s, t: nombreSub(s), n: 0, sel: true })));
      cuerpo += '<div class="fsub">Subcategoría</div>' + lista(k + 'Sub', subOps);
    }
    g.push(grupo(k, titulo, cuerpo, cats.length + subs.length));
  }
  // Tipo
  g.push(grupo('tipo', 'Tipo de organización', lista('tipos', TIPOS.map(t => ({ v: t.v, t: t.t, n: fa.tipos[t.v] || 0, sel: f.tipos.includes(t.v) }))), f.tipos.length));
  const cuerpo = $('dir-filtros-cuerpo');
  const foco = document.activeElement?.id;
  cuerpo.innerHTML = g.join('');
  if (foco) (document.getElementById(foco) as HTMLElement | null)?.focus({ preventScroll: true });
  wireCerca();
}

function pintarOrden(): void {
  const r = res!;
  const ops: [string, string][] = [];
  if (f.q.trim()) ops.push(['relevancia', 'Más relevantes']);
  if (f.cerca) ops.push(['distancia', 'Más cercanas']);
  if (r.facetas.tengo_empresas) ops.push(['coincidencias', 'Más coincidencias conmigo']);
  ops.push(['nombre', 'Nombre (A–Z)'], ['recientes', 'Más recientes']);
  $('dir-orden').innerHTML = ops.map(([v, t]) => `<option value="${v}" ${r.orden === v ? 'selected' : ''}>${t}</option>`).join('');
}

function tarjeta(o: EmpresaResultado): string {
  const loc = [o.ciudad, o.provincia].filter(Boolean).join(', ');
  const sec = [o.sector_id, o.sector2_id].filter((x): x is number => !!x).map(nombreSector).join(' · ');
  const ofe = o.items.filter(i => i.tipo === 'oferta');
  const nec = o.items.filter(i => i.tipo === 'necesidad');
  const etiqueta = (i: { categoria_id: number; subcategoria: string }) => nombreCategoria(i.categoria_id) + (i.subcategoria ? ' › ' + i.subcategoria : '');
  const extra = ofe.length + nec.length - Math.min(ofe.length, 2) - Math.min(nec.length, 1);
  const logo = o.logo
    ? `<img src="${esc(o.logo)}" class="org-logo-img logo-42" alt="" loading="lazy">`
    : `<div class="avatar logo-42" aria-hidden="true">${esc(ini(o.nombre))}</div>`;
  return `<div class="org-card${o.es_mia ? ' mine' : ''}" onclick="openDetail(${o.id})">
    ${o.es_mia ? '<div class="mine-badge"><i class="ti ti-star"></i>Mi empresa</div>' : ''}
    <div class="card-head">${logo}
      <div><div class="card-org-name">${esc(o.nombre)}</div><div class="card-ref">${esc([o.referente, o.cargo].filter(Boolean).join(' · '))}</div></div>
    </div>
    ${sec ? `<div class="card-sector"><i class="ti ti-tag"></i>${esc(sec)}</div>` : ''}
    ${loc ? `<div class="card-meta"><i class="ti ti-map-pin"></i>${esc(loc)}${o.distancia_km != null ? ` <span class="card-dist">· ${o.distancia_km.toLocaleString('es-AR')} km</span>` : ''}</div>` : ''}
    ${o.coincidencias > 0 ? `<div class="card-meta card-coinc"><i class="ti ti-arrows-exchange"></i>${o.coincidencias} ${o.coincidencias === 1 ? 'coincidencia' : 'coincidencias'} con tus empresas</div>` : ''}
    <div class="tags">
      ${ofe.slice(0, 2).map(t => `<span class="tag tag-offer">${esc(etiqueta(t))}</span>`).join('')}
      ${nec.slice(0, 1).map(t => `<span class="tag tag-need">${esc(etiqueta(t))}</span>`).join('')}
      ${extra > 0 ? `<span class="tag tag-mas">+${extra}</span>` : ''}
    </div>
  </div>`;
}

function pintarTarjetas(): void {
  const grid = $('org-grid');
  if (!items.length) {
    grid.innerHTML = `<div class="empty empty--full"><i class="ti ti-building-off"></i>
      No hay organizaciones con estos filtros.${cantidadFiltros(f) ? '<br><button type="button" class="btn-out btn-sm-txt mt-2" onclick="dirLimpiar()">Limpiar filtros</button>' : ''}</div>`;
  } else {
    grid.innerHTML = items.map(tarjeta).join('');
  }
  const mas = $('dir-mas');
  mas.classList.toggle('hidden', !res?.hay_mas);
  mas.textContent = res?.hay_mas ? `Ver más (${(res.total - items.length).toLocaleString('es-AR')} restantes)` : 'Ver más';
}

// ── Acciones ──
type Lista = 'sectores' | 'provincias' | 'departamentos' | 'localidades' | 'tipos' | 'ofrece' | 'necesita' | 'ofreceSub' | 'necesitaSub';
const NUMERICAS = new Set(['sectores', 'ofrece', 'necesita']);

function alternar<T>(arr: T[], v: T): T[] { return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]; }

window.dirToggle = function (g, valor) {
  if (g === 'estado') {
    const k = valor as 'conNecesidades' | 'misEmpresas' | 'compatibles';
    f = { ...f, [k]: !f[k] };
  } else {
    const k = g as Lista;
    const v = NUMERICAS.has(k) ? Number(valor) : valor;
    f = { ...f, [k]: alternar(f[k] as (string | number)[], v) } as FiltrosEmpresas;
    // Al sacar una provincia/partido/categoría se sacan sus hijos.
    if (k === 'provincias' && !f.provincias.length) f = { ...f, departamentos: [], localidades: [] };
    if (k === 'departamentos' && !f.departamentos.length) f = { ...f, localidades: [] };
    if (k === 'ofrece') f = { ...f, ofreceSub: f.ofreceSub.filter(s => f.ofrece.includes(Number(s.split('|')[0]))) };
    if (k === 'necesita') f = { ...f, necesitaSub: f.necesitaSub.filter(s => f.necesita.includes(Number(s.split('|')[0]))) };
  }
  cambio();
};

window.dirQuitar = function (g, valor) {
  if (g === 'cerca') { f = { ...f, cerca: null, orden: f.orden === 'distancia' ? 'auto' : f.orden }; cambio(); return; }
  window.dirToggle(g, valor);
};

window.dirLimpiar = function () {
  f = { ...filtrosVacios(), q: f.q, orden: f.orden };
  cambio();
};

window.dirMas = async function () {
  const btn = $('dir-mas') as HTMLButtonElement;
  btn.disabled = true;
  const antes = items.length;
  await buscar({ append: true });
  btn.disabled = false;
  // El foco pasa a la primera tarjeta nueva (teclado y lectores de pantalla).
  (document.querySelectorAll<HTMLElement>('#org-grid .org-card')[antes])?.focus();
};

window.dirVerTodas = function (g) {
  if (expandidos.has(g)) expandidos.delete(g); else expandidos.add(g);
  if (res) pintarFiltros(res.facetas);
};

window.dirGrupo = function (g, abierto) {
  if (abierto) gruposAbiertos.add(g); else gruposAbiertos.delete(g);
};

window.dirOrden = function (v) {
  f = { ...f, orden: v as FiltrosEmpresas['orden'] };
  cambio();
};

window.dirAbrirFiltros = function (abrir) {
  $('dir-filtros').classList.toggle('abierto', abrir);
  $('dir-btn-filtros').setAttribute('aria-expanded', String(abrir));
  document.body.classList.toggle('sin-scroll', abrir);
  if (abrir) ($('dir-filtros').querySelector('button, input, summary') as HTMLElement | null)?.focus();
  else $('dir-btn-filtros').focus();
};

window.dirVerMapa = function () {
  app().showScreen('mapa');
};

// ── "Cerca de": localidades del servicio oficial mientras se escribe ──
let sugerencias: LocalidadGeoref[] = [];
let ctrlCerca: AbortController | null = null;
let timerCerca: number | undefined;

function wireCerca(): void {
  const inp = document.getElementById('dir-cerca-q') as HTMLInputElement | null;
  if (!inp) return;
  inp.addEventListener('input', () => {
    window.clearTimeout(timerCerca);
    const txt = inp.value.trim();
    if (!txt && f.cerca) { f = { ...f, cerca: null }; cambio(); return; }
    timerCerca = window.setTimeout(async () => {
      ctrlCerca?.abort();
      ctrlCerca = new AbortController();
      try {
        sugerencias = await buscarLocalidades(txt, null, ctrlCerca.signal);
      } catch { sugerencias = []; }
      pintarSugerencias();
    }, 250);
  });
  inp.addEventListener('keydown', e => {
    const ul = $('dir-cerca-sug');
    const opts = [...ul.querySelectorAll<HTMLElement>('[role="option"]')];
    if (e.key === 'ArrowDown' && opts.length) { e.preventDefault(); opts[0].focus(); }
    if (e.key === 'Escape') { ul.classList.add('hidden'); }
  });
}

function pintarSugerencias(): void {
  const ul = $('dir-cerca-sug');
  if (!sugerencias.length) {
    ul.innerHTML = '<li class="fsug-vacio">No encontramos esa localidad.</li>';
  } else {
    ul.innerHTML = sugerencias.map((l, i) => `<li role="option" tabindex="-1" aria-selected="false" onclick="dirCercaElegir(${i})"
      onkeydown="if(event.key==='Enter'){dirCercaElegir(${i})}else if(event.key==='ArrowDown'){event.preventDefault();this.nextElementSibling?.focus()}else if(event.key==='ArrowUp'){event.preventDefault();(this.previousElementSibling||document.getElementById('dir-cerca-q')).focus()}">
      <strong>${esc(l.nombre)}</strong><span>${esc(l.departamento.nombre)}, ${esc(l.provincia.nombre)}</span></li>`).join('');
  }
  ul.classList.remove('hidden');
}

window.dirCercaElegir = function (i) {
  const l = sugerencias[i];
  if (!l) return;
  const km = Number(($('dir-cerca-km') as HTMLSelectElement).value) || 50;
  f = { ...f, cerca: { lat: l.centroide.lat, lng: l.centroide.lon, km, nombre: `${l.nombre} (${l.provincia.nombre})` }, orden: 'auto' };
  cambio();
};

window.dirCercaKm = function (km) {
  if (!f.cerca) return;
  f = { ...f, cerca: { ...f.cerca, km: Number(km) } };
  cambio();
};

// ── Mapa: los mismos filtros, todos los puntos, agrupados por zona ──
export async function puntosDelDirectorio(): Promise<{ puntos: PuntoMapa[]; total: number; filtros: number }> {
  const r = await buscarEmpresas(f, { mapa: true });
  return { puntos: r.puntos || [], total: r.total, filtros: cantidadFiltros(f) + (f.q.trim() ? 1 : 0) };
}

export function limpiarFiltrosDirectorio(): void {
  f = filtrosVacios();
  const inp = document.getElementById('search-input') as HTMLInputElement | null;
  if (inp) inp.value = '';
}

export { nombreSector };

// ── Arranque y entrada a la pantalla ──
let listo = false;

export async function initDirectorio(): Promise<void> {
  [sectores, provincias] = await Promise.all([listSectores().catch(() => []), listProvincias().catch(() => [])]);
  if (listo) return;
  listo = true;
  const inp = $('search-input') as HTMLInputElement;
  inp.addEventListener('input', () => {
    window.clearTimeout(timerTexto);
    timerTexto = window.setTimeout(() => {
      f = { ...f, q: inp.value };
      void buscar();
    }, 250);
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { window.clearTimeout(timerTexto); f = { ...f, q: inp.value }; void buscar(); }
  });
  document.addEventListener('click', e => {
    const ul = document.getElementById('dir-cerca-sug');
    if (ul && !(e.target as HTMLElement).closest('.fcerca')) ul.classList.add('hidden');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('dir-filtros').classList.contains('abierto')) window.dirAbrirFiltros(false);
  });
}

export function renderDirectorio(): void {
  void buscar();
}

export function resetDirectorio(): void {
  ctrl?.abort();
  f = filtrosVacios();
  res = null;
  items = [];
  expandidos.clear();
  const inp = document.getElementById('search-input') as HTMLInputElement | null;
  if (inp) inp.value = '';
}

// Totales de la red (para las tarjetas del inicio).
export async function totalesRed(): Promise<{ organizaciones: number; sectores: number }> {
  const r = await buscarEmpresas(filtrosVacios(), { limite: 1 });
  return { organizaciones: r.total, sectores: Object.keys(r.facetas.sectores).length };
}
