import type { CompanionInputFieldDropdown, CompanionOptionValues } from '@companion-module/base'
import type { ControlSpec } from './definitions/controls.js'
import { controlKey, type VariableDefinition } from './definitions/shared.js'

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
	readonly dim: string
	readonly label: string
	readonly choices: readonly { id: string; label: string }[]
}

// One action/feedback in the UI, collapsing every instance of a parameter (FS1/FS2, channels
// 1-32...) behind a selector dropdown per dimension. `variantById` maps a selection (dimension
// values joined by `|`) back to the concrete variable id. `displayName` is `name` prefixed with
// its category so the actions and feedbacks lists read grouped by category.
export interface LogicalControl {
	readonly key: string
	readonly name: string
	readonly displayName: string
	readonly category: string | undefined
	readonly spec: ControlSpec
	readonly selectors: readonly Selector[]
	readonly variantById: ReadonlyMap<string, string>
}

// A control key is unique across the model, so one id per layer is enough.
export const actionId = (logical: LogicalControl): string => `act_${logical.key}`
export const feedbackId = (logical: LogicalControl): string => `fb_${logical.key}`

// Collapse the definition table into its logical controls, sorted by category + name.
export function buildLogicalControls(definitions: readonly VariableDefinition[]): LogicalControl[] {
	interface Accumulator {
		key: string
		name: string
		category: string | undefined
		spec: ControlSpec
		dims: string[]
		dimChoices: Map<string, Map<string, string>>
		variantById: Map<string, string>
	}
	const accumulators = new Map<string, Accumulator>()

	for (const def of definitions) {
		const key = controlKey(def)
		let acc = accumulators.get(key)
		if (!acc) {
			acc = {
				key,
				name: def.group?.name ?? def.name,
				category: def.category,
				spec: def.control,
				dims: def.group ? def.group.selectors.map((selector) => selector.dim) : [],
				dimChoices: new Map(),
				variantById: new Map(),
			}
			accumulators.set(key, acc)
		}

		const selectors = def.group?.selectors ?? []
		for (const selector of selectors) {
			const values = acc.dimChoices.get(selector.dim) ?? new Map<string, string>()
			values.set(selector.value, selector.label)
			acc.dimChoices.set(selector.dim, values)
		}
		acc.variantById.set(selectors.map((selector) => selector.value).join('|'), def.id)
	}

	const logicals = [...accumulators.values()].map((acc) => ({
		key: acc.key,
		name: acc.name,
		displayName: acc.category ? `${acc.category} - ${acc.name}` : acc.name,
		category: acc.category,
		spec: acc.spec,
		variantById: acc.variantById,
		selectors: acc.dims.map((dim) => ({
			dim,
			label: DIMENSION_LABELS[dim] ?? dim,
			// Preserve the order values were first encountered in the definition table (e.g. PRU
			// A1-A4, B1-B4) rather than sorting lexicographically, which would scatter unpadded
			// numeric ids like "101" between "1" and "2".
			choices: [...(acc.dimChoices.get(dim) ?? new Map<string, string>())].map(([value, label]) => ({
				id: value,
				label,
			})),
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
		choices: [...selector.choices],
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
