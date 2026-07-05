// ══════════════════════════════════════════════
// CUPFI · Red de Vinculación Empresarial FI-UNLZ
// App principal: conecta la UI con Supabase (auth real + datos reales)
// ══════════════════════════════════════════════
import * as Auth from './auth.js';
import * as Empresas from './empresas.js';
import { allMatches, findMatchesFor, countMatches } from './matching.js';
import { esc, ini, normCuit, isValidCuit, isValidEmail, buildAddress, friendlyError } from './utils.js';

// ══════════════════════════════════════════════
// ESTADO GLOBAL (en memoria; los datos reales viven en Supabase)
// ══════════════════════════════════════════════
const tags = { ofertas: [], instalaciones: [], 'needs-uncovered': [], 'needs-covered': [] };
const tagCls = { ofertas: 'rt-o', instalaciones: 'rt-i', 'needs-uncovered': 'rt-nu', 'needs-covered': 'rt-nc' };
let activeFilter = 'todos';
let currentProfile = null;
let orgs = [];
let profiles = [];
let editingId = null;
let currentLogoFile = null; // File real seleccionado (se sube recién al guardar)
let currentLogoUrl = null;  // URL ya existente (modo edición) o recién subida

// Mapa
let leafletMap = null;
let mapMarkers = [];
let leafletReady = false;

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

async function init() {
  const session = await Auth.getSession();
  if (session) {
    await enterApp();
  } else {
    showAuthScreen();
  }
  Auth.onAuthStateChange(async (session) => {
    if (session && !currentProfile) {
      await enterApp();
    } else if (!session && currentProfile) {
      currentProfile = null;
      showAuthScreen();
    }
  }).catch(e => console.error('No se pudo suscribir a cambios de sesión:', e));
}

function wireStaticEvents() {
  document.getElementById('modal-detalle').addEventListener('click', function (e) {
    if (e.target === this) closeModal('modal-detalle');
  });
  document.getElementById('modal-ubicacion').addEventListener('click', function (e) {
    if (e.target === this) closeModal('modal-ubicacion');
  });
}

// ══════════════════════════════════════════════
// AUTH UI
// ══════════════════════════════════════════════
window.authTab = function (t) {
  document.querySelectorAll('.auth-tab').forEach((el, i) => el.classList.toggle('active', ['login', 'registro'][i] === t));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('af-' + t).classList.add('active');
};

window.doLogin = async function () {
  const email = document.getElementById('l-email').value.trim().toLowerCase();
  const pass = document.getElementById('l-pass').value;
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
  const nombre = document.getElementById('r-nombre').value.trim();
  const apellido = document.getElementById('r-apellido').value.trim();
  const email = document.getElementById('r-email').value.trim().toLowerCase();
  const tel = document.getElementById('r-tel').value.trim();
  const pass = document.getElementById('r-pass').value;
  const pass2 = document.getElementById('r-pass2').value;
  if (!nombre || !apellido) { showAuthMsg('r-msg', 'Nombre y apellido son obligatorios.', 'err'); return; }
  if (!email || !isValidEmail(email)) { showAuthMsg('r-msg', 'Ingresá un email válido.', 'err'); return; }
  if (!tel) { showAuthMsg('r-msg', 'El teléfono móvil es obligatorio.', 'err'); return; }
  if (!pass || pass.length < 6) { showAuthMsg('r-msg', 'La contraseña debe tener al menos 6 caracteres.', 'err'); return; }
  if (pass !== pass2) { showAuthMsg('r-msg', 'Las contraseñas no coinciden.', 'err'); return; }

  setBusy('r-btn', true);
  try {
    const data = await Auth.signUp({ nombre, apellido, email, tel, password: pass });
    if (data.session) {
      await enterApp();
    } else {
      showAuthMsg('r-msg', '✓ Cuenta creada. Revisá tu email para confirmar la cuenta antes de iniciar sesión.', 'ok');
      authTab('login');
    }
  } catch (e) {
    showAuthMsg('r-msg', friendlyError(e), 'err');
  } finally {
    setBusy('r-btn', false);
  }
};

window.doLogout = async function () {
  if (leafletMap) { leafletMap.remove(); leafletMap = null; mapMarkers = []; leafletReady = false; }
  await Auth.signOut();
  currentProfile = null;
  showAuthScreen();
};

function setBusy(btnId, busy) {
  const btn = document.getElementById(btnId);
  if (btn) btn.disabled = busy;
}

function showAuthMsg(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg; el.style.display = 'block';
  el.style.color = type === 'err' ? '#c62828' : '#2e7d32';
}

function showAuthScreen() {
  document.getElementById('auth-wrap').style.display = 'flex';
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('l-pass').value = '';
}

async function enterApp() {
  try {
    currentProfile = await Auth.getCurrentProfile();
  } catch (e) {
    showAuthMsg('l-msg', friendlyError(e), 'err');
    return;
  }
  document.getElementById('auth-wrap').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  document.getElementById('user-name-pill').textContent = currentProfile.nombre || currentProfile.email;
  const isAdmin = currentProfile.role === 'admin';
  document.getElementById('admin-tab-btn').classList.toggle('hidden', !isAdmin);
  document.getElementById('admin-badge').classList.toggle('hidden', !isAdmin);

  await refreshData();
  showScreen('directorio');
}

async function refreshData() {
  const [e, p] = await Promise.all([Empresas.listEmpresas(), Auth.listProfiles()]);
  orgs = e;
  profiles = p;
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════
function getProfileById(uid) { return profiles.find(u => u.id === uid); }

// Clases de tamaño (ver assets/css/style.css): 42px es el tamaño por
// defecto de .avatar/.org-logo-img, así que solo hace falta un modificador
// cuando el tamaño pedido es distinto.
function sizeClass(size) {
  if (size >= 56) return 'sz-56';
  if (size >= 38 && size < 42) return 'sz-38';
  if (size <= 30) return 'sz-30';
  return '';
}

function logoOrAvatar(o, size = 42) {
  const sc = sizeClass(size);
  if (o.logo) {
    return `<img src="${esc(o.logo)}" class="org-logo-img ${sc}" alt="logo de ${esc(o.nombre)}">`;
  }
  return `<div class="avatar ${sc}">${esc(ini(o.nombre))}</div>`;
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
  if (name === 'directorio') renderDir();
  if (name === 'graduados') renderGraduados();
  if (name === 'vinculacion') renderVin();
  if (name === 'mapa') renderMapa();
  if (name === 'mis-empresas') renderMias();
  if (name === 'registrar') { if (!editingId) prefillUser(); }
  if (name === 'admin') renderAdmin();
};

window.setFilter = function (el, val) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active'); activeFilter = val; renderDir();
};

function prefillUser() {
  if (!currentProfile || editingId) return;
  const r = document.getElementById('f-referente');
  if (r && !r.value) r.value = `${currentProfile.nombre} ${currentProfile.apellido}`.trim();
  const e = document.getElementById('f-email-org');
  if (e && !e.value) e.value = currentProfile.email || '';
  const p = document.getElementById('f-pais');
  if (p && !p.value) p.value = 'Argentina';
}

// ══════════════════════════════════════════════
// DIRECTORIO EMPRESAS
// ══════════════════════════════════════════════
window.renderDir = function () {
  const q = (document.getElementById('search-input').value || '').toLowerCase();
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

  document.getElementById('stat-total').textContent = orgs.length;
  document.getElementById('stat-users').textContent = profiles.filter(u => u.role !== 'admin').length;
  document.getElementById('stat-sectores').textContent = new Set(orgs.map(o => o.sector).filter(Boolean)).size;
  document.getElementById('stat-matches').textContent = countMatches(orgs);
  document.getElementById('dir-count').textContent = filtered.length;

  const grid = document.getElementById('org-grid');
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty empty--full"><i class="ti ti-building-off"></i>Sin resultados para ese criterio.</div>';
    return;
  }
  grid.innerHTML = filtered.map(o => {
    const mine = currentProfile && o.uid === currentProfile.id;
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
  }).join('');
};

// ══════════════════════════════════════════════
// DIRECTORIO GRADUADOS
// ══════════════════════════════════════════════
window.renderGraduados = function () {
  const q = (document.getElementById('search-grad').value || '').toLowerCase();
  const visible = profiles.filter(u => u.role !== 'admin');
  const filtered = visible.filter(u => {
    if (!q) return true;
    const uOrgs = orgs.filter(o => o.uid === u.id).map(o => o.nombre).join(' ');
    return [u.nombre, u.apellido, u.email, uOrgs].join(' ').toLowerCase().includes(q);
  });

  document.getElementById('grad-count').textContent = filtered.length;
  const grid = document.getElementById('grad-grid');
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty empty--full"><i class="ti ti-users-off"></i>Sin resultados.</div>';
    return;
  }
  grid.innerHTML = filtered.map(u => {
    const uOrgs = orgs.filter(o => o.uid === u.id);
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
async function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script'); s.src = src;
    s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
  });
}
async function loadCSS(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}

async function geocodeAddress(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=ar`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    const data = await res.json();
    if (data && data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) { /* silencioso: si falla el geocoder, simplemente no se ubica ese punto */ }
  return null;
}

window.renderMapa = async function () {
  const withLoc = orgs.filter(o => o.ciudad || o.provincia);
  document.getElementById('map-count').textContent = withLoc.length;

  if (!leafletReady) {
    await loadCSS('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
    await new Promise(r => setTimeout(r, 300));
    leafletReady = true;
  }

  if (!leafletMap) {
    leafletMap = L.map('gmap').setView([-38.5, -63.5], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(leafletMap);
  }

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

  for (const o of withLoc.slice()) {
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

    const marker = L.marker([coords.lat, coords.lng], { icon: makeIcon() }).addTo(leafletMap);
    marker.bindPopup(popupHtml, { maxWidth: 260, closeButton: true });
    mapMarkers.push(marker);
  }

  if (mapMarkers.length > 0) {
    const group = L.featureGroup(mapMarkers);
    leafletMap.fitBounds(group.getBounds().pad(0.2));
  }
};

window._openDetail = function (id) {
  if (leafletMap) leafletMap.closePopup();
  openDetail(id);
};

// ══════════════════════════════════════════════
// MIS EMPRESAS
// ══════════════════════════════════════════════
window.renderMias = function () {
  if (!currentProfile) return;
  const mine = orgs.filter(o => o.uid === currentProfile.id);
  document.getElementById('mis-count').textContent = mine.length;
  const grid = document.getElementById('mis-grid');
  if (!mine.length) {
    grid.innerHTML = `<div class="empty empty--full">
      <i class="ti ti-building-plus"></i>
      Todavía no registraste ninguna empresa.<br><br>
      <button class="btn-prim" onclick="showScreen('registrar')">Agregar empresa</button>
    </div>`;
    return;
  }
  grid.innerHTML = mine.map(o => `
    <div class="org-card mine" onclick="openDetail(${o.id})">
      <div class="mine-badge"><i class="ti ti-star"></i>Mi empresa</div>
      <div class="card-head">${logoOrAvatar(o)}
        <div><div class="card-org-name">${esc(o.nombre)}</div><div class="card-ref">${esc(o.referente)} · ${esc(o.cargo)}</div></div>
      </div>
      <div class="card-sector">${esc(o.sector)}</div>
      <div class="card-meta">CUIT: ${esc(o.cuit)}</div>
      ${o.ciudad ? `<div class="card-meta"><i class="ti ti-map-pin"></i>${esc(o.ciudad)}</div>` : ''}
      <div class="tags">
        ${(o.ofertas || []).slice(0, 2).map(t => `<span class="tag tag-offer">${esc(t)}</span>`).join('')}
        ${(o.needsUncovered || []).slice(0, 1).map(t => `<span class="tag tag-need">${esc(t)}</span>`).join('')}
      </div>
    </div>`).join('');
};

// ══════════════════════════════════════════════
// DETALLE DE EMPRESA
// ══════════════════════════════════════════════
window.openDetail = function (id) {
  const o = orgs.find(x => x.id === id);
  if (!o) return;
  const mx = findMatchesFor(orgs, o);
  const mine = currentProfile && (o.uid === currentProfile.id || currentProfile.role === 'admin');
  const addr = buildAddress(o);
  const u = getProfileById(o.uid);
  const mapsUrl = addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : '';

  document.getElementById('md-title').textContent = o.nombre;
  document.getElementById('modal-body').innerHTML = `
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
      ${mx.map(m => `<div class="match-card" onclick="closeModal('modal-detalle');setTimeout(()=>openDetail(${m.org.id}),80)">
        <div class="match-label"><i class="ti ti-arrows-exchange"></i>puede cubrir su necesidad</div>
        <div class="match-name">${esc(m.org.nombre)}</div>
        <div class="muted-sm">${esc(m.org.referente)}</div>
        <div class="match-detail">${esc(m.need)} → <span class="match-highlight">${esc(m.offer)}</span></div>
      </div>`).join('')}
    </div>` : ''}

    ${mine ? `<div class="dsec detail-edit-wrap">
      <button class="btn-edit-inline" onclick="startEdit(${o.id});closeModal('modal-detalle')"><i class="ti ti-pencil"></i> Editar esta empresa</button>
    </div>` : ''}
  `;
  document.getElementById('modal-detalle').classList.add('open');
};

window.closeModal = function (id) {
  document.getElementById(id).classList.remove('open');
};

// ══════════════════════════════════════════════
// LOGO (archivo real; se sube a Supabase Storage al guardar)
// ══════════════════════════════════════════════
window.previewLogo = function () {
  const file = document.getElementById('f-logo').files[0];
  if (!file) return;
  try {
    Empresas.validateLogoFile(file);
  } catch (e) {
    alert(e.message);
    document.getElementById('f-logo').value = '';
    return;
  }
  currentLogoFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = document.getElementById('logo-preview-img');
    img.src = ev.target.result;
    img.classList.remove('hidden');
    document.getElementById('logo-clear-btn').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
};

window.clearLogo = function () {
  currentLogoFile = null;
  currentLogoUrl = null;
  document.getElementById('f-logo').value = '';
  const img = document.getElementById('logo-preview-img');
  img.src = ''; img.classList.add('hidden');
  document.getElementById('logo-clear-btn').classList.add('hidden');
};

// ══════════════════════════════════════════════
// CUIT CHECK (chequeo rápido en cliente; la unicidad real la
// garantiza la restricción UNIQUE en la base de datos)
// ══════════════════════════════════════════════
window.checkCuit = function () {
  const raw = document.getElementById('f-cuit').value.trim();
  const el = document.getElementById('cuit-check');
  if (!raw) { el.textContent = ''; return; }
  const digits = normCuit(raw);
  if (digits.length < 10) { el.textContent = ''; return; }
  const editId = document.getElementById('f-edit-id').value;
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

  editingId = id;
  currentLogoFile = null;
  currentLogoUrl = o.logo || null;

  document.getElementById('f-edit-id').value = id;
  document.getElementById('form-screen-title').textContent = 'Editar empresa';
  document.getElementById('form-btn-label').textContent = 'Guardar cambios';

  const fields = {
    'f-tipo': o.tipo, 'f-cuit': o.cuit, 'f-nombre': o.nombre, 'f-sector': o.sector,
    'f-email-org': o.emailOrg, 'f-tel': o.tel, 'f-web': o.web,
    'f-calle': o.calle, 'f-ciudad': o.ciudad, 'f-provincia': o.provincia, 'f-pais': o.pais,
    'f-referente': o.referente, 'f-cargo': o.cargo, 'f-desc': o.desc,
  };
  Object.entries(fields).forEach(([k, v]) => { const el = document.getElementById(k); if (el) el.value = v || ''; });

  const img = document.getElementById('logo-preview-img');
  const clr = document.getElementById('logo-clear-btn');
  if (o.logo) { img.src = o.logo; img.classList.remove('hidden'); clr.classList.remove('hidden'); }
  else { img.src = ''; img.classList.add('hidden'); clr.classList.add('hidden'); }
  document.getElementById('f-logo').value = '';

  Object.keys(tags).forEach(k => { tags[k] = []; });
  tags.ofertas = [...(o.ofertas || [])];
  tags.instalaciones = [...(o.instalaciones || [])];
  tags['needs-uncovered'] = [...(o.needsUncovered || [])];
  tags['needs-covered'] = [...(o.needsCovered || [])];
  Object.keys(tags).forEach(k => renderTags(k));

  document.getElementById('cuit-check').textContent = '';
  document.getElementById('form-msg').style.display = 'none';
  showScreen('registrar');
};

window.cancelEdit = function () {
  editingId = null;
  currentLogoFile = null;
  currentLogoUrl = null;
  document.getElementById('f-edit-id').value = '';
  document.getElementById('form-screen-title').textContent = 'Agregar empresa u organización';
  document.getElementById('form-btn-label').textContent = 'Registrar empresa';
  resetForm();
};

function resetForm() {
  ['nombre', 'cuit', 'sector', 'calle', 'ciudad', 'provincia', 'pais', 'referente', 'cargo', 'email-org', 'tel', 'web', 'desc'].forEach(id => {
    const el = document.getElementById('f-' + id); if (el) el.value = '';
  });
  document.getElementById('f-tipo').value = 'Empresa';
  document.getElementById('f-logo').value = '';
  const img = document.getElementById('logo-preview-img');
  img.src = ''; img.classList.add('hidden');
  document.getElementById('logo-clear-btn').classList.add('hidden');
  document.getElementById('cuit-check').textContent = '';
  currentLogoFile = null;
  currentLogoUrl = null;
  Object.keys(tags).forEach(k => { tags[k] = []; renderTags(k); });
  document.getElementById('form-msg').style.display = 'none';
}

// ══════════════════════════════════════════════
// GUARDAR EMPRESA (Supabase real)
// ══════════════════════════════════════════════
window.guardarOrg = async function () {
  if (!currentProfile) { showFormMsg('Debés iniciar sesión.', 'err'); return; }

  const nombre = document.getElementById('f-nombre').value.trim();
  const cuitRaw = document.getElementById('f-cuit').value.trim();

  if (!nombre) { showFormMsg('El nombre de la organización es obligatorio.', 'err'); return; }
  if (!cuitRaw) { showFormMsg('El CUIT es obligatorio.', 'err'); return; }
  if (!isValidCuit(cuitRaw)) { showFormMsg('El CUIT debe tener 11 dígitos.', 'err'); return; }

  const editId = document.getElementById('f-edit-id').value;
  const digits = normCuit(cuitRaw);
  if (orgs.find(o => normCuit(o.cuit) === digits && String(o.id) !== editId)) {
    showFormMsg('Ya existe una empresa registrada con ese CUIT.', 'err'); return;
  }

  const submitBtn = document.getElementById('form-submit-btn');
  submitBtn.disabled = true;
  try {
    let logoUrl = currentLogoUrl;
    if (currentLogoFile) {
      showFormMsg('Subiendo logo…', 'ok');
      logoUrl = await Empresas.uploadLogo(currentLogoFile, currentProfile.id);
    }

    const data = {
      cuit: cuitRaw,
      tipo: document.getElementById('f-tipo').value,
      nombre,
      sector: document.getElementById('f-sector').value.trim(),
      calle: document.getElementById('f-calle').value.trim(),
      ciudad: document.getElementById('f-ciudad').value.trim(),
      provincia: document.getElementById('f-provincia').value.trim(),
      pais: document.getElementById('f-pais').value.trim() || 'Argentina',
      referente: document.getElementById('f-referente').value.trim(),
      cargo: document.getElementById('f-cargo').value.trim(),
      emailOrg: document.getElementById('f-email-org').value.trim(),
      tel: document.getElementById('f-tel').value.trim(),
      web: document.getElementById('f-web').value.trim(),
      desc: document.getElementById('f-desc').value.trim(),
      logo: logoUrl || null,
      ofertas: [...tags.ofertas],
      instalaciones: [...tags.instalaciones],
      needsUncovered: [...tags['needs-uncovered']],
      needsCovered: [...tags['needs-covered']],
    };

    if (editId) {
      await Empresas.updateEmpresa(editId, data);
      showFormMsg('✓ Empresa actualizada y guardada correctamente.', 'ok');
      editingId = null;
      document.getElementById('f-edit-id').value = '';
      document.getElementById('form-screen-title').textContent = 'Agregar empresa u organización';
      document.getElementById('form-btn-label').textContent = 'Registrar empresa';
    } else {
      await Empresas.createEmpresa(currentProfile.id, data);
      showFormMsg('✓ Empresa registrada y guardada correctamente. Podés verla en "Mis empresas".', 'ok');
    }

    await refreshData();
    resetForm();
  } catch (e) {
    showFormMsg(friendlyError(e), 'err');
  } finally {
    submitBtn.disabled = false;
  }
};

function showFormMsg(msg, type) {
  const el = document.getElementById('form-msg');
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
  document.getElementById('ub-id').value = id;
  document.getElementById('ub-calle').value = o.calle || '';
  document.getElementById('ub-ciudad').value = o.ciudad || '';
  document.getElementById('ub-provincia').value = o.provincia || '';
  document.getElementById('ub-pais').value = o.pais || 'Argentina';
  document.getElementById('ub-msg').style.display = 'none';
  document.getElementById('modal-ub-title').textContent = 'Ubicación: ' + o.nombre;
  document.getElementById('modal-ubicacion').classList.add('open');
};

window.guardarUbicacion = async function () {
  const id = parseInt(document.getElementById('ub-id').value, 10);
  const payload = {
    calle: document.getElementById('ub-calle').value.trim(),
    ciudad: document.getElementById('ub-ciudad').value.trim(),
    provincia: document.getElementById('ub-provincia').value.trim(),
    pais: document.getElementById('ub-pais').value.trim() || 'Argentina',
  };
  const msg = document.getElementById('ub-msg');
  try {
    await Empresas.updateEmpresa(id, payload);
    await refreshData();
    if (leafletMap) { leafletMap.remove(); leafletMap = null; mapMarkers = []; }
    msg.textContent = '✓ Ubicación guardada.';
    msg.className = 'form-msg ok';
    msg.style.display = 'block';
    renderAdmin();
    setTimeout(() => closeModal('modal-ubicacion'), 1200);
  } catch (e) {
    msg.textContent = friendlyError(e);
    msg.className = 'form-msg err';
    msg.style.display = 'block';
  }
};

// ══════════════════════════════════════════════
// VINCULACIÓN
// ══════════════════════════════════════════════
window.renderVin = function () {
  const ms = allMatches(orgs);
  document.getElementById('vin-count').textContent = ms.length;
  const list = document.getElementById('vin-list');
  if (!ms.length) {
    list.innerHTML = '<div class="empty"><i class="ti ti-arrows-exchange"></i>No se detectaron vinculaciones aún.<br>Registrá organizaciones con servicios y necesidades para que el sistema las cruce.</div>';
    return;
  }
  list.innerHTML = ms.map(m => `
    <div class="vin-row"><div class="vc">
      <div>
        <div class="vc-label">necesita</div>
        <div class="vc-name" onclick="openDetail(${m.seeker.id})">${esc(m.seeker.nombre)}</div>
        <div class="vc-ref">${esc(m.seeker.referente)}</div>
        <span class="tag tag-need tag-block">${esc(m.need)}</span>
      </div>
      <div class="vc-arrow"><i class="ti ti-arrow-right"></i></div>
      <div>
        <div class="vc-label">puede proveer</div>
        <div class="vc-name" onclick="openDetail(${m.provider.id})">${esc(m.provider.nombre)}</div>
        <div class="vc-ref">${esc(m.provider.referente)}</div>
        <span class="tag tag-offer tag-block">${esc(m.offer)}</span>
      </div>
    </div></div>`).join('');
};

// ══════════════════════════════════════════════
// TAGS
// ══════════════════════════════════════════════
window.addTag = function (event, type) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const inp = document.getElementById('input-' + type);
  const val = inp.value.trim();
  if (!val) return;
  tags[type].push(val);
  inp.value = '';
  renderTags(type);
};

window.removeTag = function (type, idx) {
  tags[type].splice(idx, 1);
  renderTags(type);
};

function renderTags(type) {
  const wrap = document.getElementById('wrap-' + type);
  const inp = document.getElementById('input-' + type);
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

  document.getElementById('admin-orgs-body').innerHTML = orgs.map(o => `
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
        <button class="btn-danger" onclick="deleteOrg(${o.id})" title="Eliminar empresa"><i class="ti ti-trash"></i></button>
      </div></td>
    </tr>`).join('');

  const uq = (document.getElementById('admin-search-users').value || '').toLowerCase();
  const filteredUsers = profiles.filter(u => {
    if (!uq) return true;
    return [u.nombre, u.apellido, u.email, u.tel].join(' ').toLowerCase().includes(uq);
  });
  document.getElementById('admin-users-count').textContent = filteredUsers.length;

  document.getElementById('admin-users-body').innerHTML = filteredUsers.map(u => {
    const isSelf = u.id === currentProfile.id;
    const isAdmin = u.role === 'admin';
    return `
    <tr>
      <td><strong>${esc(u.nombre + ' ' + (u.apellido || ''))}</strong>${isSelf ? ' <span class="badge-self">Vos</span>' : ''}</td>
      <td class="td-sm">${esc(u.email || '—')}</td>
      <td class="td-sm">${esc(u.tel || '—')}</td>
      <td class="td-sm">${orgs.filter(o => o.uid === u.id).length}</td>
      <td><span class="role-badge ${isAdmin ? 'role-badge--admin' : 'role-badge--user'}">${isAdmin ? 'Admin' : 'Usuario'}</span></td>
      <td>${isSelf
        ? '<span class="muted-sm">No podés cambiar tu propio rol</span>'
        : `<button class="btn-out" onclick="toggleUserRole('${u.id}','${isAdmin ? 'user' : 'admin'}')">${isAdmin ? 'Quitar admin' : 'Hacer admin'}</button>`}</td>
    </tr>`;
  }).join('');

  if (!filteredUsers.length) {
    document.getElementById('admin-users-body').innerHTML = '<tr><td colspan="6" class="empty">Sin resultados para ese criterio.</td></tr>';
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
    renderAdmin();
  } catch (e) {
    alert(friendlyError(e));
  }
};

window.deleteOrg = async function (id) {
  if (!confirm('¿Eliminar esta empresa definitivamente?')) return;
  try {
    await Empresas.deleteEmpresa(id);
    await refreshData();
    renderAdmin();
  } catch (e) {
    alert(friendlyError(e));
  }
};
