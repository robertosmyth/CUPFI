// ══════════════════════════════════════════════
// Utilidades compartidas
// ══════════════════════════════════════════════

// Escapado básico para evitar XSS al insertar texto en innerHTML
export function esc(s: unknown): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function ini(name: unknown): string {
  return String(name || '').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

export function normCuit(c: unknown): string {
  return String(c || '').replace(/\D/g, '');
}

export function isValidCuit(c: unknown): boolean {
  return normCuit(c).length === 11;
}

export function isValidEmail(email: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// Valida que una URL de sitio web tenga un esquema seguro (http/https).
// Se usa antes de guardar el campo "web" de una empresa para evitar
// esquemas como "javascript:" en un link que después se renderiza en <a href>.
export function isValidUrl(url: unknown): boolean {
  if (!url) return true; // campo opcional
  return /^https?:\/\/.+/i.test(String(url).trim());
}

export interface Address {
  calle?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  pais?: string | null;
}

export function buildAddress(o: Address): string {
  return [o.calle, o.ciudad, o.provincia, o.pais].filter(Boolean).join(', ');
}

// Normaliza texto (sin acentos, minúsculas) para comparar ofertas/necesidades
export function norm(s: unknown): string {
  return String(s || '').toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u').replace(/[^a-z0-9 ]/g, ' ');
}

// Clave normalizada de un tag/etiqueta (oferta, necesidad, instalación),
// usada tanto para evitar tags duplicados por mayúsculas/espacios como
// para detectar coincidencias exactas en el motor de vinculación.
export function normalizeTagKey(s: unknown): string {
  return norm(s).replace(/\s+/g, ' ').trim();
}

export function overlap(a: unknown, b: unknown): boolean {
  const wa = norm(a).split(/\s+/).filter(w => w.length > 3);
  const wb = norm(b).split(/\s+/).filter(w => w.length > 3);
  return wa.some(w => wb.some(v => v.includes(w) || w.includes(v)));
}

interface ErrorLike {
  message?: string;
  code?: string;
}

// Errores que lanzan a propósito las funciones de sql/012 (raise exception
// 'CODIGO'), con el texto que ve el usuario.
const MENSAJES_012: Array<[string, string]> = [
  ['SIN_PERMISO_EMPRESA', 'No tenés permiso para actuar en nombre de esa empresa.'],
  ['MISMO_TITULAR', 'No se pueden conectar dos empresas que comparten usuarios.'],
  ['CONEXION_SIN_COINCIDENCIA', 'Esta conexión ya no tiene coincidencias actuales: alguna de las empresas cambió sus ofertas o necesidades.'],
  ['CONEXION_RECHAZADA', 'Esta conexión fue rechazada y ya no se puede aceptar.'],
  ['CONEXION_YA_EN_MATCH', 'Esta conexión ya está en match.'],
  ['YA_ACEPTADA', 'Tu empresa ya había aceptado esta conexión.'],
  ['NADA_PARA_RETIRAR', 'Tu empresa no había aceptado esta conexión.'],
  ['CHAT_SIN_MATCH', 'El chat se habilita cuando las dos empresas aceptan la conexión.'],
  ['MENSAJE_VACIO', 'Escribí un mensaje antes de enviar.'],
  ['MENSAJE_LARGO', 'El mensaje es demasiado largo (máximo 4000 caracteres).'],
  ['OTROS_REQUIERE_DETALLE', 'En la categoría "Otros" tenés que describir qué es en el campo de subcategoría.'],
  ['CATEGORIA_INEXISTENTE', 'Una de las categorías elegidas ya no existe. Recargá la página y volvé a elegirla.'],
  ['SUBCATEGORIA_LARGA', 'La subcategoría es demasiado larga (máximo 120 caracteres).'],
  ['DEMASIADOS_ITEMS', 'Hay demasiadas ofertas y necesidades cargadas (máximo 120 en total).'],
  ['CATEGORIA_OTROS_PROTEGIDA', 'La categoría "Otros" no se puede renombrar ni borrar.'],
  ['WEBMASTER_SOLO_WEBMASTER', 'Solo un webmaster puede dar o quitar el permiso de webmaster.'],
  ['WEBMASTER_PROPIO', 'No podés quitarte a vos mismo el permiso de webmaster.'],
  ['WEBMASTER_REQUIERE_ADMIN', 'El permiso de webmaster solo se puede dar a un administrador.'],
  ['SOLO_WEBMASTER', 'Esta sección es solo para webmasters.'],
];

// Traduce errores comunes de Supabase/Postgres a mensajes en español
export function friendlyError(error: unknown): string {
  if (!error) return 'Ocurrió un error inesperado.';
  const e = error as ErrorLike;
  const msg = e.message || String(error);
  // Mensajes propios del trigger de sql/historial/010_unique_profile_constraints.sql
  // (backstop del lado del servidor si dos altas/ediciones chocan al mismo
  // tiempo; el chequeo normal se hace antes, con checkProfileDuplicates).
  if (/DUPLICATE_NOMBRE_APELLIDO/i.test(msg)) return 'Ya existe un usuario registrado con ese nombre y apellido.';
  if (/DUPLICATE_EMAIL/i.test(msg)) return 'Ya existe un usuario registrado con ese email.';
  if (/DUPLICATE_TEL/i.test(msg)) return 'Ya existe un usuario registrado con ese teléfono móvil.';
  if (/Database error saving new user/i.test(msg)) return 'Ya existe un usuario registrado con ese nombre, apellido, email o teléfono.';
  // Códigos propios de sql/012_etapa1_conexiones.sql
  const propio = MENSAJES_012.find(([code]) => msg.includes(code));
  if (propio) return propio[1];
  // Falta correr sql/012 en Supabase (tabla o función inexistente).
  if (/(empresa_items|conexiones|categorias|mensajes|bitacora|guardar_items_empresa|conexion_responder)/i.test(msg) &&
      (/does not exist|Could not find|schema cache/i.test(msg) || e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42P01')) {
    return 'La base de datos todavía no tiene la actualización de conexiones (falta correr sql/012_etapa1_conexiones.sql en Supabase).';
  }
  // Borrar una categoría que alguna empresa o conexión usa (foreign key).
  if (e.code === '23503' && /categoria/i.test(msg)) return 'No se puede borrar la categoría: hay empresas o conexiones que la usan.';
  if (e.code === '23505' || /duplicate key/i.test(msg)) {
    if (/cuit/i.test(msg)) return 'Ya existe una empresa registrada con ese CUIT.';
    if (/nombre_apellido/i.test(msg)) return 'Ya existe un usuario registrado con ese nombre y apellido.';
    if (/profiles_unique_email/i.test(msg)) return 'Ya existe un usuario registrado con ese email.';
    if (/profiles_unique_tel/i.test(msg)) return 'Ya existe un usuario registrado con ese teléfono móvil.';
    return 'Ese valor ya existe y debe ser único.';
  }
  if (/Invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/User already registered/i.test(msg)) return 'Ya existe una cuenta con ese email.';
  if (/Password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 8 caracteres.';
  if (/different from the old password/i.test(msg) || e.code === 'same_password') return 'La contraseña nueva tiene que ser distinta de la anterior.';
  if (/Auth session missing/i.test(msg)) return 'La sesión venció. Volvé a iniciar sesión (o pedí un nuevo link para restablecer la contraseña).';
  if (/Email not confirmed/i.test(msg)) return 'Confirmá tu email antes de iniciar sesión (revisá tu bandeja de entrada).';
  // Cooldown por pedido repetido (por ejemplo, click doble en "reenviar
  // email" o en "olvidé mi contraseña"): Supabase deja pasar un rato fijo
  // entre pedidos iguales, más allá del límite de emails por hora del
  // proveedor SMTP.
  if (/security purposes.*after \d+ seconds?/i.test(msg) || /only request this after/i.test(msg)) {
    return 'Por seguridad, esperá unos segundos antes de volver a pedirlo.';
  }
  // Límite de envío de emails alcanzado (rate limit propio de Supabase Auth,
  // separado del proveedor SMTP configurado — ver README, sección SMTP).
  if (/email rate limit/i.test(msg) || /rate limit exceeded/i.test(msg)) {
    return 'Se alcanzó el límite de envío de emails. Probá de nuevo en unos minutos.';
  }
  if (/JWT|network|fetch/i.test(msg)) return 'Problema de conexión con el servidor. Probá de nuevo en unos segundos.';
  return msg;
}
