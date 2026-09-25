import type { CompanionInputFieldDropdown, CompanionOptionValues } from '@companion-module/base'
import type { ControlSpec } from './definitions/controls.js'
import { controlKey, type VariableDefinition } from './definitions/shared.js'

/** Human labels for selector dropdowns, keyed by group-selector dimension. */
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

export interface SelectorChoice {
	readonly id: string
	readonly label: string
}

export interface Selector {
	readonly dim: string
	readonly label: string
	readonly choices: readonly SelectorChoice[]
}

/** One pick within a cartesian product of selector dimensions (e.g. PRU=A1). */
export interface SelectorComboEntry extends SelectorChoice {
	readonly dim: string
}

export type SelectorCombo = readonly SelectorComboEntry[]

/**
 * The value field for one spec of a control. Nearly every control has a single spec shared by all
 * its instances; where instances differ (fa1616 `input_select`, per PRU block) each spec gets its
 * own field, shown only for the selections that use it.
 */
export interface SpecVariant {
	readonly fieldId: string
	readonly spec: ControlSpec
	readonly isVisibleExpression: string | undefined
}

/**
 * One action/feedback in the UI, collapsing every instance of a parameter (FS1/FS2, channels
 * 1-32...) behind a selector dropdown per dimension. `variantById` maps a selection (dimension
 * values joined by `|`) back to the concrete variable id. `displayName` is `name` prefixed with
 * its category so the actions and feedbacks lists read grouped by category.
 */
export interface LogicalControl {
	readonly key: string
	readonly name: string
	readonly displayName: string
	readonly category: string | undefined
	readonly spec: ControlSpec
	readonly selectors: readonly Selector[]
	readonly variantById: ReadonlyMap<string, string>
	readonly specVariants: readonly SpecVariant[]
	/** Variable id -> index into `specVariants`. */
	readonly specVariantById: ReadonlyMap<string, number>
}

interface LogicalControlAccumulator {
	key: string
	name: string
	category: string | undefined
	spec: ControlSpec
	dims: string[]
	dimChoices: Map<string, Map<string, string>>
	variantById: Map<string, string>
	// Selector combos (one value per dim) using each distinct spec, in encounter order.
	specCombos: Map<ControlSpec, string[][]>
	specById: Map<string, ControlSpec>
}

/** A control key is unique across the model, so one id per layer is enough. */
export const actionId = (logical: LogicalControl): string => `act_${logical.key}`
export const feedbackId = (logical: LogicalControl): string => `fb_${logical.key}`

/** Collapse the definition table into its logical controls, sorted by category + name. */
export function buildLogicalControls(definitions: readonly VariableDefinition[]): LogicalControl[] {
	const accumulators = new Map<string, LogicalControlAccumulator>()

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
				specCombos: new Map(),
				specById: new Map(),
			}
			accumulators.set(key, acc)
		}

		const selectors = def.group?.selectors ?? []
		for (const selector of selectors) {
			const values = acc.dimChoices.get(selector.dim) ?? new Map<string, string>()
			values.set(selector.value, selector.label)
			acc.dimChoices.set(selector.dim, values)
		}
		const values = selectors.map((selector) => selector.value)
		acc.variantById.set(values.join('|'), def.id)
		const combos = acc.specCombos.get(def.control) ?? []
		combos.push(values)
		acc.specCombos.set(def.control, combos)
		acc.specById.set(def.id, def.control)
	}

	const logicals: LogicalControl[] = [...accumulators.values()].map((acc) => ({
		key: acc.key,
		name: acc.name,
		displayName: acc.category ? `${acc.category} - ${acc.name}` : acc.name,
		category: acc.category,
		spec: acc.spec,
		variantById: acc.variantById,
		...buildSpecVariants(acc),
		selectors: acc.dims.map((dim) => ({
			dim,
			label: DIMENSION_LABELS[dim] ?? dim,
			// Preserve encounter order from the definition table (e.g. PRU A1–A4, B1–B4). Lexicographic
			// sort would scatter unpadded numeric ids like "101" between "1" and "2".
			choices: [...(acc.dimChoices.get(dim) ?? new Map())].map(([value, label]) => ({ id: value, label })),
		})),
	}))

	logicals.sort((a, b) => a.displayName.localeCompare(b.displayName))
	return logicals
}

function buildSpecVariants(acc: LogicalControlAccumulator): Pick<LogicalControl, 'specVariants' | 'specVariantById'> {
	const specs = [...acc.specCombos.keys()]
	const specVariants = specs.map((spec, index) => ({
		fieldId: index === 0 ? 'value' : `value_${index}`,
		spec,
		isVisibleExpression:
			specs.length === 1 ? undefined : visibleExpression(acc.dims, acc.specCombos.get(spec) ?? [], acc.dimChoices),
	}))
	const specVariantById = new Map([...acc.specById].map(([id, spec]) => [id, specs.indexOf(spec)]))
	return { specVariants, specVariantById }
}

// Matches exactly `combos`. When they form a full cartesian product (the usual case: a spec per
// PRU, whatever the lane) it tests each dim on its own and skips dims that allow every value.
function visibleExpression(
	dims: readonly string[],
	combos: readonly (readonly string[])[],
	dimChoices: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string {
	const matches = (dim: string, values: Iterable<string>) =>
		[...values].map((value) => `$(options:${dim}) == '${value}'`).join(' || ')

	const perDim = dims.map((_dim, index) => new Set(combos.map((combo) => combo[index])))
	const productSize = perDim.reduce((size, values) => size * values.size, 1)
	if (productSize === new Set(combos.map((combo) => combo.join('|'))).size) {
		const terms = dims
			.map((dim, index) => ({ dim, values: perDim[index] }))
			.filter(({ dim, values }) => values.size < (dimChoices.get(dim)?.size ?? 0))
			.map(({ dim, values }) => `(${matches(dim, values)})`)
		return terms.length > 0 ? terms.join(' && ') : 'true'
	}
	return combos
		.map((combo) => `(${combo.map((value, index) => `$(options:${dims[index]}) == '${value}'`).join(' && ')})`)
		.join(' || ')
}

/** The spec and value field the concrete variable `id` uses. */
export function specVariantFor(logical: LogicalControl, id: string): SpecVariant {
	return logical.specVariants[logical.specVariantById.get(id) ?? 0]
}

/**
 * The raw value option for the variable `id`. Falls back to `value`, where a control's only value
 * field lived before its instances were split by spec.
 */
export function valueOption(logical: LogicalControl, id: string, options: CompanionOptionValues): unknown {
	return options[specVariantFor(logical, id).fieldId] ?? options.value
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

/** Resolve the concrete variable id targeted by a fired action/feedback from its selector values. */
export function resolveId(logical: LogicalControl, options: CompanionOptionValues): string {
	const combo = logical.selectors.map((selector) => String(options[selector.dim])).join('|')
	return logical.variantById.get(combo) ?? [...logical.variantById.values()][0]
}

/** The first choice of every selector dimension — the same combo `resolveId` falls back to. */
export function defaultOptions(logical: LogicalControl): CompanionOptionValues {
	return Object.fromEntries(logical.selectors.map((selector) => [selector.dim, selector.choices[0]?.id]))
}

/** Options object for one cartesian-product combo of selector dimensions. */
export function optionsFromCombo(combo: SelectorCombo): CompanionOptionValues {
	return Object.fromEntries(combo.map((entry) => [entry.dim, entry.id]))
}

/**
 * Every combination of choices across `selectors`, e.g. `[colorSelector]` → `[[red], [green], [blue]]`.
 * An empty selector list yields a single empty combo so callers can still run one pass.
 */
export function expandChoices(selectors: readonly Selector[]): SelectorCombo[] {
	return selectors.reduce<SelectorComboEntry[][]>(
		(combos, selector) =>
			combos.flatMap((combo) => selector.choices.map((choice) => [...combo, { dim: selector.dim, ...choice }])),
		[[]],
	)
}
