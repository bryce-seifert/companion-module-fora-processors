import { combineRgb, type CompanionFeedbackDefinitions, type CompanionFeedbackInfo } from '@companion-module/base'
import type { ControlSummary } from './api.js'
import { CATEGORY } from './definitions/shared.js'
import { ID_PREFIX, toLogical, selectorFields, resolveId, type LogicalControl } from './logical-controls.js'
import type { ModuleInstance } from './main.js'

// Free-text labels aren't useful as feedback trigger conditions.
function exclude(items: ControlSummary[]): ControlSummary[] {
	return items.filter((item) => item.category !== CATEGORY.METADATA_LABELING)
}

function trackSubscription(self: ModuleInstance, logical: LogicalControl) {
	return {
		subscribe: (feedback: CompanionFeedbackInfo) => {
			self.state.registerFeedback(resolveId(logical, feedback.options), feedback.id)
		},
		unsubscribe: (feedback: CompanionFeedbackInfo) => {
			self.state.unregisterFeedback(resolveId(logical, feedback.options), feedback.id)
		},
	}
}

const NUMBER_OPERATORS = [
	{ id: 'eq', label: 'Equal To' },
	{ id: 'gt', label: 'Greater Than' },
	{ id: 'gte', label: 'Greater Than or Equal' },
	{ id: 'lt', label: 'Less Than' },
	{ id: 'lte', label: 'Less Than or Equal' },
] as const

function compareNumber(operator: string, current: number, target: number): boolean {
	switch (operator) {
		case 'gt':
			return current > target
		case 'gte':
			return current >= target
		case 'lt':
			return current < target
		case 'lte':
			return current <= target
		default:
			return current === target
	}
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const all = self.api.describeAllProperties()
	const numbers = exclude(all.numbers)
	const booleans = exclude(all.booleans)
	const enums = exclude(all.enums)
	const strings = exclude(all.strings)
	const feedbacks: CompanionFeedbackDefinitions = {}

	for (const logical of toLogical(booleans, ID_PREFIX.boolean.feedback)) {
		feedbacks[logical.id] = {
			type: 'boolean',
			name: logical.displayName,
			defaultStyle: { bgcolor: combineRgb(0, 170, 0), color: combineRgb(0, 0, 0) },
			showInvert: true,
			options: selectorFields(logical),
			...trackSubscription(self, logical),
			callback: (feedback) => self.state.get(resolveId(logical, feedback.options)) === true,
		}
	}

	for (const logical of toLogical(enums, ID_PREFIX.enum.feedback)) {
		const choices = (logical.choices ?? []).map((choice) => ({ id: choice.id, label: choice.label }))
		feedbacks[logical.id] = {
			type: 'boolean',
			name: logical.displayName,
			defaultStyle: { bgcolor: combineRgb(0, 102, 204), color: combineRgb(255, 255, 255) },
			showInvert: true,
			options: [
				...selectorFields(logical),
				{ type: 'dropdown', id: 'value', label: logical.name, default: choices[0]?.id ?? 0, choices },
			],
			...trackSubscription(self, logical),
			callback: (feedback) => {
				const id = resolveId(logical, feedback.options)
				const choice = choices.find((c) => c.id === Number(feedback.options.value))
				return choice !== undefined && self.state.get(id) === choice.label
			},
		}
	}

	for (const logical of toLogical(numbers, ID_PREFIX.number.feedback)) {
		feedbacks[logical.id] = {
			type: 'boolean',
			name: logical.displayName,
			defaultStyle: { bgcolor: combineRgb(204, 102, 0), color: combineRgb(0, 0, 0) },
			showInvert: true,
			options: [
				...selectorFields(logical),
				{ type: 'dropdown', id: 'operator', label: 'Operator', default: 'eq', choices: [...NUMBER_OPERATORS] },
				{ type: 'number', id: 'value', label: 'Value', default: 0, min: -1_000_000_000, max: 1_000_000_000 },
			],
			...trackSubscription(self, logical),
			callback: (feedback) => {
				const id = resolveId(logical, feedback.options)
				const current = Number(self.state.get(id))
				if (Number.isNaN(current)) return false
				return compareNumber(String(feedback.options.operator), current, Number(feedback.options.value))
			},
		}
	}

	for (const logical of toLogical(strings, 'strf')) {
		feedbacks[logical.id] = {
			type: 'boolean',
			name: logical.displayName,
			defaultStyle: { bgcolor: combineRgb(96, 96, 96), color: combineRgb(255, 255, 255) },
			showInvert: true,
			options: [...selectorFields(logical), { type: 'textinput', id: 'value', label: 'Value', default: '' }],
			...trackSubscription(self, logical),
			callback: (feedback) => {
				const id = resolveId(logical, feedback.options)
				return String(self.state.get(id) ?? '') === String(feedback.options.value ?? '')
			},
		}
	}

	self.setFeedbackDefinitions(feedbacks)
}
