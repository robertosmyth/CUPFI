// ══════════════════════════════════════════════
// CUPFI · Red de Vinculación Empresarial FI-UNLZ
// App principal: conecta la UI con Supabase (auth real + datos reales)
// ══════════════════════════════════════════════
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import type * as LeafletTypes from 'leaflet';
import * as Auth from './auth.ts';
import * as Empresas from './empresas.ts';
import * as Conexiones from './conexiones.ts';
import * as Webmaster from './webmaster.ts';
import * as Solicitudes from './solicitudes.ts';
import { initSolicitudesUI } from './ui-solicitudes.ts';
import { initBlogUI, resetBlogUI } from './ui-blog.ts';
import { calcularSugerencias, etiquetaItem } from './matching.ts';
import { setContext } from './contexto.ts';
import { contarMisPendientes, initConexionesUI, puedeVerRed, resetConexionesUI } from './ui-conexiones.ts';
import { resetWebmasterUI } from './ui-webmaster.ts';
import { iniciarGuia, resetGuia } from './ui-guia.ts';
import { anunciarPantalla, initA11y } from './a11y.ts';
import { limpiarCache as limpiarCacheDirectorio } from './directorio.ts';
import { initDirectorio, limpiarFiltrosDirectorio, nombreSector, puntosDelDirectorio, renderDirectorio, resetDirectorio, totalesRed } from './ui-directorio.ts';
import { cargarUbicacion, initFormUbicacion, leerUbicacion, resetUbicacion } from './ui-ubicacion.ts';
import { renderGraduadosUI, resetGraduadosUI } from './ui-graduados.ts';
import { renderAdminUI, resetAdminUI } from './ui-admin.ts';
import { validarClave, urlSegura } from './seguridad.ts';
import { detenerSeguridadSesion, iniciarSeguridadSesion, initIndicadoresClave, limpiarCambioClave, revisarClaveTemporal } from './ui-seguridad.ts';
import '@fontsource/poppins/300.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/800.css';
import { esc, ini, normCuit, isValidCuit, isValidEmail, isValidUrl, buildAddress, friendlyError, normalizeTagKey } from './utils.ts';
import type { Categoria, ConexionRow, Empresa, EmpresaItem, EmpresaUsuarioRow, ItemTipo, Profile, SolicitudRow } from './types.ts';

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
    renderDir(): void;
    renderGraduados(): void;
    renderMapa(): Promise<void>;
    mapaSinFiltros(): void;
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
    itemCategoriaCambio(tipo: ItemTipo): void;
    itemAgregar(tipo: ItemTipo): void;
    itemSugerida(tipo: ItemTipo, idx: number): void;
    itemQuitar(idx: number): void;
    toggleWebmaster(userId: string, valor: boolean): Promise<void>;
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
    detItemCategoria(tipo: ItemTipo): void;
    detItemAgregar(empresaId: number, tipo: ItemTipo): Promise<void>;
    detItemQuitar(empresaId: number, itemId: number): Promise<void>;
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
// Ofertas y necesidades sin cubrir ya no son tags de texto libre sino
// ítems con categoría + subcategoría (formItems, más abajo).
type TagType = 'instalaciones' | 'needs-covered';

const tags: Record<TagType, string[]> = { instalaciones: [], 'needs-covered': [] };
const tagCls: Record<TagType, string> = { instalaciones: 'rt-i', 'needs-covered': 'rt-nc' };
let currentProfile: Profile | null = null;
// Link de "restablecer contraseña" del correo: se detecta en la URL apenas
// carga el script, ANTES de que Supabase la procese y la limpie. Supabase
// avisa PASSWORD_RECOVERY recién un instante después de dar la sesión por
// válida, y para entonces enterApp() ya había arrancado y terminaba tapando
// el formulario de nueva contraseña (el usuario entraba directo sin poder
// cambiarla). Mientras esto sea true, enterApp() no muestra la app.
let recoveryInProgress = /(^|[#&])type=recovery(&|$)/.test(window.location.hash);
let orgs: Empresa[] = [];
let profiles: Profile[] = [];
let categorias: Categoria[] = [];
let conexiones: ConexionRow[] = []; // las visibles para el usuario (RLS)
let solicitudes: SolicitudRow[] = []; // las visibles para el usuario (RLS, sql/013)
let formItems: EmpresaItem[] = [];  // ofertas/necesidades del formulario de empresa
let asociaciones: EmpresaUsuarioRow[] = []; // filas de empresa_usuarios (ver sql/historial/009)
let editingId: number | null = null;
let editReturnScreen: string | null = null; // pantalla a la que volver después de editar (no de agregar)
let currentLogoFile: File | null = null; // File real seleccionado (se sube recién al guardar)
let currentLogoUrl: string | null = null;  // URL ya existente (modo edición) o recién subida

// Mapa
let leafletMap: LeafletTypes.Map | null = null;
let leafletModule: typeof LeafletTypes | null = null;

// Sugerencias para "Necesidades cubiertas con proveedores" (texto libre,
// no participa del matching). Las categorías de ofertas y necesidades sin
// cubrir ahora viven en la tabla categorias (las administra un webmaster).
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
const QUICK_TAG_SOURCES: Record<TagType, string[]> = {
  instalaciones: CATEGORIAS_INSTALACIONES,
  'needs-covered': CATEGORIAS_SERVICIOS,
};

// Contexto que leen los módulos de interfaz nuevos (ui-*.ts).
setContext({
  get orgs() { return orgs; },
  get profiles() { return profiles; },
  get categorias() { return categorias; },
  get conexiones() { return conexiones; },
  get solicitudes() { return solicitudes; },
  get currentProfile() { return currentProfile; },
  misEmpresas: () => new Set(currentProfile ? orgs.filter(o => esUsuarioDeEmpresa(o, currentProfile!.id)).map(o => o.id) : []),
  refresh: () => refreshData(),
  getProfileById: uid => getProfileById(uid),
  categoriaById: id => categorias.find(c => c.id === id),
  contactButtonsHtml: org => contactButtonsHtml(org),
  showScreen: name => window.showScreen(name),
});

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
  initA11y();
  initIndicadoresClave();
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

  if (recoveryInProgress) showPasswordRecoveryForm();
  const session = await Auth.getSession();
  if (recoveryInProgress) {
    if (session) return; // formulario de nueva contraseña a la vista
    // El link venía vencido o ya usado: sin sesión no se puede cambiar la
    // contraseña, así que volvemos al login con un aviso.
    recoveryInProgress = false;
    showAuthScreen();
    window.authTab('login');
    showAuthMsg('l-msg', 'El link para restablecer la contraseña venció o ya fue usado. Pedí uno nuevo con "¿Olvidaste tu contraseña?".', 'err');
    return;
  }
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
  $('modal-perfil').addEventListener('click', function (e) {
    if (e.target === this) window.closeModal('modal-perfil');
  });
  initConexionesUI();
  initSolicitudesUI();
  initBlogUI();
  renderQuickTagButtons();
}

function renderQuickTagButtons(): void {
  const mk = (containerId: string, list: string[], type: TagType) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = list.map((c, i) => `<button type="button" class="quick-tag-btn" onclick="quickAddTag('${type}',${i})">+ ${esc(c)}</button>`).join('');
  };
  mk('quick-instalaciones', CATEGORIAS_INSTALACIONES, 'instalaciones');
  mk('quick-needs-covered', CATEGORIAS_SERVICIOS, 'needs-covered');
}

// ══════════════════════════════════════════════
// AUTH UI
// ══════════════════════════════════════════════
window.authTab = function (t) {
  document.querySelectorAll('.auth-tab').forEach((el, i) => {
    const activa = ['login', 'registro'][i] === t;
    el.classList.toggle('active', activa);
    el.setAttribute('aria-selected', String(activa));
  });
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
    await Auth.registrarEvento('sesion_inicio');
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
  const problemaClave = validarClave(pass);
  if (problemaClave) { showAuthMsg('r-msg', problemaClave, 'err'); return; }
  if (pass !== pass2) { showAuthMsg('r-msg', 'Las contraseñas no coinciden.', 'err'); return; }
  if (!$input('r-privacidad').checked) { showAuthMsg('r-msg', 'Para crear la cuenta tenés que aceptar el aviso de privacidad.', 'err'); return; }

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
      await Auth.registrarEvento('sesion_inicio');
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
  await cerrarSesion('sesion_cierre');
};

// Cierre de sesión (a pedido o por inactividad). Siempre limpia la
// pantalla, aunque falle la red.
async function cerrarSesion(motivo: 'sesion_cierre' | 'sesion_inactividad'): Promise<void> {
  detenerSeguridadSesion();
  if (leafletMap) { leafletMap.remove(); leafletMap = null; mapCluster = null; }
  await Auth.registrarEvento(motivo);
  try { await Auth.signOut(); } catch (e) { console.error('No se pudo cerrar la sesión en el servidor:', e); }
  currentProfile = null;
  showAuthScreen();
  if (motivo === 'sesion_inactividad') {
    window.authTab('login');
    showAuthMsg('l-msg', 'Cerramos tu sesión porque pasaron 30 minutos sin actividad. Volvé a ingresar para seguir.', 'err');
  }
}

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
  const problemaClave = validarClave(p1);
  if (problemaClave) { showAuthMsg('rp-msg', problemaClave, 'err'); return; }
  if (p1 !== p2) { showAuthMsg('rp-msg', 'Las contraseñas no coinciden.', 'err'); return; }
  setBusy('rp-btn', true);
  try {
    await Auth.updatePassword(p1);
    recoveryInProgress = false; // ya se puede entrar a la app
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
  el.classList.toggle('auth-msg--err', type === 'err');
  el.classList.toggle('auth-msg--ok', type === 'ok');
}

function showAuthScreen(): void {
  detenerSeguridadSesion();
  $('auth-wrap').style.display = 'flex';
  $('main-app').style.display = 'none';
  document.title = 'Red de Vinculación Empresarial – FI-UNLZ';
  $input('l-pass').value = '';
  // Que no quede nada del usuario anterior (chat abierto, bitácora, guía).
  resetConexionesUI();
  resetWebmasterUI();
  resetGuia();
  resetBlogUI();
  resetDirectorio();
  resetAdminUI();
  resetGraduadosUI();
  limpiarCacheDirectorio();
  conexiones = [];
  solicitudes = [];
}

// Al iniciar sesión, enterApp() se dispara dos veces casi juntas: desde
// doLogin y desde el evento SIGNED_IN de onAuthStateChange. Sin esta
// guarda, la segunda terminaba después y volvía a mostrar "Empresas" aunque
// el usuario ya hubiera cambiado de pestaña (y abría la guía dos veces).
let enteringApp: Promise<void> | null = null;
function enterApp(): Promise<void> {
  if (enteringApp) return enteringApp;
  if (currentProfile && $('main-app').style.display === 'block') return Promise.resolve(); // ya adentro
  enteringApp = enterAppImpl().finally(() => { enteringApp = null; });
  return enteringApp;
}

async function enterAppImpl(): Promise<void> {
  if (recoveryInProgress) return; // no tapar el formulario de nueva contraseña
  try {
    currentProfile = await Auth.getCurrentProfile();
  } catch (e) {
    showAuthMsg('l-msg', friendlyError(e), 'err');
    return;
  }
  if (!currentProfile) return;
  if (recoveryInProgress) { currentProfile = null; return; }
  $('auth-wrap').style.display = 'none';
  $('main-app').style.display = 'block';
  $('user-name-pill').textContent = currentProfile.nombre || currentProfile.email || '—';
  const isAdmin = currentProfile.role === 'admin';
  $('admin-tab-btn').classList.toggle('hidden', !isAdmin);
  $('admin-badge').classList.toggle('hidden', !isAdmin);
  $('webmaster-tab-btn').classList.toggle('hidden', !(isAdmin && currentProfile.is_webmaster));

  try {
    await refreshData();
  } catch (e) {
    // Sin datos la app no sirve: volvemos al login con el motivo.
    currentProfile = null;
    showAuthScreen();
    showAuthMsg('l-msg', friendlyError(e), 'err');
    return;
  }
  if (recoveryInProgress) { currentProfile = null; showAuthScreen(); return; } // llegó el link de reset mientras cargaba
  await Promise.all([initDirectorio(), initFormUbicacion(ensureLeaflet)]).catch(e => console.error('No se pudieron cargar sectores y provincias:', e));
  window.showScreen('directorio');
  iniciarSeguridadSesion({ email: () => currentProfile?.email ?? null, cerrarSesion: () => cerrarSesion('sesion_inactividad') });
  revisarClaveTemporal().catch(() => {});
  iniciarGuia();
}

async function refreshData(): Promise<void> {
  limpiarCacheDirectorio(); // lo buscado antes puede haber cambiado
  const [e, p, a, items, cats, cons, sols] = await Promise.all([
    Empresas.listEmpresas(), Auth.listProfiles(), Empresas.listAsociaciones(),
    Empresas.listItems(), Empresas.listCategorias(), Conexiones.listConexiones(),
    // Si la base todavía no tiene sql/013, la app sigue andando sin solicitudes.
    Solicitudes.listSolicitudes().catch(err => { console.warn('Solicitudes no disponibles:', friendlyError(err)); return [] as SolicitudRow[]; }),
  ]);
  orgs = e;
  profiles = p;
  asociaciones = a;
  categorias = cats;
  conexiones = cons;
  solicitudes = sols;
  orgs.forEach(o => {
    o.usuarios = usuariosDeEmpresa(o);
    o.items = items.get(o.id) || [];
  });
}

// "Categoría › Subcategoría" de un ítem (o "?" si su categoría ya no existe).
function itemLabel(it: EmpresaItem): string {
  const c = categorias.find(x => x.id === it.categoriaId);
  return etiquetaItem(c ? c.nombre : '?', it.subcategoria);
}
function itemsDe(o: Empresa, tipo: ItemTipo): EmpresaItem[] {
  return (o.items || []).filter(i => i.tipo === tipo);
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
  document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  const names = ['directorio', 'graduados', 'vinculacion', 'blog', 'mapa', 'mis-empresas', 'registrar', 'admin', 'webmaster'];
  const idx = names.indexOf(name);
  if (idx >= 0) {
    const btns = document.querySelectorAll('.tab-btn');
    if (btns[idx]) {
      btns[idx].classList.add('active');
      btns[idx].setAttribute('aria-current', 'page');
      anunciarPantalla((btns[idx].textContent || '').trim());
    }
  }
  if (name === 'directorio') window.renderDir();
  if (name === 'graduados') window.renderGraduados();
  if (name === 'vinculacion') window.renderVin();
  if (name === 'blog') window.renderBlog();
  if (name === 'mapa') window.renderMapa().catch(e => console.error('No se pudo cargar el mapa:', e));
  if (name === 'mis-empresas') window.renderMias();
  if (name === 'registrar') {
    if (!editingId) { prefillUser(); void cargarUbicacion(null); }
    renderItemEditors();
  }
  if (name === 'admin') window.renderAdmin();
  if (name === 'webmaster') window.renderWebmaster();
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
  // La lista, los filtros y los contadores los arma ui-directorio.ts con
  // la búsqueda en la base (buscar_empresas). Acá solo las tarjetas de arriba.
  renderDirectorio();
  void totalesRed().then(t => {
    $('stat-total').textContent = t.organizaciones.toLocaleString('es-AR');
    $('stat-sectores').textContent = String(t.sectores);
  }).catch(() => {});
  $('stat-users').textContent = String(profiles.length);
  // Admins y webmasters ven el total de la red; el resto, solo lo de sus
  // empresas (las coincidencias entre otras empresas son privadas).
  const verRed = puedeVerRed();
  $('stat-matches-label').textContent = verRed ? 'Vinculaciones posibles (red)' : 'Mis vinculaciones pendientes';
  $('stat-matches').textContent = String(verRed ? calcularSugerencias(orgs, categorias).length : contarMisPendientes());
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
      ${itemsDe(o, 'oferta').slice(0, 2).map(t => `<span class="tag tag-offer">${esc(itemLabel(t))}</span>`).join('')}
      ${itemsDe(o, 'necesidad').slice(0, 1).map(t => `<span class="tag tag-need">${esc(itemLabel(t))}</span>`).join('')}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════
// DIRECTORIO GRADUADOS
// ══════════════════════════════════════════════
window.renderGraduados = function () { renderGraduadosUI(); };

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

// Agrupa marcadores cercanos ("12" en un círculo) para que el mapa siga
// siendo legible con miles de organizaciones. La librería espera Leaflet
// como variable global: se le pasa una copia del módulo.
let ClusterGroup: (new (opts?: Record<string, unknown>) => LeafletTypes.FeatureGroup) | null = null;
async function ensureCluster(): Promise<NonNullable<typeof ClusterGroup>> {
  if (ClusterGroup) return ClusterGroup;
  const L = await ensureLeaflet();
  (globalThis as unknown as { L: unknown }).L = { ...L };
  await import('leaflet.markercluster/dist/MarkerCluster.css');
  await import('leaflet.markercluster/dist/MarkerCluster.Default.css');
  const mc = await import('leaflet.markercluster') as unknown as { MarkerClusterGroup: NonNullable<typeof ClusterGroup> };
  ClusterGroup = mc.MarkerClusterGroup;
  return ClusterGroup;
}

function pinIcon(L: typeof LeafletTypes, aproximado = false): LeafletTypes.DivIcon {
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" aria-hidden="true">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.625 14 22 14 22S28 23.625 28 14C28 6.27 21.73 0 14 0z" fill="${aproximado ? '#6b5fb5' : '#3B24C8'}"/>
      <circle cx="14" cy="14" r="7" fill="white"/>
      <circle cx="14" cy="14" r="4" fill="#233DFF"/>
    </svg>`,
    className: '', iconSize: [28, 36], iconAnchor: [14, 36], popupAnchor: [0, -38],
  });
}

let mapCluster: LeafletTypes.FeatureGroup | null = null;

// El mapa muestra lo mismo que el directorio con sus filtros, usando las
// coordenadas guardadas en la base (sql/016): ya no se adivina la
// dirección en cada visita ni se pierden empresas superpuestas.
window.renderMapa = async function () {
  const [L, Cluster, datos] = await Promise.all([ensureLeaflet(), ensureCluster(), puntosDelDirectorio()]);
  $('map-count').textContent = datos.puntos.length.toLocaleString('es-AR');

  if (!leafletMap) {
    leafletMap = L.map('gmap').setView([-38.5, -63.5], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(leafletMap);
  }
  const map = leafletMap;
  setTimeout(() => map.invalidateSize(), 50);
  mapCluster?.remove();
  mapCluster = new Cluster({ showCoverageOnHover: false, maxClusterRadius: 45, chunkedLoading: true });

  const sinUbicacion = datos.total - datos.puntos.length;
  const partes: string[] = [];
  if (datos.filtros) partes.push(`Mostrando las organizaciones del directorio con los <strong>filtros aplicados</strong> (${datos.filtros}). <button type="button" class="link-btn" onclick="mapaSinFiltros()">Ver todas</button>`);
  partes.push('Los números agrupan organizaciones cercanas: acercate o tocá un grupo para separarlas.');
  if (sinUbicacion > 0) partes.push(`${sinUbicacion.toLocaleString('es-AR')} ${sinUbicacion === 1 ? 'organización todavía no tiene' : 'organizaciones todavía no tienen'} ubicación cargada.`);
  $('map-notice-txt').innerHTML = partes.join(' ');

  for (const p of datos.puntos) {
    const lugar = [p.ciudad, p.provincia].filter(Boolean).join(', ');
    const popupHtml = `<div class="map-popup">
      <div class="map-popup-head">
        <div class="map-popup-media">${p.logo ? `<img src="${esc(p.logo)}" class="org-logo-img logo-38" alt="">` : `<div class="avatar logo-38" aria-hidden="true">${esc(ini(p.nombre))}</div>`}</div>
        <div class="map-popup-info">
          <div class="map-popup-name">${esc(p.nombre)}</div>
          <div class="map-popup-sector">${esc(p.sector_id ? nombreSector(p.sector_id) : '')}</div>
        </div>
        <div class="u-clearfix"></div>
      </div>
      <div class="map-popup-addr">${esc(lugar)}${p.precision === 'localidad' ? ' <span class="map-popup-aprox">(ubicación aproximada)</span>' : ''}</div>
      <button onclick="window._openDetail(${p.id})" class="map-popup-btn">Ver detalle completo</button>
    </div>`;
    const m = L.marker([p.lat, p.lng], { icon: pinIcon(L, p.precision === 'localidad'), title: p.nombre, alt: p.nombre, keyboard: true });
    m.bindPopup(popupHtml, { maxWidth: 260, closeButton: true });
    mapCluster.addLayer(m);
  }
  mapCluster.addTo(map);
  if (datos.puntos.length) map.fitBounds(mapCluster.getBounds(), { padding: [40, 40], maxZoom: 13 });
};

window.mapaSinFiltros = function () {
  limpiarFiltrosDirectorio();
  window.renderMapa().catch(e => console.error('No se pudo cargar el mapa:', e));
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
  // Ítems pasados automáticamente a "Otros" desde el formato anterior.
  const aRevisar = mine.filter(o => (o.items || []).some(i => i.revisar));
  $('mis-revisar').classList.toggle('hidden', !aRevisar.length);
  $('mis-revisar').innerHTML = aRevisar.length
    ? `<i class="ti ti-alert-triangle"></i> Actualizamos el formato de ofertas y necesidades: ahora llevan <strong>categoría y subcategoría</strong>.
       Algunos ítems de ${aRevisar.map(o => `<a href="#" onclick="event.preventDefault();startEdit(${o.id})">${esc(o.nombre)}</a>`).join(', ')}
       quedaron en <em>Otros</em>. Editá la empresa y asignales la categoría correcta para encontrar más conexiones.`
    : '';
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
  // Quién puede cubrir las necesidades de esta empresa: solo para sus
  // propios usuarios, admins y webmasters (es información privada).
  const mx = (puedeVerRed() || esUsuarioDeEmpresa(o, currentProfile!.id))
    ? calcularSugerencias(orgs, categorias).filter(s => s.necesita.id === o.id)
    : [];
  const mine = currentProfile && (esUsuarioDeEmpresa(o, currentProfile.id) || currentProfile.role === 'admin');
  // Solicitudes: a empresas de las que no soy usuario, con ítems cargados.
  const puedeSolicitar = !!currentProfile && !esUsuarioDeEmpresa(o, currentProfile.id) && (o.items || []).some(i => i.id);
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
          <div class="detail-sector">${esc([o.sectorId ? nombreSector(o.sectorId) : o.sector, o.sector2Id ? nombreSector(o.sector2Id) : ''].filter(Boolean).join(' · '))}</div>
        </div>
      </div>
      <div class="detail-meta-row"><i class="ti ti-id detail-icon"></i>CUIT: <strong>${esc(o.cuit)}</strong></div>
      ${u ? `<div class="detail-meta-row"><i class="ti ti-user-check detail-icon"></i>Registrado por: <strong>${esc(u.nombre + ' ' + u.apellido)}</strong></div>` : ''}
      ${o.desc ? `<p class="detail-desc">${esc(o.desc)}</p>` : ''}
    </div>

    ${(o.emailOrg || o.tel || o.web) ? `<div class="dsec"><div class="dsec-title">Contacto</div>
      ${o.emailOrg ? `<div class="drow"><i class="ti ti-mail"></i>${esc(o.emailOrg)}</div>` : ''}
      ${o.tel ? `<div class="drow"><i class="ti ti-phone"></i>${esc(o.tel)}</div>` : ''}
      ${urlSegura(o.web) ? `<div class="drow"><i class="ti ti-world"></i><a href="${esc(urlSegura(o.web))}" target="_blank" rel="noopener noreferrer" class="link-plain">${esc(o.web)}<span class="sr-only"> (se abre en otra pestaña)</span></a></div>` : (o.web ? `<div class="drow"><i class="ti ti-world"></i>${esc(o.web)}</div>` : '')}
      <div class="detail-contact-actions">${contactButtonsHtml(o)}</div>
    </div>` : ''}

    ${addr ? `<div class="dsec"><div class="dsec-title">Ubicación</div>
      <div class="drow"><i class="ti ti-map-pin"></i>${esc(addr)}</div>
      <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="link-maps">
        <i class="ti ti-external-link"></i>Abrir en Google Maps
      </a>
    </div>` : ''}

    ${detalleItemsHtml(o, 'oferta', !!mine)}
    ${(o.instalaciones || []).length ? `<div class="dsec"><div class="dsec-title">Instalaciones disponibles</div><div class="tags">${o.instalaciones.map(t => `<span class="tag tag-inst">${esc(t)}</span>`).join('')}</div></div>` : ''}
    ${detalleItemsHtml(o, 'necesidad', !!mine)}
    ${(o.needsCovered || []).length ? `<div class="dsec"><div class="dsec-title">Necesidades cubiertas con proveedores</div><div class="tags">${o.needsCovered.map(t => `<span class="tag tag-cov">${esc(t)}</span>`).join('')}</div></div>` : ''}

    ${mx.length ? `<div class="dsec"><div class="dsec-title">Vinculaciones posibles</div>
      ${mx.map(m => `<div class="match-card">
        <div class="match-label"><i class="ti ti-arrows-exchange"></i>puede cubrir su necesidad de <strong>${esc(m.categoria.nombre)}</strong> ${m.nivel === 'exacta' ? '<span class="match-strength match-strength--strong">Coincidencia exacta</span>' : '<span class="match-strength match-strength--weak">Misma categoría</span>'}</div>
        <div class="match-name" onclick="closeModal('modal-detalle');setTimeout(()=>openDetail(${m.ofrece.id}),80)">${esc(m.ofrece.nombre)}</div>
        <div class="muted-sm">${esc(m.ofrece.referente)}</div>
        ${m.pares.map(par => `<div class="match-detail">${esc(par.necesidad || 'Sin subcategoría')} ↔ <span class="match-highlight">${esc(par.oferta || 'Sin subcategoría')}</span></div>`).join('')}
        <div class="match-contact">${contactButtonsHtml(m.ofrece)}</div>
      </div>`).join('')}
    </div>` : ''}

    ${puedeSolicitar ? `<div class="dsec detail-edit-wrap">
      <button class="btn-prim" onclick="closeModal('modal-detalle');abrirSolicitud(${o.id})"><i class="ti ti-send"></i> Enviar solicitud a esta empresa</button>
    </div>` : ''}

    ${mine ? `<div class="dsec detail-edit-wrap">
      <button class="btn-edit-inline" onclick="startEdit(${o.id});closeModal('modal-detalle')"><i class="ti ti-pencil"></i> Editar esta empresa</button>
    </div>` : ''}
  `;
  $('modal-detalle').classList.add('open');
};

// Servicios/productos o necesidades en el detalle. Quien puede editar la
// empresa los agrega o quita ahí mismo, de a uno (sql/013).
function detalleItemsHtml(o: Empresa, tipo: ItemTipo, editable: boolean): string {
  const lista = itemsDe(o, tipo);
  if (!lista.length && !editable) return '';
  const titulo = tipo === 'oferta' ? 'Servicios y productos' : 'Necesidades sin cubrir';
  const cls = tipo === 'oferta' ? 'tag-offer' : 'tag-need';
  const tags = lista.map(t => `<span class="tag ${cls}">${esc(itemLabel(t))}${editable && t.id
    ? ` <button class="tag-quitar" onclick="detItemQuitar(${o.id},${t.id})" title="Quitar" aria-label="Quitar ${esc(itemLabel(t))}">×</button>` : ''}</span>`).join('');
  const form = editable ? `<div class="det-add">
      <select class="form-select" id="det-${tipo}-cat" onchange="detItemCategoria('${tipo}')" aria-label="Categoría">
        <option value="">Categoría…</option>${categorias.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}
      </select>
      <input class="form-input" id="det-${tipo}-sub" type="text" list="det-${tipo}-subs" maxlength="120" placeholder="Subcategoría (opcional)" aria-label="Subcategoría"
        onkeydown="if(event.key==='Enter'){event.preventDefault();detItemAgregar(${o.id},'${tipo}')}">
      <datalist id="det-${tipo}-subs"></datalist>
      <button class="btn-out" onclick="detItemAgregar(${o.id},'${tipo}')"><i class="ti ti-plus"></i> Agregar</button>
    </div><div class="form-msg" id="det-${tipo}-msg"></div>` : '';
  return `<div class="dsec"><div class="dsec-title">${titulo}</div>
    <div class="tags">${tags || `<span class="muted-sm">Todavía no hay ${tipo === 'oferta' ? 'servicios o productos' : 'necesidades'} cargados.</span>`}</div>${form}</div>`;
}

window.detItemCategoria = function (tipo) {
  const cat = categorias.find(c => c.id === Number($select(`det-${tipo}-cat`).value));
  $(`det-${tipo}-subs`).innerHTML = (cat?.subcategorias || []).map(x => `<option value="${esc(x)}">`).join('');
  $input(`det-${tipo}-sub`).placeholder = cat?.esOtros ? 'Describí qué es (obligatorio)' : 'Subcategoría (opcional)';
};

function detMsg(tipo: ItemTipo, t: string): void {
  const m = $(`det-${tipo}-msg`);
  m.textContent = t;
  m.className = 'form-msg err';
  m.style.display = 'block';
}

// Después de cambiar ítems: refresca datos, el detalle abierto y la pantalla de atrás.
async function refrescarTrasCambioItems(empresaId: number): Promise<void> {
  await refreshData();
  window.openDetail(empresaId);
  const activa = document.querySelector('.screen.active')?.id.replace('screen-', '');
  if (activa === 'directorio') window.renderDir();
  else if (activa === 'mis-empresas') window.renderMias();
  else if (activa === 'vinculacion') window.renderVin();
}

window.detItemAgregar = async function (empresaId, tipo) {
  const cat = categorias.find(c => c.id === Number($select(`det-${tipo}-cat`).value));
  const sub = $input(`det-${tipo}-sub`).value.trim().replace(/\s+/g, ' ');
  if (!cat) { detMsg(tipo, 'Elegí una categoría.'); return; }
  if (cat.esOtros && !sub) { detMsg(tipo, 'En "Otros" describí qué es en la subcategoría.'); return; }
  try {
    await Empresas.agregarItem(empresaId, tipo, cat.id, sub);
    await refrescarTrasCambioItems(empresaId);
  } catch (e) {
    detMsg(tipo, friendlyError(e));
  }
};

window.detItemQuitar = async function (empresaId, itemId) {
  const o = orgs.find(x => x.id === empresaId);
  const it = o?.items.find(i => i.id === itemId);
  if (!it || !confirm(`¿Quitar «${itemLabel(it)}»?`)) return;
  try {
    await Empresas.quitarItem(itemId);
    await refrescarTrasCambioItems(empresaId);
  } catch (e) {
    alert(friendlyError(e));
  }
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
  limpiarCambioClave();
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
    currentProfile = { ...currentProfile, ...updated, tel };
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
  const msg = $('pf-clave-msg');
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
    'f-tipo': o.tipo, 'f-cuit': o.cuit, 'f-nombre': o.nombre,
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
  tags.instalaciones = [...(o.instalaciones || [])];
  tags['needs-covered'] = [...(o.needsCovered || [])];
  (Object.keys(tags) as TagType[]).forEach(k => renderTags(k));
  formItems = (o.items || []).map(i => ({ ...i }));
  renderItemEditors();

  $('cuit-check').textContent = '';
  $('form-msg').style.display = 'none';
  window.showScreen('registrar');
  void cargarUbicacion(o);
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
  ['nombre', 'cuit', 'calle', 'ciudad', 'provincia', 'pais', 'referente', 'cargo', 'email-org', 'tel', 'web', 'desc'].forEach(id => {
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
  formItems = [];
  renderItemEditors();
  resetUbicacion();
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
  const editId = $input('f-edit-id').value;
  const digits = normCuit(cuitRaw);
  if (orgs.find(o => normCuit(o.cuit) === digits && String(o.id) !== editId)) {
    showFormMsg('Ya existe una empresa registrada con ese CUIT.', 'err'); return;
  }
  if (webRaw && !isValidUrl(webRaw)) { showFormMsg('El sitio web debe empezar con http:// o https://', 'err'); return; }
  const ubic = leerUbicacion();
  if ('error' in ubic) { showFormMsg(ubic.error, 'err'); return; }

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
      ...ubic.datos,
      calle: $input('f-calle').value.trim(),
      ciudad: $input('f-ciudad').value.trim(),
      pais: $input('f-pais').value.trim() || 'Argentina',
      referente: $input('f-referente').value.trim(),
      cargo: $input('f-cargo').value.trim(),
      emailOrg: $input('f-email-org').value.trim(),
      tel: $input('f-tel').value.trim(),
      web: webRaw,
      desc: $textarea('f-desc').value.trim(),
      logo: logoUrl || null,
      instalaciones: [...tags.instalaciones],
      needsCovered: [...tags['needs-covered']],
    };

    if (editId) {
      await Empresas.updateEmpresa(editId, data);
      await Empresas.guardarItems(Number(editId), formItems);
      showFormMsg('✓ Empresa actualizada y guardada correctamente.', 'ok');
    } else {
      const nueva = await Empresas.createEmpresa(currentProfile.id, data);
      try {
        await Empresas.guardarItems(nueva.id, formItems);
      } catch (e) {
        // La empresa ya quedó creada: no la duplicamos al reintentar.
        await refreshData();
        showFormMsg(`La empresa se registró, pero no se pudieron guardar sus ofertas/necesidades (${friendlyError(e)}). Editala desde "Mis empresas" para cargarlas de nuevo.`, 'err');
        setTimeout(() => resetForm(), 4000);
        return;
      }
      showFormMsg('✓ Empresa registrada y guardada correctamente. Podés verla en "Mis empresas".', 'ok');
    }

    limpiarCacheDirectorio();
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
// "Editar ubicación" abre el formulario de la empresa en la sección
// Ubicación (localidad oficial + calle + marcador), igual que al editar.
window.openEditUbicacion = function (id) {
  window.startEdit(id);
  setTimeout(() => document.getElementById('f-ciudad')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
};

// ══════════════════════════════════════════════
// VINCULACIÓN: ver ui-conexiones.ts (mis conexiones, toda la red, chat)
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// OFERTAS / NECESIDADES: categoría + subcategoría (formulario de empresa)
// ══════════════════════════════════════════════
const ITEM_TIPOS: ItemTipo[] = ['oferta', 'necesidad'];

function categoriaSeleccionada(tipo: ItemTipo): Categoria | undefined {
  const id = Number($select(`ie-${tipo}-cat`).value);
  return categorias.find(c => c.id === id);
}

function renderItemEditors(): void {
  for (const tipo of ITEM_TIPOS) {
    const sel = $select(`ie-${tipo}-cat`);
    const prev = sel.value;
    sel.innerHTML = categorias.length
      ? '<option value="">Elegí una categoría…</option>' + categorias.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')
      : '<option value="">No hay categorías cargadas</option>';
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    renderSugeridas(tipo);
    renderItemLista(tipo);
  }
}

function renderSugeridas(tipo: ItemTipo): void {
  const cat = categoriaSeleccionada(tipo);
  const input = $input(`ie-${tipo}-sub`);
  $(`ie-${tipo}-subs`).innerHTML = (cat?.subcategorias || []).map(s => `<option value="${esc(s)}">`).join('');
  input.placeholder = cat?.esOtros ? 'Describí qué es (obligatorio)' : 'Subcategoría (opcional)';
  $(`ie-${tipo}-sugeridas`).innerHTML = cat && cat.subcategorias.length
    ? cat.subcategorias.map((s, i) => `<button type="button" class="quick-tag-btn" onclick="itemSugerida('${tipo}',${i})">+ ${esc(s)}</button>`).join('')
    : '';
}

function renderItemLista(tipo: ItemTipo): void {
  const lista = $(`ie-${tipo}-lista`);
  const cls = tipo === 'oferta' ? 'rt-o' : 'rt-nu';
  const html = formItems.map((it, idx) => it.tipo !== tipo ? '' :
    `<span class="rtag ${cls}${it.revisar ? ' rtag-revisar' : ''}" title="${it.revisar ? 'Vino del formato anterior: revisá su categoría' : ''}">
      ${it.revisar ? '<i class="ti ti-alert-triangle"></i> ' : ''}${esc(itemLabel(it))}
      <span class="rtag-remove" onclick="itemQuitar(${idx})">×</span></span>`).join('');
  lista.innerHTML = html || `<span class="muted-sm">Todavía no agregaste ${tipo === 'oferta' ? 'servicios o productos' : 'necesidades'}.</span>`;
}

function agregarItem(tipo: ItemTipo, subRaw: string): void {
  const cat = categoriaSeleccionada(tipo);
  if (!cat) { showFormMsg('Elegí primero una categoría.', 'err'); return; }
  const sub = subRaw.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (cat.esOtros && !sub) { showFormMsg('En "Otros" describí qué es en el campo de subcategoría.', 'err'); return; }
  const dup = formItems.some(i => i.tipo === tipo && i.categoriaId === cat.id && normalizeTagKey(i.subcategoria) === normalizeTagKey(sub));
  if (!dup) formItems.push({ tipo, categoriaId: cat.id, subcategoria: sub, revisar: false });
  $('form-msg').style.display = 'none';
  renderItemLista(tipo);
}

window.itemCategoriaCambio = function (tipo) {
  renderSugeridas(tipo);
};

window.itemAgregar = function (tipo) {
  const input = $input(`ie-${tipo}-sub`);
  agregarItem(tipo, input.value);
  if (categoriaSeleccionada(tipo)) input.value = '';
};

window.itemSugerida = function (tipo, idx) {
  const cat = categoriaSeleccionada(tipo);
  const sub = cat?.subcategorias[idx];
  if (sub !== undefined) agregarItem(tipo, sub);
};

window.itemQuitar = function (idx) {
  const it = formItems[idx];
  if (!it) return;
  formItems.splice(idx, 1);
  renderItemLista(it.tipo);
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
window.renderAdmin = function () {
  if (!currentProfile || currentProfile.role !== 'admin') return;
  // Listas paginadas y filtros resueltos en la base: ver ui-admin.ts.
  renderAdminUI();
};

window.toggleWebmaster = async function (userId, valor) {
  const target = profiles.find(u => u.id === userId);
  const name = target ? `${target.nombre} ${target.apellido}`.trim() : 'este usuario';
  const msg = valor
    ? `¿Darle a "${name}" el permiso de webmaster? Podrá ver la bitácora y todas las conexiones (sin el contenido de los mensajes), administrar categorías y dar o quitar este permiso.`
    : `¿Quitarle a "${name}" el permiso de webmaster?`;
  if (!confirm(msg)) return;
  try {
    await Webmaster.setWebmaster(userId, valor);
    await refreshData();
    window.renderAdmin();
  } catch (e) {
    alert(friendlyError(e));
  }
};

window.toggleUserRole = async function (userId, newRole) {
  const target = profiles.find(u => u.id === userId);
  const name = target ? `${target.nombre} ${target.apellido}`.trim() : 'este usuario';
  const action = newRole === 'admin'
    ? `¿Convertir a "${name}" en administrador?`
    : `¿Quitarle el rol de administrador a "${name}"?${target?.is_webmaster ? ' También va a perder el permiso de webmaster.' : ''}`;
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
  const problemaClave = pass ? validarClave(pass) : null;
  if (problemaClave) {
    msg.textContent = problemaClave; msg.className = 'form-msg err'; msg.style.display = 'block'; return;
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
