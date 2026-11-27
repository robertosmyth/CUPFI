// ══════════════════════════════════════════════
// Búsqueda de empresas resuelta en la base (sql/016: buscar_empresas) y
// ubicaciones con el servicio oficial Georef (apis.datos.gob.ar).
// Acá no hay nada de pantalla: solo datos, para poder probarlo aparte.
// ══════════════════════════════════════════════
import { getSupabase } from './supabaseClient.ts';
import type { ProvinciaRow, SectorRow, UbicacionPrecision } from './types.ts';

export type OrdenEmpresas = 'auto' | 'relevancia' | 'nombre' | 'recientes' | 'coincidencias' | 'distancia';

export interface Cerca { lat: number; lng: number; km: number; nombre: string }

export interface FiltrosEmpresas {
  q: string;
  sectores: number[];
  provincias: string[];
  departamentos: string[];
  localidades: string[];
  tipos: string[];
  ofrece: number[];
  necesita: number[];
  ofreceSub: string[];   // "<categoría>|<subcategoría normalizada>"
  necesitaSub: string[];
  conNecesidades: boolean;
  misEmpresas: boolean;
  compatibles: boolean;
  cerca: Cerca | null;
  orden: OrdenEmpresas;
  // Solo admin/webmaster (la base lo ignora para el resto).
  usuario?: string | null;
  relacion?: 'principal' | 'asociado' | null;
}

export function filtrosVacios(): FiltrosEmpresas {
  return {
    q: '', sectores: [], provincias: [], departamentos: [], localidades: [], tipos: [],
    ofrece: [], necesita: [], ofreceSub: [], necesitaSub: [],
    conNecesidades: false, misEmpresas: false, compatibles: false, cerca: null, orden: 'auto',
    usuario: null, relacion: null,
  };
}

export interface ItemResultado { tipo: 'oferta' | 'necesidad'; categoria_id: number; subcategoria: string }

export interface EmpresaResultado {
  id: number; uid: string | null; nombre: string; tipo: string;
  sector_id: number | null; sector2_id: number | null; cuit: string;
  referente: string | null; cargo: string | null; calle: string | null; ciudad: string | null;
  departamento: string | null; provincia: string | null; provincia_id: string | null; logo: string | null;
  created_at: string; lat: number | null; lng: number | null;
  es_mia: boolean; coincidencias: number; distancia_km: number | null;
  items: ItemResultado[];
}

export interface PuntoMapa {
  id: number; nombre: string; sector_id: number | null; lat: number; lng: number;
  precision: UbicacionPrecision; logo: string | null; ciudad: string | null; provincia: string | null;
}

export interface FacetaLugar { id: string; nombre: string; n: number }

export interface Facetas {
  sectores: Record<string, number>;
  provincias: Record<string, number>;
  departamentos: (FacetaLugar & { provincia_id: string })[];
  localidades: (FacetaLugar & { departamento_id: string })[];
  tipos: Record<string, number>;
  ofrece: Record<string, number>;
  necesita: Record<string, number>;
  ofrece_sub: Record<string, number>;
  necesita_sub: Record<string, number>;
  con_necesidades: number;
  mis_empresas: number;
  compatibles: number;
  tengo_empresas: boolean;
}

export interface ResultadoBusqueda {
  total: number;
  orden: OrdenEmpresas;
  aproximada: boolean;     // no hubo resultados exactos: se buscaron palabras parecidas
  hay_mas: boolean;
  items: EmpresaResultado[];
  puntos: PuntoMapa[] | null;
  facetas: Facetas;
}

// Lo que se manda a la base: solo lo que tiene valor.
export function aParametros(f: FiltrosEmpresas): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (f.q.trim()) p.q = f.q.trim();
  const listas: [keyof FiltrosEmpresas, string][] = [
    ['sectores', 'sectores'], ['provincias', 'provincias'], ['departamentos', 'departamentos'], ['localidades', 'localidades'],
    ['tipos', 'tipos'], ['ofrece', 'ofrece'], ['necesita', 'necesita'], ['ofreceSub', 'ofrece_sub'], ['necesitaSub', 'necesita_sub'],
  ];
  for (const [k, nombre] of listas) {
    const v = f[k] as unknown[];
    if (v.length) p[nombre] = v;
  }
  if (f.conNecesidades) p.con_necesidades = true;
  if (f.misEmpresas) p.mis_empresas = true;
  if (f.compatibles) p.compatibles = true;
  if (f.cerca) p.cerca = { lat: f.cerca.lat, lng: f.cerca.lng, km: f.cerca.km };
  if (f.orden !== 'auto') p.orden = f.orden;
  if (f.usuario) { p.usuario = f.usuario; if (f.relacion) p.relacion = f.relacion; }
  return p;
}

// Cantidad de filtros activos (sin contar el texto ni el orden).
export function cantidadFiltros(f: FiltrosEmpresas): number {
  return f.sectores.length + f.provincias.length + f.departamentos.length + f.localidades.length + f.tipos.length
    + f.ofrece.length + f.necesita.length + f.ofreceSub.length + f.necesitaSub.length
    + (f.conNecesidades ? 1 : 0) + (f.misEmpresas ? 1 : 0) + (f.compatibles ? 1 : 0) + (f.cerca ? 1 : 0)
    + (f.usuario ? 1 : 0);
}

// ── Caché de respuestas recientes ──
// Volver a un filtro ya visto (o deshacer uno) responde al instante.
const CACHE_MS = 30_000;
const CACHE_MAX = 60;
const cache = new Map<string, { t: number; r: ResultadoBusqueda }>();

export function limpiarCache(): void { cache.clear(); }

export async function buscarEmpresas(
  f: FiltrosEmpresas,
  opts: { limite?: number; desde?: number; mapa?: boolean; signal?: AbortSignal } = {},
): Promise<ResultadoBusqueda> {
  const p = aParametros(f);
  if (opts.limite) p.limite = opts.limite;
  if (opts.desde) p.desde = opts.desde;
  if (opts.mapa) p.solo_mapa = true;
  const clave = JSON.stringify(p);
  const hit = cache.get(clave);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.r;
  const supabase = await getSupabase();
  let q = supabase.rpc('buscar_empresas', { p });
  if (opts.signal) q = q.abortSignal(opts.signal);
  const { data, error } = await q;
  if (error) throw error;
  const r = data as ResultadoBusqueda;
  cache.set(clave, { t: Date.now(), r });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return r;
}

let sectoresCache: SectorRow[] | null = null;
export async function listSectores(forzar = false): Promise<SectorRow[]> {
  if (sectoresCache && !forzar) return sectoresCache;
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('sectores').select('*').order('orden').order('nombre');
  if (error) throw error;
  sectoresCache = data as SectorRow[];
  return sectoresCache;
}

let provinciasCache: ProvinciaRow[] | null = null;
export async function listProvincias(): Promise<ProvinciaRow[]> {
  if (provinciasCache) return provinciasCache;
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('provincias').select('*').order('orden');
  if (error) throw error;
  provinciasCache = data as ProvinciaRow[];
  return provinciasCache;
}

// ══════════════════════════════════════════════
// GEOREF — servicio oficial de normalización de direcciones del Estado
// argentino. Gratuito, sin clave. Si no responde, se sigue sin él.
// ══════════════════════════════════════════════
export const GEOREF = 'https://apis.datos.gob.ar/georef/api';

export interface LocalidadGeoref {
  id: string;
  nombre: string;
  departamento: { id: string; nombre: string };
  provincia: { id: string; nombre: string };
  centroide: { lat: number; lon: number };
}

async function georef<T>(ruta: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), 8000);
  signal?.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(`${GEOREF}/${ruta}?${qs}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error('El servicio de ubicaciones no respondió.');
    return await res.json() as T;
  } finally {
    clearTimeout(corte);
  }
}

// Localidades que empiezan o contienen lo escrito (opcionalmente en una provincia).
export async function buscarLocalidades(texto: string, provinciaId?: string | null, signal?: AbortSignal): Promise<LocalidadGeoref[]> {
  const nombre = texto.trim();
  if (nombre.length < 2) return [];
  const params: Record<string, string | number> = {
    nombre, max: 12, campos: 'id,nombre,departamento.id,departamento.nombre,provincia.id,provincia.nombre,centroide', orden: 'nombre',
  };
  if (provinciaId) params.provincia = provinciaId;
  const r = await georef<{ localidades: LocalidadGeoref[] }>('localidades', params, signal);
  return r.localidades || [];
}

// Coordenadas exactas de una calle y altura dentro de un partido/departamento.
// null si el servicio no la encuentra (queda el centro de la localidad).
export async function ubicarDireccion(calle: string, departamentoId: string, provinciaId: string, signal?: AbortSignal): Promise<{ lat: number; lng: number } | null> {
  const direccion = calle.trim();
  if (!direccion || !/\d/.test(direccion)) return null;
  try {
    const r = await georef<{ direcciones: { ubicacion: { lat: number | null; lon: number | null } }[] }>('direcciones', {
      direccion, departamento: departamentoId, provincia: provinciaId, max: 1, campos: 'ubicacion',
    }, signal);
    const u = r.direcciones?.[0]?.ubicacion;
    return u && u.lat != null && u.lon != null ? { lat: u.lat, lng: u.lon } : null;
  } catch {
    return null;
  }
}

// "<categoría>|<subcategoría>" como lo guarda la base (f_tag = normalizeTagKey).
export function claveSub(categoriaId: number, subNormalizada: string): string {
  return `${categoriaId}|${subNormalizada}`;
}
