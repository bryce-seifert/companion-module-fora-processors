import type { CompanionActionDefinitions } from '@companion-module/base'
import { ID_PREFIX, toLogical, selectorFields, resolveId } from './logical-controls.js'
import type { ModuleInstance } from './main.js'

const NUMBER_LIMIT = 1_000_000_000

// Instances of the same logical parameter (FS1/FS2, channels 1-32...) collapse into one action with a selector dropdown per dimension.
export function UpdateActions(self: ModuleInstance): void {
	const { numbers, booleans, enums } = self.api.describeControls()
	const actions: CompanionActionDefinitions = {}

	for (const logical of toLogical(numbers, ID_PREFIX.number.action)) {
		actions[logical.id] = {
			name: logical.displayName,
			options: [
				...selectorFields(logical),
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
				{ type: 'number', id: 'value', label: 'Value', default: 0, min: -NUMBER_LIMIT, max: NUMBER_LIMIT },
			],
			callback: async (event) => {
				const id = resolveId(logical, event.options)
				const value = Number(event.options.value)
				if (event.options.mode === 'increase') await self.api.adjustNumber(id, value)
				else if (event.options.mode === 'decrease') await self.api.adjustNumber(id, -value)
				else await self.api.setNumber(id, value)
			},
		}
	}

	for (const logical of toLogical(booleans, ID_PREFIX.boolean.action)) {
		actions[logical.id] = {
			name: logical.displayName,
			options: [
				...selectorFields(logical),
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
	}

	for (const logical of toLogical(enums, ID_PREFIX.enum.action)) {
		const choices = (logical.choices ?? []).map((choice) => ({ id: choice.id, label: choice.label }))
		actions[logical.id] = {
			name: logical.displayName,
			options: [
				...selectorFields(logical),
				{ type: 'dropdown', id: 'value', label: logical.name, default: choices[0]?.id ?? 0, choices },
			],
			callback: async (event) => {
				await self.api.setEnum(resolveId(logical, event.options), Number(event.options.value))
			},
		}
	}

	self.setActionDefinitions(actions)
}
