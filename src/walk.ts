import type { EmberClient } from 'emberplus-connection'
import { Model } from 'emberplus-connection'
import { PATH_DELIMITER, type ParentGroupMember, type VariableDefinition } from './definitions/shared.js'
import { errorMessage } from './util.js'

export interface WalkOptions {
	readonly concurrency: number
	// A task that times out is re-queued at the back; without this a single dropped directory
	// silently loses every definition beneath it for the whole session.
	readonly maxAttempts: number
}

export interface WalkCallbacks {
	// A definition that resolved to a live parameter node, with its contents already populated.
	onParameter(def: VariableDefinition, node: Model.NumberedTreeNode<Model.Parameter>): void
	// A definition whose parent loaded but which the unit does not carry.
	onAbsent(def: VariableDefinition): void
	isCancelled(): boolean
	log(level: 'debug' | 'warn', message: string): void
	// Lets the caller yield the pool to latency-sensitive on-demand requests.
	beforeTask?(): Promise<void>
}

export interface WalkStats {
	// Directories we issued a getDirectory for.
	requested: number
	// Child paths skipped because their parent came back empty (unfitted option blocks).
	pruned: number
	retried: number
	failed: number
}

// A node worth descending into. `children` is only populated once a getDirectory response has come
// back, so its presence doubles as "already loaded"; `isOnline === false` marks an unfitted block.
function hasChildren(node: Model.TreeElement<Model.EmberElement>): boolean {
	if (node.contents.type === Model.ElementType.Node && node.contents.isOnline === false) return false
	return node.children !== undefined && Object.keys(node.children).length > 0
}

// Every distinct prefix of every parent path, mapped to the child segments worth descending into.
// Precomputed so a parent that has just loaded knows in O(1) which children are on a wanted path.
function planDescent(parentPaths: Iterable<string>): { roots: string[]; wantedChildren: Map<string, string[]> } {
	const prefixes = new Set<string>()
	for (const path of parentPaths) {
		const segments = path.split(PATH_DELIMITER)
		for (let depth = 1; depth <= segments.length; depth++) {
			prefixes.add(segments.slice(0, depth).join(PATH_DELIMITER))
		}
	}

	const roots: string[] = []
	const wantedChildren = new Map<string, string[]>()
	for (const prefix of prefixes) {
		const segments = prefix.split(PATH_DELIMITER)
		if (segments.length === 1) {
			roots.push(prefix)
			continue
		}
		const leaf = segments.pop()!
		const parent = segments.join(PATH_DELIMITER)
		const siblings = wantedChildren.get(parent) ?? []
		siblings.push(leaf)
		wantedChildren.set(parent, siblings)
	}
	return { roots, wantedChildren }
}

interface WalkTask {
	readonly path: string
	readonly attempt: number
}

// Walks only the paths the definition tables actually reference, breadth-first, with no barrier
// between depth levels — a parent that resolves immediately enqueues its live children, so the
// pool stays saturated instead of draining at every level boundary.
//
// Seeding is merged into the walk: a parent's getDirectory response already carries each child's
// complete contents (value, min/max, factor, enumeration, access), so definitions are resolved the
// moment their parent lands rather than in a second pass.
export async function walkDefinitions(
	client: EmberClient,
	groups: Map<string, ParentGroupMember[]>,
	opts: WalkOptions,
	cb: WalkCallbacks,
): Promise<WalkStats> {
	const { roots, wantedChildren } = planDescent(groups.keys())
	const stats: WalkStats = { requested: 0, pruned: 0, retried: 0, failed: 0 }

	const queue: WalkTask[] = roots.map((path) => ({ path, attempt: 1 }))
	const queued = new Set<string>(roots)
	let inFlight = 0

	// Everything beneath a parent that came back empty is skipped outright, so an unfitted block
	// costs one request rather than one per descendant. Definitions under it are reported absent
	// here rather than in `seed`, which only ever sees parents that did load.
	const prune = (path: string): void => {
		for (const { def } of groups.get(path) ?? []) cb.onAbsent(def)
		const children = wantedChildren.get(path)
		if (!children) return
		stats.pruned += children.length
		for (const child of children) prune(`${path}${PATH_DELIMITER}${child}`)
	}

	const seed = (path: string, node: Model.TreeElement<Model.EmberElement>): void => {
		const members = groups.get(path)
		if (!members) return
		const children = node.children ? Object.values(node.children) : []
		for (const { leaf, def } of members) {
			const child = children.find((c) => 'identifier' in c.contents && c.contents.identifier === leaf)
			if (child?.contents.type !== Model.ElementType.Parameter) {
				cb.onAbsent(def)
				continue
			}
			cb.onParameter(def, child as Model.NumberedTreeNode<Model.Parameter>)
		}
	}

	const runTask = async ({ path, attempt }: WalkTask): Promise<void> => {
		let node: Model.TreeElement<Model.EmberElement> | undefined
		try {
			node = await client.getElementByPath(path, undefined, PATH_DELIMITER)
		} catch {
			node = undefined
		}

		if (node?.contents.type !== Model.ElementType.Node) {
			prune(path)
			return
		}

		// A node may already hold children from its parent's response; only ask when it doesn't.
		if (!hasChildren(node)) {
			stats.requested++
			try {
				await (
					await client.getDirectory(node as Model.NumberedTreeNode<Model.EmberElement>)
				).response
			} catch (error) {
				const message = errorMessage(error)
				if (attempt < opts.maxAttempts && !cb.isCancelled()) {
					stats.retried++
					queue.push({ path, attempt: attempt + 1 })
					return
				}
				stats.failed++
				cb.log('debug', `Directory "${path}" not loaded after ${attempt} attempt(s): ${message}`)
				prune(path)
				return
			}
		}

		if (!hasChildren(node)) {
			prune(path)
			return
		}

		seed(path, node)

		for (const child of wantedChildren.get(path) ?? []) {
			const childPath = `${path}${PATH_DELIMITER}${child}`
			if (queued.has(childPath)) continue
			queued.add(childPath)
			queue.push({ path: childPath, attempt: 1 })
		}
	}

	const worker = async (): Promise<void> => {
		// Drain on "queue empty AND nothing in flight" — an in-flight task can still enqueue children.
		while (queue.length > 0 || inFlight > 0) {
			const task = queue.shift()
			if (!task) {
				await new Promise((resolve) => setImmediate(resolve))
				continue
			}
			if (cb.isCancelled()) return
			if (cb.beforeTask) await cb.beforeTask()

			inFlight++
			try {
				await runTask(task)
			} finally {
				inFlight--
			}
		}
	}

	await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker))
	return stats
}
