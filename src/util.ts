/**
 * Normalizes thrown values from Promise rejections and library callbacks into a loggable string.
 * Ember+/Node often reject with non-Error values, so `instanceof Error` alone is insufficient.
 */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
