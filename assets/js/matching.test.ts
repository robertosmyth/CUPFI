import { describe, expect, it } from 'vitest';
import {
  armarMisConexiones, calcularSugerencias, claveConexion, estadoConexion, estadoNeutral,
  etiquetaItem, isSameOwner, ladoDe, matchesEntre, recomendacionesPara,
} from './matching.ts';
import type { Categoria, ConexionRow, Empresa, EmpresaItem, ItemTipo } from './types.ts';

const SOLD: Categoria = { id: 1, nombre: 'Soldadura', subcategorias: ['TIG', 'MIG/MAG'], orden: 1, esOtros: false };
const METRO: Categoria = { id: 2, nombre: 'Metrología', subcategorias: [], orden: 2, esOtros: false };
const OTROS: Categoria = { id: 99, nombre: 'Otros', subcategorias: [], orden: 1000, esOtros: true };
const CATS = [SOLD, METRO, OTROS];

let nextId = 1;
function item(tipo: ItemTipo, categoriaId: number, subcategoria = ''): EmpresaItem {
  return { tipo, categoriaId, subcategoria, revisar: false };
}
function makeEmpresa(nombre: string, uid: string | null, items: EmpresaItem[], usuarios?: string[]): Empresa {
  return {
    id: nextId++, uid, cuit: '30-00000000-0', tipo: 'Empresa', nombre, sector: '', calle: '', ciudad: '',
    provincia: '', pais: 'Argentina', referente: '', cargo: '', emailOrg: '', tel: '', web: '', desc: '',
    logo: null, instalaciones: [], needsCovered: [], items, usuarios,
  };
}
function row(n: Empresa, o: Empresa, cat: Categoria, extra: Partial<ConexionRow> = {}): ConexionRow {
  return {
    id: nextId++, empresa_necesita_id: n.id, empresa_ofrece_id: o.id, categoria_id: cat.id,
    acepta_necesita_at: null, acepta_necesita_por: null, acepta_ofrece_at: null, acepta_ofrece_por: null,
    rechazada_at: null, rechazada_por: null, rechazada_empresa_id: null, match_at: null,
    created_at: '2026-01-01', updated_at: '2026-01-01', ...extra,
  };
}

describe('calcularSugerencias', () => {
  it('agrupa por necesidad y empresa, ramificando por subcategoría', () => {
    const a = makeEmpresa('A', 'ua', [item('necesidad', 1, 'TIG')]);
    const b = makeEmpresa('B', 'ub', [item('oferta', 1, 'TIG'), item('oferta', 1, 'MIG/MAG')]);
    const s = calcularSugerencias([a, b], CATS);
    expect(s).toHaveLength(1);
    expect(s[0].necesita.id).toBe(a.id);
    expect(s[0].ofrece.id).toBe(b.id);
    expect(s[0].key).toBe(claveConexion(a.id, b.id, 1));
    expect(s[0].nivel).toBe('exacta');
    expect(s[0].pares).toEqual([
      { necesidad: 'TIG', oferta: 'TIG', nivel: 'exacta' },
      { necesidad: 'TIG', oferta: 'MIG/MAG', nivel: 'categoria' },
    ]);
  });

  it('misma categoría con distinta subcategoría también conecta, como "categoria"', () => {
    const a = makeEmpresa('A', 'ua', [item('necesidad', 1, 'TIG')]);
    const b = makeEmpresa('B', 'ub', [item('oferta', 1, 'Electrodo')]);
    const s = calcularSugerencias([a, b], CATS);
    expect(s).toHaveLength(1);
    expect(s[0].nivel).toBe('categoria');
  });

  it('la subcategoría exacta se compara normalizada (mayúsculas, acentos, espacios)', () => {
    const a = makeEmpresa('A', 'ua', [item('necesidad', 1, '  tig ')]);
    const b = makeEmpresa('B', 'ub', [item('oferta', 1, 'TIG')]);
    expect(calcularSugerencias([a, b], CATS)[0].nivel).toBe('exacta');
  });

  it('no conecta categorías distintas', () => {
    const a = makeEmpresa('A', 'ua', [item('necesidad', 1, 'TIG')]);
    const b = makeEmpresa('B', 'ub', [item('oferta', 2, 'TIG')]);
    expect(calcularSugerencias([a, b], CATS)).toHaveLength(0);
  });

  it('en "Otros" solo conecta con subcategoría idéntica', () => {
    const a = makeEmpresa('A', 'ua', [item('necesidad', 99, 'Grúas')]);
    const b = makeEmpresa('B', 'ub', [item('oferta', 99, 'Gruas'), item('oferta', 99, 'Andamios')]);
    const c = makeEmpresa('C', 'uc', [item('oferta', 99, 'Andamios')]);
    const s = calcularSugerencias([a, b, c], CATS);
    expect(s).toHaveLength(1);
    expect(s[0].ofrece.id).toBe(b.id);
    expect(s[0].pares).toEqual([{ necesidad: 'Grúas', oferta: 'Gruas', nivel: 'exacta' }]);
  });

  it('calcula ambas direcciones como conexiones separadas', () => {
    const a = makeEmpresa('A', 'ua', [item('necesidad', 1, 'TIG'), item('oferta', 2)]);
    const b = makeEmpresa('B', 'ub', [item('oferta', 1, 'TIG'), item('necesidad', 2)]);
    const keys = calcularSugerencias([a, b], CATS).map(x => x.key).sort();
    expect(keys).toEqual([claveConexion(a.id, b.id, 1), claveConexion(b.id, a.id, 2)].sort());
  });

  it('no cruza empresas del mismo titular ni que comparten un usuario asociado', () => {
    const a = makeEmpresa('A', 'ux', [item('necesidad', 1, 'TIG')]);
    const b = makeEmpresa('B', 'ux', [item('oferta', 1, 'TIG')]);
    expect(calcularSugerencias([a, b], CATS)).toHaveLength(0);
    const c = makeEmpresa('C', 'u1', [item('necesidad', 1, 'TIG')], ['u1', 'shared']);
    const d = makeEmpresa('D', 'u2', [item('oferta', 1, 'TIG')], ['u2', 'shared']);
    expect(calcularSugerencias([c, d], CATS)).toHaveLength(0);
    expect(isSameOwner(c, d)).toBe(true);
  });

  it('ignora ítems de categorías que ya no existen', () => {
    const a = makeEmpresa('A', 'ua', [item('necesidad', 555)]);
    const b = makeEmpresa('B', 'ub', [item('oferta', 555)]);
    expect(calcularSugerencias([a, b], CATS)).toHaveLength(0);
  });
});

describe('estadoConexion', () => {
  const a = makeEmpresa('A', 'ua', []);
  const b = makeEmpresa('B', 'ub', []);
  it('sin fila es sugerida', () => {
    expect(estadoConexion(undefined, 'necesita')).toBe('sugerida');
  });
  it('quien aceptó espera a la otra; la otra ve que ya aceptaron', () => {
    const r = row(a, b, SOLD, { acepta_necesita_at: 'x' });
    expect(estadoConexion(r, 'necesita')).toBe('esperando_otra');
    expect(estadoConexion(r, 'ofrece')).toBe('otra_acepto');
    expect(estadoNeutral(r)).toBe('acepto_necesita');
  });
  it('match y rechazo', () => {
    expect(estadoConexion(row(a, b, SOLD, { acepta_necesita_at: 'x', acepta_ofrece_at: 'y', match_at: 'y' }), 'ofrece')).toBe('match');
    expect(estadoConexion(row(a, b, SOLD, { acepta_necesita_at: 'x', rechazada_at: 'z' }), 'ofrece')).toBe('rechazada');
  });
  it('fila con aceptaciones retiradas vuelve a sugerida', () => {
    expect(estadoConexion(row(a, b, SOLD), 'ofrece')).toBe('sugerida');
    expect(estadoNeutral(row(a, b, SOLD))).toBe('sugerida');
  });
});

describe('ladoDe', () => {
  it('identifica el lado según mis empresas', () => {
    expect(ladoDe(1, 2, new Set([1]))).toBe('necesita');
    expect(ladoDe(1, 2, new Set([2]))).toBe('ofrece');
    expect(ladoDe(1, 2, new Set([3]))).toBeNull();
  });
});

describe('armarMisConexiones', () => {
  it('combina sugerencias con estado y solo devuelve las de mis empresas', () => {
    const a = makeEmpresa('A', 'ua', [item('necesidad', 1, 'TIG')]);
    const b = makeEmpresa('B', 'ub', [item('oferta', 1, 'TIG')]);
    const c = makeEmpresa('C', 'uc', [item('oferta', 1, 'TIG')]);
    const orgs = [a, b, c];
    const sug = calcularSugerencias(orgs, CATS);
    const rows = [row(a, b, SOLD, { acepta_ofrece_at: 'x' })];
    const mias = armarMisConexiones(sug, rows, orgs, CATS, new Set([b.id]));
    expect(mias).toHaveLength(1);
    expect(mias[0].lado).toBe('ofrece');
    expect(mias[0].estado).toBe('esperando_otra');
    const deA = armarMisConexiones(sug, rows, orgs, CATS, new Set([a.id]));
    expect(deA.map(v => v.estado).sort()).toEqual(['otra_acepto', 'sugerida']);
  });

  it('mantiene una conexión respondida cuya coincidencia desapareció, marcada como no vigente', () => {
    const a = makeEmpresa('A', 'ua', []); // ya no necesita nada
    const b = makeEmpresa('B', 'ub', [item('oferta', 1, 'TIG')]);
    const rows = [row(a, b, SOLD, { acepta_necesita_at: 'x' })];
    const mias = armarMisConexiones(calcularSugerencias([a, b], CATS), rows, [a, b], CATS, new Set([a.id]));
    expect(mias).toHaveLength(1);
    expect(mias[0].vigente).toBe(false);
    expect(mias[0].pares).toEqual([]);
    expect(mias[0].nivel).toBeNull();
    expect(mias[0].estado).toBe('esperando_otra');
  });
});

describe('recomendacionesPara y matchesEntre', () => {
  it('recomienda las demás conexiones abiertas entre las dos empresas, en ambas direcciones', () => {
    const a = makeEmpresa('A', 'ua', [item('necesidad', 1, 'TIG'), item('oferta', 2), item('necesidad', 99, 'Grúas')]);
    const b = makeEmpresa('B', 'ub', [item('oferta', 1, 'TIG'), item('necesidad', 2), item('oferta', 99, 'Grúas')]);
    const c = makeEmpresa('C', 'uc', [item('necesidad', 2)]);
    const orgs = [a, b, c];
    const sug = calcularSugerencias(orgs, CATS);
    const matchRow = row(a, b, SOLD, { acepta_necesita_at: 'x', acepta_ofrece_at: 'y', match_at: 'y' });
    const rechazo = row(a, b, OTROS, { rechazada_at: 'z' });
    const vistas = armarMisConexiones(sug, [matchRow, rechazo], orgs, CATS, new Set([a.id]));
    const rec = recomendacionesPara(vistas, a.id, b.id, claveConexion(a.id, b.id, 1));
    expect(rec.map(v => v.key)).toEqual([claveConexion(b.id, a.id, 2)]);
    const chats = matchesEntre(vistas, b.id, a.id);
    expect(chats.map(v => v.key)).toEqual([claveConexion(a.id, b.id, 1)]);
  });
});

describe('etiquetaItem', () => {
  it('arma "Categoría › Subcategoría"', () => {
    expect(etiquetaItem('Soldadura', 'TIG')).toBe('Soldadura › TIG');
    expect(etiquetaItem('Soldadura', '')).toBe('Soldadura');
  });
});
