import type { CompanionVariableValue, CompanionVariableValues } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import type { ModelId } from './models.js'
import { buildFa1616Definitions } from './definitions/fa1616.js'
import { buildFa9600Definitions } from './definitions/fa9600.js'
import type { VariableDefinition, VariableId } from './definitions/shared.js'

// Re-export the shared definition API so the rest of the module keeps a single import site.
export {
	classifyParameter,
	enumChoices,
	formatParameterValue,
	groupByParent,
	PATH_DELIMITER,
	type ControlGroup,
	type ControlKind,
	type DeviceState,
	type EnumChoice,
	type GroupSelector,
	type ParentGroupMember,
	type VariableDefinition,
	type VariableId,
} from './definitions/shared.js'

export function buildDefinitions(model: ModelId | undefined): VariableDefinition[] {
	return model === '1616' ? buildFa1616Definitions() : buildFa9600Definitions()
}

// Tracks which placed feedback instances depend on which variable id, so a change to one id only
// rechecks the feedbacks that actually read it (via `checkFeedbacksById`), not every instance.
export class DeviceStateStore {
	readonly #self: ModuleInstance
	readonly #values = new Map<VariableId, CompanionVariableValue | undefined>()
	readonly #feedbackIds = new Map<VariableId, Set<string>>()

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

	registerFeedback(id: VariableId, feedbackId: string): void {
		const ids = this.#feedbackIds.get(id) ?? new Set<string>()
		ids.add(feedbackId)
		this.#feedbackIds.set(id, ids)
	}

	unregisterFeedback(id: VariableId, feedbackId: string): void {
		this.#feedbackIds.get(id)?.delete(feedbackId)
	}

	// Blanks every variable on disconnect; feedback subscriptions themselves survive reconnects.
	clear(): void {
		this.#values.clear()
		const blanks: CompanionVariableValues = {}
		for (const def of this.#self.definitions) blanks[def.id] = undefined
		this.#self.setVariableValues(blanks)
	}
}
