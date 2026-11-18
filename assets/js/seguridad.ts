// ══════════════════════════════════════════════
// SEGURIDAD: política de contraseñas y cierre por inactividad
// (ISO/IEC 27002 controles 5.17 "información de autenticación" y 8.5
// "autenticación segura"; OWASP ASVS V2).
// ══════════════════════════════════════════════

export const CLAVE_MIN = 8;
// bcrypt (lo que usa Supabase Auth) ignora lo que pase de 72 bytes.
export const CLAVE_MAX = 72;

export interface RequisitoClave { id: string; texto: string; ok: boolean }

// Cada requisito por separado, para mostrar la lista con ✓ mientras se escribe.
export function requisitosClave(clave: string): RequisitoClave[] {
  const c = clave || '';
  return [
    { id: 'largo', texto: `Al menos ${CLAVE_MIN} caracteres`, ok: c.length >= CLAVE_MIN },
    { id: 'mayus', texto: 'Una mayúscula', ok: /\p{Lu}/u.test(c) },
    { id: 'minus', texto: 'Una minúscula', ok: /\p{Ll}/u.test(c) },
    { id: 'numero', texto: 'Un número', ok: /\d/.test(c) },
    { id: 'simbolo', texto: 'Un símbolo (por ejemplo ! ? # $ % & *)', ok: /[^\p{L}\d\s]/u.test(c) },
  ];
}

// Devuelve el motivo por el que la contraseña no sirve, o null si cumple.
export function validarClave(clave: string): string | null {
  const c = clave || '';
  if (!c) return 'Ingresá una contraseña.';
  if (new TextEncoder().encode(c).length > CLAVE_MAX) return `La contraseña no puede superar los ${CLAVE_MAX} caracteres.`;
  if (c !== c.trim()) return 'La contraseña no puede empezar ni terminar con espacios.';
  const faltan = requisitosClave(c).filter(r => !r.ok).map(r => r.texto.toLowerCase().replace(/ \(.*\)$/, ''));
  if (faltan.length) return `La contraseña debe tener: ${faltan.join(', ')}.`;
  return null;
}

// Fuerza aproximada para el indicador (0 a 4). Solo orienta al usuario; la
// regla que se exige es validarClave.
export function fuerzaClave(clave: string): { nivel: 0 | 1 | 2 | 3 | 4; texto: string } {
  const c = clave || '';
  if (!c) return { nivel: 0, texto: '' };
  const cumplidos = requisitosClave(c).filter(r => r.ok).length;
  let nivel: 0 | 1 | 2 | 3 | 4 = 1;
  if (cumplidos === 5) nivel = c.length >= 14 ? 4 : c.length >= 11 ? 3 : 2;
  else if (cumplidos >= 3) nivel = 1;
  // Patrones muy comunes bajan la fuerza.
  if (/(.)\1{3,}|1234|abcd|qwerty|contrase|password/i.test(c) && nivel > 1) nivel = (nivel - 1) as 1 | 2 | 3;
  const textos = ['', 'Débil', 'Aceptable', 'Buena', 'Muy buena'];
  return { nivel, texto: textos[nivel] };
}

// ── Cierre de sesión por inactividad ──
export const INACTIVIDAD_MS = 30 * 60 * 1000; // 30 minutos
export const AVISO_PREVIO_MS = 60 * 1000;     // aviso 1 minuto antes
const CLAVE_STORAGE = 'cupfi_ultima_actividad';

export interface OpcionesInactividad {
  limiteMs?: number;
  avisoMs?: number;
  onAviso: (segundosRestantes: number) => void;
  onSigue: () => void;
  onVencida: () => void;
}

function leerUltima(): number {
  try { return Number(localStorage.getItem(CLAVE_STORAGE)) || 0; } catch { return 0; }
}
function guardarUltima(t: number): void {
  try { localStorage.setItem(CLAVE_STORAGE, String(t)); } catch { /* sin almacenamiento: vale la de esta pestaña */ }
}

// Vigila la actividad (mouse, teclado, toques, scroll). La última actividad
// se comparte entre pestañas, así usar la página en una no cierra la otra.
export function vigilarInactividad(op: OpcionesInactividad): { detener: () => void; seguir: () => void } {
  const limite = op.limiteMs ?? INACTIVIDAD_MS;
  const aviso = Math.min(op.avisoMs ?? AVISO_PREVIO_MS, limite);
  let ultimaLocal = Date.now();
  let avisando = false;
  let ultimoGuardado = 0;
  guardarUltima(ultimaLocal);

  const registrar = () => {
    if (avisando) return; // durante el aviso solo cuenta el botón "Seguir conectado"
    ultimaLocal = Date.now();
    if (ultimaLocal - ultimoGuardado > 5000) { ultimoGuardado = ultimaLocal; guardarUltima(ultimaLocal); }
  };
  const eventos = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll', 'mousemove'];
  eventos.forEach(ev => window.addEventListener(ev, registrar, { passive: true, capture: true }));

  const tick = () => {
    const ultima = Math.max(ultimaLocal, leerUltima());
    const restante = limite - (Date.now() - ultima);
    if (restante <= 0) { detener(); op.onVencida(); return; }
    if (restante <= aviso) { avisando = true; op.onAviso(Math.ceil(restante / 1000)); }
    else if (avisando) { avisando = false; op.onSigue(); } // otra pestaña siguió usando la página
  };
  const intervalo = window.setInterval(tick, 1000);

  function detener() {
    window.clearInterval(intervalo);
    eventos.forEach(ev => window.removeEventListener(ev, registrar, { capture: true }));
  }
  function seguir() {
    avisando = false;
    ultimaLocal = Date.now(); ultimoGuardado = ultimaLocal; guardarUltima(ultimaLocal);
    op.onSigue();
  }
  return { detener, seguir };
}

// ── Links ──
// Solo http/https: evita "javascript:", "data:", etc. en links cargados por usuarios.
export function urlSegura(url: unknown): string | null {
  const u = String(url ?? '').trim();
  return /^https?:\/\/[^\s<>"]+$/i.test(u) ? u : null;
}
