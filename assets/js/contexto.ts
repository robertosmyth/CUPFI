// ══════════════════════════════════════════════
// Contexto compartido entre main.ts y los módulos de interfaz nuevos
// (ui-conexiones.ts, ui-webmaster.ts, ui-guia.ts). main.ts es el dueño del
// estado; los módulos lo leen a través de este objeto en vez de duplicarlo.
// ══════════════════════════════════════════════
import type { Categoria, ConexionRow, Empresa, Profile, SolicitudRow } from './types.ts';

export interface AppContext {
  readonly orgs: Empresa[];
  readonly profiles: Profile[];
  readonly categorias: Categoria[];
  readonly conexiones: ConexionRow[];
  readonly solicitudes: SolicitudRow[]; // las visibles para el usuario (RLS)
  readonly currentProfile: Profile | null;
  // ids de las empresas de las que el usuario actual es usuario
  misEmpresas(): Set<number>;
  // vuelve a leer todo de la base
  refresh(): Promise<void>;
  getProfileById(uid: string | null | undefined): Profile | undefined;
  categoriaById(id: number): Categoria | undefined;
  contactButtonsHtml(org: Empresa): string;
  showScreen(name: string): void;
}

let ctx: AppContext | null = null;

export function setContext(c: AppContext): void {
  ctx = c;
}

export function app(): AppContext {
  if (!ctx) throw new Error('Contexto de la app no inicializado');
  return ctx;
}

// Fecha y hora cortas en formato argentino (dd/mm/aaaa hh:mm).
export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function nombreUsuario(uid: string | null | undefined): string {
  const u = app().getProfileById(uid);
  return u ? `${u.nombre} ${u.apellido || ''}`.trim() : 'Usuario';
}
