import type { CompanionVariableValue, CompanionVariableValues } from '@companion-module/base'
import { buildFa1616Definitions } from './definitions/fa1616.js'
import { buildFa9600Definitions } from './definitions/fa9600.js'
import { relabelChoices, type ControlSpec } from './definitions/controls.js'
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

export function buildDefinitions(model: ModelId | undefined, choiceLabels: ChoiceLabels): VariableDefinition[] {
	const definitions = model === '1616' ? buildFa1616Definitions() : buildFa9600Definitions()
	if (choiceLabels.size === 0) return definitions

	// Instances of a parameter share one spec object; keep that so the relabelled spec is built once.
	const relabelled = new Map<string, ControlSpec>()
	return definitions.map((def) => {
		const key = controlKeyOf(def)
		const labels = choiceLabels.get(key)
		if (!labels || def.control.kind !== 'enum') return def

		let spec = relabelled.get(key)
		if (!spec) {
			spec = relabelChoices(def.control, labels)
			relabelled.set(key, spec)
		}
		return { ...def, control: spec }
	})
}

// Tracks which placed feedback instances depend on which variable id, so a change to one id only
// rechecks the feedbacks that actually read it (via `checkFeedbacksById`), not every instance.
export class DeviceStateStore {
	readonly #self: ModuleInstance
	readonly #values = new Map<VariableId, CompanionVariableValue | undefined>()
	readonly #feedbackIds = new Map<VariableId, Set<string>>()
	// The reverse index, so re-pointing a feedback drops it from the id it used to read.
	readonly #feedbackTargets = new Map<string, VariableId>()

	constructor(self: ModuleInstance) {
		this.#self = self
	}

	set(id: VariableId, value: CompanionVariableValue | undefined): void {
		if (this.#values.has(id) && this.#values.get(id) === value) return
		this.#values.set(id, value)
		this.#self.setVariableValues({ [id]: value ?? undefined })

		const feedbackIds = this.#feedbackIds.get(id)
		if (feedbackIds?.size) this.#self.checkFeedbacksById(...feedbackIds)
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
	clear(): void {
		this.#values.clear()
		const blanks: CompanionVariableValues = {}
		for (const def of this.#self.definitions) blanks[def.id] = undefined
		this.#self.setVariableValues(blanks)
	}
}
