// ══════════════════════════════════════════════
// FORMULARIO DE EMPRESA: sector (lista fija) y ubicación normalizada.
// En Argentina la localidad se elige de la lista oficial (Georef); con la
// calle se buscan las coordenadas exactas y se pueden ajustar arrastrando
// el marcador en el mapa. Fuera de Argentina, texto libre y marcador a mano.
// ══════════════════════════════════════════════
import type * as LeafletTypes from 'leaflet';
import { buscarLocalidades, listProvincias, listSectores, ubicarDireccion, type LocalidadGeoref } from './directorio.ts';
import type { Empresa, ProvinciaRow, SectorRow, UbicacionPrecision } from './types.ts';
import { esc } from './utils.ts';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $i = (id: string) => document.getElementById(id) as HTMLInputElement;
const $s = (id: string) => document.getElementById(id) as HTMLSelectElement;

interface EstadoUbicacion {
  provinciaId: string | null;
  departamento: string;
  departamentoId: string | null;
  localidadId: string | null;
  lat: number | null;
  lng: number | null;
  precision: UbicacionPrecision | null;
}

let st: EstadoUbicacion = vacio();
let sectores: SectorRow[] = [];
let provincias: ProvinciaRow[] = [];
let sugerencias: LocalidadGeoref[] = [];
let georefCaido = false;
// Localidad con la que se abrió una empresa existente: si no se toca, se
// puede guardar aunque todavía no esté normalizada (la completan después).
let ciudadCargada: string | null = null;
let timer: number | undefined;
let ctrl: AbortController | null = null;
let ctrlCalle: AbortController | null = null;
let L: typeof LeafletTypes | null = null;
let mapa: LeafletTypes.Map | null = null;
let marcador: LeafletTypes.Marker | null = null;
let cargarLeaflet: () => Promise<typeof LeafletTypes> = async () => { throw new Error('sin mapa'); };

function vacio(): EstadoUbicacion {
  return { provinciaId: null, departamento: '', departamentoId: null, localidadId: null, lat: null, lng: null, precision: null };
}

declare global {
  interface Window { ubicElegir: (i: number) => void }
}

const esArgentina = () => /^\s*(argentina|ar|)\s*$/i.test($i('f-pais').value);

function opcionesSector(sel: HTMLSelectElement, vacioTxt: string, valor: number | null): void {
  sel.innerHTML = `<option value="">${vacioTxt}</option>` + sectores.map(s => `<option value="${s.id}" ${s.id === valor ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('');
}

function pintarPais(): void {
  const arg = esArgentina();
  $s('f-provincia-id').classList.toggle('hidden', !arg);
  $i('f-provincia').classList.toggle('hidden', arg);
  $('f-ciudad').setAttribute('placeholder', arg ? 'Empezá a escribir y elegí de la lista' : 'Ciudad');
  pintarEstado();
}

function pintarEstado(msg?: string): void {
  const e = $('f-ubic-estado');
  if (msg) { e.innerHTML = msg; return; }
  const txt: Record<UbicacionPrecision, string> = {
    direccion: '<i class="ti ti-map-pin-check"></i> Ubicación exacta por la calle. Si no es correcta, arrastrá el marcador.',
    localidad: '<i class="ti ti-map-pin"></i> Marcamos el centro de la localidad. Para más precisión, completá la calle o arrastrá el marcador.',
    manual: '<i class="ti ti-hand-finger"></i> Ubicación marcada a mano.',
  };
  e.innerHTML = st.precision ? txt[st.precision]
    : esArgentina() ? '<i class="ti ti-info-circle"></i> Elegí la localidad de la lista para ubicar la organización en el mapa.'
      : '<i class="ti ti-info-circle"></i> Tocá el mapa para marcar dónde está la organización.';
  $('f-ciudad-ayuda').textContent = esArgentina() && $i('f-ciudad').value.trim() && !st.localidadId && !georefCaido
    ? 'Elegí una opción de la lista para que la localidad quede bien registrada.' : '';
}

async function asegurarMapa(): Promise<void> {
  if (mapa) return;
  try {
    L = await cargarLeaflet();
  } catch { return; }
  mapa = L.map('f-mapa', { scrollWheelZoom: false }).setView([-38.5, -63.5], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 18,
  }).addTo(mapa);
  mapa.on('click', ev => fijar(ev.latlng.lat, ev.latlng.lng, 'manual'));
}

function fijar(lat: number, lng: number, precision: UbicacionPrecision, centrar = true): void {
  st = { ...st, lat, lng, precision };
  if (mapa && L) {
    if (!marcador) {
      const icon = L.divIcon({
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" aria-hidden="true">
          <path d="M14 0C6.27 0 0 6.27 0 14c0 9.625 14 22 14 22S28 23.625 28 14C28 6.27 21.73 0 14 0z" fill="#3B24C8"/>
          <circle cx="14" cy="14" r="7" fill="white"/><circle cx="14" cy="14" r="4" fill="#233DFF"/></svg>`,
        className: 'ubic-pin', iconSize: [28, 36], iconAnchor: [14, 36],
      });
      marcador = L.marker([lat, lng], { icon, draggable: true, keyboard: true, title: 'Ubicación de la organización (se puede arrastrar)', alt: 'Marcador de la organización' }).addTo(mapa);
      marcador.on('dragend', () => { const p = marcador!.getLatLng(); fijar(p.lat, p.lng, 'manual', false); });
    } else {
      marcador.setLatLng([lat, lng]);
    }
    if (centrar) mapa.setView([lat, lng], precision === 'localidad' ? 13 : 16);
  }
  pintarEstado();
}

function quitarPunto(): void {
  st = { ...st, lat: null, lng: null, precision: null };
  if (marcador) { marcador.remove(); marcador = null; }
  pintarEstado();
}

// ── Localidad: sugerencias del servicio oficial ──
function pintarSugerencias(): void {
  const ul = $('f-ciudad-sug');
  ul.innerHTML = sugerencias.length
    ? sugerencias.map((l, i) => `<li role="option" tabindex="-1" aria-selected="false" onclick="ubicElegir(${i})"
        onkeydown="if(event.key==='Enter'){event.preventDefault();ubicElegir(${i})}else if(event.key==='ArrowDown'){event.preventDefault();this.nextElementSibling?.focus()}else if(event.key==='ArrowUp'){event.preventDefault();(this.previousElementSibling||document.getElementById('f-ciudad')).focus()}">
        <strong>${esc(l.nombre)}</strong><span>${esc(l.departamento.nombre)}, ${esc(l.provincia.nombre)}</span></li>`).join('')
    : '<li class="fsug-vacio">No encontramos esa localidad en esa provincia.</li>';
  ul.classList.remove('hidden');
}

window.ubicElegir = async function (i) {
  const l = sugerencias[i];
  if (!l) return;
  $('f-ciudad-sug').classList.add('hidden');
  $i('f-ciudad').value = l.nombre;
  $s('f-provincia-id').value = l.provincia.id;
  st = { ...st, provinciaId: l.provincia.id, departamento: l.departamento.nombre, departamentoId: l.departamento.id, localidadId: l.id };
  await asegurarMapa();
  fijar(l.centroide.lat, l.centroide.lon, 'localidad');
  $i('f-calle').focus();
  void ubicarCalle();
};

async function ubicarCalle(): Promise<void> {
  if (!esArgentina() || !st.departamentoId || !st.provinciaId || st.precision === 'manual') return;
  ctrlCalle?.abort();
  ctrlCalle = new AbortController();
  const c = await ubicarDireccion($i('f-calle').value, st.departamentoId, st.provinciaId, ctrlCalle.signal);
  if (c) fijar(c.lat, c.lng, 'direccion');
  else if ($i('f-calle').value.trim() && st.precision === 'direccion') {
    // La calle cambió y la nueva no figura: vuelve al centro de la localidad.
    pintarEstado('<i class="ti ti-alert-circle"></i> No encontramos esa calle en el registro oficial. Arrastrá el marcador al lugar correcto.');
  }
}

export async function initFormUbicacion(leaflet: () => Promise<typeof LeafletTypes>): Promise<void> {
  cargarLeaflet = leaflet;
  [sectores, provincias] = await Promise.all([listSectores().catch(() => []), listProvincias().catch(() => [])]);
  opcionesSector($s('f-sector-id'), 'Elegí el sector…', null);
  opcionesSector($s('f-sector2-id'), 'Ninguno', null);
  $s('f-provincia-id').innerHTML = '<option value="">Elegí la provincia…</option>'
    + provincias.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');

  if ($i('f-ciudad').dataset.ubic) return; // eventos ya conectados
  $i('f-ciudad').dataset.ubic = '1';
  $i('f-pais').addEventListener('input', () => { if (!esArgentina()) st = { ...vacio(), lat: st.lat, lng: st.lng, precision: st.lat != null ? 'manual' : null }; pintarPais(); });
  $s('f-provincia-id').addEventListener('change', () => {
    st = { ...vacio(), provinciaId: $s('f-provincia-id').value || null };
    $i('f-ciudad').value = '';
    quitarPunto();
  });
  $i('f-ciudad').addEventListener('input', () => {
    if (st.localidadId) { st = { ...st, localidadId: null, departamento: '', departamentoId: null }; quitarPunto(); }
    pintarEstado();
    if (!esArgentina()) return;
    window.clearTimeout(timer);
    const txt = $i('f-ciudad').value;
    timer = window.setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        sugerencias = await buscarLocalidades(txt, $s('f-provincia-id').value || null, ctrl.signal);
        georefCaido = false;
        if (txt.trim().length >= 2) pintarSugerencias();
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        georefCaido = true;
        $('f-ciudad-sug').classList.add('hidden');
        pintarEstado('<i class="ti ti-alert-circle"></i> El servicio oficial de ubicaciones no responde: podés escribir la localidad y marcar el punto en el mapa.');
      }
    }, 250);
  });
  $i('f-ciudad').addEventListener('keydown', e => {
    const opts = [...$('f-ciudad-sug').querySelectorAll<HTMLElement>('[role="option"]')];
    if (e.key === 'ArrowDown' && opts.length) { e.preventDefault(); opts[0].focus(); }
    if (e.key === 'Escape') $('f-ciudad-sug').classList.add('hidden');
  });
  $i('f-calle').addEventListener('change', () => {
    if (st.precision === 'manual') return; // no pisar lo que marcó la persona
    void ubicarCalle();
  });
  document.addEventListener('click', e => {
    if (!(e.target as HTMLElement).closest('#f-ciudad, #f-ciudad-sug')) $('f-ciudad-sug').classList.add('hidden');
  });
}

// Al abrir el formulario (alta o edición).
export async function cargarUbicacion(o: Empresa | null): Promise<void> {
  opcionesSector($s('f-sector-id'), 'Elegí el sector…', o?.sectorId ?? null);
  opcionesSector($s('f-sector2-id'), 'Ninguno', o?.sector2Id ?? null);
  st = o ? {
    provinciaId: o.provinciaId, departamento: o.departamento, departamentoId: o.departamentoId, localidadId: o.localidadId,
    lat: o.lat, lng: o.lng, precision: o.ubicacionPrecision,
  } : vacio();
  ciudadCargada = o ? (o.ciudad || '').trim() : null;
  $s('f-provincia-id').value = o?.provinciaId || '';
  if (!o) $i('f-pais').value = 'Argentina';
  pintarPais();
  await asegurarMapa();
  if (!mapa) return;
  setTimeout(() => mapa?.invalidateSize(), 50);
  if (marcador) { marcador.remove(); marcador = null; }
  if (st.lat != null && st.lng != null && st.precision) fijar(st.lat, st.lng, st.precision);
  else mapa.setView([-38.5, -63.5], 4);
}

export interface DatosUbicacion {
  sectorId: number | null; sector2Id: number | null; sector: string;
  provinciaId: string | null; provincia: string; departamento: string; departamentoId: string | null;
  localidadId: string | null; lat: number | null; lng: number | null; ubicacionPrecision: UbicacionPrecision | null;
}

// Lo que se guarda, o el motivo por el que todavía no se puede guardar.
export function leerUbicacion(): { datos: DatosUbicacion } | { error: string } {
  const sectorId = Number($s('f-sector-id').value) || null;
  const sector2Id = Number($s('f-sector2-id').value) || null;
  if (!sectorId) return { error: 'Elegí el sector de la organización.' };
  if (sector2Id && sector2Id === sectorId) return { error: 'El sector secundario tiene que ser distinto del principal.' };
  const arg = esArgentina();
  const ciudad = $i('f-ciudad').value.trim();
  if (arg && ciudad && !st.localidadId && !georefCaido && ciudad !== ciudadCargada) {
    return { error: 'Elegí la localidad de la lista que aparece al escribir (así queda bien ubicada en el mapa y en los filtros).' };
  }
  const provinciaId = arg ? ($s('f-provincia-id').value || null) : null;
  return {
    datos: {
      sectorId, sector2Id, sector: sectores.find(s => s.id === sectorId)?.nombre || '',
      provinciaId,
      provincia: arg ? (provincias.find(p => p.id === provinciaId)?.nombre || '') : $i('f-provincia').value.trim(),
      departamento: st.departamento, departamentoId: st.departamentoId, localidadId: st.localidadId,
      lat: st.lat, lng: st.lng, ubicacionPrecision: st.lat != null ? st.precision : null,
    },
  };
}

export function resetUbicacion(): void {
  st = vacio();
  ciudadCargada = null;
  $s('f-sector-id').value = '';
  $s('f-sector2-id').value = '';
  $s('f-provincia-id').value = '';
  $i('f-provincia').value = '';
  $('f-ciudad-sug').classList.add('hidden');
  if (marcador) { marcador.remove(); marcador = null; }
  mapa?.setView([-38.5, -63.5], 4);
  pintarPais();
}
