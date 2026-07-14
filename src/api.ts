import { InstanceStatus } from '@companion-module/base'
import { EmberClient, Model, Types } from 'emberplus-connection'
import type { ModuleInstance } from './main.js'
import { DEVICE_ID_PATH, getModelSpec, type ModelSpec } from './models.js'
import {
	classifyParameter,
	enumChoices,
	formatParameterValue,
	groupByParent,
	PATH_DELIMITER,
	type ControlGroup,
	type ControlKind,
	type EnumChoice,
	type ParentGroupMember,
	type VariableDefinition,
} from './state.js'

// A parameter resolved at connect time and exposed to the actions/feedbacks layers.
interface ControlEntry {
	readonly def: VariableDefinition
	readonly node: Model.NumberedTreeNode<Model.Parameter>
	readonly kind: ControlKind
	readonly parameterType: Model.ParameterType
	readonly writable: boolean
	readonly min?: number
	readonly max?: number
	readonly factor?: number
	readonly choices?: EnumChoice[]
	// Un-scaled, pre-enum-label value, kept current for adjust/toggle.
	latestRaw: Types.EmberValue | undefined
}

export interface ControlSummary {
	id: string
	name: string
	group?: ControlGroup
	choices?: EnumChoice[]
	category?: string
}

// Action-facing: writable controllable parameters only, grouped by kind.
export interface ControlDescriptors {
	numbers: ControlSummary[]
	booleans: ControlSummary[]
	enums: ControlSummary[]
}

// Feedback-facing: every classified parameter, writable or read-only, grouped by kind.
export interface PropertyDescriptors {
	numbers: ControlSummary[]
	booleans: ControlSummary[]
	enums: ControlSummary[]
	strings: ControlSummary[]
}

const RECONNECT_INTERVAL_MS = 5000

// Max Ember+ requests in flight at once while populating variables on connect.
const POPULATE_CONCURRENCY = 40

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

export class ForaApi {
	readonly #self: ModuleInstance
	#client: EmberClient | null = null
	#reconnectTimer: NodeJS.Timeout | null = null
	#destroyed = false
	readonly #controls = new Map<string, ControlEntry>()

	constructor(self: ModuleInstance) {
		this.#self = self
	}

	async connect(): Promise<void> {
		this.#destroyed = false
		await this.#teardownClient()

		const { host, model } = this.#self.config
		if (!host) {
			this.#self.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}

		const spec = getModelSpec(model)
		const port = spec.port
		this.#self.log('debug', `Connecting to ${spec.label} at ${host}:${port}`)
		this.#self.updateStatus(InstanceStatus.Connecting)

		const client = new EmberClient(host, port)
		this.#client = client

		client.on('disconnected', () => this.#handleDrop('Disconnected'))
		client.on('error', (error: Error) => this.#handleDrop(error.message))

		let connectResult: void | Error
		try {
			connectResult = await client.connect()
		} catch (error) {
			this.#handleDrop(error instanceof Error ? error.message : String(error))
			return
		}
		if (connectResult instanceof Error) {
			this.#handleDrop(connectResult.message)
			return
		}
		if (this.#client !== client) return // superseded by a newer connect()/teardown

		this.#self.log('info', `Connected to ${spec.label} at ${host}:${port}, verifying identity`)
		await this.#verifyIdentity(client, spec)
	}

	async #verifyIdentity(client: EmberClient, spec: ModelSpec): Promise<void> {
		let deviceId: string | undefined
		try {
			deviceId = await this.#readDeviceId(client)
		} catch (error) {
			// A failed read is treated as a transient connection problem.
			this.#handleDrop(error instanceof Error ? error.message : String(error))
			return
		}

		if (this.#client !== client) return // superseded while awaiting

		if (deviceId === undefined) {
			this.#handleDrop(`Could not read device identity at "${DEVICE_ID_PATH}"`)
			return
		}

		if (deviceId !== spec.deviceId) {
			this.#self.log(
				'error',
				`Model mismatch: device reports "${deviceId}" but config is set to ${spec.label} ("${spec.deviceId}")`,
			)
			this.#self.updateStatus(InstanceStatus.BadConfig, `Wrong model: device is "${deviceId}", expected ${spec.label}`)
			await this.#teardownClient() // config error, not transient — stop without reconnecting
			return
		}

		this.#self.log('info', `Identity confirmed: ${deviceId}`)
		this.#self.updateStatus(InstanceStatus.Ok)

		await this.#populateVariables(client)
	}

	async #populateVariables(client: EmberClient): Promise<void> {
		const groups = groupByParent(this.#self.definitions)
		this.#controls.clear()

		const started = Date.now()
		await this.#loadDirectories(client, [...groups.keys()])
		if (this.#client !== client) return

		await this.#seedAndSubscribe(client, groups)
		if (this.#client !== client) return

		this.#self.log('debug', `Variable population took ${Date.now() - started}ms`)
		// Rebuild actions/feedbacks/presets now that parameter types, ranges and enum choices are known.
		this.#self.updateActions()
		this.#self.updateFeedbacks()
		this.#self.updatePresets()
	}

	async #loadDirectories(client: EmberClient, parentPaths: readonly string[]): Promise<void> {
		const byDepth = new Map<number, Set<string>>()
		for (const parentPath of parentPaths) {
			const segments = parentPath.split(PATH_DELIMITER)
			for (let depth = 1; depth <= segments.length; depth++) {
				const prefix = segments.slice(0, depth).join(PATH_DELIMITER)
				const level = byDepth.get(depth) ?? new Set<string>()
				level.add(prefix)
				byDepth.set(depth, level)
			}
		}

		for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
			if (this.#client !== client) return
			await runPool([...byDepth.get(depth)!], POPULATE_CONCURRENCY, async (path) => {
				try {
					const node = await client.getElementByPath(path, undefined, PATH_DELIMITER)
					if (node?.contents.type === Model.ElementType.Node) {
						await (
							await client.getDirectory(node as Model.NumberedTreeNode<Model.EmberElement>)
						).response
					}
				} catch (error) {
					this.#self.log(
						'debug',
						`Directory "${path}" not loaded: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			})
		}
	}

	async #seedAndSubscribe(client: EmberClient, groups: Map<string, ParentGroupMember[]>): Promise<void> {
		const leaves: { def: VariableDefinition; node: Model.NumberedTreeNode<Model.EmberElement> }[] = []

		for (const [parentPath, members] of groups) {
			let parent: Model.TreeElement<Model.EmberElement> | undefined
			try {
				parent = await client.getElementByPath(parentPath, undefined, PATH_DELIMITER)
			} catch {
				parent = undefined // path doesn't exist (config-dependent subtree); members skipped below
			}
			const children = parent?.children ? Object.values(parent.children) : []

			for (const { leaf, def } of members) {
				const node = children.find((child) => 'identifier' in child.contents && child.contents.identifier === leaf)
				if (node?.contents.type !== Model.ElementType.Parameter) {
					// Absent leaves are expected here: some subtrees are config-dependent
					// (e.g. fs-2 `uhd` when not in UHD mode). The variable just stays blank.
					this.#self.log('debug', `"${def.path}" absent; ${def.id} left blank`)
					continue
				}
				this.#self.state.set(def.id, formatParameterValue(node.contents))
				this.#registerControl(def, node as Model.NumberedTreeNode<Model.Parameter>)
				leaves.push({ def, node: node })
			}
		}

		this.#self.log(
			'info',
			`Seeded ${leaves.length}/${this.#self.definitions.length} variables; subscribing for updates`,
		)

		await runPool(leaves, POPULATE_CONCURRENCY, async ({ def, node }) => {
			try {
				await client.subscribe(node, (updated) => {
					if (this.#client !== client) return // stale update from a superseded client
					if (updated.contents.type === Model.ElementType.Parameter) {
						this.#self.state.set(def.id, formatParameterValue(updated.contents))
						const control = this.#controls.get(def.id)
						if (control) control.latestRaw = updated.contents.value
					}
				})
			} catch (error) {
				this.#self.log(
					'warn',
					`Failed to subscribe to "${def.path}": ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		})
	}

	// Non-controllable types (trigger, octets, null) are ignored entirely.
	#registerControl(def: VariableDefinition, node: Model.NumberedTreeNode<Model.Parameter>): void {
		const parameter = node.contents
		const kind = classifyParameter(parameter)
		if (!kind) return

		this.#controls.set(def.id, {
			def,
			node,
			kind,
			parameterType: parameter.parameterType,
			writable:
				parameter.access === Model.ParameterAccess.Write || parameter.access === Model.ParameterAccess.ReadWrite,
			min: parameter.minimum ?? undefined,
			max: parameter.maximum ?? undefined,
			factor: parameter.factor,
			choices: kind === 'enum' ? enumChoices(parameter) : undefined,
			latestRaw: parameter.value,
		})
	}

	describeControls(): ControlDescriptors {
		const descriptors: ControlDescriptors = { numbers: [], booleans: [], enums: [] }
		for (const control of this.#controls.values()) {
			if (!control.writable) continue
			const summary: ControlSummary = {
				id: control.def.id,
				name: control.def.name,
				group: control.def.group,
				category: control.def.category,
			}
			if (control.kind === 'number') {
				descriptors.numbers.push(summary)
			} else if (control.kind === 'boolean') {
				descriptors.booleans.push(summary)
			} else if (control.kind === 'enum') {
				descriptors.enums.push({ ...summary, choices: control.choices ?? [] })
			}
		}
		const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
		descriptors.numbers.sort(byName)
		descriptors.booleans.sort(byName)
		descriptors.enums.sort(byName)
		return descriptors
	}

	describeAllProperties(): PropertyDescriptors {
		const descriptors: PropertyDescriptors = { numbers: [], booleans: [], enums: [], strings: [] }
		for (const control of this.#controls.values()) {
			const summary: ControlSummary = {
				id: control.def.id,
				name: control.def.name,
				group: control.def.group,
				category: control.def.category,
			}
			if (control.kind === 'number') {
				descriptors.numbers.push(summary)
			} else if (control.kind === 'boolean') {
				descriptors.booleans.push(summary)
			} else if (control.kind === 'enum') {
				descriptors.enums.push({ ...summary, choices: control.choices ?? [] })
			} else {
				descriptors.strings.push(summary)
			}
		}
		const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
		descriptors.numbers.sort(byName)
		descriptors.booleans.sort(byName)
		descriptors.enums.sort(byName)
		descriptors.strings.sort(byName)
		return descriptors
	}

	// `display` is in display units; scaled by `factor` and clamped before writing.
	async setNumber(id: string, display: number): Promise<void> {
		const control = this.#numberControl(id)
		if (!control) return
		await this.#writeNumber(control, display * this.#factor(control))
	}

	async adjustNumber(id: string, deltaDisplay: number): Promise<void> {
		const control = this.#numberControl(id)
		if (!control) return
		const current = typeof control.latestRaw === 'number' ? control.latestRaw : 0
		await this.#writeNumber(control, current + deltaDisplay * this.#factor(control))
	}

	async setBoolean(id: string, mode: 'on' | 'off' | 'toggle'): Promise<void> {
		const control = this.#controls.get(id)
		if (control?.kind !== 'boolean' || !control.writable) return this.#warnNoControl(id, 'boolean')
		const value = mode === 'toggle' ? control.latestRaw !== true : mode === 'on'
		await this.#write(control, value)
	}

	async setEnum(id: string, index: number): Promise<void> {
		const control = this.#controls.get(id)
		if (control?.kind !== 'enum' || !control.writable) return this.#warnNoControl(id, 'enum')
		await this.#write(control, index)
	}

	#numberControl(id: string): ControlEntry | undefined {
		const control = this.#controls.get(id)
		if (control?.kind !== 'number' || !control.writable) {
			this.#warnNoControl(id, 'number')
			return undefined
		}
		return control
	}

	#factor(control: ControlEntry): number {
		return control.factor && control.factor !== 0 ? control.factor : 1
	}

	// Round (unless Real), clamp to the parameter's raw min/max, then write.
	async #writeNumber(control: ControlEntry, rawValue: number): Promise<void> {
		let raw = control.parameterType === Model.ParameterType.Real ? rawValue : Math.round(rawValue)
		if (typeof control.min === 'number') raw = Math.max(raw, control.min)
		if (typeof control.max === 'number') raw = Math.min(raw, control.max)
		await this.#write(control, raw)
	}

	async #write(control: ControlEntry, value: Types.EmberValue): Promise<void> {
		const client = this.#client
		if (!client) {
			this.#self.log('warn', `Cannot set ${control.def.id}: not connected`)
			return
		}
		try {
			await client.setValue(control.node, value)
		} catch (error) {
			this.#self.log(
				'warn',
				`Failed to set ${control.def.id}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	#warnNoControl(id: string, expected: ControlKind): void {
		this.#self.log('warn', `No ${expected} control for "${id}" (unknown, read-only, or not yet connected)`)
	}

	async #readDeviceId(client: EmberClient): Promise<string | undefined> {
		const rootReq = await client.getDirectory(client.tree)
		await rootReq.response

		const node = await client.getElementByPath(DEVICE_ID_PATH)
		const contents = node?.contents
		if (contents?.type !== Model.ElementType.Parameter) return undefined

		const value = contents.value
		return value === undefined || value === null ? undefined : String(value).trim()
	}

	#handleDrop(reason: string): void {
		if (this.#destroyed) return
		this.#self.log('warn', `Connection lost: ${reason}`)
		this.#controls.clear()
		this.#self.state.clear()
		this.#self.updateStatus(InstanceStatus.ConnectionFailure, reason)
		this.#scheduleReconnect()
	}

	#scheduleReconnect(): void {
		if (this.#destroyed || this.#reconnectTimer) return
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null
			void this.connect()
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
