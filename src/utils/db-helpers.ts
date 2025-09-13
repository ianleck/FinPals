/**
 * Helper utilities for database result handling
 */

/**
 * Extract first result from a database query result
 */
export function getFirstResult<T>(result: unknown): T | null {
    const results = result as T[];
    return results?.[0] ?? null;
}

/**
 * Convert database results to array
 */
export function toResultArray<T>(result: unknown): T[] {
    return (result as T[]) ?? [];
}

/**
 * Check if result has any rows
 */
export function hasResults(result: unknown): boolean {
    const results = result as any[];
    return results && results.length > 0;
}