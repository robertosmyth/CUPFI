// ══════════════════════════════════════════════
// DIRECTORIO DE GRADUADOS: búsqueda y "Ver más" resueltos en la base
// (buscar_graduados, sql/016). El email y el teléfono llegan solo si
// quien mira puede verlos (vínculo aceptado, uno mismo o admin).
// ══════════════════════════════════════════════
import { app } from './contexto.ts';
import { getSupabase } from './supabaseClient.ts';
import { nombreSector } from './ui-directorio.ts';
import { esc, friendlyError, ini } from './utils.ts';

interface EmpresaGrad { id: number; nombre: string; logo: string | null; sector_id: number | null; ciudad: string | null }
interface Graduado { id: string; nombre: string; apellido: string; email: string | null; tel: string | null; empresas: EmpresaGrad[] }

const POR_PAGINA = 24;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
let items: Graduado[] = [];
let total = 0;
let pedido = 0;
let timer: number | undefined;
let listo = false;

function tarjeta(u: Graduado): string {
  const yo = app().currentProfile;
  const isSelf = !!yo && u.id === yo.id;
  const emps = u.empresas || [];
  return `<div class="user-card">
    <div class="user-card-head">
      <div class="user-avatar" aria-hidden="true">${esc((u.nombre?.[0] || '') + (u.apellido?.[0] || ''))}</div>
      <div>
        <div class="user-name">${esc(`${u.nombre} ${u.apellido || ''}`)} ${isSelf ? '<span class="badge-self">Yo</span>' : ''}</div>
        ${u.email ? `<div class="user-contact"><i class="ti ti-mail" aria-hidden="true"></i>${esc(u.email)}</div>` : ''}
        ${u.tel ? `<div class="user-contact"><i class="ti ti-phone" aria-hidden="true"></i>${esc(u.tel)}</div>` : ''}
        ${!u.email && !u.tel ? '<div class="user-contact user-contact--privado"><i class="ti ti-lock" aria-hidden="true"></i>Contacto visible al vincularse</div>' : ''}
      </div>
    </div>
    <div class="user-companies">
      <div class="user-companies-title"><i class="ti ti-building" aria-hidden="true"></i>${emps.length} empresa${emps.length !== 1 ? 's' : ''}</div>
      ${emps.length === 0 ? '<div class="muted-note">Sin empresas registradas aún.</div>' : ''}
      ${emps.map(o => `
        <div class="mini-company" role="button" tabindex="0" onclick="openDetail(${o.id})" onkeydown="if(event.key==='Enter')openDetail(${o.id})">
          ${o.logo ? `<img src="${esc(o.logo)}" class="mini-logo" alt="" loading="lazy">` : `<div class="mini-avatar" aria-hidden="true">${esc(ini(o.nombre))}</div>`}
          <div>
            <div class="mini-name">${esc(o.nombre)}</div>
            <div class="mini-sector">${esc(o.sector_id ? nombreSector(o.sector_id) : '')}${o.ciudad ? ' · ' + esc(o.ciudad) : ''}</div>
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

function pintar(): void {
  $('grad-count').textContent = total.toLocaleString('es-AR');
  const grid = $('grad-grid');
  grid.innerHTML = items.length
    ? items.map(tarjeta).join('')
    : '<div class="empty empty--full"><i class="ti ti-users-off" aria-hidden="true"></i>Sin resultados.</div>';
  const btn = $('grad-mas') as HTMLButtonElement;
  const faltan = total - items.length;
  btn.classList.toggle('hidden', faltan <= 0);
  btn.textContent = `Ver más graduados (${Math.min(POR_PAGINA, faltan)} de ${faltan.toLocaleString('es-AR')} restantes)`;
}

async function cargar(agregar: boolean): Promise<void> {
  const mio = ++pedido;
  const grid = $('grad-grid');
  grid.setAttribute('aria-busy', 'true');
  try {
    const supabase = await getSupabase();
    const q = (document.getElementById('search-grad') as HTMLInputElement).value;
    const { data, error } = await supabase.rpc('buscar_graduados', { p: { q, limite: POR_PAGINA, desde: agregar ? items.length : 0 } });
    if (error) throw error;
    if (mio !== pedido) return;
    const r = data as { total: number; items: Graduado[] };
    items = agregar ? items.concat(r.items) : r.items;
    total = r.total;
    pintar();
  } catch (e) {
    if (mio === pedido) grid.innerHTML = `<div class="empty empty--full">${esc(friendlyError(e))}</div>`;
  } finally {
    grid.removeAttribute('aria-busy');
  }
}

declare global {
  interface Window { gradMas(): void }
}
window.gradMas = () => { void cargar(true); };

export function renderGraduadosUI(): void {
  if (!listo) {
    listo = true;
    document.getElementById('search-grad')!.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void cargar(false), 250);
    });
  }
  void cargar(false);
}

export function resetGraduadosUI(): void {
  items = []; total = 0; pedido++;
}
