// ══════════════════════════════════════════════
// Piezas compartidas para listas grandes: paginador numerado con
// "por página", y buscador de usuarios con sugerencias (reemplaza las
// listas desplegables con todos los usuarios).
// ══════════════════════════════════════════════
import { getSupabase } from './supabaseClient.ts';
import { esc } from './utils.ts';

export const TAMANOS = [25, 50, 100];

// Páginas a mostrar: 1 … 4 5 [6] 7 8 … 40
export function paginasVisibles(actual: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, actual - 1, actual, actual + 1].filter(n => n >= 1 && n <= total));
  if (actual <= 3) [2, 3, 4].forEach(n => set.add(n));
  if (actual >= total - 2) [total - 3, total - 2, total - 1].forEach(n => set.add(n));
  const nums = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

// Paginador. `onIr` y `onTamano` son nombres de funciones globales (window).
export function paginadorHtml(o: { id: string; pagina: number; tamano: number; total: number; onIr: string; onTamano: string; etiqueta: string }): string {
  const paginas = Math.max(1, Math.ceil(o.total / o.tamano));
  const desde = o.total ? (o.pagina - 1) * o.tamano + 1 : 0;
  const hasta = Math.min(o.total, o.pagina * o.tamano);
  const btn = (n: number, txt: string, aria: string, dis = false, actual = false) =>
    `<button type="button" class="pag-btn${actual ? ' activo' : ''}" ${dis ? 'disabled' : ''} ${actual ? 'aria-current="page"' : ''}
      aria-label="${aria}" onclick="${o.onIr}(${n})">${txt}</button>`;
  return `<nav class="paginador" id="${o.id}" aria-label="Páginas de ${esc(o.etiqueta)}">
    <span class="pag-info">${desde.toLocaleString('es-AR')}–${hasta.toLocaleString('es-AR')} de ${o.total.toLocaleString('es-AR')}</span>
    <div class="pag-nums">
      ${btn(o.pagina - 1, '<i class="ti ti-chevron-left"></i>', 'Página anterior', o.pagina <= 1)}
      ${paginasVisibles(o.pagina, paginas).map(n => n === '…' ? '<span class="pag-gap" aria-hidden="true">…</span>' : btn(n, String(n), `Página ${n}`, false, n === o.pagina)).join('')}
      ${btn(o.pagina + 1, '<i class="ti ti-chevron-right"></i>', 'Página siguiente', o.pagina >= paginas)}
    </div>
    <label class="pag-tam">Por página
      <select onchange="${o.onTamano}(Number(this.value))">${TAMANOS.map(t => `<option value="${t}" ${t === o.tamano ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </label>
  </nav>`;
}

// ── Buscador de usuarios con sugerencias (admin y webmaster) ──
export interface UsuarioSugerido { id: string; nombre: string; apellido: string; email: string | null }

export async function sugerirUsuarios(q: string): Promise<UsuarioSugerido[]> {
  if (q.trim().length < 2) return [];
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('sugerir_usuarios', { p_q: q.trim(), p_limite: 8 });
  if (error) throw error;
  return (data || []) as UsuarioSugerido[];
}

const etiquetaUsuario = (u: UsuarioSugerido) => `${u.nombre} ${u.apellido || ''}`.trim() + (u.email ? ` (${u.email})` : '');

// Convierte un <input> en buscador de usuario. Llama a onCambio con el
// usuario elegido (o null al borrarlo).
export function buscadorUsuario(input: HTMLInputElement, onCambio: (u: UsuarioSugerido | null) => void): { limpiar: () => void; valor: () => UsuarioSugerido | null } {
  let elegido: UsuarioSugerido | null = null;
  let lista: UsuarioSugerido[] = [];
  let timer: number | undefined;
  let pedido = 0;
  const wrap = document.createElement('div');
  wrap.className = 'busq-usuario';
  input.parentNode?.insertBefore(wrap, input);
  wrap.appendChild(input);
  const ul = document.createElement('ul');
  ul.className = 'fsug hidden';
  ul.id = input.id + '-sug';
  ul.setAttribute('role', 'listbox');
  wrap.appendChild(ul);
  const quitar = document.createElement('button');
  quitar.type = 'button';
  quitar.className = 'busq-quitar hidden';
  quitar.setAttribute('aria-label', 'Quitar el filtro de usuario');
  quitar.innerHTML = '<i class="ti ti-x" aria-hidden="true"></i>';
  wrap.appendChild(quitar);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', ul.id);

  const fijar = (u: UsuarioSugerido | null) => {
    elegido = u;
    input.value = u ? etiquetaUsuario(u) : '';
    input.classList.toggle('busq-elegido', !!u);
    quitar.classList.toggle('hidden', !u);
    ul.classList.add('hidden');
    onCambio(u);
  };
  const pintar = () => {
    ul.innerHTML = lista.length
      ? lista.map((u, i) => `<li role="option" tabindex="-1" aria-selected="false" data-i="${i}"><strong>${esc(`${u.nombre} ${u.apellido || ''}`)}</strong><span>${esc(u.email || '')}</span></li>`).join('')
      : '<li class="fsug-vacio">Ningún usuario coincide.</li>';
    ul.classList.remove('hidden');
  };
  input.addEventListener('input', () => {
    if (elegido) { elegido = null; input.classList.remove('busq-elegido'); quitar.classList.add('hidden'); onCambio(null); }
    window.clearTimeout(timer);
    const txt = input.value;
    if (txt.trim().length < 2) { ul.classList.add('hidden'); return; }
    timer = window.setTimeout(async () => {
      const mio = ++pedido;
      try { const r = await sugerirUsuarios(txt); if (mio === pedido) { lista = r; pintar(); } } catch { /* sin sugerencias */ }
    }, 200);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); (ul.querySelector('[role="option"]') as HTMLElement | null)?.focus(); }
    if (e.key === 'Escape') ul.classList.add('hidden');
  });
  ul.addEventListener('click', e => {
    const li = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null;
    if (li) fijar(lista[Number(li.dataset.i)]);
  });
  ul.addEventListener('keydown', e => {
    const li = e.target as HTMLElement;
    if (e.key === 'Enter' && li.dataset.i) { e.preventDefault(); fijar(lista[Number(li.dataset.i)]); input.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); (li.nextElementSibling as HTMLElement | null)?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); ((li.previousElementSibling as HTMLElement | null) || input).focus(); }
    if (e.key === 'Escape') { ul.classList.add('hidden'); input.focus(); }
  });
  quitar.addEventListener('click', () => { fijar(null); input.focus(); });
  document.addEventListener('click', e => { if (!wrap.contains(e.target as Node)) ul.classList.add('hidden'); });
  return { limpiar: () => fijar(null), valor: () => elegido };
}
