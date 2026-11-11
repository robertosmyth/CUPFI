import { describe, expect, it } from 'vitest';
import { buscarEmpresas, nivelDe } from './busqueda.ts';
import type { Categoria, Empresa, EmpresaItem, ItemTipo } from './types.ts';

const SOLD: Categoria = { id: 1, nombre: 'Soldadura', subcategorias: ['TIG'], orden: 1, esOtros: false };
const OTROS: Categoria = { id: 99, nombre: 'Otros', subcategorias: [], orden: 1000, esOtros: true };

let nextId = 1;
const item = (tipo: ItemTipo, categoriaId: number, subcategoria = ''): EmpresaItem => ({ tipo, categoriaId, subcategoria, revisar: false });
function emp(nombre: string, items: EmpresaItem[], usuarios: string[] = ['u' + nextId]): Empresa {
  return {
    id: nextId++, uid: usuarios[0] || null, cuit: '', tipo: 'Empresa', nombre, sector: '', calle: '', ciudad: '',
    provincia: '', pais: '', referente: '', cargo: '', emailOrg: '', tel: '', web: '', desc: '',
    logo: null, instalaciones: [], needsCovered: [], items, usuarios,
  };
}

describe('nivelDe', () => {
  it('distingue exacta, parecida y misma categoría (sin tildes ni mayúsculas)', () => {
    expect(nivelDe('Soldadura TIG', 'soldadura tig', false)).toBe('exacta');
    expect(nivelDe('Grúas portuarias', 'gruas', false)).toBe('parecida');
    expect(nivelDe('MIG/MAG', 'TIG', false)).toBe('categoria');
    expect(nivelDe('MIG/MAG', '', false)).toBe('categoria');
  });
  it('en "Otros" solo cuenta el detalle escrito', () => {
    expect(nivelDe('Grúas portuarias', '', true)).toBeNull();
    expect(nivelDe('Grúas portuarias', 'pintura', true)).toBeNull();
    expect(nivelDe('Grúas portuarias', 'grúas portuarias', true)).toBe('exacta');
  });
});

describe('buscarEmpresas', () => {
  const a = emp('Alfa', [item('oferta', 1, 'MIG/MAG'), item('necesidad', 1, 'TIG')]);
  const b = emp('Beta', [item('oferta', 1, 'TIG')]);
  const c = emp('Gamma', [item('oferta', 1, 'TIG')], []); // sin usuarios
  const d = emp('Delta', [item('oferta', 99, 'Grúas portuarias')]);
  const orgs = [a, b, c, d];

  it('conseguir busca en ofertas, con la mejor coincidencia primero y las sin usuarios al final', () => {
    const r = buscarEmpresas(orgs, SOLD, 'tig', 'conseguir', new Set());
    expect(r.map(x => x.empresa.nombre)).toEqual(['Beta', 'Alfa', 'Gamma']);
    expect(r[0].mejor).toBe('exacta');
    expect(r[1].mejor).toBe('categoria');
    expect(r[2].sinUsuarios).toBe(true);
  });
  it('ofrecer busca en necesidades', () => {
    const r = buscarEmpresas(orgs, SOLD, '', 'ofrecer', new Set());
    expect(r.map(x => x.empresa.nombre)).toEqual(['Alfa']);
  });
  it('excluye mis empresas', () => {
    const r = buscarEmpresas(orgs, SOLD, 'tig', 'conseguir', new Set([b.id]));
    expect(r.map(x => x.empresa.nombre)).not.toContain('Beta');
  });
  it('en "Otros" exige texto y encuentra por parte del detalle', () => {
    expect(buscarEmpresas(orgs, OTROS, '', 'conseguir', new Set())).toHaveLength(0);
    const r = buscarEmpresas(orgs, OTROS, 'gruas', 'conseguir', new Set());
    expect(r.map(x => x.empresa.nombre)).toEqual(['Delta']);
    expect(r[0].mejor).toBe('parecida');
  });
});
