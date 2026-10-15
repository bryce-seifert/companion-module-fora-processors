import { InstanceStatus } from '@companion-module/base'
import type { Socket } from 'node:net'
import { EmberClient, Model, Types } from 'emberplus-connection'
import { isWritable, type ControlSpec } from './definitions/controls.js'
import type { ModuleInstance } from './main.js'
import { describeIdentitySource, getModelSpec, isTruncatedDirectory, type ModelSpec } from './models.js'
import { formatValue, groupByParent, PATH_DELIMITER, type VariableDefinition } from './state.js'
import { errorMessage, withDeadline } from './util.js'
import { walkTree, type DirFieldMask } from './walk.js'

const RECONNECT_INTERVAL_MS = 5000
const POPULATE_CONCURRENCY = 64
// The 1616 answers within 400ms but silently drops a few percent of requests under load; a short
// timeout plus retries recovers those far faster than waiting out a long one.
const REQUEST_TIMEOUT_MS = 2000
// The library checks timeouts once a second, so its own timeout can land up to a second late.
const REQUEST_DEADLINE_MS = REQUEST_TIMEOUT_MS + 2000
const HEARTBEAT_INTERVAL_MS = 8000
const WALK_MAX_ATTEMPTS = 5

// dirFieldMask 5 (Identifier | Value) keeps a truncated directory inside one frame. The library
// spells that integer 'CONNECTIONS'; the name is wrong for what we ask, the wire value is what counts.
const IDENTIFIER_AND_VALUE_MASK = 'CONNECTIONS' as DirFieldMask

// A definition matched to the live parameter node it resolved to. The node is what `setValue` and
// `subscribe` need; everything else comes from `def.control`.
interface LiveParameter {
	// Replaced when the labels read on this connection relabel the definitions.
	def: VariableDefinition
	readonly node: Model.NumberedTreeNode<Model.Parameter>
	// Un-scaled, pre-enum-label value, kept current for adjust/toggle.
	latestRaw: Types.EmberValue | undefined
}

// What the walk resolves: a declared parameter, or the string naming one enum choice (renameable
// LUT slots). Labels ride along so their parents are listed in the same pool as everything else.
type WalkTarget =
	| { readonly kind: 'parameter'; readonly leaf: string; readonly def: VariableDefinition }
	| { readonly kind: 'label'; readonly leaf: string; readonly id: number; readonly into: Map<number, string> }

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

// The decoder settles on `Null` when a listing gives it no parameterType, which would encode the
// write as a BER null. Fall back to what the control tables say the parameter accepts.
function writeParameterType(live: LiveParameter): Model.ParameterType {
	const reported = live.node.contents.parameterType
	if (reported && reported !== Model.ParameterType.Null) return reported

	switch (live.def.control.kind) {
		case 'boolean':
			return Model.ParameterType.Boolean
		case 'string':
			return Model.ParameterType.String
		// Enums are written as the device's own index, and numbers as factor-scaled integers.
		default:
			return Model.ParameterType.Integer
	}
}

// As above, plus the type needed to encode the value.
function writeTarget(live: LiveParameter): Model.QualifiedElement<Model.Parameter> {
	return new Model.QualifiedElementImpl(numericPath(live.node), {
		type: Model.ElementType.Parameter,
		parameterType: writeParameterType(live),
	})
}

// The private S101 socket inside an EmberClient (emberplus-connection 0.3.x).
interface S101SocketInternals {
	socket?: Socket
	_autoReconnect: boolean
	_clearConnectionAttemptTimer(): void
	connect(): Promise<void | Error>
}

// The S101 socket runs its own reconnect timer (every 5s, 60 tries) that `disconnect()` and
// `discard()` never clear when the socket isn't connected. A discarded client would then keep
// dialling, connect when the unit comes back, and stay open on keepalives forever. Since we build a
// new client per attempt, stop the old socket from ever connecting again.
function stopSocketReconnects(client: EmberClient): S101SocketInternals {
	const socket = (client as unknown as { _client: S101SocketInternals })._client
	socket._autoReconnect = false
	socket._clearConnectionAttemptTimer()
	// Also covers the retry a pending connect timeout and a socket close each trigger.
	socket.connect = async () => undefined
	return socket
}

// Groups every declared parameter and every label path by parent. `choiceLabels` fills in as the
// walk reads label strings, each source starting from the labels the unit can't supply.
function buildWalkTargets(
	definitions: readonly VariableDefinition[],
	spec: ModelSpec,
): { groups: Map<string, WalkTarget[]>; choiceLabels: Map<string, ReadonlyMap<number, string>> } {
	const groups = new Map<string, WalkTarget[]>()
	for (const [parent, members] of groupByParent(definitions)) {
		groups.set(
			parent,
			members.map(({ leaf, def }) => ({ kind: 'parameter', leaf, def })),
		)
	}

	const choiceLabels = new Map<string, ReadonlyMap<number, string>>()
	for (const source of spec.choiceLabelSources) {
		const into = new Map<number, string>(source.fixedLabels)
		for (const key of source.controlKeys) choiceLabels.set(key, into)
		for (const [id, path] of source.labelPaths) {
			const segments = path.split(PATH_DELIMITER)
			const leaf = segments.pop()
			if (leaf === undefined) continue
			const parent = segments.join(PATH_DELIMITER)
			const members = groups.get(parent) ?? []
			members.push({ kind: 'label', leaf, id, into })
			groups.set(parent, members)
		}
	}
	return { groups, choiceLabels }
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
		await this.#seedValues(client, spec)
	}

	// Reads every declared parameter and the unit's enum labels in one walk, then subscribes.
	// Actions, feedbacks and variables already exist at this point — this only fills them in.
	async #seedValues(client: EmberClient, spec: ModelSpec): Promise<void> {
		this.#live.clear()
		const started = Date.now()

		const absentByKey = new Map<string, { count: number; sample: string }>()
		const { groups, choiceLabels } = buildWalkTargets(this.#self.definitions, spec)
		let labelsRead = 0

		const stats = await walkTree(
			client,
			groups,
			{
				concurrency: POPULATE_CONCURRENCY,
				maxAttempts: WALK_MAX_ATTEMPTS,
				dirFieldMask: (path) => (isTruncatedDirectory(spec, path) ? IDENTIFIER_AND_VALUE_MASK : undefined),
				requestDeadlineMs: REQUEST_DEADLINE_MS,
			},
			{
				onParameter: (target, node) => {
					const value = node.contents.value
					if (target.kind === 'label') {
						// A label that won't read keeps its table text, so a unit without the option
						// fitted shows the static names.
						if (typeof value !== 'string' || value.trim() === '') return
						target.into.set(target.id, value.trim())
						labelsRead++
						return
					}
					const { def } = target
					this.#self.state.set(def.id, formatValue(def.control, value))
					this.#live.set(def.id, { def, node, latestRaw: value })
				},
				// Expected: subtrees are config-dependent and option blocks may be unfitted. The
				// action stays in the UI either way; setting one that isn't there just warns.
				onAbsent: (target) => {
					if (target.kind === 'label') return
					const { def } = target
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

		if (choiceLabels.size > 0) {
			this.#self.applyChoiceLabels(choiceLabels)
			this.#rebindDefinitions()
		}

		let absentTotal = 0
		for (const [key, { count, sample }] of [...absentByKey].sort((a, b) => b[1].count - a[1].count)) {
			absentTotal += count
			this.#self.log('debug', `${key}: ${count} absent on this unit (e.g. "${sample}")`)
		}
		this.#self.log(
			'debug',
			`Loaded ${stats.requested} directories in ${Date.now() - started}ms ` +
				`(${stats.masked} field-masked, ${stats.filled} children filled); ` +
				`pruned ${stats.pruned} under absent parents, retried ${stats.retried}, gave up on ${stats.failed}`,
		)
		this.#self.log(
			'debug',
			`Found ${this.#live.size}/${this.#self.definitions.length} parameters (${absentTotal} absent on this unit), ` +
				`${labelsRead} device-supplied enum labels`,
		)

		// One request per parameter, so it runs after every value is already current as of its read.
		await this.#subscribeAll(client)
	}

	// Relabelling replaces the definitions the walk resolved against; point what's already live at
	// the new ones and reformat their values with the new labels.
	#rebindDefinitions(): void {
		const byId = new Map(this.#self.definitions.map((def) => [def.id, def]))
		for (const live of this.#live.values()) {
			const def = byId.get(live.def.id)
			if (!def || def === live.def) continue
			live.def = def
			this.#self.state.set(def.id, formatValue(def.control, live.latestRaw))
		}
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
			const request = await client.setValue(writeTarget(live), value)
			// The acknowledgement is a second promise, and an unhandled rejection from it would kill
			// the module process. Not awaited. Some parameters (1616 audio `fade`) never notify their
			// subscription, so the value the acknowledgement carries back is applied too.
			request.response
				?.then((updated) => {
					if (this.#client !== client) return
					if (updated?.contents.type !== Model.ElementType.Parameter) return
					if (updated.contents.value === undefined) return
					live.latestRaw = updated.contents.value
					this.#self.state.set(live.def.id, formatValue(live.def.control, updated.contents.value))
				})
				.catch((error: unknown) => {
					this.#self.log('debug', `No acknowledgement for ${live.def.id}: ${errorMessage(error)}`)
				})
		} catch (error) {
			this.#self.log('warn', `Failed to set ${live.def.id}: ${errorMessage(error)}`)
		}
	}

	// `getElementByPath` only matches nodes already in `client.tree`, so the root has to be loaded
	// first or the first path segment fails to match and it silently returns undefined.
	async #readDeviceId(client: EmberClient, spec: ModelSpec): Promise<string | undefined> {
		await withDeadline(
			(async () => {
				await (
					await client.getDirectory(client.tree)
				).response
			})(),
			REQUEST_DEADLINE_MS,
			'root getDirectory',
		)

		const identityPath = spec.identity.kind === 'parameter' ? spec.identity.path : spec.identity.root
		const node = await withDeadline(
			client.getElementByPath(identityPath, undefined, PATH_DELIMITER),
			REQUEST_DEADLINE_MS,
			'identity lookup',
		)
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
			await withDeadline(
				(async () => {
					await (
						await client.getDirectory(target)
					).response
				})(),
				REQUEST_DEADLINE_MS,
				'heartbeat',
			)
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
		const socket = stopSocketReconnects(client)
		try {
			await client.disconnect()
		} catch {
			// Already disconnected or never connected; nothing to do.
		}
		client.discard()
		socket.socket?.destroy()
	}

	// Permanently shut down the API. No reconnect will be scheduled afterwards.
	async destroy(): Promise<void> {
		this.#destroyed = true
		await this.#teardownClient()
	}
}
