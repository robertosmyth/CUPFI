// ══════════════════════════════════════════════
// Guía (chatbot con respuestas fijas):
//  · Recorrido paso a paso que se abre solo en el primer ingreso de cada
//    usuario (queda guardado en su cuenta: profiles.guia_vista).
//  · Botón flotante siempre disponible con preguntas frecuentes y la
//    opción de repetir el recorrido.
// No usa IA ni servicios externos: todas las respuestas están acá.
// ══════════════════════════════════════════════
import * as Auth from './auth.ts';
import { app } from './contexto.ts';
import { esc } from './utils.ts';

declare global {
  interface Window {
    guiaAbrir(): void;
    guiaCerrar(): void;
    guiaOpcion(id: string): void;
  }
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

interface Opcion { id: string; texto: string }
interface Paso {
  texto: string;          // admite HTML propio (no datos de usuarios, salvo escapados)
  pantalla?: string;      // pestaña a mostrar al llegar a este paso
  opciones: Opcion[];
}

// ─── Recorrido ─────────────────────────────────────────────────────
function pasosRecorrido(): Paso[] {
  const nombre = esc(app().currentProfile?.nombre || '');
  return [
    {
      texto: `¡Hola${nombre ? ' ' + nombre : ''}! 👋 Soy la guía de la <strong>Red de Vinculación</strong>. En un minuto te muestro cómo conectar tu empresa con otras de la red.`,
      opciones: [{ id: 'paso:1', texto: 'Empezar' }, { id: 'omitir', texto: 'Ahora no' }],
    },
    {
      texto: 'En <strong>Empresas</strong> está el directorio de todas las organizaciones, con lo que ofrecen (en verde) y lo que necesitan (en naranja).',
      pantalla: 'directorio',
      opciones: [{ id: 'paso:2', texto: 'Siguiente' }],
    },
    {
      texto: 'Primero cargá tu empresa en <strong>Agregar</strong>. Lo más importante son dos listas: <strong>Servicios / Productos</strong> (lo que ofrecés) y <strong>Necesidades sin cubrir</strong>. Cada ítem lleva una <strong>categoría</strong> y una <strong>subcategoría</strong>, por ejemplo <em>Soldadura › TIG</em>.',
      pantalla: 'registrar',
      opciones: [{ id: 'paso:3', texto: 'Siguiente' }],
    },
    {
      texto: 'En <strong>Vinculación</strong> el sistema cruza tus necesidades con lo que ofrecen otras empresas (y al revés). Cada conexión muestra <strong>quién necesita</strong> y <strong>quién ofrece</strong>, y cómo coinciden las subcategorías: <em>Coincidencia exacta</em> o <em>Misma categoría</em>.',
      pantalla: 'vinculacion',
      opciones: [{ id: 'paso:4', texto: 'Siguiente' }],
    },
    {
      texto: 'Para que haya <strong>match</strong> las dos empresas tienen que aceptar. Si la otra aceptó primero vas a ver <em>"La otra empresa ya aceptó"</em>, así sabés que está interesada antes de aceptar. Antes del match podés retirar tu aceptación o rechazar.',
      opciones: [{ id: 'paso:5', texto: 'Siguiente' }],
    },
    {
      texto: 'Con el match se habilita un <strong>chat privado</strong> entre las dos empresas, con una pestaña por cada conexión. Solo lo leen ustedes: la plataforma registra <em>que</em> hubo contacto, nunca lo que se escribe.',
      opciones: [{ id: 'paso:6', texto: 'Siguiente' }],
    },
    {
      texto: '¡Listo! 🎉 Me encontrás siempre en el botón <strong>Guía</strong> de abajo a la derecha, por si querés repasar algo.',
      opciones: [{ id: 'faq', texto: 'Ver preguntas frecuentes' }, { id: 'fin', texto: 'Cerrar' }],
    },
  ];
}

// ─── Preguntas frecuentes ──────────────────────────────────────────
const FAQ: Array<{ id: string; pregunta: string; respuesta: string; pantalla?: string }> = [
  {
    id: 'cargar', pregunta: '¿Cómo cargo mi empresa?', pantalla: 'registrar',
    respuesta: 'Andá a <strong>Agregar</strong>, completá los datos (el CUIT es obligatorio y único) y cargá tus <strong>Servicios / Productos</strong> y <strong>Necesidades sin cubrir</strong> eligiendo categoría y subcategoría. Después la encontrás en <strong>Mis empresas</strong>, desde donde podés editarla.',
  },
  {
    id: 'categorias', pregunta: '¿Qué son la categoría y la subcategoría?',
    respuesta: 'La <strong>categoría</strong> es el rubro general (por ejemplo <em>Soldadura</em>) y la <strong>subcategoría</strong> el detalle (<em>TIG</em>). Podés elegir una subcategoría sugerida o escribir la tuya. Si nada encaja, usá <em>Otros</em> y describí lo que ofrecés o necesitás.',
  },
  {
    id: 'niveles', pregunta: '¿Qué diferencia hay entre "Coincidencia exacta" y "Misma categoría"?',
    respuesta: '<strong>Coincidencia exacta</strong>: misma categoría y misma subcategoría (TIG con TIG). <strong>Misma categoría</strong>: mismo rubro con distinta subcategoría (TIG con MIG/MAG), puede servir igual. En <em>Otros</em> solo se conecta si el detalle es el mismo.',
  },
  {
    id: 'aceptar', pregunta: '¿Cómo acepto una conexión?', pantalla: 'vinculacion',
    respuesta: 'En <strong>Vinculación → Mis conexiones</strong> tocá <strong>Aceptar</strong>. Si la otra empresa todavía no aceptó, la conexión queda en <em>"Esperando a la otra empresa"</em>. Cuando las dos aceptan es <strong>match</strong> y se habilita el chat. Cualquier usuario asociado a tu empresa puede aceptar en su nombre.',
  },
  {
    id: 'rechazar', pregunta: '¿Qué pasa si rechazo o retiro mi aceptación?',
    respuesta: '<strong>Retirar</strong> deshace tu aceptación (solo antes del match). <strong>Rechazar</strong> hace que la conexión deje de sugerirse a ambas empresas y no se puede deshacer.',
  },
  {
    id: 'privacidad', pregunta: '¿Quién puede leer mis mensajes?',
    respuesta: 'Solo los usuarios de las dos empresas de la conexión. Ni los administradores ni los webmasters pueden leer el contenido: la plataforma solo registra que hubo contacto (cantidad de mensajes y fechas).',
  },
  {
    id: 'revisar', pregunta: '¿Qué significa "Revisar" en mis ofertas o necesidades?', pantalla: 'mis-empresas',
    respuesta: 'Son ítems que se cargaron con el formato anterior (texto libre) y se pasaron automáticamente a <em>Otros</em>. Editá tu empresa y asignales la categoría y subcategoría correctas para encontrar más coincidencias. Al guardar, la marca desaparece.',
  },
  {
    id: 'varias', pregunta: '¿Puedo tener varias empresas?',
    respuesta: 'Sí. Podés cargar todas las que quieras, y una empresa puede tener varios usuarios asociados (lo configura un administrador). El sistema nunca conecta entre sí empresas que comparten usuarios.',
  },
  {
    id: 'perfil', pregunta: '¿Cómo cambio mis datos o mi contraseña?',
    respuesta: 'Con el botón del lápiz junto a tu nombre, arriba a la derecha. Ahí podés editar nombre, teléfono y email, y pedir un correo para cambiar la contraseña.',
  },
  {
    id: 'contacto', pregunta: '¿Cómo contacto a CUPFI?',
    respuesta: 'Escribinos a <a href="mailto:cupfi@ingenieria.unlz.edu.ar">cupfi@ingenieria.unlz.edu.ar</a>.',
  },
];

// ─── Mecánica del chat ─────────────────────────────────────────────
let enRecorridoInicial = false;

function burbujaBot(html: string): void {
  const box = $('guia-mensajes');
  const el = document.createElement('div');
  el.className = 'guia-burbuja';
  el.innerHTML = html;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function burbujaUsuario(texto: string): void {
  const box = $('guia-mensajes');
  const el = document.createElement('div');
  el.className = 'guia-burbuja guia-burbuja--usuario';
  el.textContent = texto;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function opciones(ops: Opcion[]): void {
  $('guia-opciones').innerHTML = ops.map(o => `<button class="guia-op" onclick="guiaOpcion('${o.id}')">${esc(o.texto)}</button>`).join('');
}

function menuPrincipal(): Opcion[] {
  return [
    ...FAQ.map(f => ({ id: 'faq:' + f.id, texto: f.pregunta })),
    { id: 'paso:1', texto: '▶ Repetir el recorrido' },
  ];
}

function mostrarPaso(i: number): void {
  const pasos = pasosRecorrido();
  const p = pasos[i];
  if (!p) return;
  if (p.pantalla) app().showScreen(p.pantalla);
  burbujaBot(p.texto);
  opciones(p.opciones);
  if (i === pasos.length - 1) marcarVista(); // llegó al final del recorrido
}

function marcarVista(): void {
  const c = app().currentProfile;
  if (!c || c.guia_vista) return;
  c.guia_vista = true; // evita volver a abrirla en esta sesión aunque falle la red
  Auth.marcarGuiaVista().catch(e => console.warn('No se pudo guardar que la guía ya se vio:', e));
}

window.guiaOpcion = function (id) {
  const boton = [...document.querySelectorAll<HTMLButtonElement>('#guia-opciones .guia-op')].find(b => b.getAttribute('onclick')?.includes(`'${id}'`));
  if (boton) burbujaUsuario(boton.textContent || '');
  if (id.startsWith('paso:')) { mostrarPaso(Number(id.slice(5))); return; }
  if (id.startsWith('faq:')) {
    const f = FAQ.find(x => x.id === id.slice(4));
    if (f) {
      if (f.pantalla) app().showScreen(f.pantalla);
      burbujaBot(f.respuesta);
      opciones([...menuPrincipal()]);
    }
    return;
  }
  if (id === 'faq') { burbujaBot('¿Sobre qué tenés dudas?'); opciones(menuPrincipal()); return; }
  if (id === 'omitir') {
    burbujaBot('¡Sin problema! Cuando quieras, abrime desde el botón <strong>Guía</strong> de abajo a la derecha.');
    opciones([{ id: 'faq', texto: 'Ver preguntas frecuentes' }, { id: 'fin', texto: 'Cerrar' }]);
    marcarVista();
    return;
  }
  if (id === 'fin') { window.guiaCerrar(); return; }
};

window.guiaAbrir = function () {
  $('guia-panel').classList.add('open');
  $('guia-fab').classList.add('hidden');
  if (!$('guia-mensajes').children.length) {
    burbujaBot('¡Hola! ¿En qué te ayudo? Elegí una pregunta o repetí el recorrido.');
    opciones(menuPrincipal());
  }
};

window.guiaCerrar = function () {
  $('guia-panel').classList.remove('open');
  $('guia-fab').classList.remove('hidden');
  if (enRecorridoInicial) { enRecorridoInicial = false; marcarVista(); }
};

// Se llama al entrar a la app: abre el recorrido solo si el usuario
// nunca lo vio.
export function iniciarGuia(): void {
  $('guia-wrap').classList.remove('hidden');
  if (app().currentProfile?.guia_vista) return;
  enRecorridoInicial = true;
  $('guia-mensajes').innerHTML = '';
  $('guia-panel').classList.add('open');
  $('guia-fab').classList.add('hidden');
  mostrarPaso(0);
}

export function resetGuia(): void {
  enRecorridoInicial = false;
  $('guia-panel').classList.remove('open');
  $('guia-fab').classList.remove('hidden');
  $('guia-wrap').classList.add('hidden');
  $('guia-mensajes').innerHTML = '';
  $('guia-opciones').innerHTML = '';
}
