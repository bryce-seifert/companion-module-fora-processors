import type { CompanionVariableValue } from '@companion-module/base'
import { Model } from 'emberplus-connection'

// An Ember+ parameter mirrored into a Companion variable. `path` is `/`-delimited.
export interface VariableDefinition {
	readonly id: string
	readonly name: string
	readonly path: string
	// When set, this parameter is one instance of a group presented as a single action.
	readonly group?: ControlGroup
	// Functions.csv "Category" column; prefixed onto the action name for grouping in the UI.
	readonly category?: string
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

// Enum parameters report a 0-based index mapped back to its label; `factor` parameters report a
// scaled integer divided back down for display.
export function formatParameterValue(parameter: Model.Parameter): CompanionVariableValue | undefined {
	const { value } = parameter
	if (value === undefined || value === null) return undefined

	if (typeof value === 'number') {
		const label = enumLabel(parameter, value)
		if (label !== undefined) return label
		if (parameter.factor) return value / parameter.factor
	}

	if (Buffer.isBuffer(value)) return value.toString('hex')
	return value
}

function enumLabel(parameter: Model.Parameter, index: number): string | undefined {
	if (parameter.enumMap) {
		for (const [label, mapped] of parameter.enumMap) {
			if (mapped === index) return label
		}
	}
	if (parameter.enumeration) {
		const label = parameter.enumeration.split('\n')[index]
		if (label !== undefined) return label
	}
	return undefined
}

export type ControlKind = 'number' | 'boolean' | 'enum' | 'string'

export interface EnumChoice {
	readonly id: number
	readonly label: string
}

// Independent of read/write access — read-only status parameters get a kind too, so they can
// drive feedbacks even though they never become actions. Enums take priority over the underlying integer type.
export function classifyParameter(parameter: Model.Parameter): ControlKind | undefined {
	if (parameter.enumeration || parameter.enumMap) return 'enum'
	switch (parameter.parameterType) {
		case Model.ParameterType.Boolean:
			return 'boolean'
		case Model.ParameterType.Integer:
		case Model.ParameterType.Real:
			return 'number'
		case Model.ParameterType.String:
			return 'string'
		default:
			return undefined // trigger, octets, null
	}
}

// The device uses a bare "~" as a placeholder for unused/reserved enum slots; never a real choice.
const isPlaceholderChoice = (label: string): boolean => label.trim() === '~'

// Placeholder slots are filtered but original indices are kept as ids, so the remaining
// choices still map back to the correct device value.
export function enumChoices(parameter: Model.Parameter): EnumChoice[] {
	if (parameter.enumMap) {
		return [...parameter.enumMap.entries()]
			.map(([label, id]) => ({ id, label }))
			.filter((choice) => !isPlaceholderChoice(choice.label))
			.sort((a, b) => a.id - b.id)
	}
	if (parameter.enumeration) {
		return parameter.enumeration
			.split('\n')
			.map((label, id) => ({ id, label }))
			.filter((choice) => !isPlaceholderChoice(choice.label))
	}
	return []
}
