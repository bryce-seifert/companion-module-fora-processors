import { FA9600_CONTROLS } from './fa9600-controls.js'
import {
	attachControls,
	CATEGORY,
	cap,
	pad,
	range,
	type ControlGroup,
	type DefinitionDraft,
	type GroupSelector,
	type VariableDefinition,
} from './shared.js'

// FA-9600 definition table. Paths mirror the v3.90+ tree; the device exposes two Ember+
// roots — `processor` (identity) and `root` (data).

function fsDefinitions(n: 1 | 2): DefinitionDraft[] {
	const fs = `fs${n}`
	const label = `FS${n}`
	const base = `root/video/fs-${n}`
	const sync = `${base}/synchronizer`
	const cp = `${base}/color-processor`
	const lut1d = `${cp}/gamma-color/lut-1d-color`
	const defs: DefinitionDraft[] = []
	// Every FS parameter collapses into a single action with a Frame Sync selector; the
	// group key/name are the id/name with their `fs1_`/`FS1 ` prefix stripped.
	const add = (id: string, name: string, path: string, category: string) =>
		defs.push({
			id,
			name,
			path,
			category,
			group: {
				key: id.replace(/^fs[12]_/, ''),
				name: name.replace(/^FS[12] /, ''),
				selectors: [{ dim: 'fs', value: fs, label }],
			},
		})

	add(`${fs}_sync_mode`, `${label} Sync Mode`, `${sync}/timing/mode`, CATEGORY.SYNCHRONIZATION)
	add(`${fs}_timing_h`, `${label} Horizontal Phase`, `${sync}/timing/timing-h`, CATEGORY.SYNCHRONIZATION)
	add(`${fs}_timing_v`, `${label} Vertical Phase`, `${sync}/timing/timing-v`, CATEGORY.SYNCHRONIZATION)
	add(`${fs}_sync_delay`, `${label} Signal Latency`, `${sync}/timing/sync-delay`, CATEGORY.SIGNAL_STATUS)
	add(
		`${fs}_format_setting`,
		`${label} Sync Setting Mode (Auto/Manual)`,
		`${sync}/format/format-setting`,
		CATEGORY.SYNCHRONIZATION,
	)
	add(`${fs}_standard`, `${label} Standard`, `${sync}/format/standard`, CATEGORY.SYNCHRONIZATION)
	add(`${fs}_rate`, `${label} Rate`, `${sync}/format/rate`, CATEGORY.SYNCHRONIZATION)
	add(`${fs}_level`, `${label} 3G SDI Output Level`, `${sync}/format/level`, CATEGORY.UTILITIES)
	add(`${fs}_division`, `${label} SQD / 2SI Division`, `${sync}/format/division`, CATEGORY.WORKFLOW_4K)
	add(`${fs}_out_format`, `${label} Output Format Status`, `${sync}/format/out-format`, CATEGORY.SYNCHRONIZATION)
	add(`${fs}_source_select`, `${label} Video Input Select`, `${sync}/source-select`, CATEGORY.PATH_ROUTING)
	add(`${fs}_loss_mode`, `${label} Video Input Loss Mode`, `${sync}/loss-mode`, CATEGORY.UTILITIES)
	add(`${fs}_back_color`, `${label} Back Color`, `${sync}/back-color`, CATEGORY.UTILITIES)
	add(`${fs}_freeze`, `${label} Video Freeze On/Off`, `${sync}/video-freeze/freeze`, CATEGORY.UTILITIES)
	add(`${fs}_freeze_mode`, `${label} Video Freeze Mode`, `${sync}/video-freeze/mode`, CATEGORY.UTILITIES)
	add(`${fs}_uhd_input_link`, `${label} Input Link (4KFS/Workflow)`, `${sync}/uhd/input-link`, CATEGORY.FS_LINKING)

	// Specific names to ensure actions read as complete labels, not abbreviations.
	const LEVEL_NAME: Record<string, string> = {
		video: 'Video Level',
		y: 'Y Level',
		chroma: 'Chroma Level',
		black: 'Setup/Black Level',
		hue: 'Hue',
	}
	for (const p of ['video', 'y', 'chroma', 'black', 'hue']) {
		add(`${fs}_ppamp_${p}`, `${label} ${LEVEL_NAME[p]}`, `${cp}/preprocess-amp/${p}`, CATEGORY.SIGNAL_PROCESSING)
	}

	// Red/Green/Blue collapse into one action per balance group via a Color selector.
	for (const group of ['white', 'black', 'gamma']) {
		for (const color of ['red', 'green', 'blue']) {
			defs.push({
				id: `${fs}_ppbal_${group}_${color}`,
				name: `${label} CC ${cap(group)} Level ${cap(color)}`,
				path: `${cp}/postprocess-balance/${group}/${color}`,
				category: CATEGORY.SIGNAL_PROCESSING,
				group: {
					key: `ppbal_${group}`,
					name: `CC ${cap(group)} Level (R/G/B)`,
					selectors: [
						{ dim: 'fs', value: fs, label },
						{ dim: 'color', value: color, label: cap(color) },
					],
				},
			})
		}
	}
	add(
		`${fs}_ppbal_gamma_curve`,
		`${label} Gamma Curve`,
		`${cp}/postprocess-balance/gamma/curve`,
		CATEGORY.SIGNAL_PROCESSING,
	)

	add(`${fs}_knee_white_mode`, `${label} Clip Mode`, `${cp}/knee/white-knee/mode`, CATEGORY.SIGNAL_PROCESSING)
	add(
		`${fs}_knee_white_out_clip`,
		`${label} RGB White Clip`,
		`${cp}/knee/white-knee/out-clip`,
		CATEGORY.SIGNAL_PROCESSING,
	)
	add(`${fs}_knee_black_out_clip`, `${label} RGB Black Clip`, `${cp}/knee/black/out-clip`, CATEGORY.SIGNAL_PROCESSING)

	for (const p of ['white', 'black', 'chroma']) {
		add(`${fs}_ycbcr_${p}`, `${label} YCbCr ${cap(p)}`, `${cp}/ycbcr/${p}`, CATEGORY.SIGNAL_PROCESSING)
	}

	// R-Y/G-Y/B-Y collapse into one action per differential group via a Component selector.
	for (const group of ['white', 'black']) {
		for (const comp of ['r-y', 'g-y', 'b-y']) {
			defs.push({
				id: `${fs}_diff_${group}_${comp.replace('-', '')}`,
				name: `${label} CC Differential ${cap(group)} Level ${comp.toUpperCase()}`,
				path: `${cp}/differential/${group}/${comp}`,
				category: CATEGORY.SIGNAL_PROCESSING,
				group: {
					key: `diff_${group}`,
					name: `CC Differential ${cap(group)} Level (R-Y/G-Y/B-Y)`,
					selectors: [
						{ dim: 'fs', value: fs, label },
						{ dim: 'comp', value: comp, label: comp.toUpperCase() },
					],
				},
			})
		}
	}

	add(`${fs}_dr_gain`, `${label} Dynamic Range Gain`, `${cp}/gain/dr-gain`, CATEGORY.SIGNAL_PROCESSING)
	add(`${fs}_sdr_gain`, `${label} SDR Gain`, `${cp}/gain/sdr-gain`, CATEGORY.SIGNAL_PROCESSING)
	add(`${fs}_total_gain`, `${label} Total Gain`, `${cp}/gain/total-gain`, CATEGORY.SIGNAL_PROCESSING)

	add(`${fs}_test`, `${label} Video Test Signal`, `${cp}/other/test`, CATEGORY.UTILITIES)
	add(
		`${fs}_gamma_color_function`,
		`${label} Color Correction Bypass`,
		`${cp}/gamma-color/function`,
		CATEGORY.UTILITIES,
	)
	add(`${fs}_lut_in_color`, `${label} Input Color Space`, `${lut1d}/in-color`, CATEGORY.HDR_COLOR_SPACE)
	add(`${fs}_lut_out_color`, `${label} Output Color Space`, `${lut1d}/out-color`, CATEGORY.HDR_COLOR_SPACE)
	add(`${fs}_lut_in_gamma`, `${label} Input Gamma (EOTF)`, `${lut1d}/in-gamma`, CATEGORY.HDR_COLOR_SPACE)
	add(`${fs}_lut_out_gamma`, `${label} Output Gamma (OETF)`, `${lut1d}/out-gamma`, CATEGORY.HDR_COLOR_SPACE)

	// Color processor — LUT label name tables.
	for (const i of range(1, 10)) {
		add(
			`${fs}_gamma_label_${pad(i, 2)}`,
			`${label} Gamma Label ${pad(i, 2)}`,
			`${lut1d}/gamma-label/label-${pad(i, 2)}/name`,
			CATEGORY.METADATA_LABELING,
		)
	}
	for (const i of range(1, 7)) {
		add(
			`${fs}_color_label_${pad(i, 2)}`,
			`${label} Color Label ${pad(i, 2)}`,
			`${lut1d}/color-label/label-${pad(i, 2)}/name`,
			CATEGORY.METADATA_LABELING,
		)
	}
	return defs
}

function statusDefinitions(): DefinitionDraft[] {
	const status = 'root/video/common/status'
	return [
		{
			id: 'ref_format',
			name: 'Reference Format',
			path: `${status}/in-reference/format`,
			category: CATEGORY.SIGNAL_STATUS,
		},
		{
			id: 'in1_format',
			name: 'Input 1 Format',
			path: `${status}/in-video/standard/in-1/format`,
			category: CATEGORY.SIGNAL_STATUS,
		},
		{
			id: 'in2_format',
			name: 'Input 2 Format',
			path: `${status}/in-video/standard/in-2/format`,
			category: CATEGORY.SIGNAL_STATUS,
		},
	]
}

const embSelector = (e: number): GroupSelector => ({ dim: 'emb', value: String(e), label: `Emb ${e}` })
const chSelector = (ch: number): GroupSelector => ({ dim: 'ch', value: pad(ch, 2), label: `Ch ${pad(ch, 2)}` })

function audioDefinitions(): DefinitionDraft[] {
	const defs: DefinitionDraft[] = []
	const add = (id: string, name: string, path: string, category: string, group?: ControlGroup) =>
		defs.push({ id, name, path, category, group })

	for (const e of [1, 2]) {
		for (const ch of range(1, 16)) {
			add(
				`out_emb${e}_ch${pad(ch, 2)}_gain`,
				`Output Channel Gain Emb${e} Ch${pad(ch, 2)}`,
				`root/audio/out-audio/embedded-${e}/channels/ch-${pad(ch, 2)}/gain`,
				CATEGORY.GAIN_DELAY,
				{ key: 'out_gain', name: 'Output Channel Gain', selectors: [embSelector(e), chSelector(ch)] },
			)
		}
		add(
			`out_emb${e}_master_mute`,
			`Output Group Mute Emb${e}`,
			`root/audio/out-audio/embedded-${e}/master-mute`,
			CATEGORY.GAIN_DELAY,
			{ key: 'out_master_mute', name: 'Output Group Mute', selectors: [embSelector(e)] },
		)
	}

	for (const ch of range(1, 32)) {
		add(
			`in_delay_ch${pad(ch, 2)}`,
			`Input Channel Delay Ch${pad(ch, 2)}`,
			`root/audio/in-delay/ch-${pad(ch, 2)}/delay`,
			CATEGORY.GAIN_DELAY,
			{ key: 'in_delay', name: 'Input Channel Delay', selectors: [chSelector(ch)] },
		)
	}

	add(
		'audio_reference_level',
		'Audio Reference Level (-18/-20 dBFS)',
		'root/audio/system/reference-level',
		CATEGORY.HARDWARE_STANDARDS,
	)
	for (const e of [1, 2]) {
		add(
			`test_tone_emb${e}`,
			`Embedded Audio Test Signal Emb${e}`,
			`root/audio/system/test-tone/tone-embedded-${e}`,
			CATEGORY.TEST_SIGNALS,
			{ key: 'test_tone', name: 'Embedded Audio Test Signal', selectors: [embSelector(e)] },
		)
	}

	return defs
}

function eventDefinitions(): DefinitionDraft[] {
	return range(0, 100).map((i) => ({
		id: `event_${pad(i, 3)}`,
		name: `Event ${pad(i, 3)} - Name`,
		path: `root/other/event/event-name/event-${pad(i, 3)}/name`,
		category: CATEGORY.METADATA_LABELING,
	}))
}

// Primary load/save are Ember+ Functions this module doesn't invoke; alt-event-load/save are
// the Write-Only "alternative" parameters the device provides for that case.
function eventControlDefinitions(): DefinitionDraft[] {
	const event = 'root/other/event'
	return [
		{ id: 'event_load', name: 'Load Event (Number)', path: `${event}/alt-event-load`, category: CATEGORY.EVENT_MEMORY },
		{ id: 'event_save', name: 'Save Event (Number)', path: `${event}/alt-event-save`, category: CATEGORY.EVENT_MEMORY },
		{ id: 'startup_event', name: 'Startup Event', path: `${event}/startup-event`, category: CATEGORY.EVENT_MEMORY },
	]
}

export function buildFa9600Definitions(): VariableDefinition[] {
	return attachControls(
		[
			...fsDefinitions(1),
			...fsDefinitions(2),
			...statusDefinitions(),
			...audioDefinitions(),
			...eventDefinitions(),
			...eventControlDefinitions(),
		],
		FA9600_CONTROLS,
	)
}
