// ══════════════════════════════════════════════
// PANTALLA "ADMIN": empresas y usuarios, con búsqueda, filtros y páginas
// resueltos en la base (buscar_empresas / buscar_usuarios, sql/016).
// Las acciones (editar, asociar usuarios, roles…) siguen en main.ts.
// ══════════════════════════════════════════════
import { app, fechaHora } from './contexto.ts';
import { buscarEmpresas, filtrosVacios, type EmpresaResultado } from './directorio.ts';
import { getSupabase } from './supabaseClient.ts';
import { buscadorUsuario, paginadorHtml } from './ui-listas.ts';
import { nombreSector } from './ui-directorio.ts';
import { esc, friendlyError, ini } from './utils.ts';

interface UsuarioAdmin {
  id: string; nombre: string; apellido: string; email: string | null; tel: string | null;
  role: string; is_webmaster: boolean; created_at: string; last_sign_in_at: string | null; empresas: number;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $i = (id: string) => document.getElementById(id) as HTMLInputElement;
const $s = (id: string) => document.getElementById(id) as HTMLSelectElement;

const emp = { pagina: 1, tamano: 25, usuario: null as string | null, pedido: 0 };
const usr = { pagina: 1, tamano: 25, pedido: 0 };
let seccion: 'empresas' | 'usuarios' = 'empresas';
let listo = false;
let timerE: number | undefined;
let timerU: number | undefined;

declare global {
  interface Window {
    admSeccion: (s: 'empresas' | 'usuarios') => void;
    admEmpIr: (n: number) => void;
    admEmpTam: (n: number) => void;
    admUsrIr: (n: number) => void;
    admUsrTam: (n: number) => void;
  }
}

function filaEmpresa(o: EmpresaResultado): string {
  const logo = o.logo ? `<img src="${esc(o.logo)}" class="org-logo-img logo-30" alt="" loading="lazy">` : `<div class="avatar logo-30" aria-hidden="true">${esc(ini(o.nombre))}</div>`;
  const sec = [o.sector_id, o.sector2_id].filter((x): x is number => !!x).map(nombreSector).join(' · ');
  return `<tr>
    <td>${logo}</td>
    <td><strong>${esc(o.nombre)}</strong></td>
    <td class="muted-sm">${esc(o.cuit)}</td>
    <td class="td-sm">${esc(sec || '—')}</td>
    <td class="td-sm">${esc(o.referente || '—')}</td>
    <td class="td-sm">${esc([o.ciudad, o.provincia].filter(Boolean).join(', ') || '—')}${o.lat == null ? ' <span class="muted-sm" title="Sin punto en el mapa">· sin mapa</span>' : ''}</td>
    <td><div class="action-btns">
      <button class="btn-edit-inline" onclick="startEdit(${o.id})" title="Editar empresa" aria-label="Editar ${esc(o.nombre)}"><i class="ti ti-pencil"></i></button>
      <button class="btn-loc" onclick="openEditUbicacion(${o.id})" title="Editar ubicación" aria-label="Editar ubicación de ${esc(o.nombre)}"><i class="ti ti-map-pin"></i></button>
      <button class="btn-out btn-icon" onclick="openAsignarUsuarios(${o.id})" title="Usuarios asociados" aria-label="Usuarios de ${esc(o.nombre)}"><i class="ti ti-users"></i></button>
      <button class="btn-danger" onclick="deleteOrg(${o.id})" title="Eliminar empresa (no se puede deshacer)" aria-label="Eliminar ${esc(o.nombre)}"><i class="ti ti-trash"></i></button>
    </div></td>
  </tr>`;
}

async function cargarEmpresas(): Promise<void> {
  const mio = ++emp.pedido;
  const body = $('admin-orgs-body');
  body.setAttribute('aria-busy', 'true');
  try {
    const f = { ...filtrosVacios(), q: $i('admin-search-orgs').value, orden: 'nombre' as const,
      usuario: emp.usuario, relacion: ($s('admin-filter-rol-usuario').value || null) as 'principal' | 'asociado' | null };
    const r = await buscarEmpresas(f, { limite: emp.tamano, desde: (emp.pagina - 1) * emp.tamano });
    if (mio !== emp.pedido) return;
    $('admin-orgs-count').textContent = r.total.toLocaleString('es-AR');
    body.innerHTML = r.items.length ? r.items.map(filaEmpresa).join('') : '<tr><td colspan="7" class="empty">Sin resultados para ese criterio.</td></tr>';
    $('admin-orgs-pag').innerHTML = r.total > 25 ? paginadorHtml({ id: 'pag-adm-emp', pagina: emp.pagina, tamano: emp.tamano, total: r.total, onIr: 'admEmpIr', onTamano: 'admEmpTam', etiqueta: 'empresas' }) : '';
  } catch (e) {
    if (mio === emp.pedido) body.innerHTML = `<tr><td colspan="7" class="empty">${esc(friendlyError(e))}</td></tr>`;
  } finally {
    body.removeAttribute('aria-busy');
  }
}

function filaUsuario(u: UsuarioAdmin): string {
  const yo = app().currentProfile!;
  const isSelf = u.id === yo.id;
  const isAdmin = u.role === 'admin';
  const btnWebmaster = yo.is_webmaster && isAdmin && !isSelf
    ? `<button class="btn-out" onclick="toggleWebmaster('${u.id}', ${!u.is_webmaster})">${u.is_webmaster ? 'Quitar webmaster' : 'Hacer webmaster'}</button>` : '';
  return `<tr>
    <td><strong>${esc(`${u.nombre} ${u.apellido || ''}`)}</strong>${isSelf ? ' <span class="badge-self">Vos</span>' : ''}</td>
    <td class="td-sm">${esc(u.email || '—')}</td>
    <td class="td-sm">${esc(u.tel || '—')}</td>
    <td class="td-sm">${u.empresas}</td>
    <td class="td-sm">${u.last_sign_in_at ? fechaHora(u.last_sign_in_at) : '<span class="muted-sm">Nunca</span>'}</td>
    <td><span class="role-badge ${isAdmin ? 'role-badge--admin' : 'role-badge--user'}">${isAdmin ? 'Admin' : 'Usuario'}</span>${u.is_webmaster ? ' <span class="role-badge role-badge--webmaster">Webmaster</span>' : ''}</td>
    <td><div class="action-btns">
      <button class="btn-edit-inline" onclick="openEditarUsuario('${u.id}')" title="Editar usuario (nombre, email, contraseña…)" aria-label="Editar ${esc(u.nombre)}"><i class="ti ti-pencil"></i></button>
      ${isSelf ? '<span class="muted-sm">No podés cambiar tu propio rol</span>'
        : `<button class="btn-out" onclick="toggleUserRole('${u.id}','${isAdmin ? 'user' : 'admin'}')">${isAdmin ? 'Quitar admin' : 'Hacer admin'}</button>`}
      ${btnWebmaster}
    </div></td>
  </tr>`;
}

async function cargarUsuarios(): Promise<void> {
  const mio = ++usr.pedido;
  const body = $('admin-users-body');
  body.setAttribute('aria-busy', 'true');
  try {
    const rol = $s('admin-u-rol').value;
    const conEmp = $s('admin-u-empresa').value;
    const p: Record<string, unknown> = {
      q: $i('admin-search-users').value, orden: $s('admin-u-orden').value,
      limite: usr.tamano, desde: (usr.pagina - 1) * usr.tamano,
    };
    if (rol === 'webmaster') p.webmaster = true; else if (rol) p.rol = rol;
    if (conEmp) p.con_empresa = conEmp === 'si';
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('buscar_usuarios', { p });
    if (error) throw error;
    if (mio !== usr.pedido) return;
    const r = data as { total: number; items: UsuarioAdmin[] };
    $('admin-users-count').textContent = r.total.toLocaleString('es-AR');
    body.innerHTML = r.items.length ? r.items.map(filaUsuario).join('') : '<tr><td colspan="7" class="empty">Sin resultados para ese criterio.</td></tr>';
    $('admin-users-pag').innerHTML = r.total > 25 ? paginadorHtml({ id: 'pag-adm-usr', pagina: usr.pagina, tamano: usr.tamano, total: r.total, onIr: 'admUsrIr', onTamano: 'admUsrTam', etiqueta: 'usuarios' }) : '';
  } catch (e) {
    if (mio === usr.pedido) body.innerHTML = `<tr><td colspan="7" class="empty">${esc(friendlyError(e))}</td></tr>`;
  } finally {
    body.removeAttribute('aria-busy');
  }
}

function mostrarSeccion(s: 'empresas' | 'usuarios'): void {
  seccion = s;
  for (const k of ['empresas', 'usuarios'] as const) {
    $(`adm-sec-${k}`).classList.toggle('hidden', k !== s);
    $(`adm-tab-${k}`).classList.toggle('active', k === s);
    $(`adm-tab-${k}`).setAttribute('aria-selected', String(k === s));
  }
}

window.admSeccion = function (s) {
  mostrarSeccion(s);
  void (s === 'empresas' ? cargarEmpresas() : cargarUsuarios());
};
const irA = (est: { pagina: number }, cargar: () => Promise<void>, ancla: string) => (n: number) => {
  est.pagina = Math.max(1, n);
  void cargar().then(() => $(ancla).scrollIntoView({ block: 'start', behavior: 'smooth' }));
};
window.admEmpIr = irA(emp, cargarEmpresas, 'adm-sec-empresas');
window.admUsrIr = irA(usr, cargarUsuarios, 'adm-sec-usuarios');
window.admEmpTam = n => { emp.tamano = n; emp.pagina = 1; void cargarEmpresas(); };
window.admUsrTam = n => { usr.tamano = n; usr.pagina = 1; void cargarUsuarios(); };

function iniciar(): void {
  if (listo) return;
  listo = true;
  $i('admin-search-orgs').addEventListener('input', () => {
    window.clearTimeout(timerE);
    timerE = window.setTimeout(() => { emp.pagina = 1; void cargarEmpresas(); }, 250);
  });
  buscadorUsuario($i('admin-filter-usuario'), u => {
    emp.usuario = u?.id ?? null;
    $s('admin-filter-rol-usuario').disabled = !u;
    emp.pagina = 1;
    void cargarEmpresas();
  });
  $s('admin-filter-rol-usuario').addEventListener('change', () => { emp.pagina = 1; void cargarEmpresas(); });
  $i('admin-search-users').addEventListener('input', () => {
    window.clearTimeout(timerU);
    timerU = window.setTimeout(() => { usr.pagina = 1; void cargarUsuarios(); }, 250);
  });
  ['admin-u-rol', 'admin-u-empresa', 'admin-u-orden'].forEach(id => $s(id).addEventListener('change', () => { usr.pagina = 1; void cargarUsuarios(); }));
}

// Entrada a la pantalla y recarga después de una acción (editar, roles…).
export function renderAdminUI(): void {
  iniciar();
  void cargarEmpresas();
  void cargarUsuarios();
}

export function resetAdminUI(): void {
  emp.pagina = 1; emp.usuario = null; usr.pagina = 1;
  if (listo) mostrarSeccion('empresas');
}

export function seccionAdmin(): string { return seccion; }
