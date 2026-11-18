// ══════════════════════════════════════════════
// ACCESIBILIDAD (WCAG 2.2 AA / ISO/IEC 40500)
// Se aplica a TODA la página, también a lo que se dibuja después
// (listas, tarjetas, ventanas), así cada pantalla nueva ya nace accesible:
//  · ventanas emergentes como diálogos: se anuncian, Esc las cierra, el
//    foco queda adentro y vuelve a donde estaba al cerrarlas;
//  · todo lo clickeable se puede usar con teclado (Enter / Espacio);
//  · cada campo con su etiqueta; los mensajes se leen en voz alta;
//  · botones de solo ícono con nombre; íconos decorativos ocultos;
//  · mostrar/ocultar contraseña.
// ══════════════════════════════════════════════

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';
const NATIVOS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY', 'OPTION', 'DETAILS']);
let contadorIds = 0;
const nuevoId = (p: string) => `${p}-${++contadorIds}`;

function visible(el: Element): boolean {
  const h = el as HTMLElement;
  return !!(h.offsetWidth || h.offsetHeight || h.getClientRects().length);
}

// ── Ventanas emergentes ──
const pilaFoco: { modal: HTMLElement; volverA: HTMLElement | null }[] = [];

function modalesAbiertos(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.modal-overlay.open')];
}

function prepararModal(ov: HTMLElement): void {
  const caja = ov.querySelector<HTMLElement>('.modal') || ov;
  if (!caja.hasAttribute('role')) {
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-modal', 'true');
  }
  const titulo = caja.querySelector<HTMLElement>('.modal-header h2, .modal-header h3, h2');
  if (titulo && titulo.textContent?.trim()) {
    if (!titulo.id) titulo.id = nuevoId('dlg-titulo');
    caja.setAttribute('aria-labelledby', titulo.id);
    caja.removeAttribute('aria-label');
  } else if (!caja.hasAttribute('aria-label')) {
    caja.setAttribute('aria-label', 'Ventana');
  }
}

function alAbrirModal(ov: HTMLElement): void {
  prepararModal(ov);
  if (pilaFoco.some(p => p.modal === ov)) return;
  pilaFoco.push({ modal: ov, volverA: document.activeElement as HTMLElement | null });
  // Primer campo (o el botón cerrar) recibe el foco, salvo que la propia
  // pantalla ya haya puesto el foco adentro.
  requestAnimationFrame(() => {
    if (ov.contains(document.activeElement)) return;
    const caja = ov.querySelector<HTMLElement>('.modal') || ov;
    const primero = [...caja.querySelectorAll<HTMLElement>(FOCUSABLE)].find(e => visible(e) && !e.classList.contains('modal-close'))
      || caja.querySelector<HTMLElement>('.modal-close');
    (primero || caja).focus({ preventScroll: true });
  });
}

function alCerrarModal(ov: HTMLElement): void {
  const i = pilaFoco.findIndex(p => p.modal === ov);
  if (i < 0) return;
  const [{ volverA }] = pilaFoco.splice(i, 1);
  if (volverA && document.contains(volverA) && visible(volverA)) volverA.focus({ preventScroll: true });
}

function cerrarModalSuperior(): boolean {
  const abiertos = modalesAbiertos();
  const top = abiertos[abiertos.length - 1];
  if (!top) return false;
  const btn = top.querySelector<HTMLElement>('.modal-close');
  if (btn) { btn.click(); return true; }
  return false;
}

function atraparFoco(e: KeyboardEvent): void {
  const abiertos = modalesAbiertos();
  const top = abiertos[abiertos.length - 1];
  if (!top) return;
  const items = [...top.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  if (!items.length) return;
  const primero = items[0], ultimo = items[items.length - 1];
  const act = document.activeElement as HTMLElement | null;
  if (!top.contains(act)) { e.preventDefault(); primero.focus(); return; }
  if (e.shiftKey && act === primero) { e.preventDefault(); ultimo.focus(); }
  else if (!e.shiftKey && act === ultimo) { e.preventDefault(); primero.focus(); }
}

// ── Mejoras por elemento ──
function nombreAccesible(el: HTMLElement): string {
  if (el.getAttribute('aria-label')?.trim() || el.getAttribute('aria-labelledby')) return 'x';
  if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return 'x';
  if (el.closest('label')) return 'x';
  return '';
}

function etiquetaPara(ctrl: HTMLElement): HTMLLabelElement | null {
  // Etiqueta inmediatamente anterior (mismo contenedor) o la del grupo.
  let prev = ctrl.previousElementSibling;
  while (prev && !(prev instanceof HTMLLabelElement) && !prev.matches('input,select,textarea')) prev = prev.previousElementSibling;
  if (prev instanceof HTMLLabelElement && !prev.htmlFor && !prev.querySelector('input,select,textarea')) return prev;
  const grupo = ctrl.parentElement;
  if (grupo) {
    const labels = [...grupo.children].filter((c): c is HTMLLabelElement => c instanceof HTMLLabelElement && !c.htmlFor);
    const ctrls = grupo.querySelectorAll(':scope > input:not([type="hidden"]), :scope > select, :scope > textarea');
    if (labels.length === 1 && ctrls.length === 1 && !labels[0].querySelector('input,select,textarea')) return labels[0];
  }
  return null;
}

function mejorarControl(ctrl: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  if (ctrl instanceof HTMLInputElement && ['hidden', 'button', 'submit'].includes(ctrl.type)) return;
  if (nombreAccesible(ctrl)) return;
  const lab = etiquetaPara(ctrl);
  if (lab) {
    if (!ctrl.id) ctrl.id = nuevoId('campo');
    lab.htmlFor = ctrl.id;
    return;
  }
  const alt = ctrl.getAttribute('placeholder') || ctrl.getAttribute('title')
    || (ctrl instanceof HTMLSelectElement ? ctrl.options[0]?.textContent : '') || '';
  if (alt.trim()) ctrl.setAttribute('aria-label', alt.trim().replace(/\.\.\.$|…$/, ''));
}

function mejorarClickeable(el: HTMLElement): void {
  if (NATIVOS.has(el.tagName) || el.hasAttribute('role') && el.getAttribute('role') !== 'presentation') {
    if (!el.hasAttribute('tabindex') && el.getAttribute('role') === 'button') el.tabIndex = 0;
    return;
  }
  if (el.closest('button, a')) return;
  el.setAttribute('role', 'button');
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
}

function mejorarBoton(b: HTMLElement): void {
  if ((b.textContent || '').trim() || b.getAttribute('aria-label')) return;
  const t = b.getAttribute('title') || (b.classList.contains('modal-close') ? 'Cerrar' : '');
  if (t) b.setAttribute('aria-label', t);
}

function agregarVerClave(inp: HTMLInputElement): void {
  if (inp.dataset.verClave) return;
  inp.dataset.verClave = '1';
  const envoltura = document.createElement('div');
  envoltura.className = 'clave-wrap';
  inp.parentNode?.insertBefore(envoltura, inp);
  envoltura.appendChild(inp);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'clave-ver';
  b.setAttribute('aria-label', 'Mostrar contraseña');
  b.setAttribute('aria-pressed', 'false');
  b.innerHTML = '<i class="ti ti-eye" aria-hidden="true"></i>';
  b.addEventListener('click', () => {
    const ver = inp.type === 'password';
    inp.type = ver ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(ver));
    b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
    b.innerHTML = `<i class="ti ${ver ? 'ti-eye-off' : 'ti-eye'}" aria-hidden="true"></i>`;
  });
  envoltura.appendChild(b);
}

export function mejorar(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.modal-overlay').forEach(prepararModal);
  root.querySelectorAll<HTMLElement>('i.ti, .ti[class*="ti-"]').forEach(i => { if (!i.hasAttribute('aria-hidden')) i.setAttribute('aria-hidden', 'true'); });
  root.querySelectorAll<HTMLElement>('[onclick]').forEach(mejorarClickeable);
  root.querySelectorAll<HTMLElement>('button, [role="button"]').forEach(mejorarBoton);
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea').forEach(mejorarControl);
  root.querySelectorAll<HTMLElement>('.auth-msg, .form-msg, [id$="-msg"]').forEach(m => {
    if (!m.hasAttribute('role')) { m.setAttribute('role', 'status'); m.setAttribute('aria-live', 'polite'); }
  });
  root.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(agregarVerClave);
}

export function initA11y(): void {
  mejorar(document);

  // Lo que se agrega o cambia después también se mejora, apenas aparece
  // (el observador corre antes de que el navegador vuelva a dibujar). Las
  // mejoras no repiten cambios ya hechos, así que esto se estabiliza solo.
  new MutationObserver(muts => {
    let agregado = false;
    for (const m of muts) {
      if (m.type === 'attributes' && m.target instanceof HTMLElement && m.target.classList.contains('modal-overlay')) {
        if (m.target.classList.contains('open')) alAbrirModal(m.target); else alCerrarModal(m.target);
      } else if (m.type === 'childList' && m.addedNodes.length) {
        agregado = true;
      }
    }
    if (agregado) mejorar(document);
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (cerrarModalSuperior()) { e.preventDefault(); return; }
      const guia = document.querySelector<HTMLElement>('#guia-panel.open .guia-header button');
      if (guia) { guia.click(); e.preventDefault(); }
      return;
    }
    if (e.key === 'Tab') { atraparFoco(e); return; }
    // Enter / Espacio activan los elementos clickeables que no son botones.
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.getAttribute('role') === 'button' && !NATIVOS.has(t.tagName)) {
      e.preventDefault();
      t.click();
    }
  });
}

// Título de la pestaña del navegador y encabezado para lectores de pantalla.
export function anunciarPantalla(nombre: string): void {
  document.title = `${nombre} · Red de Vinculación – FI-UNLZ`;
  const h = document.getElementById('titulo-seccion');
  if (h) h.textContent = nombre;
}
