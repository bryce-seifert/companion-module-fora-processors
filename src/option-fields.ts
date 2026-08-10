import type { CompanionInputFieldDropdown, CompanionInputFieldNumber } from '@companion-module/base'

/** Shared upper/lower bound for free-form number option fields in actions and feedbacks. */
export const NUMBER_OPTION_LIMIT = 1_000_000_000

export type BooleanActionMode = 'on' | 'off' | 'toggle'
export type NumberActionMode = 'set' | 'increase' | 'decrease'
export type NumberCompareOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte'

export const BOOLEAN_ACTION_MODES: readonly { id: BooleanActionMode; label: string }[] = [
	{ id: 'on', label: 'On' },
	{ id: 'off', label: 'Off' },
	{ id: 'toggle', label: 'Toggle' },
]

export const NUMBER_ACTION_MODES: readonly { id: NumberActionMode; label: string }[] = [
	{ id: 'set', label: 'Set' },
	{ id: 'increase', label: 'Increase' },
	{ id: 'decrease', label: 'Decrease' },
]

export const NUMBER_COMPARE_OPERATORS: readonly { id: NumberCompareOperator; label: string }[] = [
	{ id: 'eq', label: 'Equal To' },
	{ id: 'gt', label: 'Greater Than' },
	{ id: 'gte', label: 'Greater Than or Equal' },
	{ id: 'lt', label: 'Less Than' },
	{ id: 'lte', label: 'Less Than or Equal' },
]

export function numberValueField(label: string, defaultValue = 0): CompanionInputFieldNumber {
	return {
		type: 'number',
		id: 'value',
		label,
		default: defaultValue,
		min: -NUMBER_OPTION_LIMIT,
		max: NUMBER_OPTION_LIMIT,
	}
}

export function dropdownField(
	id: string,
	label: string,
	choices: readonly { id: string | number; label: string }[],
	defaultValue: string | number,
): CompanionInputFieldDropdown {
	return {
		type: 'dropdown',
		id,
		label,
		default: defaultValue,
		choices: [...choices],
	}
}

export function compareNumber(operator: NumberCompareOperator, current: number, target: number): boolean {
	switch (operator) {
		case 'gt':
			return current > target
		case 'gte':
			return current >= target
		case 'lt':
			return current < target
		case 'lte':
			return current <= target
		case 'eq':
			return current === target
	}
}

export function isBooleanActionMode(value: unknown): value is BooleanActionMode {
	return value === 'on' || value === 'off' || value === 'toggle'
}

export function isNumberActionMode(value: unknown): value is NumberActionMode {
	return value === 'set' || value === 'increase' || value === 'decrease'
}

export function isNumberCompareOperator(value: unknown): value is NumberCompareOperator {
	return value === 'eq' || value === 'gt' || value === 'gte' || value === 'lt' || value === 'lte'
}
