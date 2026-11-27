// ══════════════════════════════════════════════
// Lecturas completas sin el corte de la API.
//
// Supabase entrega como máximo 1000 filas por pedido y, si hay más, corta
// sin avisar. Para las listas que la app necesita enteras (empresas,
// ofertas/necesidades, perfiles…) se piden en tandas hasta traerlas todas.
// Cada tanda debe venir con un orden estable (por ejemplo, por id) para
// que ninguna fila se repita ni se saltee entre tandas.
// ══════════════════════════════════════════════
export const TANDA = 1000;

type Pedido<T> = (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>;

export async function traerTodo<T>(pedido: Pedido<T>, tanda = TANDA): Promise<T[]> {
  const todo: T[] = [];
  for (let desde = 0; ; desde += tanda) {
    const { data, error } = await pedido(desde, desde + tanda - 1);
    if (error) throw error;
    const filas = data || [];
    todo.push(...filas);
    if (filas.length < tanda) return todo;
  }
}
