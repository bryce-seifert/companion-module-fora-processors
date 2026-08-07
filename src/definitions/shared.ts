import type { CompanionVariableValue } from '@companion-module/base'
import type { ControlSpec } from './controls.js'

// An Ember+ parameter before its control metadata has been attached. The model tables are
// written in this form: they say what a parameter is called and where it lives, and the
// matching `*-controls.ts` table says what it accepts.
export interface DefinitionDraft {
	readonly id: string
	readonly name: string
	readonly path: string
	// When set, this parameter is one instance of a group presented as a single action.
	readonly group?: ControlGroup
	// Functions.csv "Category" column; prefixed onto the action name for grouping in the UI.
	readonly category?: string
	// Set only where instances sharing a control key genuinely differ (see fa1616 `input_select`).
	readonly control?: ControlSpec
}

// An Ember+ parameter mirrored into a Companion variable. `path` is `/`-delimited.
export interface VariableDefinition extends DefinitionDraft {
	readonly control: ControlSpec
}

// Instances of a parameter share one spec, so the control tables are keyed by group key —
// or by id for the handful of parameters that aren't grouped.
export function controlKey(draft: DefinitionDraft): string {
	return draft.group?.key ?? draft.id
}

// Resolves each draft's spec from `table`. A draft that already carries its own `control` keeps
// it. A missing key is a bug in the tables rather than a device condition, so it throws rather
// than silently dropping the parameter from the UI.
export function attachControls(
	drafts: readonly DefinitionDraft[],
	table: Record<string, ControlSpec>,
): VariableDefinition[] {
	return drafts.map((draft) => {
		const control = draft.control ?? table[controlKey(draft)]
		if (!control) throw new Error(`No control spec for "${controlKey(draft)}" (definition "${draft.id}")`)
		return { ...draft, control }
	})
}

// Functions.csv "Category" column values, shared by both models' definition tables.
export const CATEGORY = {
	SIGNAL_PROCESSING: 'Signal Processing',
	PATH_ROUTING: 'Path & Routing',
	SYNCHRONIZATION: 'Synchronization',
	SIGNAL_STATUS: 'Signal Status',
	UTILITIES: 'Utilities',
	HDR_COLOR_SPACE: 'HDR and Color Space',
	GAIN_DELAY: 'Gain & Delay',
	HARDWARE_STANDARDS: 'Hardware/Standards',
	TEST_SIGNALS: 'Test Signals',
	EVENT_MEMORY: 'Event Memory',
	METADATA_LABELING: 'Metadata & Labeling',
	FS_LINKING: 'FS Linking',
	WORKFLOW_4K: '4K Workflow',
} as const

// One dimension of a grouped action (e.g. Frame Sync, PRU, Lane, Channel) and this instance's value.
export interface GroupSelector {
	readonly dim: string
	readonly value: string
	readonly label: string
}

// Instances sharing a `key` collapse into one action with a selector dropdown per dimension.
export interface ControlGroup {
	readonly key: string
	readonly name: string
	readonly selectors: readonly GroupSelector[]
}

// Delimiter used in VariableDefinition.path; passed to `getElementByPath`.
export const PATH_DELIMITER = '/'

export type VariableId = string

// `undefined` = not yet known.
export type DeviceState = Record<VariableId, CompanionVariableValue | undefined>

export const pad = (value: number, width: number): string => String(value).padStart(width, '0')
export const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)
export const range = (start: number, end: number): number[] =>
	Array.from({ length: end - start + 1 }, (_, i) => start + i)

export interface ParentGroupMember {
	readonly leaf: string
	readonly def: VariableDefinition
}

// Groups by parent path so each parent's children can be fetched in one getDirectory call instead of one round-trip per leaf.
export function groupByParent(definitions: readonly VariableDefinition[]): Map<string, ParentGroupMember[]> {
	const groups = new Map<string, ParentGroupMember[]>()
	for (const def of definitions) {
		const segments = def.path.split(PATH_DELIMITER)
		const leaf = segments.pop()
		if (leaf === undefined) continue
		const parentPath = segments.join(PATH_DELIMITER)
		const group = groups.get(parentPath) ?? []
		group.push({ leaf, def })
		groups.set(parentPath, group)
	}
	return groups
}

// Turns a raw device value into what the Companion variable shows: enums display their label,
// scaled numbers are divided back down. Driven entirely by the definition's spec, so the same
// formatting applies whether the value came from the initial read or a subscription update.
export function formatValue(spec: ControlSpec, value: unknown): CompanionVariableValue | undefined {
	if (value === undefined || value === null) return undefined

	if (spec.kind === 'enum' && typeof value === 'number') {
		return spec.choices.find((choice) => choice.id === value)?.label ?? value
	}
	if (spec.kind === 'number' && typeof value === 'number') {
		return spec.factor === 1 ? value : value / spec.factor
	}

	if (Buffer.isBuffer(value)) return value.toString('hex')
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
	return undefined // Ember+ carries nothing else; anything left has no sensible display form.
}
