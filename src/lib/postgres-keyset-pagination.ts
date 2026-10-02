// ============================================================
// src/lib/postgres-keyset-pagination.ts
//
// TASK 1b — Helper de Keyset Pagination (ROW-VALUES idiom)
// para evitar OFFSET en tablas con millones de registros.
//
// NFR-07: Ninguna query de alertas top N usa OFFSET.
// Principio: O(M log N) por página vs O(N) de OFFSET.
// ============================================================

export type KeysetOrderDirection = 'asc' | 'desc';
export type KeysetPrimitive = string | number | bigint | boolean | Date | null;
export type KeysetOrderColumn = [string, KeysetOrderDirection];

/**
 * Construye la cláusula WHERE (key1, key2, ...) OP (?, ?, ...)
 * para navegación cursor-based sin OFFSET.
 *
 * Ejemplo: order = [['diff', 'desc'], ['id', 'asc']], cursor = { diff: 0.05, id: 'cm123' }
 * → "(diff, id) < (0.05::numeric, 'cm123'::text)"  [en Prisma $queryRaw interpolado]
 *
 * @returns Fragmento SQL con placeholders {n} + arreglo de parámetros ordenados.
 */
export function buildKeysetWhere<T extends Record<string, KeysetPrimitive>>(
    order: readonly KeysetOrderColumn[],
    cursor: T | null,
    options: { placeholderPrefix?: string } = {},
): { sql: string; params: unknown[] } {
    if (order.length === 0) {
        return { sql: 'TRUE', params: [] };
    }
    if (!cursor) {
        return { sql: 'TRUE', params: [] };
    }

    const prefix = options.placeholderPrefix ?? '$';
    const cols: string[] = [];
    const params: unknown[] = [];
    const placeholders: string[] = [];
    const ops: ('<' | '>')[] = [];

    for (const [col, dir] of order) {
        cols.push(col);
        params.push((cursor as never)[col]);
        placeholders.push(`${prefix}${params.length}`);
        // direction 'desc' → siguientes valores son MENORES (<)
        // direction 'asc'  → siguientes valores son MAYORES (>)
        ops.push(dir === 'desc' ? '<' : '>');
    }

    // Postgres ROW values tuple comparison. Si todas las cols son
    // DESC → OP unificado '<'. Si todas ASC → '>'.
    const uniform = ops.every(op => op === ops[0]);
    if (uniform) {
        return {
            sql: `(${cols.join(', ')}) ${ops[0]} (${placeholders.join(', ')})`,
            params,
        };
    }

    // Mix de direcciones (no común pero seguro): construir
    // cláusula de lexicográficación manual.
    const clauses: string[] = [];
    for (let i = 0; i < order.length; i++) {
        const prev = order
            .slice(0, i)
            .map(([c], j) => `${c} = ${placeholders[j]}`)
            .join(' AND ');
        const cur = `${cols[i]} ${ops[i]} ${placeholders[i]}`;
        clauses.push(prev ? `(${prev} AND ${cur})` : cur);
    }
    return { sql: `(${clauses.join(' OR ')})`, params };
}

/**
 * Alias semántico para el cursor de alertas.
 */
export type SbcSdiAlertCursor = { diff: number; id: string };
export const SBC_SDI_ORDER: KeysetOrderColumn[] = [
    ['diff', 'desc'],
    ['id', 'asc'],
];

export type BrechaTimbradoCursor = { brecha_dias: number; id: string };
export const BRECHA_TIMBRADO_ORDER: KeysetOrderColumn[] = [
    ['brecha_dias', 'desc'],
    ['id', 'asc'],
];
