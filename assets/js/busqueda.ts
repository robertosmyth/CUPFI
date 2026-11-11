// ══════════════════════════════════════════════
// Buscador preciso de "quiero conseguir / quiero ofrecer" (sin DOM, para
// poder probarlo). Busca en los servicios/productos o necesidades
// cargados por las empresas, por categoría y, opcionalmente, subcategoría.
//  · conseguir → empresas que OFRECEN eso
//  · ofrecer   → empresas que lo NECESITAN
// ══════════════════════════════════════════════
import { normalizeTagKey } from './utils.ts';
import type { Categoria, Empresa, EmpresaItem, SolicitudTipo } from './types.ts';

// exacta: misma subcategoría · parecida: una contiene a la otra ·
// categoria: mismo rubro, otra subcategoría (no aplica en "Otros", donde
// solo cuenta el detalle escrito).
export type NivelBusqueda = 'exacta' | 'parecida' | 'categoria';

export interface ItemEncontrado {
  item: EmpresaItem;
  nivel: NivelBusqueda;
}

export interface ResultadoBusqueda {
  empresa: Empresa;
  items: ItemEncontrado[];
  mejor: NivelBusqueda;
  sinUsuarios: boolean; // nadie en la red puede responder por ella
}

const ORDEN: Record<NivelBusqueda, number> = { exacta: 0, parecida: 1, categoria: 2 };

export function nivelDe(subItem: string, buscado: string, esOtros: boolean): NivelBusqueda | null {
  const a = normalizeTagKey(subItem);
  const b = normalizeTagKey(buscado);
  if (!b) return esOtros ? null : 'categoria';
  if (a === b) return 'exacta';
  if (a && (a.includes(b) || b.includes(a))) return 'parecida';
  return esOtros ? null : 'categoria';
}

export function buscarEmpresas(
  orgs: Empresa[], categoria: Categoria, subcategoria: string, modo: SolicitudTipo, excluir: Set<number>,
): ResultadoBusqueda[] {
  const tipo = modo === 'conseguir' ? 'oferta' : 'necesidad';
  const out: ResultadoBusqueda[] = [];
  for (const o of orgs) {
    if (excluir.has(o.id)) continue;
    const items: ItemEncontrado[] = [];
    for (const it of o.items || []) {
      if (it.tipo !== tipo || it.categoriaId !== categoria.id) continue;
      const nivel = nivelDe(it.subcategoria, subcategoria, categoria.esOtros);
      if (nivel) items.push({ item: it, nivel });
    }
    if (!items.length) continue;
    items.sort((x, y) => ORDEN[x.nivel] - ORDEN[y.nivel] || x.item.subcategoria.localeCompare(y.item.subcategoria, 'es'));
    out.push({ empresa: o, items, mejor: items[0].nivel, sinUsuarios: !(o.usuarios || []).length });
  }
  // Primero las que tienen alguien que responda y la mejor coincidencia.
  out.sort((x, y) => Number(x.sinUsuarios) - Number(y.sinUsuarios)
    || ORDEN[x.mejor] - ORDEN[y.mejor]
    || x.empresa.nombre.localeCompare(y.empresa.nombre, 'es'));
  return out;
}
