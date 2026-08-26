import { InstanceStatus } from '@companion-module/base'
import { EmberClient, Model, Types } from 'emberplus-connection'
import { isWritable, type ControlSpec } from './definitions/controls.js'
import type { ModuleInstance } from './main.js'
import { describeIdentitySource, getModelSpec, type ModelSpec } from './models.js'
import { formatValue, groupByParent, PATH_DELIMITER, type ParentGroupMember, type VariableDefinition } from './state.js'
import { errorMessage } from './util.js'
import { walkDefinitions } from './walk.js'

const RECONNECT_INTERVAL_MS = 5000
const POPULATE_CONCURRENCY = 32
const REQUEST_TIMEOUT_MS = 10000
const HEARTBEAT_INTERVAL_MS = 8000
const WALK_MAX_ATTEMPTS = 3

// A definition matched to the live parameter node it resolved to. The node is what `setValue` and
// `subscribe` need; everything else comes from `def.control`.
interface LiveParameter {
	readonly def: VariableDefinition
	readonly node: Model.NumberedTreeNode<Model.Parameter>
	// Un-scaled, pre-enum-label value, kept current for adjust/toggle.
	latestRaw: Types.EmberValue | undefined
}

// Run `worker` over `items` with at most `limit` promises in flight at a time.
async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
	let index = 0
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (index < items.length) {
			await worker(items[index++])
		}
	})
	await Promise.all(runners)
}

function numericPath(node: Model.NumberedTreeNode<Model.EmberElement>): string {
	const segments: number[] = []
	let current: Model.TreeElement<Model.EmberElement> | undefined = node
	while (current && 'number' in current) {
		segments.unshift((current as Model.NumberedTreeNode<Model.EmberElement>).number)
		current = current.parent
	}
	return segments.join('.')
}

// emberplus-connection sends a command with the node's full contents attached; the units treat the
// value riding along as a write, which re-applies dependent defaults. Address by path instead.
function subscribeTarget(node: Model.NumberedTreeNode<Model.Parameter>): Model.QualifiedElement<Model.Parameter> {
	return new Model.QualifiedElementImpl(numericPath(node), { type: Model.ElementType.Parameter } as Model.Parameter)
}

// As above, plus the type needed to encode the value.
function writeTarget(node: Model.NumberedTreeNode<Model.Parameter>): Model.QualifiedElement<Model.Parameter> {
	return new Model.QualifiedElementImpl(numericPath(node), {
		type: Model.ElementType.Parameter,
		parameterType: node.contents.parameterType,
	})
}

export class ForaApi {
	readonly #self: ModuleInstance
	#client: EmberClient | null = null
	#reconnectTimer: NodeJS.Timeout | null = null
	#heartbeatTimer: NodeJS.Timeout | null = null
	#destroyed = false
	// Set while retrying after a drop, so each failed attempt doesn't repeat the same warning.
	#retrying = false
	// Parameters this unit actually carries, resolved on the current connection.
	readonly #live = new Map<string, LiveParameter>()

	constructor(self: ModuleInstance) {
		this.#self = self
	}

	async connect(): Promise<void> {
		this.#retrying = false
		await this.#openConnection()
	}

	async #openConnection(): Promise<void> {
		this.#destroyed = false
		await this.#teardownClient()

		const { host, model } = this.#self.config
		if (!host) {
			this.#self.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}

		const spec = getModelSpec(model)
		this.#self.log('debug', `Connecting to ${spec.label} at ${host}:${spec.port}`)
		this.#self.updateStatus(InstanceStatus.Connecting)

		const client = new EmberClient(host, spec.port, REQUEST_TIMEOUT_MS)
		this.#client = client

		client.on('disconnected', () => this.#handleDrop('Disconnected'))
		client.on('error', (error: Error) => this.#handleDrop(error.message))

		let connectResult: void | Error
		try {
			connectResult = await client.connect()
		} catch (error) {
			this.#handleDrop(errorMessage(error))
			return
		}
		if (connectResult instanceof Error) {
			this.#handleDrop(connectResult.message)
			return
		}
		if (this.#client !== client) return // superseded by a newer connect()/teardown

		this.#self.log(
			'info',
			`${this.#retrying ? 'Reconnected' : 'Connected'} to ${spec.label} at ${host}:${spec.port}, verifying model...`,
		)
		await this.#verifyModel(client, spec)
	}

	async #verifyModel(client: EmberClient, spec: ModelSpec): Promise<void> {
		let deviceId: string | undefined
		try {
			deviceId = await this.#readDeviceId(client, spec)
		} catch (error) {
			// A failed read is treated as a transient connection problem.
			this.#handleDrop(errorMessage(error))
			return
		}

		if (this.#client !== client) return // superseded while awaiting

		if (deviceId === undefined) {
			this.#handleDrop(`Could not read device model from ${describeIdentitySource(spec.identity)}`)
			return
		}

		if (deviceId !== spec.deviceId) {
			this.#self.log(
				'error',
				`Model mismatch: device reports "${deviceId}" but config is set to ${spec.label} ("${spec.deviceId}")`,
			)
			this.#self.updateStatus(InstanceStatus.BadConfig, `Wrong model: device is "${deviceId}", expected ${spec.label}`)
			this.#retrying = false
			await this.#teardownClient() // config error, not transient — stop without reconnecting
			return
		}

		this.#self.log('info', `Device model confirmed: ${deviceId}`)
		this.#self.updateStatus(InstanceStatus.Ok)
		this.#retrying = false

		this.#startHeartbeat(client)
		await this.#seedValues(client)
	}

	// Reads every declared parameter, then subscribes. Actions, feedbacks and variables already
	// exist at this point — this only fills them in.
	async #seedValues(client: EmberClient): Promise<void> {
		this.#live.clear()
		const started = Date.now()

		const absentByKey = new Map<string, { count: number; sample: string }>()
		const groups: Map<string, ParentGroupMember[]> = groupByParent(this.#self.definitions)

		const stats = await walkDefinitions(
			client,
			groups,
			{ concurrency: POPULATE_CONCURRENCY, maxAttempts: WALK_MAX_ATTEMPTS },
			{
				onParameter: (def, node) => {
					this.#self.state.set(def.id, formatValue(def.control, node.contents.value))
					this.#live.set(def.id, { def, node, latestRaw: node.contents.value })
				},
				// Expected: subtrees are config-dependent and option blocks may be unfitted. The
				// action stays in the UI either way; setting one that isn't there just warns.
				onAbsent: (def) => {
					const key = def.group?.key ?? def.id
					const tally = absentByKey.get(key) ?? { count: 0, sample: def.path }
					tally.count++
					absentByKey.set(key, tally)
				},
				isCancelled: () => this.#client !== client,
				log: (level, message) => this.#self.log(level, message),
			},
		)

		if (this.#client !== client) return

		let absentTotal = 0
		for (const [key, { count, sample }] of [...absentByKey].sort((a, b) => b[1].count - a[1].count)) {
			absentTotal += count
			this.#self.log('debug', `${key}: ${count} absent on this unit (e.g. "${sample}")`)
		}
		this.#self.log(
			'debug',
			`Loaded ${stats.requested} directories in ${Date.now() - started}ms; pruned ${stats.pruned} under ` +
				`absent parents, retried ${stats.retried}, gave up on ${stats.failed}`,
		)
		this.#self.log(
			'debug',
			`Found ${this.#live.size}/${this.#self.definitions.length} parameters (${absentTotal} absent on this unit)`,
		)

		// One request per parameter, so it runs after every value is already current as of its read.
		await this.#subscribeAll(client)
	}

	async #subscribeAll(client: EmberClient): Promise<void> {
		await runPool([...this.#live.values()], POPULATE_CONCURRENCY, async (live) => {
			try {
				await client.subscribe(subscribeTarget(live.node), (updated) => {
					if (this.#client !== client) return // stale update from a superseded client
					if (updated.contents.type !== Model.ElementType.Parameter) return
					live.latestRaw = updated.contents.value
					this.#self.state.set(live.def.id, formatValue(live.def.control, updated.contents.value))
				})
			} catch (error) {
				this.#self.log('warn', `Failed to subscribe to "${live.def.path}": ${errorMessage(error)}`)
			}
		})
	}

	// `display` is in display units; scaled by `factor` and clamped before writing.
	async setNumber(id: string, display: number): Promise<void> {
		const found = this.#writable(id, 'number')
		if (!found) return
		const [live, spec] = found
		await this.#writeNumber(live, spec, display * spec.factor)
	}

	async adjustNumber(id: string, deltaDisplay: number): Promise<void> {
		const found = this.#writable(id, 'number')
		if (!found) return
		const [live, spec] = found
		const current = typeof live.latestRaw === 'number' ? live.latestRaw : 0
		await this.#writeNumber(live, spec, current + deltaDisplay * spec.factor)
	}

	async setBoolean(id: string, mode: 'on' | 'off' | 'toggle'): Promise<void> {
		const found = this.#writable(id, 'boolean')
		if (!found) return
		const [live] = found
		await this.#write(live, mode === 'toggle' ? live.latestRaw !== true : mode === 'on')
	}

	async setEnum(id: string, index: number): Promise<void> {
		const found = this.#writable(id, 'enum')
		if (!found) return
		await this.#write(found[0], index)
	}

	async setString(id: string, value: string): Promise<void> {
		const found = this.#writable(id, 'string')
		if (!found) return
		await this.#write(found[0], value)
	}

	// The tables cover every parameter a model can carry, but a unit populates only a subset — an
	// action can legitimately target something this unit doesn't have.
	#writable<K extends ControlSpec['kind']>(
		id: string,
		kind: K,
	): [LiveParameter, Extract<ControlSpec, { kind: K }>] | undefined {
		const live = this.#live.get(id)
		if (!live) {
			this.#self.log('warn', `Cannot set "${id}": not present on this unit, or not connected`)
			return undefined
		}
		const spec = live.def.control
		if (spec.kind !== kind || !isWritable(spec)) {
			this.#self.log('warn', `Cannot set "${id}": not a writable ${kind}`)
			return undefined
		}
		return [live, spec as Extract<ControlSpec, { kind: K }>]
	}

	// Round (unless the device reports a fractional type), clamp to the raw bounds, then write.
	async #writeNumber(live: LiveParameter, spec: Extract<ControlSpec, { kind: 'number' }>, raw: number): Promise<void> {
		const rounded = live.node.contents.parameterType === Model.ParameterType.Real ? raw : Math.round(raw)
		await this.#write(live, Math.min(Math.max(rounded, spec.min), spec.max))
	}

	async #write(live: LiveParameter, value: Types.EmberValue): Promise<void> {
		const client = this.#client
		if (!client) {
			this.#self.log('warn', `Cannot set ${live.def.id}: not connected`)
			return
		}
		try {
			const request = await client.setValue(writeTarget(live.node), value)
			// The acknowledgement is a second promise, and an unhandled rejection from it would kill
			// the module process. Not awaited — the subscription already carries the value back.
			request.response?.catch((error: unknown) => {
				this.#self.log('debug', `No acknowledgement for ${live.def.id}: ${errorMessage(error)}`)
			})
		} catch (error) {
			this.#self.log('warn', `Failed to set ${live.def.id}: ${errorMessage(error)}`)
		}
	}

	// `getElementByPath` only matches nodes already in `client.tree`, so the root has to be loaded
	// first or the first path segment fails to match and it silently returns undefined.
	async #readDeviceId(client: EmberClient, spec: ModelSpec): Promise<string | undefined> {
		await (
			await client.getDirectory(client.tree)
		).response

		const identityPath = spec.identity.kind === 'parameter' ? spec.identity.path : spec.identity.root
		const node = await client.getElementByPath(identityPath, undefined, PATH_DELIMITER)
		const contents = node?.contents
		if (!contents) return undefined

		const raw = this.#identityRawValue(spec, contents)
		return raw === undefined || raw === null ? undefined : String(raw).trim()
	}

	/** Pulls the identity string from either a parameter value or a root node's description. */
	#identityRawValue(spec: ModelSpec, contents: Model.EmberElement): Types.EmberValue | undefined {
		if (spec.identity.kind === 'parameter') {
			return contents.type === Model.ElementType.Parameter ? contents.value : undefined
		}
		return contents.type === Model.ElementType.Node ? contents.description : undefined
	}

	#handleDrop(reason: string): void {
		if (this.#destroyed) return
		// `error` and `disconnected` both fire for one failure. Detach immediately so repeats are
		// ignored and an in-flight walk cancels instead of grinding on against a dead socket.
		const client = this.#client
		this.#client = null
		if (!client) return

		if (this.#retrying) {
			// Already announced; keep the retry loop out of the log until it succeeds.
			this.#self.log('debug', `Reconnect attempt failed: ${reason}`)
		} else {
			this.#retrying = true
			this.#self.log(
				'warn',
				`Connection lost: ${reason}. Retrying every ${RECONNECT_INTERVAL_MS / 1000}s until reconnected.`,
			)
		}

		void this.#disposeClient(client)
		this.#live.clear()
		this.#self.state.clear()
		this.#self.updateStatus(InstanceStatus.ConnectionFailure, reason)
		this.#scheduleReconnect()
	}

	#scheduleReconnect(): void {
		if (this.#destroyed || this.#reconnectTimer) return
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null
			void this.#openConnection()
		}, RECONNECT_INTERVAL_MS)
	}

	// Cancel any pending reconnect and dispose of the current client.
	async #teardownClient(): Promise<void> {
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer)
			this.#reconnectTimer = null
		}

		const client = this.#client
		this.#client = null
		if (!client) return
		await this.#disposeClient(client)
	}

	// Polls so the device's inactivity timer keeps getting reset. Unconditional rather than "only
	// when idle": one small request is noise next to the walk, and tracking activity is error-prone.
	#startHeartbeat(client: EmberClient): void {
		this.#stopHeartbeat()
		this.#heartbeatTimer = setInterval(() => {
			if (this.#client !== client) return
			void this.#sendHeartbeat(client)
		}, HEARTBEAT_INTERVAL_MS)
	}

	async #sendHeartbeat(client: EmberClient): Promise<void> {
		// A top-level node, not `client.tree`: an unqualified root getDirectory only resolves while
		// the tree is empty. The device answers either way, but only this form confirms it did.
		const target = client.tree[0]
		if (!target) return

		try {
			// Await the response, not just the send: an unhandled rejection here would be fatal.
			await (
				await client.getDirectory(target)
			).response
		} catch (_error) {
			if (this.#client !== client) return
			//this.#self.log('debug', `Heartbeat failed: ${errorMessage(error)}`)
		}
	}

	#stopHeartbeat(): void {
		if (!this.#heartbeatTimer) return
		clearInterval(this.#heartbeatTimer)
		this.#heartbeatTimer = null
	}

	async #disposeClient(client: EmberClient): Promise<void> {
		this.#stopHeartbeat()
		client.removeAllListeners()
		try {
			await client.disconnect()
		} catch {
			// Already disconnected or never connected; nothing to do.
		}
		client.discard()
	}

	// Permanently shut down the API. No reconnect will be scheduled afterwards.
	async destroy(): Promise<void> {
		this.#destroyed = true
		await this.#teardownClient()
	}
}
