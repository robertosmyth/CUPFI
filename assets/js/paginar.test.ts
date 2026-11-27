import { describe, expect, it } from 'vitest';
import { traerTodo } from './paginar.ts';

const fuente = (n: number, tope = 1000) => {
  const filas = Array.from({ length: n }, (_, i) => i);
  const pedidos: Array<[number, number]> = [];
  const pedido = async (desde: number, hasta: number) => {
    pedidos.push([desde, hasta]);
    // como la API: nunca más que `tope` por pedido
    return { data: filas.slice(desde, Math.min(hasta + 1, desde + tope)), error: null };
  };
  return { pedido, pedidos };
};

describe('traerTodo', () => {
  it('trae todo aunque haya más filas que el corte de la API', async () => {
    const f = fuente(2500);
    const r = await traerTodo(f.pedido);
    expect(r).toHaveLength(2500);
    expect(r[2499]).toBe(2499);
    expect(f.pedidos).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('con justo una tanda completa hace un pedido extra vacío', async () => {
    const f = fuente(1000);
    expect(await traerTodo(f.pedido)).toHaveLength(1000);
    expect(f.pedidos).toHaveLength(2);
  });
  it('lista vacía', async () => {
    expect(await traerTodo(fuente(0).pedido)).toEqual([]);
  });
  it('propaga el error', async () => {
    await expect(traerTodo(async () => ({ data: null, error: new Error('x') }))).rejects.toThrow('x');
  });
});
