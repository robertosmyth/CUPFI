// ══════════════════════════════════════════════
// Motor de conexiones: cruza las necesidades de una empresa con las
// ofertas de otra, por categoría y subcategoría.
//
// Una conexión = "A necesita [categoría] ← B la ofrece". Se ramifica en
// pares de subcategorías:
//   A necesita Soldadura ← B
//     └ TIG ↔ TIG      · Coincidencia exacta   (misma subcategoría)
//     └ TIG ↔ MIG/MAG  · Misma categoría       (distinta subcategoría)
//
// Reglas (las mismas que valida la base en fn_conexion_vigente, ver
// sql/012_etapa1_conexiones.sql):
//  - En la categoría "Otros" solo hay conexión si la subcategoría es
//    idéntica (normalizada): "Otros" agrupa cosas muy distintas.
//  - Nunca se conectan dos empresas que comparten algún usuario
//    (administrador principal o asociado).
//
// El ESTADO de cada conexión (aceptada, match, rechazada...) vive en la
// tabla conexiones; acá solo se combina con las sugerencias calculadas.
// ══════════════════════════════════════════════
import { normalizeTagKey } from './utils.ts';
import type {
  Categoria, ConexionRow, Empresa, EstadoConexion, LadoConexion,
  NivelCoincidencia, ParCoincidencia, Sugerencia,
} from './types.ts';

export function claveConexion(necesitaId: number, ofreceId: number, categoriaId: number): string {
  return `${necesitaId}-${ofreceId}-${categoriaId}`;
}

// Considera "mismo titular" si comparten al menos un usuario. Si
// a.usuarios / b.usuarios no están calculados, cae al chequeo por uid.
export function isSameOwner(a: Empresa, b: Empresa): boolean {
  const au = a.usuarios || (a.uid ? [a.uid] : []);
  const bu = b.usuarios || (b.uid ? [b.uid] : []);
  if (!au.length || !bu.length) return false;
  return au.some(id => bu.includes(id));
}

export function calcularSugerencias(orgs: Empresa[], categorias: Categoria[]): Sugerencia[] {
  const catById = new Map(categorias.map(c => [c.id, c]));
  const out: Sugerencia[] = [];

  for (const s of orgs) {
    // necesidades de s agrupadas por categoría
    const needsByCat = new Map<number, string[]>();
    for (const it of s.items || []) {
      if (it.tipo !== 'necesidad') continue;
      if (!needsByCat.has(it.categoriaId)) needsByCat.set(it.categoriaId, []);
      needsByCat.get(it.categoriaId)!.push(it.subcategoria);
    }
    if (!needsByCat.size) continue;

    for (const p of orgs) {
      if (p.id === s.id || isSameOwner(s, p)) continue;
      for (const [catId, needs] of needsByCat) {
        const cat = catById.get(catId);
        if (!cat) continue;
        const offers = (p.items || []).filter(it => it.tipo === 'oferta' && it.categoriaId === catId).map(it => it.subcategoria);
        if (!offers.length) continue;

        let pares: ParCoincidencia[] = [];
        for (const n of needs) {
          for (const o of offers) {
            const nivel: NivelCoincidencia = normalizeTagKey(n) === normalizeTagKey(o) ? 'exacta' : 'categoria';
            pares.push({ necesidad: n, oferta: o, nivel });
          }
        }
        if (cat.esOtros) {
          pares = pares.filter(x => x.nivel === 'exacta' && normalizeTagKey(x.necesidad) !== '');
        }
        if (!pares.length) continue;
        pares.sort((x, y) => (x.nivel === y.nivel ? 0 : x.nivel === 'exacta' ? -1 : 1));

        out.push({
          key: claveConexion(s.id, p.id, catId),
          necesita: s,
          ofrece: p,
          categoria: cat,
          pares,
          nivel: pares.some(x => x.nivel === 'exacta') ? 'exacta' : 'categoria',
        });
      }
    }
  }
  return out;
}

// De qué lado de la conexión está el usuario (según las empresas de las
// que es usuario). null si no es usuario de ninguna de las dos.
export function ladoDe(necesitaId: number, ofreceId: number, misEmpresas: ReadonlySet<number>): LadoConexion | null {
  if (misEmpresas.has(necesitaId)) return 'necesita';
  if (misEmpresas.has(ofreceId)) return 'ofrece';
  return null;
}

// Estado de una conexión visto desde un lado. Sin fila = solo sugerida.
export function estadoConexion(row: ConexionRow | undefined, lado: LadoConexion): EstadoConexion {
  if (!row) return 'sugerida';
  if (row.rechazada_at) return 'rechazada';
  if (row.match_at) return 'match';
  const mia = lado === 'necesita' ? row.acepta_necesita_at : row.acepta_ofrece_at;
  const otra = lado === 'necesita' ? row.acepta_ofrece_at : row.acepta_necesita_at;
  if (mia) return 'esperando_otra';
  if (otra) return 'otra_acepto';
  return 'sugerida';
}

// Estado neutral (para el webmaster, que no es parte de la conexión).
export type EstadoNeutral = 'sugerida' | 'acepto_necesita' | 'acepto_ofrece' | 'match' | 'rechazada';
export function estadoNeutral(row: ConexionRow): EstadoNeutral {
  if (row.rechazada_at) return 'rechazada';
  if (row.match_at) return 'match';
  if (row.acepta_necesita_at) return 'acepto_necesita';
  if (row.acepta_ofrece_at) return 'acepto_ofrece';
  return 'sugerida';
}

export interface ConexionVista {
  key: string;
  necesita: Empresa;
  ofrece: Empresa;
  categoria: Categoria;
  pares: ParCoincidencia[];
  nivel: NivelCoincidencia | null; // null si ya no hay coincidencias actuales
  row?: ConexionRow;
  lado: LadoConexion;
  estado: EstadoConexion;
  vigente: boolean; // false = la coincidencia desapareció después de responderse
}

// Conexiones en las que participa alguna de mis empresas: las sugerencias
// actuales (con su estado si alguien ya respondió) más las conexiones ya
// respondidas cuya coincidencia desapareció (vigente = false).
export function armarMisConexiones(
  sugerencias: Sugerencia[],
  rows: ConexionRow[],
  orgs: Empresa[],
  categorias: Categoria[],
  misEmpresas: ReadonlySet<number>,
): ConexionVista[] {
  const rowByKey = new Map(rows.map(r => [claveConexion(r.empresa_necesita_id, r.empresa_ofrece_id, r.categoria_id), r]));
  const orgById = new Map(orgs.map(o => [o.id, o]));
  const catById = new Map(categorias.map(c => [c.id, c]));
  const out: ConexionVista[] = [];
  const vistas = new Set<string>();

  for (const s of sugerencias) {
    const lado = ladoDe(s.necesita.id, s.ofrece.id, misEmpresas);
    if (!lado) continue;
    const row = rowByKey.get(s.key);
    out.push({ ...s, row, lado, estado: estadoConexion(row, lado), vigente: true });
    vistas.add(s.key);
  }

  for (const [key, row] of rowByKey) {
    if (vistas.has(key)) continue;
    const lado = ladoDe(row.empresa_necesita_id, row.empresa_ofrece_id, misEmpresas);
    const necesita = orgById.get(row.empresa_necesita_id);
    const ofrece = orgById.get(row.empresa_ofrece_id);
    const categoria = catById.get(row.categoria_id);
    if (!lado || !necesita || !ofrece || !categoria) continue;
    out.push({
      key, necesita, ofrece, categoria, pares: [], nivel: null,
      row, lado, estado: estadoConexion(row, lado), vigente: false,
    });
  }
  return out;
}

// Al llegar a un match entre A y B: las demás conexiones todavía abiertas
// entre esas dos empresas, en cualquiera de las dos direcciones.
export function recomendacionesPara(vistas: ConexionVista[], a: number, b: number, exceptoKey?: string): ConexionVista[] {
  return vistas.filter(v =>
    v.key !== exceptoKey &&
    v.vigente &&
    v.estado !== 'match' && v.estado !== 'rechazada' &&
    ((v.necesita.id === a && v.ofrece.id === b) || (v.necesita.id === b && v.ofrece.id === a)));
}

// Conexiones en match entre dos empresas (en ambas direcciones): son las
// pestañas del chat entre ellas.
export function matchesEntre(vistas: ConexionVista[], a: number, b: number): ConexionVista[] {
  return vistas.filter(v =>
    v.estado === 'match' && !!v.row &&
    ((v.necesita.id === a && v.ofrece.id === b) || (v.necesita.id === b && v.ofrece.id === a)));
}

// Etiqueta legible de un ítem: "Categoría › Subcategoría".
export function etiquetaItem(categoria: string, subcategoria: string): string {
  return subcategoria ? `${categoria} › ${subcategoria}` : categoria;
}
