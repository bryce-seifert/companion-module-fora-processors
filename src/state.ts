import type { CompanionVariableValue, CompanionVariableValues } from '@companion-module/base'
import { buildFa1616Definitions } from './definitions/fa1616.js'
import { buildFa9600Definitions } from './definitions/fa9600.js'
import { relabelChoices, withDeviceChoices, type EnumChoice, type EnumSpec } from './definitions/controls.js'
import { controlKey as controlKeyOf, type VariableDefinition, type VariableId } from './definitions/shared.js'
import type { ModuleInstance } from './main.js'
import type { ModelId } from './models.js'

// Re-export the shared definition API so the rest of the module keeps a single import site.
export {
	controlKey,
	formatValue,
	groupByParent,
	PATH_DELIMITER,
	type ControlGroup,
	type DeviceState,
	type GroupSelector,
	type ParentGroupMember,
	type VariableDefinition,
	type VariableId,
} from './definitions/shared.js'

/** Enum labels read from the device, keyed by control key then by the enum's own id. */
export type ChoiceLabels = ReadonlyMap<string, ReadonlyMap<number, string>>

/**
 * What the connected unit reports about its own fit (mode, cards, licences): its enum labels and
 * choices, and which parameters it lacks or locks. Empty until the first walk lands.
 */
export interface DeviceFit {
	readonly labels: ChoiceLabels
	/** Variable id -> the choices that instance's own Ember+ enumeration offers. */
	readonly perInstance: ReadonlyMap<VariableId, readonly EnumChoice[]>
	/** Parameters this unit doesn't carry (an unfitted card or licence). */
	readonly absent: ReadonlySet<VariableId>
	/** Parameters writable in the tables that the unit reports read-only in its current mode. */
	readonly readOnly: ReadonlySet<VariableId>
}

export const NO_DEVICE_FIT: DeviceFit = {
	labels: new Map(),
	perInstance: new Map(),
	absent: new Set(),
	readOnly: new Set(),
}

export function buildDefinitions(model: ModelId | undefined, fit: DeviceFit): VariableDefinition[] {
	const definitions = model === '1616' ? buildFa1616Definitions() : buildFa9600Definitions()
	if (fit.labels.size === 0 && fit.perInstance.size === 0) return definitions

	// Instances of a parameter share one spec object; keep that so the relabelled spec is built once.
	const relabelled = new Map<EnumSpec, EnumSpec>()
	// Instances offering the same list share a spec too, so they share one value field in the UI.
	const enumerated = new Map<string, EnumSpec>()
	return definitions.map((def) => {
		if (def.control.kind !== 'enum') return def

		const labels = fit.labels.get(controlKeyOf(def))
		let spec = def.control
		if (labels) {
			const base = spec
			spec = relabelled.get(base) ?? relabelChoices(base, labels)
			relabelled.set(base, spec)
		}

		const instanceChoices = fit.perInstance.get(def.id)
		if (instanceChoices) {
			const signature = `${controlKeyOf(def)}:${JSON.stringify(instanceChoices)}`
			spec = enumerated.get(signature) ?? withDeviceChoices(spec, instanceChoices)
			enumerated.set(signature, spec)
		}
		return spec === def.control ? def : { ...def, control: spec }
	})
}

// The unit sends each value in its own frame (the 1616 alone pushes ~64 delay readings a second),
// and every Companion call is an IPC message. Changes inside this window go out as one call.
const FLUSH_INTERVAL_MS = 50

// Tracks which placed feedback instances depend on which variable id, so a change to one id only
// rechecks the feedbacks that actually read it (via `checkFeedbacksById`), not every instance.
export class DeviceStateStore {
	readonly #self: ModuleInstance
	readonly #values = new Map<VariableId, CompanionVariableValue | undefined>()
	#pendingValues: CompanionVariableValues = {}
	#pendingFeedbackIds = new Set<string>()
	#flushTimer: NodeJS.Timeout | null = null
	readonly #feedbackIds = new Map<VariableId, Set<string>>()
	// The reverse index, so re-pointing a feedback drops it from the id it used to read.
	readonly #feedbackTargets = new Map<string, VariableId>()

	constructor(self: ModuleInstance) {
		this.#self = self
	}

	set(id: VariableId, value: CompanionVariableValue | undefined): void {
		if (this.#values.has(id) && this.#values.get(id) === value) return
		this.#values.set(id, value)
		this.#pendingValues[id] = value ?? undefined
		for (const feedbackId of this.#feedbackIds.get(id) ?? []) this.#pendingFeedbackIds.add(feedbackId)
		this.#flushTimer ??= setTimeout(() => this.#flush(), FLUSH_INTERVAL_MS)
	}

	#flush(): void {
		this.#cancelFlush()
		const values = this.#pendingValues
		const feedbackIds = this.#pendingFeedbackIds
		this.#pendingValues = {}
		this.#pendingFeedbackIds = new Set()
		if (Object.keys(values).length > 0) this.#self.setVariableValues(values)
		if (feedbackIds.size > 0) this.#self.checkFeedbacksById(...feedbackIds)
	}

	#cancelFlush(): void {
		if (!this.#flushTimer) return
		clearTimeout(this.#flushTimer)
		this.#flushTimer = null
	}

	get(id: VariableId): CompanionVariableValue | undefined {
		return this.#values.get(id)
	}

	// Points a placed feedback at the variable it currently reads. Called on every evaluation, since
	// Companion runs `subscribe` only on insert and an edited feedback would keep its original id.
	trackFeedback(feedbackId: string, id: VariableId): void {
		const previous = this.#feedbackTargets.get(feedbackId)
		if (previous === id) return
		if (previous !== undefined) this.#feedbackIds.get(previous)?.delete(feedbackId)

		this.#feedbackTargets.set(feedbackId, id)
		const ids = this.#feedbackIds.get(id) ?? new Set<string>()
		ids.add(feedbackId)
		this.#feedbackIds.set(id, ids)
	}

	untrackFeedback(feedbackId: string): void {
		const previous = this.#feedbackTargets.get(feedbackId)
		if (previous === undefined) return
		this.#feedbackIds.get(previous)?.delete(feedbackId)
		this.#feedbackTargets.delete(feedbackId)
	}

	// Blanks every variable on disconnect; feedback subscriptions themselves survive reconnects.
	// Nothing to blank once cleared, so each failed reconnect attempt doesn't resend every id.
	clear(): void {
		this.#pendingValues = {}
		this.#pendingFeedbackIds.clear()
		this.#cancelFlush()
		if (this.#values.size === 0) return
		this.#values.clear()
		const blanks: CompanionVariableValues = {}
		for (const def of this.#self.definitions) blanks[def.id] = undefined
		this.#self.setVariableValues(blanks)
	}

	// Drops anything not yet sent; the instance is going away.
	destroy(): void {
		this.#pendingValues = {}
		this.#pendingFeedbackIds.clear()
		this.#cancelFlush()
	}
}
