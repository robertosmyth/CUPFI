// ══════════════════════════════════════════════
// CUPFI · Red de Vinculación Empresarial FI-UNLZ
// App principal: conecta la UI con Supabase (auth real + datos reales)
// ══════════════════════════════════════════════
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import type * as LeafletTypes from 'leaflet';
import * as Auth from './auth.ts';
import * as Empresas from './empresas.ts';
import { allMatches, findMatchesFor, countMatches, groupMatchesByPair } from './matching.ts';
import { esc, ini, normCuit, isValidCuit, isValidEmail, isValidUrl, buildAddress, friendlyError, normalizeTagKey } from './utils.ts';
import type { Empresa, EmpresaUsuarioRow, Profile } from './types.ts';

// Handlers expuestos a los `onclick`/`onchange`/`onkeydown` inline del HTML
// (ver index.html). Se mantiene ese patrón tal cual estaba en JS: es un
// sitio sin build de componentes, así que exponer funciones en `window` es
// más simple que reescribir cada listener con addEventListener. Declararlas
// acá le da tipado a cada asignación `window.foo = ...` de más abajo (y
// tipa por contexto los parámetros de esas funciones, sin tener que
// repetirlos dentro de cada una).
declare global {
  interface Window {
    authTab(t: string): void;
    doLogin(): Promise<void>;
    doRegister(): Promise<void>;
    doLogout(): Promise<void>;
    openForgotPassword(): void;
    doForgotPassword(): Promise<void>;
    doResetPassword(): Promise<void>;
    showScreen(name: string): void;
    setFilter(el: HTMLElement, val: string): void;
    renderDir(): void;
    renderGraduados(): void;
    renderMapa(): Promise<void>;
    _openDetail(id: number): void;
    renderMias(): void;
    openDetail(id: number): void;
    closeModal(id: string): void;
    openEditProfile(): void;
    guardarPerfil(): Promise<void>;
    solicitarCambioPassword(): Promise<void>;
    previewLogo(): void;
    clearLogo(): void;
    checkCuit(): void;
    startEdit(id: number): void;
    cancelEdit(): void;
    guardarOrg(): Promise<void>;
    openEditUbicacion(id: number): void;
    guardarUbicacion(): Promise<void>;
    setVinFilter(el: HTMLElement, val: string): void;
    renderVin(): void;
    addTag(event: KeyboardEvent, type: TagType): void;
    quickAddTag(type: TagType, idx: number): void;
    removeTag(type: TagType, idx: number): void;
    renderAdmin(): void;
    toggleUserRole(userId: string, newRole: string): Promise<void>;
    deleteOrg(id: number): Promise<void>;
    openEditarUsuario(userId: string): void;
    guardarEdicionUsuario(): Promise<void>;
    openAsignarUsuarios(empresaId: number): void;
    cambiarDuenoEmpresa(): Promise<void>;
    agregarUsuarioAEmpresa(): Promise<void>;
    quitarUsuarioDeEmpresa(empresaId: number, userId: string): Promise<void>;
  }
}

// Cast corto para document.getElementById: el resto del archivo confía en
// que los ids existen en el HTML (igual que la versión JS original), así
// que esto solo le da el tipo correcto al resultado en vez de agregar
// chequeos de null en cada línea.
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const $input = (id: string) => $<HTMLInputElement>(id);
const $select = (id: string) => $<HTMLSelectElement>(id);
const $textarea = (id: string) => $<HTMLTextAreaElement>(id);
const $img = (id: string) => $<HTMLImageElement>(id);
const $button = (id: string) => $<HTMLButtonElement>(id);

// ══════════════════════════════════════════════
// ESTADO GLOBAL (en memoria; los datos reales viven en Supabase)
// ══════════════════════════════════════════════
type TagType = 'ofertas' | 'instalaciones' | 'needs-uncovered' | 'needs-covered';

const tags: Record<TagType, string[]> = { ofertas: [], instalaciones: [], 'needs-uncovered': [], 'needs-covered': [] };
const tagCls: Record<TagType, string> = { ofertas: 'rt-o', instalaciones: 'rt-i', 'needs-uncovered': 'rt-nu', 'needs-covered': 'rt-nc' };
let activeFilter = 'todos';
let activeVinFilter: 'todos' | 'strong' | 'weak' = 'todos';
let currentProfile: Profile | null = null;
let orgs: Empresa[] = [];
let profiles: Profile[] = [];
let asociaciones: EmpresaUsuarioRow[] = []; // filas de empresa_usuarios (ver sql/historial/009)
let editingId: number | null = null;
let editReturnScreen: string | null = null; // pantalla a la que volver después de editar (no de agregar)
let currentLogoFile: File | null = null; // File real seleccionado (se sube recién al guardar)
let currentLogoUrl: string | null = null;  // URL ya existente (modo edición) o recién subida

// Mapa
let leafletMap: LeafletTypes.Map | null = null;
let mapMarkers: LeafletTypes.Marker[] = [];
let leafletModule: typeof LeafletTypes | null = null;

// Categorías sugeridas para servicios/productos y necesidades: compartir
// el mismo vocabulario entre "ofertas" y "necesidades" es lo que permite
// que el motor de vinculación (matching.ts) encuentre coincidencias
// exactas y confiables, además de las aproximadas por palabras.
const CATEGORIAS_SERVICIOS = [
  'Mecanizado de piezas', 'Diseño eléctrico', 'Diseño mecánico', 'Ensayos de materiales',
  'Mantenimiento industrial', 'Logística y transporte', 'Consultoría técnica',
  'Automatización industrial', 'Soldadura', 'Metrología', 'Inyección de plásticos',
  'Tratamientos superficiales', 'Control de calidad', 'Ingeniería de procesos',
  'Instalaciones eléctricas', 'Climatización (HVAC)', 'Software a medida',
  'Capacitación técnica', 'Importación / Exportación', 'Insumos industriales',
  'Seguridad e higiene', 'Auditoría técnica', 'Impresión 3D / prototipado',
  'Energías renovables', 'Construcción y obra civil', 'Recursos humanos técnicos',
  'Marketing y ventas B2B', 'Legal y contable',
];
const CATEGORIAS_INSTALACIONES = [
  'Planta de producción', 'Laboratorio de ensayos', 'Depósito / almacenamiento',
  'Taller de mecanizado CNC', 'Sala limpia', 'Playa de maniobras', 'Oficinas técnicas',
  'Equipos de diagnóstico', 'Flota de vehículos', 'Sala de capacitación',
];
const SECTORES = [
  'Oil & Gas', 'Industrial', 'Consultoría', 'Automotriz', 'Metalmecánica',
  'Electrotecnia', 'Construcción', 'Alimenticia', 'Química', 'Textil / Calzado',
  'Minería', 'Energía', 'Software / TI', 'Logística', 'Agroindustria',
  'Salud', 'Educación', 'Ferroviario', 'Naval / Portuario', 'Institucional',
];
const QUICK_TAG_SOURCES: Record<TagType, string[]> = {
  ofertas: CATEGORIAS_SERVICIOS,
  instalaciones: CATEGORIAS_INSTALACIONES,
  'needs-uncovered': CATEGORIAS_SERVICIOS,
  'needs-covered': CATEGORIAS_SERVICIOS,
};

// ══════════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // wireStaticEvents() y authTab/doLogin/doRegister ya quedaron disponibles
  // (se definen más abajo, de forma síncrona, sin depender de red). Si algo
  // falla al conectar con Supabase (CDN externo, sin internet, etc.), solo
  // se avisa acá arriba del formulario de login; el resto de la pantalla
  // de acceso sigue funcionando igual.
  wireStaticEvents();
  init().catch(e => {
    console.error('Error inicializando la app:', e);
    showAuthMsg('l-msg', friendlyError(e), 'err');
  });
});

async function init(): Promise<void> {
  // BUG arreglado acá: antes esta función primero pedía la sesión y
  // recién DESPUÉS se suscribía a onAuthStateChange. El problema es que
  // cuando la página carga desde un link de "restablecer contraseña"
  // (o de confirmación de email), Supabase procesa el token de la URL
  // apenas se crea el cliente y dispara el evento (PASSWORD_RECOVERY /
  // USER_UPDATED) casi de inmediato — mucho antes de que termine
  // getSession()+enterApp(), que hacen varias vueltas a la base. Para
  // cuando nos suscribíamos, el evento ya se había perdido. En el caso
  // de PASSWORD_RECOVERY eso significaba que el link SÍ dejaba una
  // sesión válida, así que el usuario terminaba entrando directo a la
  // app (o viendo el login si no había sesión) en vez del formulario
  // para definir la contraseña nueva: "nunca dejaba cambiar la
  // contraseña". Ahora la suscripción se hace antes de tocar la sesión.
  let recoveryInProgress = false;
  const showPasswordRecoveryForm = () => {
    recoveryInProgress = true;
    $('auth-wrap').style.display = 'flex';
    $('main-app').style.display = 'none';
    document.querySelectorAll('.auth-tab').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    $('af-reset').classList.add('active');
  };

  Auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      // El usuario volvió del link de "restablecer contraseña" del email.
      showPasswordRecoveryForm();
      return;
    }
    if (event === 'USER_UPDATED' && currentProfile) {
      // El usuario confirmó un cambio de email desde el link del correo:
      // sincronizamos profiles.email y lo que se ve en pantalla.
      try {
        await Auth.syncEmailFromAuth();
        currentProfile = await Auth.getCurrentProfile();
        const pill = document.getElementById('user-name-pill');
        if (pill) pill.textContent = currentProfile?.nombre || currentProfile?.email || '—';
      } catch (e) { console.error('No se pudo sincronizar el email:', e); }
      return;
    }
    if (recoveryInProgress) return; // no pisar el formulario de reset
    if (session && !currentProfile) {
      await enterApp();
    } else if (!session && currentProfile) {
      currentProfile = null;
      showAuthScreen();
    }
  }).catch(e => console.error('No se pudo suscribir a cambios de sesión:', e));

  const session = await Auth.getSession();
  if (recoveryInProgress) return; // el listener de arriba ya mostró el form de reset
  if (session) {
    await enterApp();
  } else {
    showAuthScreen();
  }
}

function wireStaticEvents(): void {
  $('modal-detalle').addEventListener('click', function (e) {
    if (e.target === this) window.closeModal('modal-detalle');
  });
  $('modal-ubicacion').addEventListener('click', function (e) {
    if (e.target === this) window.closeModal('modal-ubicacion');
  });
  $('modal-perfil').addEventListener('click', function (e) {
    if (e.target === this) window.closeModal('modal-perfil');
  });
  renderQuickTagButtons();
  renderSectorDatalist();
}

function renderQuickTagButtons(): void {
  const mk = (containerId: string, list: string[], type: TagType) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = list.map((c, i) => `<button type="button" class="quick-tag-btn" onclick="quickAddTag('${type}',${i})">+ ${esc(c)}</button>`).join('');
  };
  mk('quick-ofertas', CATEGORIAS_SERVICIOS, 'ofertas');
  mk('quick-instalaciones', CATEGORIAS_INSTALACIONES, 'instalaciones');
  mk('quick-needs-uncovered', CATEGORIAS_SERVICIOS, 'needs-uncovered');
  mk('quick-needs-covered', CATEGORIAS_SERVICIOS, 'needs-covered');
}

function renderSectorDatalist(): void {
  const dl = document.getElementById('sectores-list');
  if (!dl) return;
  dl.innerHTML = SECTORES.map(s => `<option value="${esc(s)}">`).join('');
}

// ══════════════════════════════════════════════
// AUTH UI
// ══════════════════════════════════════════════
window.authTab = function (t) {
  document.querySelectorAll('.auth-tab').forEach((el, i) => el.classList.toggle('active', ['login', 'registro'][i] === t));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  $('af-' + t).classList.add('active');
};

window.doLogin = async function () {
  const email = $input('l-email').value.trim().toLowerCase();
  const pass = $input('l-pass').value;
  if (!email || !pass) { showAuthMsg('l-msg', 'Completá email y contraseña.', 'err'); return; }
  setBusy('l-btn', true);
  try {
    await Auth.signIn({ email, password: pass });
    await enterApp();
  } catch (e) {
    showAuthMsg('l-msg', friendlyError(e), 'err');
  } finally {
    setBusy('l-btn', false);
  }
};

window.doRegister = async function () {
  const nombre = $input('r-nombre').value.trim();
  const apellido = $input('r-apellido').value.trim();
  const email = $input('r-email').value.trim().toLowerCase();
  const tel = $input('r-tel').value.trim();
  const pass = $input('r-pass').value;
  const pass2 = $input('r-pass2').value;
  if (!nombre || !apellido) { showAuthMsg('r-msg', 'Nombre y apellido son obligatorios.', 'err'); return; }
  if (!email || !isValidEmail(email)) { showAuthMsg('r-msg', 'Ingresá un email válido.', 'err'); return; }
  if (!tel) { showAuthMsg('r-msg', 'El teléfono móvil es obligatorio.', 'err'); return; }
  if (!pass || pass.length < 8) { showAuthMsg('r-msg', 'La contraseña debe tener al menos 8 caracteres.', 'err'); return; }
  if (pass !== pass2) { showAuthMsg('r-msg', 'Las contraseñas no coinciden.', 'err'); return; }

  setBusy('r-btn', true);
  try {
    // No puede haber dos usuarios con el mismo nombre+apellido, email o
    // teléfono móvil (ver sql/historial/010_unique_profile_constraints.sql). Se
    // valida acá antes de crear la cuenta para dar un mensaje claro en
    // vez del genérico que devolvería Supabase Auth si el trigger de la
    // base lo rechazara después.
    const dup = await Auth.checkProfileDuplicates({ nombre, apellido, tel, email });
    if (dup.nombre_apellido) { showAuthMsg('r-msg', 'Ya existe un usuario registrado con ese nombre y apellido.', 'err'); return; }
    if (dup.email) { showAuthMsg('r-msg', 'Ya existe una cuenta con ese email.', 'err'); return; }
    if (dup.tel) { showAuthMsg('r-msg', 'Ya existe un usuario registrado con ese teléfono móvil.', 'err'); return; }

    const data = await Auth.signUp({ nombre, apellido, email, tel, password: pass });
    if (data.session) {
      await enterApp();
    } else {
      showAuthMsg('r-msg', '✓ Cuenta creada. Revisá tu email para confirmar la cuenta antes de iniciar sesión.', 'ok');
      window.authTab('login');
    }
  } catch (e) {
    showAuthMsg('r-msg', friendlyError(e), 'err');
  } finally {
    setBusy('r-btn', false);
  }
};

window.doLogout = async function () {
  if (leafletMap) { leafletMap.remove(); leafletMap = null; mapMarkers = []; }
  await Auth.signOut();
  currentProfile = null;
  showAuthScreen();
};

window.openForgotPassword = function () {
  document.querySelectorAll('.auth-tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  $('af-forgot').classList.add('active');
};

window.doForgotPassword = async function () {
  const email = $input('fp-email').value.trim().toLowerCase();
  if (!email || !isValidEmail(email)) { showAuthMsg('fp-msg', 'Ingresá un email válido.', 'err'); return; }
  setBusy('fp-btn', true);
  try {
    await Auth.resetPasswordForEmail(email);
    showAuthMsg('fp-msg', '✓ Si ese email tiene una cuenta, te enviamos un link para restablecer la contraseña.', 'ok');
  } catch (e) {
    showAuthMsg('fp-msg', friendlyError(e), 'err');
  } finally {
    setBusy('fp-btn', false);
  }
};

window.doResetPassword = async function () {
  const p1 = $input('rp-pass').value;
  const p2 = $input('rp-pass2').value;
  if (!p1 || p1.length < 8) { showAuthMsg('rp-msg', 'La contraseña debe tener al menos 8 caracteres.', 'err'); return; }
  if (p1 !== p2) { showAuthMsg('rp-msg', 'Las contraseñas no coinciden.', 'err'); return; }
  setBusy('rp-btn', true);
  try {
    await Auth.updatePassword(p1);
    showAuthMsg('rp-msg', '✓ Contraseña actualizada. Ya podés ingresar con ella.', 'ok');
    setTimeout(() => { enterApp().catch(e => showAuthMsg('l-msg', friendlyError(e), 'err')); }, 1200);
  } catch (e) {
    showAuthMsg('rp-msg', friendlyError(e), 'err');
  } finally {
    setBusy('rp-btn', false);
  }
};

function setBusy(btnId: string, busy: boolean): void {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
  if (btn) btn.disabled = busy;
}

function showAuthMsg(id: string, msg: string, type: 'err' | 'ok'): void {
  const el = $(id);
  el.textContent = msg; el.style.display = 'block';
  el.style.color = type === 'err' ? '#c62828' : '#2e7d32';
}

function showAuthScreen(): void {
  $('auth-wrap').style.display = 'flex';
  $('main-app').style.display = 'none';
  $input('l-pass').value = '';
}

async function enterApp(): Promise<void> {
  try {
    currentProfile = await Auth.getCurrentProfile();
  } catch (e) {
    showAuthMsg('l-msg', friendlyError(e), 'err');
    return;
  }
  if (!currentProfile) return;
  $('auth-wrap').style.display = 'none';
  $('main-app').style.display = 'block';
  $('user-name-pill').textContent = currentProfile.nombre || currentProfile.email || '—';
  const isAdmin = currentProfile.role === 'admin';
  $('admin-tab-btn').classList.toggle('hidden', !isAdmin);
  $('admin-badge').classList.toggle('hidden', !isAdmin);

  await refreshData();
  window.showScreen('directorio');
}

async function refreshData(): Promise<void> {
  const [e, p, a] = await Promise.all([Empresas.listEmpresas(), Auth.listProfiles(), Empresas.listAsociaciones()]);
  orgs = e;
  profiles = p;
  asociaciones = a;
  orgs.forEach(o => { o.usuarios = usuariosDeEmpresa(o); });
}

// Todos los usuarios con acceso a una empresa: el administrador principal
// (o.uid) más los usuarios adicionales que un admin haya asociado
// desde el panel (empresa_usuarios, ver sql/historial/009).
function usuariosDeEmpresa(o: Empresa): string[] {
  const ids = new Set<string>();
  if (o.uid) ids.add(o.uid);
  asociaciones.filter(a => a.empresa_id === o.id).forEach(a => ids.add(a.user_id));
  return [...ids];
}

// ¿userId es administrador principal o usuario asociado de esta empresa? (sin contar admin global)
function esUsuarioDeEmpresa(o: Empresa, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return (o.usuarios || usuariosDeEmpresa(o)).includes(userId);
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════
function getProfileById(uid: string | null | undefined): Profile | undefined { return profiles.find(u => u.id === uid); }

// Clases de tamaño (ver assets/css/style.css): 42px es el tamaño por
// defecto de .avatar/.org-logo-img, así que solo hace falta un modificador
// cuando el tamaño pedido es distinto.
function sizeClass(size: number): string {
  if (size >= 56) return 'sz-56';
  if (size >= 38 && size < 42) return 'sz-38';
  if (size <= 30) return 'sz-30';
  return '';
}

function logoOrAvatar(o: Empresa, size = 42): string {
  const sc = sizeClass(size);
  if (o.logo) {
    return `<img src="${esc(o.logo)}" class="org-logo-img ${sc}" alt="logo de ${esc(o.nombre)}">`;
  }
  return `<div class="avatar ${sc}">${esc(ini(o.nombre))}</div>`;
}

// Botón(es) de contacto directo para una organización: email y/o teléfono.
// Se usa tanto en la lista de Vinculación como en el detalle de empresa,
// para que contactar a la otra empresa sea un solo click.
function contactButtonsHtml(org: Empresa): string {
  const parts: string[] = [];
  if (org.emailOrg) {
    parts.push(`<a class="btn-contact" href="mailto:${esc(org.emailOrg)}"><i class="ti ti-mail"></i> Contactar por email</a>`);
  }
  if (org.tel) {
    const telHref = org.tel.replace(/[^0-9+]/g, '');
    parts.push(`<a class="btn-contact" href="tel:${esc(telHref)}"><i class="ti ti-phone"></i> Llamar</a>`);
  }
  if (!parts.length) return '<span class="muted-sm">Esta organización no cargó datos de contacto.</span>';
  return parts.join(' ');
}

// ══════════════════════════════════════════════
// NAVEGACIÓN
// ══════════════════════════════════════════════
window.showScreen = function (name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  const names = ['directorio', 'graduados', 'vinculacion', 'mapa', 'mis-empresas', 'registrar', 'admin'];
  const idx = names.indexOf(name);
  if (idx >= 0) { const btns = document.querySelectorAll('.tab-btn'); if (btns[idx]) btns[idx].classList.add('active'); }
  if (name === 'directorio') window.renderDir();
  if (name === 'graduados') window.renderGraduados();
  if (name === 'vinculacion') window.renderVin();
  if (name === 'mapa') window.renderMapa().catch(e => console.error('No se pudo cargar el mapa:', e));
  if (name === 'mis-empresas') window.renderMias();
  if (name === 'registrar') { if (!editingId) prefillUser(); }
  if (name === 'admin') window.renderAdmin();
};

window.setFilter = function (el, val) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active'); activeFilter = val; window.renderDir();
};

function prefillUser(): void {
  if (!currentProfile || editingId) return;
  const r = document.getElementById('f-referente') as HTMLInputElement | null;
  if (r && !r.value) r.value = `${currentProfile.nombre} ${currentProfile.apellido}`.trim();
  const e = document.getElementById('f-email-org') as HTMLInputElement | null;
  if (e && !e.value) e.value = currentProfile.email || '';
  const p = document.getElementById('f-pais') as HTMLInputElement | null;
  if (p && !p.value) p.value = 'Argentina';
}

// ══════════════════════════════════════════════
// DIRECTORIO EMPRESAS
// ══════════════════════════════════════════════
window.renderDir = function () {
  const q = ($input('search-input').value || '').toLowerCase();
  const INDUSTRIAL_KEYWORDS = ['Industrial', 'Autopartista', 'Microfusión', 'Transmisión', 'Materiales', 'Calzado', 'Herramientas', 'Electrotecnia', 'Sanitarios', 'Ferroviario', 'Inspección', 'Portuario', 'mecánica', 'eléctric'];
  let filtered = orgs.filter(o => {
    if (activeFilter === 'Oil & Gas' && !(o.sector || '').includes('Oil')) return false;
    if (activeFilter === 'Industrial' && !INDUSTRIAL_KEYWORDS.some(k => (o.sector || '').includes(k))) return false;
    if (activeFilter === 'Consultoría' && !['Consul', 'Radicac', 'profesional'].some(k => (o.sector || '').includes(k))) return false;
    if (activeFilter === 'has-need' && !(o.needsUncovered && o.needsUncovered.length)) return false;
    if (!q) return true;
    const hay = [o.nombre, o.sector, o.cuit, o.desc, o.referente, o.ciudad, o.provincia, ...(o.ofertas || []), ...(o.needsUncovered || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });

  $('stat-total').textContent = String(orgs.length);
  $('stat-users').textContent = String(profiles.filter(u => u.role !== 'admin').length);
  $('stat-sectores').textContent = String(new Set(orgs.map(o => o.sector).filter(Boolean)).size);
  $('stat-matches').textContent = String(countMatches(orgs));
  $('dir-count').textContent = String(filtered.length);

  const grid = $('org-grid');
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty empty--full"><i class="ti ti-building-off"></i>Sin resultados para ese criterio.</div>';
    return;
  }
  grid.innerHTML = filtered.map(o => renderOrgCard(o)).join('');
};

// Tarjeta de organización, compartida entre el Directorio y "Mis empresas".
function renderOrgCard(o: Empresa): string {
  const mine = currentProfile && esUsuarioDeEmpresa(o, currentProfile.id);
  const loc = [o.ciudad, o.provincia].filter(Boolean).join(', ');
  return `<div class="org-card${mine ? ' mine' : ''}" onclick="openDetail(${o.id})">
    ${mine ? '<div class="mine-badge"><i class="ti ti-star"></i>Mi empresa</div>' : ''}
    <div class="card-head">${logoOrAvatar(o)}
      <div><div class="card-org-name">${esc(o.nombre)}</div><div class="card-ref">${esc(o.referente)} · ${esc(o.cargo)}</div></div>
    </div>
    <div class="card-sector"><i class="ti ti-tag"></i>${esc(o.sector)}</div>
    <div class="card-meta"><i class="ti ti-id"></i>CUIT: ${esc(o.cuit)}</div>
    ${loc ? `<div class="card-meta"><i class="ti ti-map-pin"></i>${esc(loc)}</div>` : ''}
    <div class="tags">
      ${(o.ofertas || []).slice(0, 2).map(t => `<span class="tag tag-offer">${esc(t)}</span>`).join('')}
      ${(o.needsUncovered || []).slice(0, 1).map(t => `<span class="tag tag-need">${esc(t)}</span>`).join('')}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════
// DIRECTORIO GRADUADOS
// ══════════════════════════════════════════════
window.renderGraduados = function () {
  const q = ($input('search-grad').value || '').toLowerCase();
  const visible = profiles.filter(u => u.role !== 'admin');
  const filtered = visible.filter(u => {
    if (!q) return true;
    const uOrgs = orgs.filter(o => esUsuarioDeEmpresa(o, u.id)).map(o => o.nombre).join(' ');
    return [u.nombre, u.apellido, u.email, uOrgs].join(' ').toLowerCase().includes(q);
  });

  $('grad-count').textContent = String(filtered.length);
  const grid = $('grad-grid');
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty empty--full"><i class="ti ti-users-off"></i>Sin resultados.</div>';
    return;
  }
  grid.innerHTML = filtered.map(u => {
    const uOrgs = orgs.filter(o => esUsuarioDeEmpresa(o, u.id));
    const isSelf = currentProfile && u.id === currentProfile.id;
    return `<div class="user-card">
      <div class="user-card-head">
        <div class="user-avatar">${esc((u.nombre?.[0] || '') + (u.apellido?.[0] || ''))}</div>
        <div>
          <div class="user-name">${esc(u.nombre + ' ' + u.apellido)} ${isSelf ? '<span class="badge-self">Yo</span>' : ''}</div>
          <div class="user-contact"><i class="ti ti-mail"></i>${esc(u.email || '—')}</div>
          ${u.tel ? `<div class="user-contact"><i class="ti ti-phone"></i>${esc(u.tel)}</div>` : ''}
        </div>
      </div>
      <div class="user-companies">
        <div class="user-companies-title"><i class="ti ti-building"></i>${uOrgs.length} empresa${uOrgs.length !== 1 ? 's' : ''}</div>
        ${uOrgs.length === 0 ? '<div class="muted-note">Sin empresas registradas aún.</div>' : ''}
        ${uOrgs.map(o => `
          <div class="mini-company" onclick="openDetail(${o.id})">
            ${o.logo ? `<img src="${esc(o.logo)}" class="mini-logo" alt="logo">` : `<div class="mini-avatar">${esc(ini(o.nombre))}</div>`}
            <div>
              <div class="mini-name">${esc(o.nombre)}</div>
              <div class="mini-sector">${esc(o.sector)}${o.ciudad ? ' · ' + esc(o.ciudad) : ''}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('');
};

// ══════════════════════════════════════════════
// MAPA (Leaflet + OpenStreetMap, sin clave API)
// ══════════════════════════════════════════════

// Leaflet se importa recién cuando hace falta (pestaña "Mapa"), ya
// bundleado por Vite en vez de cargarlo en runtime desde unpkg.com: sin
// dependencia de red externa una vez construido el sitio, con versión fija
// en package-lock.json, y sin bajarle esos ~150 KB a quien nunca abre el
// mapa. El propio import() lo cachea el motor de JS, no hace falta un
// flag "ya está listo" como antes.
async function ensureLeaflet(): Promise<typeof LeafletTypes> {
  if (!leafletModule) {
    await import('leaflet/dist/leaflet.css');
    leafletModule = await import('leaflet');
  }
  return leafletModule;
}

interface GeoCoords { lat: number; lng: number }
type GeocodeCacheValue = GeoCoords | null;

// Caché de geocoding (memoria + localStorage). Nominatim (el geocoder
// gratuito de OpenStreetMap) pide explícitamente no golpear su API sin
// cachear: antes esto se re-geocodificaba TODO el directorio cada vez que
// se abría la pestaña "Mapa", en serie y sin guardar nada. Acá se cachea
// por dirección normalizada; no se cachean errores de red (sí se cachea
// "no se encontró esa dirección") para poder reintentar si fue un problema
// pasajero de conexión.
const GEOCODE_CACHE_KEY = 'cupfi_geocode_cache_v1';
let geocodeCache: Record<string, GeocodeCacheValue> | null = null;

function loadGeocodeCache(): Record<string, GeocodeCacheValue> {
  if (geocodeCache) return geocodeCache;
  try {
    const raw = localStorage.getItem(GEOCODE_CACHE_KEY);
    geocodeCache = raw ? JSON.parse(raw) : {};
  } catch {
    geocodeCache = {};
  }
  return geocodeCache!;
}

function saveGeocodeCache(): void {
  try {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(geocodeCache || {}));
  } catch {
    // localStorage puede no estar disponible (modo privado, cuota llena);
    // no es crítico, simplemente no persiste entre sesiones.
  }
}

async function geocodeAddress(address: string): Promise<GeocodeCacheValue> {
  const cache = loadGeocodeCache();
  const key = address.trim().toLowerCase();
  if (key in cache) return cache[key];
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=ar`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    const data = await res.json();
    const coords: GeocodeCacheValue = data && data.length ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : null;
    cache[key] = coords;
    saveGeocodeCache();
    return coords;
  } catch {
    return null; // silencioso y sin cachear: si falla la red, se reintenta la próxima vez
  }
}

window.renderMapa = async function () {
  const withLoc = orgs.filter(o => o.ciudad || o.provincia);
  $('map-count').textContent = String(withLoc.length);

  const L = await ensureLeaflet();

  if (!leafletMap) {
    leafletMap = L.map('gmap').setView([-38.5, -63.5], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(leafletMap);
  }
  const map = leafletMap;

  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];
  if (!withLoc.length) return;

  const makeIcon = () => L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.625 14 22 14 22S28 23.625 28 14C28 6.27 21.73 0 14 0z" fill="#3B24C8"/>
      <circle cx="14" cy="14" r="7" fill="white"/>
      <circle cx="14" cy="14" r="4" fill="#233DFF"/>
    </svg>`,
    className: '', iconSize: [28, 36], iconAnchor: [14, 36], popupAnchor: [0, -38],
  });

  for (const o of withLoc) {
    const addr = buildAddress(o);
    const query = [o.ciudad, o.provincia, o.pais].filter(Boolean).join(', ');
    const coords = await geocodeAddress(query);
    if (!coords) continue;

    const u = getProfileById(o.uid);
    const uName = u ? `${u.nombre} ${u.apellido}` : '—';

    const popupHtml = `<div class="map-popup">
      <div class="map-popup-head">
        <div class="map-popup-media">${logoOrAvatar(o, 38)}</div>
        <div class="map-popup-info">
          <div class="map-popup-name">${esc(o.nombre)}</div>
          <div class="map-popup-sector">${esc(o.sector)}</div>
        </div>
        <div class="u-clearfix"></div>
      </div>
      <div class="map-popup-meta"><strong>Graduado:</strong> ${esc(uName)}</div>
      <div class="map-popup-meta"><strong>Cargo:</strong> ${esc(o.cargo)}</div>
      <div class="map-popup-addr">${esc(addr)}</div>
      <button onclick="window._openDetail(${o.id})" class="map-popup-btn">
        Ver detalle completo
      </button>
    </div>`;

    const marker = L.marker([coords.lat, coords.lng], { icon: makeIcon() }).addTo(map);
    marker.bindPopup(popupHtml, { maxWidth: 260, closeButton: true });
    mapMarkers.push(marker);
  }

  if (mapMarkers.length > 0) {
    const group = L.featureGroup(mapMarkers);
    map.fitBounds(group.getBounds().pad(0.2));
  }
};

window._openDetail = function (id) {
  if (leafletMap) leafletMap.closePopup();
  window.openDetail(id);
};

// ══════════════════════════════════════════════
// MIS EMPRESAS
// ══════════════════════════════════════════════
window.renderMias = function () {
  if (!currentProfile) return;
  const mine = orgs.filter(o => esUsuarioDeEmpresa(o, currentProfile!.id));
  $('mis-count').textContent = String(mine.length);
  const grid = $('mis-grid');
  if (!mine.length) {
    grid.innerHTML = `<div class="empty empty--full">
      <i class="ti ti-building-plus"></i>
      Todavía no registraste ninguna empresa.<br><br>
      <button class="btn-prim" onclick="showScreen('registrar')">Agregar empresa</button>
    </div>`;
    return;
  }
  grid.innerHTML = mine.map(o => renderOrgCard(o)).join('');
};

// ══════════════════════════════════════════════
// DETALLE DE EMPRESA
// ══════════════════════════════════════════════
window.openDetail = function (id) {
  const o = orgs.find(x => x.id === id);
  if (!o) return;
  const mx = findMatchesFor(orgs, o);
  const mine = currentProfile && (esUsuarioDeEmpresa(o, currentProfile.id) || currentProfile.role === 'admin');
  const addr = buildAddress(o);
  const u = getProfileById(o.uid);
  const mapsUrl = addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : '';

  $('md-title').textContent = o.nombre;
  $('modal-body').innerHTML = `
    <div class="dsec">
      <div class="detail-head">
        ${logoOrAvatar(o, 56)}
        <div>
          <div class="detail-name">${esc(o.referente)}</div>
          <div class="detail-role">${esc(o.cargo)}</div>
          <div class="detail-sector">${esc(o.sector)}</div>
        </div>
      </div>
      <div class="detail-meta-row"><i class="ti ti-id detail-icon"></i>CUIT: <strong>${esc(o.cuit)}</strong></div>
      ${u ? `<div class="detail-meta-row"><i class="ti ti-user-check detail-icon"></i>Registrado por: <strong>${esc(u.nombre + ' ' + u.apellido)}</strong></div>` : ''}
      ${o.desc ? `<p class="detail-desc">${esc(o.desc)}</p>` : ''}
    </div>

    ${(o.emailOrg || o.tel || o.web) ? `<div class="dsec"><div class="dsec-title">Contacto</div>
      ${o.emailOrg ? `<div class="drow"><i class="ti ti-mail"></i>${esc(o.emailOrg)}</div>` : ''}
      ${o.tel ? `<div class="drow"><i class="ti ti-phone"></i>${esc(o.tel)}</div>` : ''}
      ${o.web ? `<div class="drow"><i class="ti ti-world"></i><a href="${esc(o.web)}" target="_blank" rel="noopener noreferrer" class="link-plain">${esc(o.web)}</a></div>` : ''}
      <div class="detail-contact-actions">${contactButtonsHtml(o)}</div>
    </div>` : ''}

    ${addr ? `<div class="dsec"><div class="dsec-title">Ubicación</div>
      <div class="drow"><i class="ti ti-map-pin"></i>${esc(addr)}</div>
      <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="link-maps">
        <i class="ti ti-external-link"></i>Abrir en Google Maps
      </a>
    </div>` : ''}

    ${(o.ofertas || []).length ? `<div class="dsec"><div class="dsec-title">Servicios y productos</div><div class="tags">${o.ofertas.map(t => `<span class="tag tag-offer">${esc(t)}</span>`).join('')}</div></div>` : ''}
    ${(o.instalaciones || []).length ? `<div class="dsec"><div class="dsec-title">Instalaciones disponibles</div><div class="tags">${o.instalaciones.map(t => `<span class="tag tag-inst">${esc(t)}</span>`).join('')}</div></div>` : ''}
    ${(o.needsUncovered || []).length ? `<div class="dsec"><div class="dsec-title">Necesidades sin cubrir</div><div class="tags">${o.needsUncovered.map(t => `<span class="tag tag-need">${esc(t)}</span>`).join('')}</div></div>` : ''}
    ${(o.needsCovered || []).length ? `<div class="dsec"><div class="dsec-title">Necesidades cubiertas con proveedores</div><div class="tags">${o.needsCovered.map(t => `<span class="tag tag-cov">${esc(t)}</span>`).join('')}</div></div>` : ''}

    ${mx.length ? `<div class="dsec"><div class="dsec-title">Vinculaciones posibles</div>
      ${mx.map(m => `<div class="match-card">
        <div class="match-label"><i class="ti ti-arrows-exchange"></i>puede cubrir su necesidad ${m.strength === 'strong' ? '<span class="match-strength match-strength--strong">Coincidencia exacta</span>' : '<span class="match-strength match-strength--weak">Posible coincidencia</span>'}</div>
        <div class="match-name" onclick="closeModal('modal-detalle');setTimeout(()=>openDetail(${m.org.id}),80)">${esc(m.org.nombre)}</div>
        <div class="muted-sm">${esc(m.org.referente)}</div>
        <div class="match-detail">${esc(m.need)} → <span class="match-highlight">${esc(m.offer)}</span></div>
        <div class="match-contact">${contactButtonsHtml(m.org)}</div>
      </div>`).join('')}
    </div>` : ''}

    ${mine ? `<div class="dsec detail-edit-wrap">
      <button class="btn-edit-inline" onclick="startEdit(${o.id});closeModal('modal-detalle')"><i class="ti ti-pencil"></i> Editar esta empresa</button>
    </div>` : ''}
  `;
  $('modal-detalle').classList.add('open');
};

window.closeModal = function (id) {
  $(id).classList.remove('open');
};

// ══════════════════════════════════════════════
// PERFIL PROPIO
// ══════════════════════════════════════════════
window.openEditProfile = function () {
  if (!currentProfile) return;
  $input('pf-nombre').value = currentProfile.nombre || '';
  $input('pf-apellido').value = currentProfile.apellido || '';
  $input('pf-tel').value = currentProfile.tel || '';
  $input('pf-email').value = currentProfile.email || '';
  $('pf-msg').style.display = 'none';
  $('modal-perfil').classList.add('open');
};

window.guardarPerfil = async function () {
  if (!currentProfile) return;
  const nombre = $input('pf-nombre').value.trim();
  const apellido = $input('pf-apellido').value.trim();
  const tel = $input('pf-tel').value.trim();
  const nuevoEmail = $input('pf-email').value.trim();
  const msg = $('pf-msg');
  if (!nombre || !apellido) {
    msg.textContent = 'Nombre y apellido son obligatorios.';
    msg.className = 'form-msg err';
    msg.style.display = 'block';
    return;
  }
  if (!nuevoEmail || !isValidEmail(nuevoEmail)) {
    msg.textContent = 'Ingresá un email válido.';
    msg.className = 'form-msg err';
    msg.style.display = 'block';
    return;
  }
  try {
    // Mismo chequeo de unicidad que en el registro (nombre+apellido,
    // email, teléfono), excluyendo el propio perfil.
    const dup = await Auth.checkProfileDuplicates({ nombre, apellido, tel, email: nuevoEmail, excludeId: currentProfile.id });
    if (dup.nombre_apellido) throw new Error('Ya existe otro usuario con ese nombre y apellido.');
    if (dup.email) throw new Error('Ya existe otro usuario con ese email.');
    if (dup.tel) throw new Error('Ya existe otro usuario con ese teléfono móvil.');

    const updated = await Auth.updateOwnProfile({ nombre, apellido, tel });
    currentProfile = { ...currentProfile, ...updated };
    $('user-name-pill').textContent = currentProfile.nombre || currentProfile.email || '—';

    let emailPendiente = false;
    if (nuevoEmail !== currentProfile.email) {
      await Auth.updateEmail(nuevoEmail);
      emailPendiente = true;
    }

    await refreshData();
    window.renderGraduados();
    msg.textContent = emailPendiente
      ? '✓ Perfil actualizado. Te enviamos un correo de confirmación a ' + nuevoEmail + ': hasta que lo confirmes, seguís entrando con tu email anterior.'
      : '✓ Perfil actualizado.';
    msg.className = 'form-msg ok';
    msg.style.display = 'block';
    if (!emailPendiente) setTimeout(() => window.closeModal('modal-perfil'), 900);
  } catch (e) {
    msg.textContent = friendlyError(e);
    msg.className = 'form-msg err';
    msg.style.display = 'block';
  }
};

window.solicitarCambioPassword = async function () {
  if (!currentProfile?.email) return;
  const msg = $('pf-msg');
  try {
    await Auth.resetPasswordForEmail(currentProfile.email);
    msg.textContent = '✓ Te enviamos un correo a ' + currentProfile.email + ' con un link para definir una nueva contraseña.';
    msg.className = 'form-msg ok';
    msg.style.display = 'block';
  } catch (e) {
    msg.textContent = friendlyError(e);
    msg.className = 'form-msg err';
    msg.style.display = 'block';
  }
};

// ══════════════════════════════════════════════
// LOGO (archivo real; se sube a Supabase Storage al guardar)
// ══════════════════════════════════════════════
window.previewLogo = function () {
  const file = $input('f-logo').files?.[0];
  if (!file) return;
  try {
    Empresas.validateLogoFile(file);
  } catch (e) {
    alert((e as Error).message);
    $input('f-logo').value = '';
    return;
  }
  currentLogoFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = $img('logo-preview-img');
    img.src = String(ev.target?.result || '');
    img.classList.remove('hidden');
    $('logo-clear-btn').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
};

window.clearLogo = function () {
  currentLogoFile = null;
  currentLogoUrl = null;
  $input('f-logo').value = '';
  const img = $img('logo-preview-img');
  img.src = ''; img.classList.add('hidden');
  $('logo-clear-btn').classList.add('hidden');
};

// ══════════════════════════════════════════════
// CUIT CHECK (chequeo rápido en cliente; la unicidad real la
// garantiza la restricción UNIQUE en la base de datos)
// ══════════════════════════════════════════════
window.checkCuit = function () {
  const raw = $input('f-cuit').value.trim();
  const el = $('cuit-check');
  if (!raw) { el.textContent = ''; return; }
  const digits = normCuit(raw);
  if (digits.length < 10) { el.textContent = ''; return; }
  const editId = $input('f-edit-id').value;
  const existing = orgs.find(o => normCuit(o.cuit) === digits && String(o.id) !== editId);
  if (existing) {
    el.style.color = '#c62828';
    el.textContent = '✗ CUIT ya registrado: ' + existing.nombre;
  } else {
    el.style.color = '#2e7d32';
    el.textContent = '✓ CUIT disponible';
  }
};

// ══════════════════════════════════════════════
// EDICIÓN DE EMPRESA
// ══════════════════════════════════════════════
window.startEdit = function (id) {
  const o = orgs.find(x => x.id === id);
  if (!o) return;

  const activeScreen = document.querySelector('.screen.active');
  editReturnScreen = activeScreen ? activeScreen.id.replace('screen-', '') : null;

  editingId = id;
  currentLogoFile = null;
  currentLogoUrl = o.logo || null;

  $input('f-edit-id').value = String(id);
  $('form-screen-title').textContent = 'Editar empresa';
  $('form-btn-label').textContent = 'Guardar cambios';

  const fields: Record<string, string | null> = {
    'f-tipo': o.tipo, 'f-cuit': o.cuit, 'f-nombre': o.nombre, 'f-sector': o.sector,
    'f-email-org': o.emailOrg, 'f-tel': o.tel, 'f-web': o.web,
    'f-calle': o.calle, 'f-ciudad': o.ciudad, 'f-provincia': o.provincia, 'f-pais': o.pais,
    'f-referente': o.referente, 'f-cargo': o.cargo, 'f-desc': o.desc,
  };
  Object.entries(fields).forEach(([k, v]) => {
    const el = document.getElementById(k) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (el) el.value = v || '';
  });

  const img = $img('logo-preview-img');
  const clr = $('logo-clear-btn');
  if (o.logo) { img.src = o.logo; img.classList.remove('hidden'); clr.classList.remove('hidden'); }
  else { img.src = ''; img.classList.add('hidden'); clr.classList.add('hidden'); }
  $input('f-logo').value = '';

  (Object.keys(tags) as TagType[]).forEach(k => { tags[k] = []; });
  tags.ofertas = [...(o.ofertas || [])];
  tags.instalaciones = [...(o.instalaciones || [])];
  tags['needs-uncovered'] = [...(o.needsUncovered || [])];
  tags['needs-covered'] = [...(o.needsCovered || [])];
  (Object.keys(tags) as TagType[]).forEach(k => renderTags(k));

  $('cuit-check').textContent = '';
  $('form-msg').style.display = 'none';
  window.showScreen('registrar');
};

window.cancelEdit = function () {
  const wasEditing = !!editingId;
  const returnTo = editReturnScreen;
  editingId = null;
  currentLogoFile = null;
  currentLogoUrl = null;
  $input('f-edit-id').value = '';
  $('form-screen-title').textContent = 'Agregar empresa u organización';
  $('form-btn-label').textContent = 'Registrar empresa';
  resetForm();
  if (wasEditing) window.showScreen(returnTo || 'directorio');
};

function resetForm(): void {
  ['nombre', 'cuit', 'sector', 'calle', 'ciudad', 'provincia', 'pais', 'referente', 'cargo', 'email-org', 'tel', 'web', 'desc'].forEach(id => {
    const el = document.getElementById('f-' + id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) el.value = '';
  });
  $select('f-tipo').value = 'Empresa';
  $input('f-logo').value = '';
  const img = $img('logo-preview-img');
  img.src = ''; img.classList.add('hidden');
  $('logo-clear-btn').classList.add('hidden');
  $('cuit-check').textContent = '';
  currentLogoFile = null;
  currentLogoUrl = null;
  (Object.keys(tags) as TagType[]).forEach(k => { tags[k] = []; renderTags(k); });
  $('form-msg').style.display = 'none';
}

// ══════════════════════════════════════════════
// GUARDAR EMPRESA (Supabase real)
// ══════════════════════════════════════════════
window.guardarOrg = async function () {
  if (!currentProfile) { showFormMsg('Debés iniciar sesión.', 'err'); return; }

  const nombre = $input('f-nombre').value.trim();
  const cuitRaw = $input('f-cuit').value.trim();
  const webRaw = $input('f-web').value.trim();

  if (!nombre) { showFormMsg('El nombre de la organización es obligatorio.', 'err'); return; }
  if (!cuitRaw) { showFormMsg('El CUIT es obligatorio.', 'err'); return; }
  if (!isValidCuit(cuitRaw)) { showFormMsg('El CUIT debe tener 11 dígitos.', 'err'); return; }
  if (webRaw && !isValidUrl(webRaw)) { showFormMsg('El sitio web debe empezar con http:// o https://', 'err'); return; }

  const editId = $input('f-edit-id').value;
  const digits = normCuit(cuitRaw);
  if (orgs.find(o => normCuit(o.cuit) === digits && String(o.id) !== editId)) {
    showFormMsg('Ya existe una empresa registrada con ese CUIT.', 'err'); return;
  }

  const submitBtn = $button('form-submit-btn');
  submitBtn.disabled = true;
  try {
    let logoUrl = currentLogoUrl;
    if (currentLogoFile) {
      showFormMsg('Subiendo logo…', 'ok');
      logoUrl = await Empresas.uploadLogo(currentLogoFile, currentProfile.id);
    }

    const data = {
      cuit: cuitRaw,
      tipo: $select('f-tipo').value,
      nombre,
      sector: $input('f-sector').value.trim(),
      calle: $input('f-calle').value.trim(),
      ciudad: $input('f-ciudad').value.trim(),
      provincia: $input('f-provincia').value.trim(),
      pais: $input('f-pais').value.trim() || 'Argentina',
      referente: $input('f-referente').value.trim(),
      cargo: $input('f-cargo').value.trim(),
      emailOrg: $input('f-email-org').value.trim(),
      tel: $input('f-tel').value.trim(),
      web: webRaw,
      desc: $textarea('f-desc').value.trim(),
      logo: logoUrl || null,
      ofertas: [...tags.ofertas],
      instalaciones: [...tags.instalaciones],
      needsUncovered: [...tags['needs-uncovered']],
      needsCovered: [...tags['needs-covered']],
    };

    if (editId) {
      await Empresas.updateEmpresa(editId, data);
      showFormMsg('✓ Empresa actualizada y guardada correctamente.', 'ok');
    } else {
      await Empresas.createEmpresa(currentProfile.id, data);
      showFormMsg('✓ Empresa registrada y guardada correctamente. Podés verla en "Mis empresas".', 'ok');
    }

    await refreshData();

    if (editId) {
      // Dejamos el mensaje de éxito visible un momento antes de limpiar el
      // formulario y volver a la pantalla desde donde se editó (en vez de
      // tirar al usuario al formulario de alta vacío sin aviso).
      const returnTo = editReturnScreen;
      editingId = null;
      $input('f-edit-id').value = '';
      setTimeout(() => {
        resetForm();
        $('form-screen-title').textContent = 'Agregar empresa u organización';
        $('form-btn-label').textContent = 'Registrar empresa';
        window.showScreen(returnTo || 'directorio');
      }, 1300);
    } else {
      setTimeout(() => resetForm(), 1300);
    }
  } catch (e) {
    showFormMsg(friendlyError(e), 'err');
  } finally {
    submitBtn.disabled = false;
  }
};

function showFormMsg(msg: string, type: 'err' | 'ok'): void {
  const el = $('form-msg');
  el.textContent = msg;
  el.className = `form-msg ${type}`;
  el.style.display = 'block';
}

// ══════════════════════════════════════════════
// EDITAR UBICACIÓN (modal rápido)
// ══════════════════════════════════════════════
window.openEditUbicacion = function (id) {
  const o = orgs.find(x => x.id === id);
  if (!o) return;
  $input('ub-id').value = String(id);
  $input('ub-calle').value = o.calle || '';
  $input('ub-ciudad').value = o.ciudad || '';
  $input('ub-provincia').value = o.provincia || '';
  $input('ub-pais').value = o.pais || 'Argentina';
  $('ub-msg').style.display = 'none';
  $('modal-ub-title').textContent = 'Ubicación: ' + o.nombre;
  $('modal-ubicacion').classList.add('open');
};

window.guardarUbicacion = async function () {
  const id = parseInt($input('ub-id').value, 10);
  const payload = {
    calle: $input('ub-calle').value.trim(),
    ciudad: $input('ub-ciudad').value.trim(),
    provincia: $input('ub-provincia').value.trim(),
    pais: $input('ub-pais').value.trim() || 'Argentina',
  };
  const msg = $('ub-msg');
  try {
    await Empresas.updateEmpresa(id, payload);
    await refreshData();
    if (leafletMap) { leafletMap.remove(); leafletMap = null; mapMarkers = []; }
    msg.textContent = '✓ Ubicación guardada.';
    msg.className = 'form-msg ok';
    msg.style.display = 'block';
    window.renderAdmin();
    setTimeout(() => window.closeModal('modal-ubicacion'), 1200);
  } catch (e) {
    msg.textContent = friendlyError(e);
    msg.className = 'form-msg err';
    msg.style.display = 'block';
  }
};

// ══════════════════════════════════════════════
// VINCULACIÓN
// ══════════════════════════════════════════════
window.setVinFilter = function (el, val) {
  // Escopado a #screen-vinculacion para no interferir con los chips de
  // filtro del Directorio (que usan la misma clase .chip).
  document.querySelectorAll('#screen-vinculacion .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeVinFilter = val as 'todos' | 'strong' | 'weak';
  window.renderVin();
};

window.renderVin = function () {
  const totalGrouped = groupMatchesByPair(allMatches(orgs));
  const q = ($input('search-vin').value || '').toLowerCase();

  let grouped = totalGrouped;
  if (activeVinFilter === 'strong') {
    grouped = grouped.filter(g => g.items.some(it => it.strength === 'strong'));
  } else if (activeVinFilter === 'weak') {
    grouped = grouped.filter(g => g.items.every(it => it.strength !== 'strong'));
  }
  if (q) {
    grouped = grouped.filter(g => {
      const hay = [
        g.seeker.nombre, g.seeker.referente, g.seeker.sector,
        g.provider.nombre, g.provider.referente, g.provider.sector,
        ...g.items.map(it => it.need), ...g.items.map(it => it.offer),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  $('vin-count').textContent = String(grouped.length);
  const list = $('vin-list');
  if (!grouped.length) {
    list.innerHTML = totalGrouped.length
      ? '<div class="empty"><i class="ti ti-arrows-exchange"></i>Sin resultados para ese criterio.</div>'
      : '<div class="empty"><i class="ti ti-arrows-exchange"></i>No se detectaron vinculaciones aún.<br>Registrá organizaciones con servicios y necesidades para que el sistema las cruce.</div>';
    return;
  }
  list.innerHTML = grouped.map(g => `
    <div class="vin-row">
      <div class="vc">
        <div>
          <div class="vc-label">necesita</div>
          <div class="vc-name" onclick="openDetail(${g.seeker.id})">${esc(g.seeker.nombre)}</div>
          <div class="vc-ref">${esc(g.seeker.referente)}</div>
        </div>
        <div class="vc-arrow"><i class="ti ti-arrow-right"></i></div>
        <div>
          <div class="vc-label">puede proveer</div>
          <div class="vc-name" onclick="openDetail(${g.provider.id})">${esc(g.provider.nombre)}</div>
          <div class="vc-ref">${esc(g.provider.referente)}</div>
        </div>
      </div>
      <div class="vin-items">
        ${g.items.map(it => `<div class="vin-item">
          <span class="tag tag-need">${esc(it.need)}</span>
          <i class="ti ti-arrow-right icon-sm"></i>
          <span class="tag tag-offer">${esc(it.offer)}</span>
          ${it.strength === 'strong' ? '<span class="match-strength match-strength--strong">Coincidencia exacta</span>' : '<span class="match-strength match-strength--weak">Posible coincidencia</span>'}
        </div>`).join('')}
      </div>
      <div class="vin-contact">${contactButtonsHtml(g.provider)}</div>
    </div>`).join('');
};

// ══════════════════════════════════════════════
// TAGS
// ══════════════════════════════════════════════
function addTagValue(type: TagType, rawVal: string): void {
  const val = String(rawVal || '').trim().replace(/\s+/g, ' ');
  if (!val) return;
  const key = normalizeTagKey(val);
  if (tags[type].some(t => normalizeTagKey(t) === key)) return; // evita duplicados por mayúsculas/espacios
  tags[type].push(val);
  renderTags(type);
}

window.addTag = function (event, type) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const inp = $input('input-' + type);
  addTagValue(type, inp.value);
  inp.value = '';
};

window.quickAddTag = function (type, idx) {
  const list = QUICK_TAG_SOURCES[type];
  if (!list) return;
  addTagValue(type, list[idx]);
};

window.removeTag = function (type, idx) {
  tags[type].splice(idx, 1);
  renderTags(type);
};

function renderTags(type: TagType): void {
  const wrap = $('wrap-' + type);
  const inp = $('input-' + type);
  wrap.querySelectorAll('.rtag').forEach(e => e.remove());
  tags[type].forEach((t, i) => {
    const el = document.createElement('span');
    el.className = `rtag ${tagCls[type]}`;
    el.innerHTML = `${esc(t)} <span class="rtag-remove" onclick="removeTag('${type}',${i})">×</span>`;
    wrap.insertBefore(el, inp);
  });
}

// ══════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════
function renderAdminOrgsUserFilterOptions(): void {
  const sel = $select('admin-filter-usuario');
  const prev = sel.value;
  sel.innerHTML = '<option value="">Todos los usuarios</option>' +
    profiles.map(u => `<option value="${u.id}">${esc(u.nombre + ' ' + (u.apellido || ''))} (${esc(u.email || '')})</option>`).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

window.renderAdmin = function () {
  if (!currentProfile || currentProfile.role !== 'admin') return;

  renderAdminOrgsUserFilterOptions();
  const filterUserId = $select('admin-filter-usuario').value;
  const filterRol = $select('admin-filter-rol-usuario').value;
  const oq = ($input('admin-search-orgs').value || '').toLowerCase();

  const filteredOrgs = orgs.filter(o => {
    if (filterUserId) {
      if (filterRol === 'principal' && o.uid !== filterUserId) return false;
      if (filterRol === 'asociado' && !asociaciones.some(a => a.empresa_id === o.id && a.user_id === filterUserId)) return false;
      if (filterRol === 'cualquiera' && !esUsuarioDeEmpresa(o, filterUserId)) return false;
    }
    if (oq && ![o.nombre, o.cuit, o.sector].join(' ').toLowerCase().includes(oq)) return false;
    return true;
  });

  $('admin-orgs-count').textContent = String(filteredOrgs.length);
  $('admin-orgs-body').innerHTML = filteredOrgs.map(o => `
    <tr>
      <td>${logoOrAvatar(o, 30)}</td>
      <td><strong>${esc(o.nombre)}</strong></td>
      <td class="muted-sm">${esc(o.cuit)}</td>
      <td class="td-sm">${esc(o.sector)}</td>
      <td class="td-sm">${esc(o.referente)}</td>
      <td class="td-sm">${esc([o.ciudad, o.provincia].filter(Boolean).join(', ')) || '—'}</td>
      <td><div class="action-btns">
        <button class="btn-edit-inline" onclick="startEdit(${o.id})" title="Editar empresa"><i class="ti ti-pencil"></i></button>
        <button class="btn-loc" onclick="openEditUbicacion(${o.id})" title="Editar ubicación"><i class="ti ti-map-pin"></i></button>
        <button class="btn-out btn-icon" onclick="openAsignarUsuarios(${o.id})" title="Usuarios asociados"><i class="ti ti-users"></i></button>
        <button class="btn-danger" onclick="deleteOrg(${o.id})" title="Eliminar empresa (esta acción no se puede deshacer)"><i class="ti ti-trash"></i></button>
      </div></td>
    </tr>`).join('');

  if (!filteredOrgs.length) {
    $('admin-orgs-body').innerHTML = '<tr><td colspan="7" class="empty">Sin resultados para ese criterio.</td></tr>';
  }

  const uq = ($input('admin-search-users').value || '').toLowerCase();
  const filteredUsers = profiles.filter(u => {
    if (!uq) return true;
    return [u.nombre, u.apellido, u.email, u.tel].join(' ').toLowerCase().includes(uq);
  });
  $('admin-users-count').textContent = String(filteredUsers.length);

  $('admin-users-body').innerHTML = filteredUsers.map(u => {
    const isSelf = u.id === currentProfile!.id;
    const isAdmin = u.role === 'admin';
    return `
    <tr>
      <td><strong>${esc(u.nombre + ' ' + (u.apellido || ''))}</strong>${isSelf ? ' <span class="badge-self">Vos</span>' : ''}</td>
      <td class="td-sm">${esc(u.email || '—')}</td>
      <td class="td-sm">${esc(u.tel || '—')}</td>
      <td class="td-sm">${orgs.filter(o => esUsuarioDeEmpresa(o, u.id)).length}</td>
      <td><span class="role-badge ${isAdmin ? 'role-badge--admin' : 'role-badge--user'}">${isAdmin ? 'Admin' : 'Usuario'}</span></td>
      <td><div class="action-btns">
        <button class="btn-edit-inline" onclick="openEditarUsuario('${u.id}')" title="Editar usuario (nombre, email, contraseña...)"><i class="ti ti-pencil"></i></button>
        ${isSelf
          ? '<span class="muted-sm">No podés cambiar tu propio rol</span>'
          : `<button class="btn-out" onclick="toggleUserRole('${u.id}','${isAdmin ? 'user' : 'admin'}')">${isAdmin ? 'Quitar admin' : 'Hacer admin'}</button>`}
      </div></td>
    </tr>`;
  }).join('');

  if (!filteredUsers.length) {
    $('admin-users-body').innerHTML = '<tr><td colspan="6" class="empty">Sin resultados para ese criterio.</td></tr>';
  }
};

window.toggleUserRole = async function (userId, newRole) {
  const target = profiles.find(u => u.id === userId);
  const name = target ? `${target.nombre} ${target.apellido}`.trim() : 'este usuario';
  const action = newRole === 'admin' ? `¿Convertir a "${name}" en administrador?` : `¿Quitarle el rol de administrador a "${name}"?`;
  if (!confirm(action)) return;
  try {
    await Auth.setUserRole(userId, newRole);
    await refreshData();
    window.renderAdmin();
  } catch (e) {
    alert(friendlyError(e));
  }
};

window.deleteOrg = async function (id) {
  const o = orgs.find(x => x.id === id);
  const nombre = o ? o.nombre : 'esta empresa';
  if (!confirm(`¿Eliminar definitivamente "${nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await Empresas.deleteEmpresa(id);
    await refreshData();
    window.renderAdmin();
  } catch (e) {
    alert(friendlyError(e));
  }
};

// ══════════════════════════════════════════════
// EDITAR USUARIO (admin, sin verificación — ver auth.ts/adminUpdateUserAuth
// y supabase/functions/admin-update-user/index.ts)
// ══════════════════════════════════════════════
window.openEditarUsuario = function (userId) {
  const u = getProfileById(userId);
  if (!u) return;
  $input('eu-id').value = u.id;
  $input('eu-nombre').value = u.nombre || '';
  $input('eu-apellido').value = u.apellido || '';
  $input('eu-tel').value = u.tel || '';
  $input('eu-email').value = u.email || '';
  $input('eu-pass').value = '';
  $input('eu-pass2').value = '';
  $('eu-msg').style.display = 'none';
  $('modal-editar-usuario-title').textContent = 'Editar usuario: ' + `${u.nombre} ${u.apellido}`.trim();
  $('modal-editar-usuario').classList.add('open');
};

window.guardarEdicionUsuario = async function () {
  const userId = $input('eu-id').value;
  const nombre = $input('eu-nombre').value.trim();
  const apellido = $input('eu-apellido').value.trim();
  const tel = $input('eu-tel').value.trim();
  const email = $input('eu-email').value.trim();
  const pass = $input('eu-pass').value;
  const pass2 = $input('eu-pass2').value;
  const msg = $('eu-msg');

  if (!nombre || !apellido) {
    msg.textContent = 'Nombre y apellido son obligatorios.'; msg.className = 'form-msg err'; msg.style.display = 'block'; return;
  }
  if (!email || !isValidEmail(email)) {
    msg.textContent = 'Ingresá un email válido.'; msg.className = 'form-msg err'; msg.style.display = 'block'; return;
  }
  if (pass && pass.length < 8) {
    msg.textContent = 'La contraseña debe tener al menos 8 caracteres.'; msg.className = 'form-msg err'; msg.style.display = 'block'; return;
  }
  if (pass !== pass2) {
    msg.textContent = 'Las contraseñas no coinciden.'; msg.className = 'form-msg err'; msg.style.display = 'block'; return;
  }

  const target = getProfileById(userId);
  if (!target) return;
  const nombreCompleto = `${nombre} ${apellido}`.trim();
  if (!confirm(`¿Aplicar estos cambios a la cuenta de "${nombreCompleto}"? Se aplican de inmediato, sin pedirle confirmación al usuario.`)) return;

  try {
    const dup = await Auth.checkProfileDuplicates({ nombre, apellido, tel, email, excludeId: userId });
    if (dup.nombre_apellido) throw new Error('Ya existe otro usuario con ese nombre y apellido.');
    if (dup.email) throw new Error('Ya existe otro usuario con ese email.');
    if (dup.tel) throw new Error('Ya existe otro usuario con ese teléfono móvil.');

    await Auth.adminUpdateProfile(userId, { nombre, apellido, tel });

    const emailChanged = email !== (target.email || '');
    if (emailChanged || pass) {
      await Auth.adminUpdateUserAuth(userId, {
        email: emailChanged ? email : undefined,
        password: pass || undefined,
      });
    }

    await refreshData();
    window.renderAdmin();
    msg.textContent = '✓ Usuario actualizado.';
    msg.className = 'form-msg ok';
    msg.style.display = 'block';
    setTimeout(() => window.closeModal('modal-editar-usuario'), 900);
  } catch (e) {
    msg.textContent = friendlyError(e);
    msg.className = 'form-msg err';
    msg.style.display = 'block';
  }
};

// ══════════════════════════════════════════════
// ASIGNAR / DESASIGNAR EMPRESA A USUARIOS (admin)
// ══════════════════════════════════════════════
window.openAsignarUsuarios = function (empresaId) {
  const o = orgs.find(x => x.id === empresaId);
  if (!o) return;
  $input('asig-empresa-id').value = String(empresaId);
  $('modal-asignar-title').textContent = 'Usuarios de: ' + o.nombre;

  const duenoSel = $select('asig-dueno');
  duenoSel.innerHTML = '<option value="">— Sin administrador principal asignado —</option>' +
    profiles.map(u => `<option value="${u.id}" ${u.id === o.uid ? 'selected' : ''}>${esc(u.nombre + ' ' + (u.apellido || ''))} (${esc(u.email || '')})</option>`).join('');

  renderAsignarNuevoUsuarioSelect(empresaId);
  renderAsignarLista(empresaId);
  $('asig-msg').style.display = 'none';
  $('modal-asignar').classList.add('open');
};

function renderAsignarLista(empresaId: number): void {
  const ids = asociaciones.filter(a => a.empresa_id === empresaId).map(a => a.user_id);
  const html = ids.length
    ? ids.map(uid => {
        const u = getProfileById(uid);
        const nombre = u ? `${u.nombre} ${u.apellido || ''}`.trim() : uid;
        return `<div class="asig-item"><span>${esc(nombre)}</span><button class="btn-danger btn-sm" onclick="quitarUsuarioDeEmpresa(${empresaId}, '${uid}')" title="Quitar"><i class="ti ti-x"></i></button></div>`;
      }).join('')
    : '<p class="muted-sm">Sin usuarios adicionales.</p>';
  $('asig-lista').innerHTML = html;
}

function renderAsignarNuevoUsuarioSelect(empresaId: number): void {
  const o = orgs.find(x => x.id === empresaId);
  const yaAsociados = new Set(asociaciones.filter(a => a.empresa_id === empresaId).map(a => a.user_id));
  const disponibles = profiles.filter(u => u.id !== o?.uid && !yaAsociados.has(u.id));
  const sel = $select('asig-nuevo-usuario');
  sel.innerHTML = disponibles.length
    ? disponibles.map(u => `<option value="${u.id}">${esc(u.nombre + ' ' + (u.apellido || ''))} (${esc(u.email || '')})</option>`).join('')
    : '<option value="">No hay más usuarios para agregar</option>';
}

function asigMsg(text: string, type: 'err' | 'ok'): void {
  const msg = $('asig-msg');
  msg.textContent = text;
  msg.className = `form-msg ${type}`;
  msg.style.display = 'block';
}

window.cambiarDuenoEmpresa = async function () {
  const empresaId = parseInt($input('asig-empresa-id').value, 10);
  const nuevoUid = $select('asig-dueno').value || null;
  try {
    await Empresas.reasignarDueno(empresaId, nuevoUid);
    await refreshData();
    window.renderAdmin();
    renderAsignarNuevoUsuarioSelect(empresaId);
    renderAsignarLista(empresaId);
    asigMsg('✓ Administrador principal actualizado.', 'ok');
  } catch (e) {
    asigMsg(friendlyError(e), 'err');
  }
};

window.agregarUsuarioAEmpresa = async function () {
  const empresaId = parseInt($input('asig-empresa-id').value, 10);
  const userId = $select('asig-nuevo-usuario').value;
  if (!userId) return;
  try {
    await Empresas.asignarUsuario(empresaId, userId);
    await refreshData();
    window.renderAdmin();
    renderAsignarNuevoUsuarioSelect(empresaId);
    renderAsignarLista(empresaId);
    asigMsg('✓ Usuario agregado.', 'ok');
  } catch (e) {
    asigMsg(friendlyError(e), 'err');
  }
};

window.quitarUsuarioDeEmpresa = async function (empresaId, userId) {
  if (!confirm('¿Quitar a este usuario de la empresa? Va a perder acceso para editarla.')) return;
  try {
    await Empresas.desasignarUsuario(empresaId, userId);
    await refreshData();
    window.renderAdmin();
    renderAsignarNuevoUsuarioSelect(empresaId);
    renderAsignarLista(empresaId);
  } catch (e) {
    asigMsg(friendlyError(e), 'err');
  }
};
