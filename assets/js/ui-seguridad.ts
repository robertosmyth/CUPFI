// ══════════════════════════════════════════════
// UI de seguridad y privacidad: requisitos de contraseña en vivo, cambio de
// contraseña con sesión iniciada, aviso de contraseña temporal, cierre de
// sesión por inactividad y aviso de privacidad.
// ══════════════════════════════════════════════
import * as Auth from './auth.ts';
import { fuerzaClave, requisitosClave, validarClave, vigilarInactividad } from './seguridad.ts';
import { friendlyError } from './utils.ts';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $input = (id: string) => document.getElementById(id) as HTMLInputElement;

declare global {
  interface Window {
    abrirPrivacidad: () => void;
    cerrarPrivacidad: () => void;
    abrirCambioClave: () => void;
    ocultarAvisoClave: () => void;
    cambiarClavePropia: () => Promise<void>;
    seguirConectado: () => void;
    irAlContenido: () => void;
  }
}

// ── Requisitos de contraseña mientras se escribe ──
function pintarRequisitos(caja: HTMLElement, clave: string): void {
  const f = fuerzaClave(clave);
  const reqs = requisitosClave(clave);
  caja.innerHTML = `
    <div class="clave-fuerza" aria-hidden="${clave ? 'false' : 'true'}">
      <div class="clave-barra"><span class="nivel-${f.nivel}"></span></div>
      <span class="clave-fuerza-txt">${clave ? 'Seguridad: ' + f.texto : ''}</span>
    </div>
    <ul class="clave-lista">
      ${reqs.map(r => `<li class="${r.ok ? 'ok' : ''}"><i class="ti ${r.ok ? 'ti-circle-check' : 'ti-circle'}" aria-hidden="true"></i>${r.texto}<span class="sr-only">${r.ok ? ': cumplido' : ': falta'}</span></li>`).join('')}
    </ul>`;
}

export function initIndicadoresClave(): void {
  document.querySelectorAll<HTMLElement>('[data-clave-para]').forEach(caja => {
    const inp = document.getElementById(caja.dataset.clavePara || '') as HTMLInputElement | null;
    if (!inp) return;
    pintarRequisitos(caja, '');
    inp.addEventListener('input', () => pintarRequisitos(caja, inp.value));
  });
}

export function limpiarIndicador(inputId: string): void {
  const caja = document.querySelector<HTMLElement>(`[data-clave-para="${inputId}"]`);
  if (caja) pintarRequisitos(caja, '');
}

// ── Mensajes de formulario ──
function msg(id: string, texto: string, tipo: 'ok' | 'err'): void {
  const el = $(id);
  el.textContent = texto;
  el.className = 'form-msg ' + tipo;
  el.style.display = 'block';
}

// ── Cambio de contraseña con la sesión iniciada ──
let emailActual: () => string | null = () => null;

window.cambiarClavePropia = async function () {
  const actual = $input('pf-clave-actual').value;
  const nueva = $input('pf-clave-nueva').value;
  const nueva2 = $input('pf-clave-nueva2').value;
  const email = emailActual();
  if (!actual) { msg('pf-clave-msg', 'Ingresá tu contraseña actual.', 'err'); return; }
  const problema = validarClave(nueva);
  if (problema) { msg('pf-clave-msg', problema, 'err'); return; }
  if (nueva !== nueva2) { msg('pf-clave-msg', 'Las contraseñas nuevas no coinciden.', 'err'); return; }
  if (nueva === actual) { msg('pf-clave-msg', 'La contraseña nueva tiene que ser distinta de la actual.', 'err'); return; }
  if (!email) return;
  const btn = $('pf-clave-btn') as HTMLButtonElement;
  btn.disabled = true;
  try {
    await Auth.cambiarClave(email, actual, nueva);
    ['pf-clave-actual', 'pf-clave-nueva', 'pf-clave-nueva2'].forEach(id => { $input(id).value = ''; });
    limpiarIndicador('pf-clave-nueva');
    msg('pf-clave-msg', '✓ Contraseña cambiada. La próxima vez ingresá con la nueva.', 'ok');
    window.ocultarAvisoClave();
  } catch (e) {
    msg('pf-clave-msg', friendlyError(e), 'err');
  } finally {
    btn.disabled = false;
  }
};

export function limpiarCambioClave(): void {
  ['pf-clave-actual', 'pf-clave-nueva', 'pf-clave-nueva2'].forEach(id => { const i = document.getElementById(id) as HTMLInputElement | null; if (i) i.value = ''; });
  const m = document.getElementById('pf-clave-msg');
  if (m) { m.textContent = ''; m.style.display = 'none'; }
  limpiarIndicador('pf-clave-nueva');
}

// ── Aviso de contraseña temporal ──
window.ocultarAvisoClave = function () {
  $('aviso-clave').classList.add('hidden');
};
window.abrirCambioClave = function () {
  window.openEditProfile();
  requestAnimationFrame(() => {
    $('pf-clave-titulo').scrollIntoView({ block: 'start', behavior: 'smooth' });
    $input('pf-clave-actual').focus({ preventScroll: true });
  });
};
export async function revisarClaveTemporal(): Promise<void> {
  $('aviso-clave').classList.toggle('hidden', !(await Auth.tieneClaveTemporal()));
}

// ── Aviso de privacidad ──
window.abrirPrivacidad = function () { $('modal-privacidad').classList.add('open'); };
window.cerrarPrivacidad = function () { $('modal-privacidad').classList.remove('open'); };

window.irAlContenido = function () {
  const destino = $('main-app').style.display === 'block' ? $('contenido') : $('auth-wrap');
  destino.setAttribute('tabindex', '-1');
  destino.focus();
};

// ── Cierre por inactividad ──
let vigilancia: { detener: () => void; seguir: () => void } | null = null;

// En la copia local de pruebas se puede acortar el tiempo (nunca en el sitio publicado).
function tiempoDePrueba(): number | undefined {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return undefined;
  try { return Number(localStorage.getItem('cupfi_test_inactividad_ms')) || undefined; } catch { return undefined; }
}

window.seguirConectado = function () {
  $('modal-inactividad').classList.remove('open');
  vigilancia?.seguir();
};

export function iniciarSeguridadSesion(opts: { email: () => string | null; cerrarSesion: () => Promise<void> }): void {
  emailActual = opts.email;
  detenerSeguridadSesion();
  const limite = tiempoDePrueba();
  vigilancia = vigilarInactividad({
    limiteMs: limite,
    avisoMs: limite ? Math.min(60_000, Math.floor(limite / 2)) : undefined,
    onAviso: seg => {
      $('inactividad-seg').textContent = String(seg);
      const m = $('modal-inactividad');
      if (!m.classList.contains('open')) m.classList.add('open');
    },
    onSigue: () => $('modal-inactividad').classList.remove('open'),
    onVencida: () => {
      $('modal-inactividad').classList.remove('open');
      vigilancia = null;
      opts.cerrarSesion().catch(e => console.error('No se pudo cerrar la sesión:', e));
    },
  });
}

export function detenerSeguridadSesion(): void {
  vigilancia?.detener();
  vigilancia = null;
  document.getElementById('modal-inactividad')?.classList.remove('open');
  document.getElementById('aviso-clave')?.classList.add('hidden');
}
