import { describe, expect, it } from 'vitest';
import { allMatches, countMatches, findMatchesFor, groupMatchesByPair } from './matching.ts';
import type { Empresa } from './types.ts';

let nextId = 1;
function makeEmpresa(overrides: Partial<Empresa> & { uid?: string | null }): Empresa {
  return {
    id: nextId++,
    uid: overrides.uid ?? null,
    cuit: '30-00000000-0',
    tipo: 'Empresa',
    nombre: 'Empresa',
    sector: '',
    calle: '',
    ciudad: '',
    provincia: '',
    pais: 'Argentina',
    referente: '',
    cargo: '',
    emailOrg: '',
    tel: '',
    web: '',
    desc: '',
    logo: null,
    ofertas: [],
    instalaciones: [],
    needsUncovered: [],
    needsCovered: [],
    ...overrides,
  };
}

describe('allMatches', () => {
  it('detecta una coincidencia exacta cuando need y offer son el mismo texto normalizado', () => {
    const a = makeEmpresa({ nombre: 'Necesita', uid: 'user-a', needsUncovered: ['Mecanizado de piezas'] });
    const b = makeEmpresa({ nombre: 'Provee', uid: 'user-b', ofertas: ['  mecanizado   de piezas '] });
    const matches = allMatches([a, b]);
    expect(matches).toHaveLength(1);
    expect(matches[0].strength).toBe('strong');
    expect(matches[0].seeker.id).toBe(a.id);
    expect(matches[0].provider.id).toBe(b.id);
  });

  it('no cruza dos empresas del mismo administrador principal', () => {
    const a = makeEmpresa({ nombre: 'A', uid: 'user-x', needsUncovered: ['Soldadura'] });
    const b = makeEmpresa({ nombre: 'B', uid: 'user-x', ofertas: ['Soldadura'] });
    expect(allMatches([a, b])).toHaveLength(0);
  });

  it('no cruza empresas que comparten un usuario asociado (aunque uid difiera)', () => {
    const a = makeEmpresa({ nombre: 'A', uid: 'user-x', usuarios: ['user-x', 'user-shared'], needsUncovered: ['Soldadura'] });
    const b = makeEmpresa({ nombre: 'B', uid: 'user-y', usuarios: ['user-y', 'user-shared'], ofertas: ['Soldadura'] });
    expect(allMatches([a, b])).toHaveLength(0);
  });

  it('solo muestra coincidencia débil si no hay ninguna fuerte para esa necesidad', () => {
    const a = makeEmpresa({ nombre: 'A', uid: 'user-a', needsUncovered: ['Mantenimiento industrial pesado'] });
    const b = makeEmpresa({ nombre: 'B', uid: 'user-b', ofertas: ['Servicios de mantenimiento'] });
    const matches = allMatches([a, b]);
    expect(matches).toHaveLength(1);
    expect(matches[0].strength).toBe('weak');
  });

  it('oculta las coincidencias débiles de una necesidad si ya hay una fuerte', () => {
    const a = makeEmpresa({ nombre: 'A', uid: 'user-a', needsUncovered: ['Mecanizado de piezas'] });
    const b = makeEmpresa({ nombre: 'B', uid: 'user-b', ofertas: ['Mecanizado de piezas'] });
    const c = makeEmpresa({ nombre: 'C', uid: 'user-c', ofertas: ['Piezas mecanizadas especiales'] });
    const matches = allMatches([a, b, c]);
    expect(matches).toHaveLength(1);
    expect(matches[0].strength).toBe('strong');
    expect(matches[0].provider.id).toBe(b.id);
  });
});

describe('findMatchesFor', () => {
  it('devuelve solo las coincidencias donde la empresa dada es quien necesita', () => {
    const a = makeEmpresa({ nombre: 'A', uid: 'user-a', needsUncovered: ['Metrología'] });
    const b = makeEmpresa({ nombre: 'B', uid: 'user-b', ofertas: ['Metrología'] });
    const forA = findMatchesFor([a, b], a);
    expect(forA).toHaveLength(1);
    expect(forA[0].org.id).toBe(b.id);

    const forB = findMatchesFor([a, b], b);
    expect(forB).toHaveLength(0);
  });
});

describe('countMatches', () => {
  it('cuenta pares únicos, no una vez por cada necesidad que calza', () => {
    const a = makeEmpresa({
      nombre: 'A', uid: 'user-a',
      needsUncovered: ['Soldadura', 'Metrología'],
    });
    const b = makeEmpresa({
      nombre: 'B', uid: 'user-b',
      ofertas: ['Soldadura', 'Metrología'],
    });
    expect(allMatches([a, b])).toHaveLength(2); // dos coincidencias individuales...
    expect(countMatches([a, b])).toBe(1); // ...pero un solo par de empresas
  });
});

describe('groupMatchesByPair', () => {
  it('agrupa todas las coincidencias de un mismo par seeker/provider en una sola entrada', () => {
    const a = makeEmpresa({ nombre: 'A', uid: 'user-a', needsUncovered: ['Soldadura', 'Metrología'] });
    const b = makeEmpresa({ nombre: 'B', uid: 'user-b', ofertas: ['Soldadura', 'Metrología'] });
    const grouped = groupMatchesByPair(allMatches([a, b]));
    expect(grouped).toHaveLength(1);
    expect(grouped[0].items).toHaveLength(2);
  });
});
