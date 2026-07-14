import type { CompanionInputFieldDropdown, CompanionOptionValues } from '@companion-module/base'
import type { ControlSummary } from './api.js'
import type { EnumChoice } from './state.js'

// Human labels for the selector dropdowns, keyed by group-selector dimension.
export const DIMENSION_LABELS: Record<string, string> = {
	fs: 'Frame Sync',
	emb: 'Embedded',
	ch: 'Channel',
	pru: 'PRU',
	lane: 'Lane',
	group: 'Group',
	event: 'Event',
	label: 'Label',
	color: 'Color',
	comp: 'Component',
}

export interface Selector {
	dim: string
	label: string
	choices: { id: string; label: string }[]
}

// The `idPrefix` each layer passes to toLogical, kept in one place so actions/feedbacks/presets
// never disagree on the id a given logical control resolves to.
export const ID_PREFIX = {
	number: { action: 'num', feedback: 'numf' },
	boolean: { action: 'bool', feedback: 'boolf' },
	enum: { action: 'enum', feedback: 'enumf' },
} as const

// `variantById` maps a selection (dimension values joined by `|`) back to the concrete variable id.
// `displayName` is `name` prefixed with its category so actions/feedbacks list grouped by category.
export interface LogicalControl {
	id: string
	name: string
	displayName: string
	category?: string
	selectors: Selector[]
	variantById: Map<string, string>
	choices?: EnumChoice[]
}

// Collapse grouped parameter instances into logical controls, sorted by category + name.
export function toLogical(items: ControlSummary[], idPrefix: string): LogicalControl[] {
	interface Accumulator {
		id: string
		name: string
		category?: string
		dims: string[]
		dimChoices: Map<string, Map<string, string>>
		variantById: Map<string, string>
		choices?: EnumChoice[]
	}
	const accumulators = new Map<string, Accumulator>()

	for (const item of items) {
		const groupKey = item.group ? `g:${item.group.key}` : `i:${item.id}`
		let acc = accumulators.get(groupKey)
		if (!acc) {
			acc = {
				id: `${idPrefix}_${item.group?.key ?? item.id}`,
				name: item.group?.name ?? item.name,
				category: item.category,
				dims: item.group ? item.group.selectors.map((selector) => selector.dim) : [],
				dimChoices: new Map(),
				variantById: new Map(),
				choices: item.choices,
			}
			accumulators.set(groupKey, acc)
		}

		const selectors = item.group?.selectors ?? []
		for (const selector of selectors) {
			const values = acc.dimChoices.get(selector.dim) ?? new Map<string, string>()
			values.set(selector.value, selector.label)
			acc.dimChoices.set(selector.dim, values)
		}
		acc.variantById.set(selectors.map((selector) => selector.value).join('|'), item.id)
	}

	const logicals = [...accumulators.values()].map((acc) => ({
		id: acc.id,
		name: acc.name,
		displayName: acc.category ? `${acc.category} - ${acc.name}` : acc.name,
		category: acc.category,
		choices: acc.choices,
		variantById: acc.variantById,
		selectors: acc.dims.map((dim) => ({
			dim,
			label: DIMENSION_LABELS[dim] ?? dim,
			choices: [...(acc.dimChoices.get(dim) ?? new Map())]
				.map(([value, label]) => ({ id: value, label }))
				.sort((a, b) => a.id.localeCompare(b.id)),
		})),
	}))
	logicals.sort((a, b) => a.displayName.localeCompare(b.displayName))
	return logicals
}

export function selectorFields(logical: LogicalControl): CompanionInputFieldDropdown[] {
	return logical.selectors.map((selector) => ({
		type: 'dropdown',
		id: selector.dim,
		label: selector.label,
		default: selector.choices[0]?.id,
		choices: selector.choices,
	}))
}

// Resolve the concrete variable id targeted by a fired action/feedback from its selector values.
export function resolveId(logical: LogicalControl, options: CompanionOptionValues): string {
	const combo = logical.selectors.map((selector) => String(options[selector.dim])).join('|')
	return logical.variantById.get(combo) ?? [...logical.variantById.values()][0]
}

// The first choice of every selector dimension — the same combo `resolveId` falls back to.
export function defaultOptions(logical: LogicalControl): CompanionOptionValues {
	return Object.fromEntries(logical.selectors.map((selector) => [selector.dim, selector.choices[0]?.id]))
}
