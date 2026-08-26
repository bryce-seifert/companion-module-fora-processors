// The control shape of an Ember+ parameter: what it accepts and how it displays
// This is fixed per model rather than being discovered from the device

export type Access = 'read' | 'write' | 'readwrite'

export interface EnumChoice {
	readonly id: number
	readonly label: string
}

export interface NumberSpec {
	readonly kind: 'number'
	readonly access: Access
	// Raw device bounds, before `factor` is divided out for display.
	readonly min: number
	readonly max: number
	// The device reports a scaled integer; display value is raw / factor. 1 means unscaled.
	readonly factor: number
	// Display suffix from the manual's format string ('dB', 'ms', '%')
	readonly unit: string | null
}

export interface BooleanSpec {
	readonly kind: 'boolean'
	readonly access: Access
}

export interface EnumSpec {
	readonly kind: 'enum'
	readonly access: Access
	// Ids are the device's own indices and are not necessarily contiguous — unused slots are
	// omitted, so the remaining choices still map back to the correct device value.
	readonly choices: readonly EnumChoice[]
}

export interface StringSpec {
	readonly kind: 'string'
	readonly access: Access
}

export type ControlSpec = NumberSpec | BooleanSpec | EnumSpec | StringSpec

export type ControlKind = ControlSpec['kind']

export const num = (access: Access, range: Omit<NumberSpec, 'kind' | 'access'>): NumberSpec => ({
	kind: 'number',
	access,
	...range,
})

export const bool = (access: Access): BooleanSpec => ({ kind: 'boolean', access })

export const text = (access: Access): StringSpec => ({ kind: 'string', access })

export const choice = (access: Access, choices: readonly (readonly [number, string])[]): EnumSpec => ({
	kind: 'enum',
	access,
	choices: choices.map(([id, label]) => ({ id, label })),
})

export function isWritable(spec: ControlSpec): boolean {
	return spec.access === 'write' || spec.access === 'readwrite'
}

// Write-only parameters (event load/save/delete, ...) never report a value back from the device,
// so there's no live state to compare a feedback against.
export function isReadable(spec: ControlSpec): boolean {
	return spec.access === 'read' || spec.access === 'readwrite'
}

// Same enum, device-supplied labels. Ids the device didn't name keep the table's own label, so a
// partial read degrades to static text rather than blanking choices out of the dropdowns.
export function relabelChoices(spec: EnumSpec, labels: ReadonlyMap<number, string>): EnumSpec {
	return {
		...spec,
		choices: spec.choices.map((choice) => ({ ...choice, label: labels.get(choice.id) ?? choice.label })),
	}
}
