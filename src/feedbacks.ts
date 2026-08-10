import {
	combineRgb,
	type CompanionBooleanFeedbackDefinition,
	type CompanionFeedbackDefinitions,
	type CompanionFeedbackInfo,
} from '@companion-module/base'
import { isReadable } from './definitions/controls.js'
import { CATEGORY } from './definitions/shared.js'
import { feedbackId, resolveId, selectorFields, type LogicalControl } from './logical-controls.js'
import type { ModuleInstance } from './main.js'
import {
	compareNumber,
	dropdownField,
	isNumberCompareOperator,
	NUMBER_COMPARE_OPERATORS,
	numberValueField,
} from './option-fields.js'

const STYLE = {
	boolean: { bgcolor: combineRgb(0, 170, 0), color: combineRgb(0, 0, 0) },
	enum: { bgcolor: combineRgb(0, 102, 204), color: combineRgb(255, 255, 255) },
	number: { bgcolor: combineRgb(204, 102, 0), color: combineRgb(0, 0, 0) },
	string: { bgcolor: combineRgb(96, 96, 96), color: combineRgb(255, 255, 255) },
} as const

type BooleanFeedbackBase = Omit<CompanionBooleanFeedbackDefinition, 'options' | 'callback'>

/**
 * Feedbacks only recheck when a variable they read changes, so each placed instance registers
 * the concrete id its selectors resolve to.
 */
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

function commonFeedback(self: ModuleInstance, logical: LogicalControl): BooleanFeedbackBase {
	return {
		type: 'boolean',
		name: logical.displayName,
		defaultStyle: STYLE[logical.spec.kind],
		showInvert: true,
		...trackSubscription(self, logical),
	}
}

function booleanFeedback(self: ModuleInstance, logical: LogicalControl): CompanionBooleanFeedbackDefinition {
	return {
		...commonFeedback(self, logical),
		options: selectorFields(logical),
		callback: (feedback) => self.state.get(resolveId(logical, feedback.options)) === true,
	}
}

function enumFeedback(self: ModuleInstance, logical: LogicalControl): CompanionBooleanFeedbackDefinition {
	const choices =
		logical.spec.kind === 'enum' ? logical.spec.choices.map((choice) => ({ id: choice.id, label: choice.label })) : []
	return {
		...commonFeedback(self, logical),
		options: [...selectorFields(logical), dropdownField('value', logical.name, choices, choices[0]?.id ?? 0)],
		// State holds the enum's label, not its index.
		callback: (feedback) => {
			const choice = choices.find((c) => c.id === Number(feedback.options.value))
			return choice !== undefined && self.state.get(resolveId(logical, feedback.options)) === choice.label
		},
	}
}

function numberFeedback(self: ModuleInstance, logical: LogicalControl): CompanionBooleanFeedbackDefinition {
	const unit = logical.spec.kind === 'number' && logical.spec.unit ? `Value (${logical.spec.unit})` : 'Value'
	return {
		...commonFeedback(self, logical),
		options: [
			...selectorFields(logical),
			dropdownField('operator', 'Operator', NUMBER_COMPARE_OPERATORS, 'eq'),
			numberValueField(unit),
		],
		callback: (feedback) => {
			const current = Number(self.state.get(resolveId(logical, feedback.options)))
			if (Number.isNaN(current)) return false
			const operator = isNumberCompareOperator(feedback.options.operator) ? feedback.options.operator : 'eq'
			return compareNumber(operator, current, Number(feedback.options.value))
		},
	}
}

function stringFeedback(self: ModuleInstance, logical: LogicalControl): CompanionBooleanFeedbackDefinition {
	return {
		...commonFeedback(self, logical),
		options: [...selectorFields(logical), { type: 'textinput', id: 'value', label: 'Value', default: '' }],
		callback: (feedback) => {
			const current = self.state.get(resolveId(logical, feedback.options))
			return String(current ?? '') === String(feedback.options.value ?? '')
		},
	}
}

/**
 * Every readable logical control gets a feedback. Write-only parameters never report a value back,
 * and free-text labels aren't useful as trigger conditions, so both are skipped.
 */
export function UpdateFeedbacks(self: ModuleInstance): void {
	const feedbacks: CompanionFeedbackDefinitions = {}

	for (const logical of self.logicalControls) {
		if (logical.category === CATEGORY.METADATA_LABELING) continue
		if (!isReadable(logical.spec)) continue

		switch (logical.spec.kind) {
			case 'boolean':
				feedbacks[feedbackId(logical)] = booleanFeedback(self, logical)
				break
			case 'enum':
				feedbacks[feedbackId(logical)] = enumFeedback(self, logical)
				break
			case 'number':
				feedbacks[feedbackId(logical)] = numberFeedback(self, logical)
				break
			case 'string':
				feedbacks[feedbackId(logical)] = stringFeedback(self, logical)
				break
		}
	}

	self.setFeedbackDefinitions(feedbacks)
}
