/**
 * Normalizes thrown values from Promise rejections and library callbacks into a loggable string.
 * Ember+/Node often reject with non-Error values, so `instanceof Error` alone is insufficient.
 */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export class DeadlineError extends Error {}

// emberplus-connection keys in-flight requests by a random 4-character id. Two that collide
// overwrite each other, and the first one's promise then never settles — not even by timing out.
// Anything awaited on the library goes through this, so an orphaned request fails like a timeout.
export async function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined
	const deadline = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new DeadlineError(`No reply to ${what} within ${ms}ms`)), ms)
	})
	try {
		return await Promise.race([promise, deadline])
	} finally {
		clearTimeout(timer)
	}
}
