import type {
	CompanionActionDefinition,
	CompanionActionDefinitions,
	CompanionOptionValues,
} from '@companion-module/base'
import { isWritable } from './definitions/controls.js'
import {
	actionId,
	describeSelection,
	resolveId,
	selectorFields,
	valueOption,
	type LogicalControl,
} from './logical-controls.js'
import type { ModuleInstance } from './main.js'
import {
	BOOLEAN_ACTION_MODES,
	dropdownField,
	enumValueFields,
	isBooleanActionMode,
	isNumberActionMode,
	NUMBER_ACTION_MODES,
	numberValueField,
} from './option-fields.js'

// The target of a fired action, or undefined (with a warning) when its selectors name no parameter.
function targetId(self: ModuleInstance, logical: LogicalControl, options: CompanionOptionValues): string | undefined {
	const id = resolveId(logical, options)
	if (id === undefined) {
		self.log('warn', `${logical.displayName}: no such parameter (${describeSelection(logical, options)}); not sent`)
	}
	return id
}

function numberAction(self: ModuleInstance, logical: LogicalControl): CompanionActionDefinition {
	const unit = logical.spec.kind === 'number' && logical.spec.unit ? ` (${logical.spec.unit})` : ''
	return {
		name: logical.displayName,
		options: [
			...selectorFields(logical),
			dropdownField('mode', 'Operation', NUMBER_ACTION_MODES, 'set'),
			numberValueField(`Value${unit}`),
		],
		callback: async (event) => {
			const id = targetId(self, logical, event.options)
			if (id === undefined) return
			const value = Number(event.options.value)
			const mode = isNumberActionMode(event.options.mode) ? event.options.mode : 'set'

			if (mode === 'increase') {
				await self.api.adjustNumber(id, value)
				return
			}
			if (mode === 'decrease') {
				await self.api.adjustNumber(id, -value)
				return
			}
			await self.api.setNumber(id, value)
		},
	}
}

function booleanAction(self: ModuleInstance, logical: LogicalControl): CompanionActionDefinition {
	return {
		name: logical.displayName,
		options: [...selectorFields(logical), dropdownField('mode', 'Action', BOOLEAN_ACTION_MODES, 'toggle')],
		callback: async (event) => {
			const id = targetId(self, logical, event.options)
			if (id === undefined) return
			const mode = isBooleanActionMode(event.options.mode) ? event.options.mode : 'toggle'
			await self.api.setBoolean(id, mode)
		},
	}
}

function enumAction(self: ModuleInstance, logical: LogicalControl): CompanionActionDefinition {
	return {
		name: logical.displayName,
		options: [...selectorFields(logical), ...enumValueFields(logical)],
		callback: async (event) => {
			const id = targetId(self, logical, event.options)
			if (id === undefined) return
			await self.api.setEnum(id, Number(valueOption(logical, id, event.options)))
		},
	}
}

function stringAction(self: ModuleInstance, logical: LogicalControl): CompanionActionDefinition {
	return {
		name: logical.displayName,
		options: [...selectorFields(logical), { type: 'textinput', id: 'value', label: logical.name, default: '' }],
		callback: async (event) => {
			const id = targetId(self, logical, event.options)
			if (id === undefined) return
			await self.api.setString(id, String(event.options.value ?? ''))
		},
	}
}

/** One action per writable logical control. Read-only parameters still become variables/feedbacks. */
export function UpdateActions(self: ModuleInstance): void {
	const actions: CompanionActionDefinitions = {}

	for (const logical of self.logicalControls) {
		const { spec } = logical
		if (!isWritable(spec)) continue

		switch (spec.kind) {
			case 'number':
				actions[actionId(logical)] = numberAction(self, logical)
				break
			case 'boolean':
				actions[actionId(logical)] = booleanAction(self, logical)
				break
			case 'enum':
				actions[actionId(logical)] = enumAction(self, logical)
				break
			case 'string':
				actions[actionId(logical)] = stringAction(self, logical)
				break
		}
	}

	self.setActionDefinitions(actions)
}
