import type { CompanionActionDefinition, CompanionActionDefinitions } from '@companion-module/base'
import { isWritable } from './definitions/controls.js'
import { actionId, resolveId, selectorFields, type LogicalControl } from './logical-controls.js'
import type { ModuleInstance } from './main.js'
import {
	BOOLEAN_ACTION_MODES,
	dropdownField,
	isBooleanActionMode,
	isNumberActionMode,
	NUMBER_ACTION_MODES,
	numberValueField,
} from './option-fields.js'

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
			const id = resolveId(logical, event.options)
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
			const mode = isBooleanActionMode(event.options.mode) ? event.options.mode : 'toggle'
			await self.api.setBoolean(resolveId(logical, event.options), mode)
		},
	}
}

function enumAction(self: ModuleInstance, logical: LogicalControl): CompanionActionDefinition {
	const choices =
		logical.spec.kind === 'enum' ? logical.spec.choices.map((choice) => ({ id: choice.id, label: choice.label })) : []
	return {
		name: logical.displayName,
		options: [...selectorFields(logical), dropdownField('value', logical.name, choices, choices[0]?.id ?? 0)],
		callback: async (event) => {
			await self.api.setEnum(resolveId(logical, event.options), Number(event.options.value))
		},
	}
}

function stringAction(self: ModuleInstance, logical: LogicalControl): CompanionActionDefinition {
	return {
		name: logical.displayName,
		options: [...selectorFields(logical), { type: 'textinput', id: 'value', label: logical.name, default: '' }],
		callback: async (event) => {
			await self.api.setString(resolveId(logical, event.options), String(event.options.value ?? ''))
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
