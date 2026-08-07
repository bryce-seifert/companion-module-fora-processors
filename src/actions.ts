import type { CompanionActionDefinitions } from '@companion-module/base'
import { isWritable } from './definitions/controls.js'
import { actionId, resolveId, selectorFields } from './logical-controls.js'
import type { ModuleInstance } from './main.js'

const NUMBER_LIMIT = 1_000_000_000

// One action per writable logical control. Read-only parameters (status, latency, labels) still
// become variables and feedbacks, but there is nothing to set on them.
export function UpdateActions(self: ModuleInstance): void {
	const actions: CompanionActionDefinitions = {}

	for (const logical of self.logicalControls) {
		const { spec } = logical
		if (!isWritable(spec)) continue
		const selectors = selectorFields(logical)

		if (spec.kind === 'number') {
			const unit = spec.unit ? ` (${spec.unit})` : ''
			actions[actionId(logical)] = {
				name: logical.displayName,
				options: [
					...selectors,
					{
						type: 'dropdown',
						id: 'mode',
						label: 'Operation',
						default: 'set',
						choices: [
							{ id: 'set', label: 'Set' },
							{ id: 'increase', label: 'Increase' },
							{ id: 'decrease', label: 'Decrease' },
						],
					},
					{
						type: 'number',
						id: 'value',
						label: `Value${unit}`,
						default: 0,
						min: -NUMBER_LIMIT,
						max: NUMBER_LIMIT,
					},
				],
				callback: async (event) => {
					const id = resolveId(logical, event.options)
					const value = Number(event.options.value)
					if (event.options.mode === 'increase') await self.api.adjustNumber(id, value)
					else if (event.options.mode === 'decrease') await self.api.adjustNumber(id, -value)
					else await self.api.setNumber(id, value)
				},
			}
		} else if (spec.kind === 'boolean') {
			actions[actionId(logical)] = {
				name: logical.displayName,
				options: [
					...selectors,
					{
						type: 'dropdown',
						id: 'mode',
						label: 'Action',
						default: 'toggle',
						choices: [
							{ id: 'on', label: 'On' },
							{ id: 'off', label: 'Off' },
							{ id: 'toggle', label: 'Toggle' },
						],
					},
				],
				callback: async (event) => {
					await self.api.setBoolean(resolveId(logical, event.options), event.options.mode as 'on' | 'off' | 'toggle')
				},
			}
		} else if (spec.kind === 'enum') {
			const choices = spec.choices.map((choice) => ({ id: choice.id, label: choice.label }))
			actions[actionId(logical)] = {
				name: logical.displayName,
				options: [
					...selectors,
					{ type: 'dropdown', id: 'value', label: logical.name, default: choices[0]?.id ?? 0, choices },
				],
				callback: async (event) => {
					await self.api.setEnum(resolveId(logical, event.options), Number(event.options.value))
				},
			}
		} else {
			actions[actionId(logical)] = {
				name: logical.displayName,
				options: [...selectors, { type: 'textinput', id: 'value', label: logical.name, default: '' }],
				callback: async (event) => {
					await self.api.setString(resolveId(logical, event.options), String(event.options.value ?? ''))
				},
			}
		}
	}

	self.setActionDefinitions(actions)
}
