import { choice, type EnumSpec } from './controls.js'
import { FA1616_CONTROLS } from './fa1616-controls.js'
import {
	attachControls,
	CATEGORY,
	cap,
	pad,
	range,
	type DefinitionDraft,
	type GroupSelector,
	type VariableDefinition,
} from './shared.js'

// Instances are block-numbered PRUs, each with four lanes (a–d) sharing the same parameter
// set, so every logical parameter collapses into one action with PRU/Lane selectors.

// Video block: Block-A 1-4, Block-B 101-104.
const PRU_VIDEO = [1, 2, 3, 4, 101, 102, 103, 104]
// Input-select and audio also include Block-C 201-204.
const PRU_AUDIO = [...PRU_VIDEO, 201, 202, 203, 204]
const LANES = ['a', 'b', 'c', 'd'] as const

// "A1", "B3", "C2" from the block-offset PRU index.
function pruLabel(n: number): string {
	if (n >= 200) return `C${n - 200}`
	if (n >= 100) return `B${n - 100}`
	return `A${n}`
}
const pruSelector = (n: number): GroupSelector => ({ dim: 'pru', value: String(n), label: pruLabel(n) })
const laneSelector = (lane: string): GroupSelector => ({ dim: 'lane', value: lane, label: lane.toUpperCase() })

// Readable dimension tokens for ids ("prub4", "lanea") — mirrors the emb1/ch01 convention in fa9600.ts.
const pruTag = (n: number): string => `pru${pruLabel(n).toLowerCase()}`
const laneTag = (lane: string): string => `lane${lane}`

// Readable suffix for names: "PRU B4" or "PRU B4 Lane B".
const pruNameSuffix = (n: number, lane?: string): string =>
	lane ? `PRU ${pruLabel(n)} Lane ${lane.toUpperCase()}` : `PRU ${pruLabel(n)}`

// An extra selector dimension (e.g. Color, Component) that folds sibling parameters into one action.
interface ColorProcVariant {
	readonly dim: string
	readonly value: string
	readonly label: string
	// Consolidated action name; the variant label is appended to each parameter's own name.
	readonly groupName: string
}

// One parameter per PRU x lane. When `variant` is given, an extra selector dimension folds
// sibling parameters (R/G/B, R-Y/G-Y/B-Y...) into the same action too.
function addColorProc(
	defs: DefinitionDraft[],
	prus: readonly number[],
	key: string,
	name: string,
	leaf: string,
	category: string,
	variant?: ColorProcVariant,
): void {
	for (const n of prus) {
		for (const lane of LANES) {
			const base = `root/processor/video/color-processor/color-processor-${n}/color-processor-${n}${lane}`
			defs.push({
				id: `cp_${pruTag(n)}_${laneTag(lane)}_${key}${variant ? `_${variant.value.replace(/-/g, '')}` : ''}`,
				name: `CP ${name}${variant ? ` ${variant.label}` : ''} ${pruNameSuffix(n, lane)}`,
				path: `${base}/${leaf}`,
				category,
				group: {
					key: `cp_${key}`,
					name: variant?.groupName ?? name,
					selectors: variant
						? [pruSelector(n), laneSelector(lane), { dim: variant.dim, value: variant.value, label: variant.label }]
						: [pruSelector(n), laneSelector(lane)],
				},
			})
		}
	}
}

// Names as complete labels, not abbreviations.
const LEVEL_NAME: Record<string, string> = {
	video: 'Video Level',
	y: 'Y Level',
	chroma: 'Chroma Level',
	black: 'Setup/Black Level',
	hue: 'Hue',
}
const GAIN_NAME: Record<string, string> = {
	'dr-gain': 'Dynamic Range Gain',
	'sdr-gain': 'SDR Gain',
	'total-gain': 'Total Gain',
}

function colorProcessorDefinitions(): DefinitionDraft[] {
	const defs: DefinitionDraft[] = []

	for (const p of ['video', 'y', 'chroma', 'black', 'hue']) {
		addColorProc(defs, PRU_VIDEO, `preamp_${p}`, LEVEL_NAME[p], `pre-amplifier/${p}`, CATEGORY.SIGNAL_PROCESSING)
	}

	for (const group of ['white', 'black', 'gamma']) {
		for (const color of ['red', 'green', 'blue']) {
			addColorProc(
				defs,
				PRU_VIDEO,
				`postbal_${group}`,
				`CC ${cap(group)} Level`,
				`post-balance/${group}/${color}`,
				CATEGORY.SIGNAL_PROCESSING,
				{ dim: 'color', value: color, label: cap(color), groupName: `CC ${cap(group)} Level (R/G/B)` },
			)
		}
	}
	addColorProc(
		defs,
		PRU_VIDEO,
		'postbal_gamma_curve',
		'Gamma Curve',
		'post-balance/gamma-curve',
		CATEGORY.SIGNAL_PROCESSING,
	)

	//Clip-mode is white-only; the black node exposes just enable + output-clip.
	addColorProc(
		defs,
		PRU_VIDEO,
		'rgbclip_white_mode',
		'White Clip Mode',
		'rgb-clip/white/clip-mode',
		CATEGORY.SIGNAL_PROCESSING,
	)
	for (const group of ['white', 'black']) {
		addColorProc(
			defs,
			PRU_VIDEO,
			`rgbclip_${group}_out`,
			`RGB ${cap(group)} Clip`,
			`rgb-clip/${group}/output-clip`,
			CATEGORY.SIGNAL_PROCESSING,
		)
	}

	for (const p of ['white', 'black', 'chroma']) {
		addColorProc(defs, PRU_VIDEO, `ycbcr_${p}`, `YCbCr ${cap(p)}`, `ycbcr/${p}`, CATEGORY.SIGNAL_PROCESSING)
	}

	for (const group of ['white', 'black']) {
		for (const comp of ['r-y', 'g-y', 'b-y']) {
			addColorProc(
				defs,
				PRU_VIDEO,
				`diff_${group}`,
				`CC Differential ${cap(group)} Level`,
				`differential/${group}/${comp}`,
				CATEGORY.SIGNAL_PROCESSING,
				{
					dim: 'comp',
					value: comp,
					label: comp.toUpperCase(),
					groupName: `CC Differential ${cap(group)} Level (R-Y/G-Y/B-Y)`,
				},
			)
		}
	}

	for (const g of ['dr-gain', 'sdr-gain', 'total-gain']) {
		addColorProc(defs, PRU_VIDEO, g.replace('-', '_'), GAIN_NAME[g], `gain/${g}`, CATEGORY.SIGNAL_PROCESSING)
	}

	// gamma-color node: CC bypass = "conversion"; colour space + gamma are EOTF/OETF in/out.
	addColorProc(defs, PRU_VIDEO, 'cc_bypass', 'Color Correction Bypass', 'gamma-color/conversion', CATEGORY.UTILITIES)
	addColorProc(defs, PRU_VIDEO, 'in_color', 'Input Color Space', 'gamma-color/in-color', CATEGORY.HDR_COLOR_SPACE)
	addColorProc(defs, PRU_VIDEO, 'out_color', 'Output Color Space', 'gamma-color/out-color', CATEGORY.HDR_COLOR_SPACE)
	addColorProc(defs, PRU_VIDEO, 'in_gamma', 'Input Gamma (EOTF)', 'gamma-color/in-gamma', CATEGORY.HDR_COLOR_SPACE)
	addColorProc(defs, PRU_VIDEO, 'out_gamma', 'Output Gamma (OETF)', 'gamma-color/out-gamma', CATEGORY.HDR_COLOR_SPACE)

	return defs
}

function synchronizerDefinitions(): DefinitionDraft[] {
	const defs: DefinitionDraft[] = []
	const addPru = (key: string, name: string, leaf: string, category: string) => {
		for (const n of PRU_VIDEO) {
			defs.push({
				id: `sync_${pruTag(n)}_${key}`,
				name: `Sync ${name} ${pruNameSuffix(n)}`,
				path: `root/processor/video/synchronizer/synchronizer-${n}/${leaf}`,
				category,
				group: { key: `sync_${key}`, name, selectors: [pruSelector(n)] },
			})
		}
	}

	// sync-mode / loss-mode / back-color sit on `synchronizer-format` itself, not its `format` child.
	const sf = 'synchronizer-format'
	const fmt = `${sf}/format`
	addPru('mode', 'Sync Mode', `${sf}/sync-mode`, CATEGORY.SYNCHRONIZATION)
	addPru('standard', 'Standard', `${fmt}/standard`, CATEGORY.SYNCHRONIZATION)
	addPru('rate', 'Rate', `${fmt}/rate`, CATEGORY.SYNCHRONIZATION)
	addPru('level', '3G SDI Output Level', `${fmt}/level`, CATEGORY.UTILITIES)
	addPru('division', 'SQD / 2SI Division', `${fmt}/division`, CATEGORY.WORKFLOW_4K)
	addPru('format_status', 'Output Format Status', `${fmt}/format-status`, CATEGORY.SYNCHRONIZATION)
	addPru('is_manual', 'Sync Setting Mode (Auto/Manual)', `${fmt}/is-manual`, CATEGORY.SYNCHRONIZATION)
	addPru('loss_mode', 'Video Input Loss Mode', `${sf}/loss-mode`, CATEGORY.UTILITIES)
	addPru('back_color', 'Back Color', `${sf}/back-color`, CATEGORY.UTILITIES)
	addPru('h_timing', 'Horizontal Phase', 'adjust-timing/h-timing', CATEGORY.SYNCHRONIZATION)
	addPru('v_timing', 'Vertical Phase', 'adjust-timing/v-timing', CATEGORY.SYNCHRONIZATION)
	addPru('genlock_status', 'Genlock Status', 'reference-select/genlock-status', CATEGORY.SYNCHRONIZATION)
	addPru('genlock_in_signal', 'Genlock In Signal', 'reference-select/genlock-in-signal', CATEGORY.SYNCHRONIZATION)
	addPru('ptp_signal', 'PTP/Input Lock Signal', 'reference-select/ptp-signal', CATEGORY.SYNCHRONIZATION)

	// Per-lane delay status hangs off adjust-timing. `delay-stauts` is the device's own misspelling
	for (const n of PRU_VIDEO) {
		for (const lane of LANES) {
			const base = `root/processor/video/synchronizer/synchronizer-${n}/adjust-timing/delay-stauts/lane-${lane}`
			for (const [leaf, key, name] of [
				['sdi-delay', 'sdi_delay', 'SDI Latency'],
				['ip-delay', 'ip_delay', 'IP Latency'],
				['total-delay', 'total_delay', 'Signal Latency'],
			] as const) {
				defs.push({
					id: `sync_${pruTag(n)}_${laneTag(lane)}_${key}`,
					name: `Sync ${name} ${pruNameSuffix(n, lane)}`,
					path: `${base}/${leaf}`,
					category: CATEGORY.SIGNAL_STATUS,
					group: { key: `sync_${key}`, name, selectors: [pruSelector(n), laneSelector(lane)] },
				})
			}
		}
	}

	return defs
}

function freezeDefinitions(): DefinitionDraft[] {
	const defs: DefinitionDraft[] = []
	for (const n of PRU_VIDEO) {
		for (const lane of LANES) {
			const base = `root/processor/video/test-signal-freeze/test-signal-freeze-${n}/test-signal-freeze-${n}${lane}`
			for (const [leaf, key, name] of [
				['freeze-enable', 'freeze', 'Video Freeze On/Off'],
				['freeze-mode', 'freeze_mode', 'Video Freeze Mode'],
				['test', 'test', 'Video Test Signal'],
			] as const) {
				defs.push({
					id: `freeze_${pruTag(n)}_${laneTag(lane)}_${key}`,
					name: `${name} ${pruNameSuffix(n, lane)}`,
					path: `${base}/${leaf}`,
					category: CATEGORY.UTILITIES,
					group: { key: `freeze_${key}`, name, selectors: [pruSelector(n), laneSelector(lane)] },
				})
			}
		}
	}
	return defs
}

// Input select is the one parameter whose choices differ between instances: each PRU sees only
// its own SDI/IP bus. Block-A (1-4) reads the A bus, Block-B (101-104) the B bus, and Block-C
// (201-204) reaches both, with the B bus offset by 100.
function inputSelectSpec(n: number): EnumSpec {
	const bus = (label: string, offset: number) =>
		[
			...range(1, 8).map((i) => [offset + i - 1, `SDI ${label}${i}`] as const),
			...range(1, 8).map((i) => [offset + 16 + i - 1, `IP ${label}${i}`] as const),
			...range(1, 4).map((i) => [offset + 24 + i - 1, `RECV ${label === 'A' ? 2 : 4}-${i}`] as const),
		] as const

	if (n >= 200) return choice('readwrite', [...bus('A', 0), ...bus('B', 100)])
	return n >= 100 ? choice('readwrite', bus('B', 0)) : choice('readwrite', bus('A', 0))
}

// VERIFY: manual's CSV lost identifiers for the `path` block; these follow the Functions-table paths.
function pathDefinitions(): DefinitionDraft[] {
	const defs: DefinitionDraft[] = []
	for (const n of PRU_AUDIO) {
		for (const lane of LANES) {
			const base = `root/path/pru-input-select/pru-input-select-${n}/pru-input-select-${n}${lane}`
			defs.push({
				id: `input_select_${pruTag(n)}_${laneTag(lane)}`,
				name: `Video Input Select ${pruNameSuffix(n, lane)}`,
				path: `${base}/select`,
				category: CATEGORY.PATH_ROUTING,
				control: inputSelectSpec(n),
				group: { key: 'input_select', name: 'Video Input Select', selectors: [pruSelector(n), laneSelector(lane)] },
			})
		}
		// input-link: 4K workflow linking, not part of the video-block VERIFY note above.
		defs.push({
			id: `input_link_${pruTag(n)}`,
			name: `Input Link (4KFS/Workflow) ${pruNameSuffix(n)}`,
			path: `root/path/pru-input-select/pru-input-select-${n}/input-link`,
			category: CATEGORY.FS_LINKING,
			group: { key: 'input_link', name: 'Input Link (4KFS/Workflow)', selectors: [pruSelector(n)] },
		})
	}
	return defs
}

// Channel count (64 per PRU) and the PRU set are the most likely values to need trimming after hardware discovery.
function audioDefinitions(): DefinitionDraft[] {
	const defs: DefinitionDraft[] = []
	const AUDIO = 'root/processor/audio'
	const groupSel = (g: number): GroupSelector => ({ dim: 'group', value: String(g), label: `Grp ${g}` })
	const chSel = (ch: number): GroupSelector => ({ dim: 'ch', value: pad(ch, 2), label: `Ch ${pad(ch, 2)}` })

	for (const n of PRU_AUDIO) {
		for (const g of range(1, 4)) {
			// Channels are numbered 01–64 continuously, 16 per group.
			for (const ch of range((g - 1) * 16 + 1, g * 16)) {
				const chp = pad(ch, 2)
				defs.push({
					id: `aud_gain_${pruTag(n)}_g${g}_ch${chp}`,
					name: `Per-Channel Gain (Embedded) PRU ${pruLabel(n)} Grp${g} Ch${chp}`,
					path: `${AUDIO}/audio-gain/audio-gain-${n}/group-${g}/ch-${chp}/gain`,
					category: CATEGORY.GAIN_DELAY,
					group: {
						key: 'aud_gain',
						name: 'Per-Channel Gain (Embedded)',
						selectors: [pruSelector(n), groupSel(g), chSel(ch)],
					},
				})
				defs.push({
					id: `aud_delay_${pruTag(n)}_g${g}_ch${chp}`,
					name: `Per-Channel Delay (Embedded) PRU ${pruLabel(n)} Grp${g} Ch${chp}`,
					path: `${AUDIO}/audio-delay/audio-delay-${n}/adjust-delay/group-${g}/ch-${chp}/delay`,
					category: CATEGORY.GAIN_DELAY,
					group: {
						key: 'aud_delay',
						name: 'Per-Channel Delay (Embedded)',
						selectors: [pruSelector(n), groupSel(g), chSel(ch)],
					},
				})
			}
			defs.push({
				id: `aud_mute_${pruTag(n)}_g${g}`,
				name: `Mute (Per Group/PRU) PRU ${pruLabel(n)} Grp${g}`,
				path: `${AUDIO}/audio-gain/audio-gain-${n}/group-${g}/master-mute`,
				category: CATEGORY.GAIN_DELAY,
				group: { key: 'aud_mute', name: 'Mute (Per Group/PRU)', selectors: [pruSelector(n), groupSel(g)] },
			})
			defs.push({
				id: `aud_test_${pruTag(n)}_g${g}`,
				name: `Embedded Audio Test Signal PRU ${pruLabel(n)} Grp${g}`,
				path: `${AUDIO}/test-signal-mute/test-signal-mute-${n}/group-${g}/mode`,
				category: CATEGORY.TEST_SIGNALS,
				group: { key: 'aud_test', name: 'Embedded Audio Test Signal', selectors: [pruSelector(n), groupSel(g)] },
			})
		}
	}

	defs.push({
		id: 'aud_reference_level',
		name: 'Reference Level (-18/-20 dBFS)',
		path: `${AUDIO}/test-signal-mute/tone-level`,
		category: CATEGORY.HARDWARE_STANDARDS,
	})
	return defs
}

// Primary load/save/delete are Ember+ Functions this module doesn't invoke; these are the
// Write-Only "alternative" parameters instead.
function eventDefinitions(): DefinitionDraft[] {
	const event = 'root/utility/event'
	// The device's identifiers for the alternative parameters and for `event-item` carry a
	// trailing space; it is part of the identifier and must be matched verbatim.
	const defs: DefinitionDraft[] = [
		{
			id: 'event_load',
			name: 'Load Event (Number)',
			path: `${event}/alt-load-event `,
			category: CATEGORY.EVENT_MEMORY,
		},
		{
			id: 'event_save',
			name: 'Save Event (Number)',
			path: `${event}/alt-save-event `,
			category: CATEGORY.EVENT_MEMORY,
		},
		{
			id: 'event_delete',
			name: 'Delete Event (Number)',
			path: `${event}/alt-delete-event `,
			category: CATEGORY.EVENT_MEMORY,
		},
		{
			id: 'startup_event_type',
			name: 'Startup Event Type',
			path: `${event}/start-up-event/type`,
			category: CATEGORY.EVENT_MEMORY,
		},
		{
			id: 'startup_event_number',
			name: 'Startup Event Number',
			path: `${event}/start-up-event/number`,
			category: CATEGORY.EVENT_MEMORY,
		},
	]

	// Per-event overwrite enable (events 001–100, bucketed in tens).
	for (const i of range(1, 100)) {
		const bucketStart = Math.floor((i - 1) / 10) * 10 + 1
		const bucket = `event${pad(bucketStart, 3)}-${pad(bucketStart + 9, 3)}`
		defs.push({
			id: `event_overwrite_${pad(i, 3)}`,
			name: 'Event Overwrite',
			path: `${event}/event-item /${bucket}/event${pad(i, 3)}/overwrite`,
			category: CATEGORY.EVENT_MEMORY,
			group: {
				key: 'event_overwrite',
				name: 'Event Overwrite',
				selectors: [{ dim: 'event', value: pad(i, 3), label: `Event ${pad(i, 3)}` }],
			},
		})
	}
	return defs
}

export function buildFa1616Definitions(): VariableDefinition[] {
	return attachControls(
		[
			...colorProcessorDefinitions(),
			...synchronizerDefinitions(),
			...freezeDefinitions(),
			...pathDefinitions(),
			...audioDefinitions(),
			...eventDefinitions(),
		],
		FA1616_CONTROLS,
	)
}
