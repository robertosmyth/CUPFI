// ══════════════════════════════════════════════
// Utilidades compartidas
// ══════════════════════════════════════════════

// Escapado básico para evitar XSS al insertar texto en innerHTML
export function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function ini(name) {
  return String(name || '').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

export function normCuit(c) {
  return String(c || '').replace(/\D/g, '');
}

export function isValidCuit(c) {
  return normCuit(c).length === 11;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// Valida que una URL de sitio web tenga un esquema seguro (http/https).
// Se usa antes de guardar el campo "web" de una empresa para evitar
// esquemas como "javascript:" en un link que después se renderiza en <a href>.
export function isValidUrl(url) {
  if (!url) return true; // campo opcional
  return /^https?:\/\/.+/i.test(String(url).trim());
}

export function buildAddress(o) {
  return [o.calle, o.ciudad, o.provincia, o.pais].filter(Boolean).join(', ');
}

// Normaliza texto (sin acentos, minúsculas) para comparar ofertas/necesidades
export function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u').replace(/[^a-z0-9 ]/g, ' ');
}

// Clave normalizada de un tag/etiqueta (oferta, necesidad, instalación),
// usada tanto para evitar tags duplicados por mayúsculas/espacios como
// para detectar coincidencias exactas en el motor de vinculación.
export function normalizeTagKey(s) {
  return norm(s).replace(/\s+/g, ' ').trim();
}

export function overlap(a, b) {
  const wa = norm(a).split(/\s+/).filter(w => w.length > 3);
  const wb = norm(b).split(/\s+/).filter(w => w.length > 3);
  return wa.some(w => wb.some(v => v.includes(w) || w.includes(v)));
}

// Traduce errores comunes de Supabase/Postgres a mensajes en español
export function friendlyError(error) {
  if (!error) return 'Ocurrió un error inesperado.';
  const msg = error.message || String(error);
  if (error.code === '23505' || /duplicate key/i.test(msg)) {
    if (/cuit/i.test(msg)) return 'Ya existe una empresa registrada con ese CUIT.';
    return 'Ese valor ya existe y debe ser único.';
  }
  if (/Invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/User already registered/i.test(msg)) return 'Ya existe una cuenta con ese email.';
  if (/Password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/Email not confirmed/i.test(msg)) return 'Confirmá tu email antes de iniciar sesión (revisá tu bandeja de entrada).';
  if (/JWT|network|fetch/i.test(msg)) return 'Problema de conexión con el servidor. Probá de nuevo en unos segundos.';
  return msg;
}
