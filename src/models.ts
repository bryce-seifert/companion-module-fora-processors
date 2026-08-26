export type ModelId = '1616' | '9600'

// Where a model reports its identity. The FA-9600 exposes a deviceID parameter; the FA-1616 has
// no such parameter and instead carries the model name as the description of its single root node.
export type IdentitySource =
	{ readonly kind: 'parameter'; readonly path: string } | { readonly kind: 'rootDescription'; readonly root: string }

export interface ModelSpec {
	readonly id: ModelId
	readonly label: string
	readonly port: number
	readonly identity: IdentitySource
	/** Value the device reports at `identity`; used to verify the configured model matches the hardware. */
	readonly deviceId: string
	/** Directories this model can't list whole: the reply overruns one S101 frame and the unit
	 * truncates it from the front, so it arrives undecodable. A field mask trims it enough to parse. */
	readonly truncatedDirectories: readonly string[]
	/** Enum labels this model publishes as strings on the device rather than fixing in firmware. */
	readonly choiceLabelSources: readonly ChoiceLabelSource[]
}

// Where a set of enum controls gets its labels. LUT slots are renameable, so their names belong to
// the unit rather than our tables — the ids stay fixed, only the text is read.
export interface ChoiceLabelSource {
	/** Control keys whose enum labels these fill. */
	readonly controlKeys: readonly string[]
	/** Enum id -> `/`-delimited path of the string parameter naming it. */
	readonly labelPaths: ReadonlyMap<number, string>
	/** Ids the unit names wrongly or not at all, taken from the control-command manual instead. */
	readonly fixedLabels: ReadonlyMap<number, string>
}

const COLOR_PROCESSOR_COMMON = 'root/processor/video/color-processor/common'

const pad2 = (value: number): string => String(value).padStart(2, '0')

// Gamma slots: User 01-50 at 0-49, Preset 01-10 at 50-59 (the manual documents these one higher;
// the unit refuses 60). User labels are split across three sibling nodes named for their span.
const gammaLabelPaths = (): Map<number, string> => {
	const paths = new Map<number, string>()
	for (const [first, last] of [
		[1, 20],
		[21, 40],
		[41, 50],
	]) {
		const group = `user-label-${pad2(first)}-${pad2(last)}`
		for (let id = first; id <= last; id++) {
			paths.set(id - 1, `${COLOR_PROCESSOR_COMMON}/gamma-label/${group}/u-${pad2(id)}/name`)
		}
	}
	for (let preset = 1; preset <= 10; preset++) {
		paths.set(49 + preset, `${COLOR_PROCESSOR_COMMON}/gamma-label/preset-label-01-20/p-${pad2(preset)}/name`)
	}
	return paths
}

// Colour space slots: User 01-10 at 0-9, three fixed colourimetries at 10-12. `color-label/p-01..03`
// exists but mirrors the user names, so the presets are labelled from the manual instead.
const colorLabelPaths = (): Map<number, string> =>
	new Map(
		Array.from({ length: 10 }, (_unused, index) => [
			index,
			`${COLOR_PROCESSOR_COMMON}/color-label/u-${pad2(index + 1)}/name`,
		]),
	)

const COLOR_PRESET_LABELS = new Map([
	[10, 'Preset 01: ITU-R BT.709'],
	[11, 'Preset 02: ITU-R BT.2020'],
	[12, 'Preset 03: S-Gamut/Gamut3'],
])

export const MODELS: Record<ModelId, ModelSpec> = {
	'1616': {
		id: '1616',
		label: 'FOR-A 1616',
		port: 9000,
		identity: { kind: 'rootDescription', root: 'root' },
		deviceId: 'FA-1616',
		// The in/out gamma and colour-space parameters carry long enumeration tables, which push
		// the listing of their shared parent over the frame limit.
		truncatedDirectories: ['/gamma-color'],
		choiceLabelSources: [
			{
				controlKeys: ['cp_in_gamma', 'cp_out_gamma'],
				labelPaths: gammaLabelPaths(),
				fixedLabels: new Map(),
			},
			{
				controlKeys: ['cp_in_color', 'cp_out_color'],
				labelPaths: colorLabelPaths(),
				fixedLabels: COLOR_PRESET_LABELS,
			},
		],
	},
	'9600': {
		id: '9600',
		label: 'FOR-A 9600',
		port: 55000,
		identity: { kind: 'parameter', path: 'processor/identity/deviceConfig/deviceID' },
		deviceId: 'FA-9600',
		truncatedDirectories: [],
		choiceLabelSources: [],
	},
}

export function isTruncatedDirectory(spec: ModelSpec, path: string): boolean {
	return spec.truncatedDirectories.some((suffix) => path.endsWith(suffix))
}

export function describeIdentitySource(identity: IdentitySource): string {
	return identity.kind === 'parameter' ? `parameter "${identity.path}"` : `description of root node "${identity.root}"`
}

export const DEFAULT_MODEL: ModelId = '1616'

export function getModelSpec(id: ModelId | undefined): ModelSpec {
	return MODELS[id ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL]
}
