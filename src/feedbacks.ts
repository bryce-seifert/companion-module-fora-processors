import { combineRgb, type CompanionFeedbackDefinitions, type CompanionFeedbackInfo } from '@companion-module/base'
import { isReadable } from './definitions/controls.js'
import { CATEGORY } from './definitions/shared.js'
import { feedbackId, resolveId, selectorFields, type LogicalControl } from './logical-controls.js'
import type { ModuleInstance } from './main.js'

const NUMBER_LIMIT = 1_000_000_000

const STYLE = {
	boolean: { bgcolor: combineRgb(0, 170, 0), color: combineRgb(0, 0, 0) },
	enum: { bgcolor: combineRgb(0, 102, 204), color: combineRgb(255, 255, 255) },
	number: { bgcolor: combineRgb(204, 102, 0), color: combineRgb(0, 0, 0) },
	string: { bgcolor: combineRgb(96, 96, 96), color: combineRgb(255, 255, 255) },
}

const NUMBER_OPERATORS = [
	{ id: 'eq', label: 'Equal To' },
	{ id: 'gt', label: 'Greater Than' },
	{ id: 'gte', label: 'Greater Than or Equal' },
	{ id: 'lt', label: 'Less Than' },
	{ id: 'lte', label: 'Less Than or Equal' },
]

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

// Feedbacks only recheck when a variable they read changes, so each placed instance registers
// the concrete id its selectors resolve to.
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

// Every readable logical control gets a feedback, writable or not — read-only status parameters
// are the most useful ones to drive button colour. Write-only parameters (event load/save/delete,
// ...) are skipped: the device never reports a value back for them, so there's nothing for a
// feedback to compare against. Free-text labels are also excluded: comparing them isn't a useful
// trigger condition.
export function UpdateFeedbacks(self: ModuleInstance): void {
	const feedbacks: CompanionFeedbackDefinitions = {}

	for (const logical of self.logicalControls) {
		if (logical.category === CATEGORY.METADATA_LABELING) continue
		if (!isReadable(logical.spec)) continue
		const { spec } = logical
		const common = {
			type: 'boolean' as const,
			name: logical.displayName,
			defaultStyle: STYLE[spec.kind],
			showInvert: true,
			...trackSubscription(self, logical),
		}
		const selectors = selectorFields(logical)

		if (spec.kind === 'boolean') {
			feedbacks[feedbackId(logical)] = {
				...common,
				options: selectors,
				callback: (feedback: CompanionFeedbackInfo) => self.state.get(resolveId(logical, feedback.options)) === true,
			}
		} else if (spec.kind === 'enum') {
			const choices = spec.choices.map((choice) => ({ id: choice.id, label: choice.label }))
			feedbacks[feedbackId(logical)] = {
				...common,
				options: [
					...selectors,
					{ type: 'dropdown', id: 'value', label: logical.name, default: choices[0]?.id ?? 0, choices },
				],
				// State holds the enum's label, not its index.
				callback: (feedback: CompanionFeedbackInfo) => {
					const choice = choices.find((c) => c.id === Number(feedback.options.value))
					return choice !== undefined && self.state.get(resolveId(logical, feedback.options)) === choice.label
				},
			}
		} else if (spec.kind === 'number') {
			feedbacks[feedbackId(logical)] = {
				...common,
				options: [
					...selectors,
					{ type: 'dropdown', id: 'operator', label: 'Operator', default: 'eq', choices: NUMBER_OPERATORS },
					{
						type: 'number',
						id: 'value',
						label: spec.unit ? `Value (${spec.unit})` : 'Value',
						default: 0,
						min: -NUMBER_LIMIT,
						max: NUMBER_LIMIT,
					},
				],
				callback: (feedback: CompanionFeedbackInfo) => {
					const current = Number(self.state.get(resolveId(logical, feedback.options)))
					if (Number.isNaN(current)) return false
					return compareNumber(String(feedback.options.operator), current, Number(feedback.options.value))
				},
			}
		} else {
			feedbacks[feedbackId(logical)] = {
				...common,
				options: [...selectors, { type: 'textinput', id: 'value', label: 'Value', default: '' }],
				callback: (feedback: CompanionFeedbackInfo) => {
					const current = self.state.get(resolveId(logical, feedback.options))
					return String(current ?? '') === String(feedback.options.value ?? '')
				},
			}
		}
	}

	self.setFeedbackDefinitions(feedbacks)
}
