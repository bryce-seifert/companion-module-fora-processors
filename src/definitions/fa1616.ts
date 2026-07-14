import { CATEGORY, cap, pad, range, type ControlGroup, type GroupSelector, type VariableDefinition } from './shared.js'

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
	defs: VariableDefinition[],
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
				id: `cp_${n}${lane}_${key}${variant ? `_${variant.value.replace(/-/g, '')}` : ''}`,
				name: `CP ${name}${variant ? ` ${variant.label}` : ''}`,
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

// Names below follow the Functions.csv "Item" column so actions read as complete labels
// rather than internal node abbreviations (Pre-Amp, Bal, Diff, RGB Clip, CC Bypass…).
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

function colorProcessorDefinitions(): VariableDefinition[] {
	const defs: VariableDefinition[] = []

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

	for (const group of ['white', 'black']) {
		addColorProc(
			defs,
			PRU_VIDEO,
			`rgbclip_${group}_mode`,
			`${cap(group)} Clip Mode`,
			`rgb-clip/${group}/clip-mode`,
			CATEGORY.SIGNAL_PROCESSING,
		)
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
				`diff_${group}_${comp.replace('-', '')}`,
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

function synchronizerDefinitions(): VariableDefinition[] {
	const defs: VariableDefinition[] = []
	const addPru = (key: string, name: string, leaf: string, category: string) => {
		for (const n of PRU_VIDEO) {
			defs.push({
				id: `sync_${n}_${key}`,
				name: `Sync ${name}`,
				path: `root/processor/video/synchronizer/synchronizer-${n}/${leaf}`,
				category,
				group: { key: `sync_${key}`, name, selectors: [pruSelector(n)] },
			})
		}
	}

	const fmt = 'synchronizer-format/format'
	addPru('mode', 'Sync Mode', `${fmt}/sync-mode`, CATEGORY.SYNCHRONIZATION)
	addPru('standard', 'Standard', `${fmt}/standard`, CATEGORY.SYNCHRONIZATION)
	addPru('rate', 'Rate', `${fmt}/rate`, CATEGORY.SYNCHRONIZATION)
	addPru('level', '3G SDI Output Level', `${fmt}/level`, CATEGORY.UTILITIES)
	addPru('division', 'SQD / 2SI Division', `${fmt}/division`, CATEGORY.WORKFLOW_4K)
	addPru('format_status', 'Output Format Status', `${fmt}/format-status`, CATEGORY.SYNCHRONIZATION)
	addPru('is_manual', 'Sync Setting Mode (Auto/Manual)', `${fmt}/is-manual`, CATEGORY.SYNCHRONIZATION)
	addPru('loss_mode', 'Video Input Loss Mode', `${fmt}/loss-mode`, CATEGORY.UTILITIES)
	addPru('back_color', 'Back Color', `${fmt}/back-color`, CATEGORY.UTILITIES)
	addPru('h_timing', 'Horizontal Phase', 'adjust-timing/h-timing', CATEGORY.SYNCHRONIZATION)
	addPru('v_timing', 'Vertical Phase', 'adjust-timing/v-timing', CATEGORY.SYNCHRONIZATION)
	addPru('genlock_status', 'Genlock Status', 'reference-select/genlock-status', CATEGORY.SYNCHRONIZATION)
	addPru('genlock_in_signal', 'Genlock In Signal', 'reference-select/genlock-in-signal', CATEGORY.SYNCHRONIZATION)
	addPru('ptp_signal', 'PTP/Input Lock Signal', 'reference-select/ptp-signal', CATEGORY.SYNCHRONIZATION)

	// Per-lane delay status lives under the synchronizer node, not per-lane.
	for (const n of PRU_VIDEO) {
		for (const lane of LANES) {
			const base = `root/processor/video/synchronizer/synchronizer-${n}/delay-status/lane-${lane}`
			for (const [leaf, key, name] of [
				['sdi-delay', 'sdi_delay', 'SDI Latency'],
				['ip-delay', 'ip_delay', 'IP Latency'],
				['total-delay', 'total_delay', 'Signal Latency'],
			] as const) {
				defs.push({
					id: `sync_${n}${lane}_${key}`,
					name: `Sync ${name}`,
					path: `${base}/${leaf}`,
					category: CATEGORY.SIGNAL_STATUS,
					group: { key: `sync_${key}`, name, selectors: [pruSelector(n), laneSelector(lane)] },
				})
			}
		}
	}

	return defs
}

// VERIFY: Functions table roots this at `root/test-signal-freeze`; manual groups it under the video block (used here).
function freezeDefinitions(): VariableDefinition[] {
	const defs: VariableDefinition[] = []
	for (const n of PRU_VIDEO) {
		for (const lane of LANES) {
			const base = `root/processor/video/test-signal-freeze/test-signal-freeze-${n}/test-signal-freeze-${n}${lane}`
			for (const [leaf, key, name] of [
				['freeze-enable', 'freeze', 'Video Freeze On/Off'],
				['freeze-mode', 'freeze_mode', 'Video Freeze Mode'],
				['test', 'test', 'Video Test Signal'],
			] as const) {
				defs.push({
					id: `freeze_${n}${lane}_${key}`,
					name,
					path: `${base}/${leaf}`,
					category: CATEGORY.UTILITIES,
					group: { key: `freeze_${key}`, name, selectors: [pruSelector(n), laneSelector(lane)] },
				})
			}
		}
	}
	return defs
}

// VERIFY: manual's CSV lost identifiers for the `path` block; these follow the Functions-table paths.
function pathDefinitions(): VariableDefinition[] {
	const defs: VariableDefinition[] = []
	for (const n of PRU_AUDIO) {
		for (const lane of LANES) {
			const base = `root/path/pru-input-select/pru-input-select-${n}/pru-input-select-${n}${lane}`
			defs.push({
				id: `input_select_${n}${lane}`,
				name: 'Video Input Select',
				path: `${base}/select`,
				category: CATEGORY.PATH_ROUTING,
				group: { key: 'input_select', name: 'Video Input Select', selectors: [pruSelector(n), laneSelector(lane)] },
			})
		}
		// input-link: 4K workflow linking, not part of the video-block VERIFY note above.
		defs.push({
			id: `input_link_${n}`,
			name: 'Input Link (4KFS/Workflow)',
			path: `root/path/pru-input-select/pru-input-select-${n}/input-link`,
			category: CATEGORY.FS_LINKING,
			group: { key: 'input_link', name: 'Input Link (4KFS/Workflow)', selectors: [pruSelector(n)] },
		})
	}
	return defs
}

// VERIFY: manual lost identifiers for the `audio` block; these follow the Functions-table paths.
// Channel count (64 per PRU) and the PRU set are the most likely values to need trimming after hardware discovery.
function audioDefinitions(): VariableDefinition[] {
	const defs: VariableDefinition[] = []
	const groupSel = (g: number): GroupSelector => ({ dim: 'group', value: String(g), label: `Grp ${g}` })
	const chSel = (ch: number): GroupSelector => ({ dim: 'ch', value: pad(ch, 2), label: `Ch ${pad(ch, 2)}` })

	for (const n of PRU_AUDIO) {
		for (const g of range(1, 4)) {
			// Channels are numbered 01–64 continuously, 16 per group.
			for (const ch of range((g - 1) * 16 + 1, g * 16)) {
				const chp = pad(ch, 2)
				defs.push({
					id: `aud_gain_${n}_g${g}_ch${chp}`,
					name: 'Per-Channel Gain (Embedded)',
					path: `root/audio/audio-gain/audio-gain-${n}/group-${g}/ch-${chp}/gain`,
					category: CATEGORY.GAIN_DELAY,
					group: {
						key: 'aud_gain',
						name: 'Per-Channel Gain (Embedded)',
						selectors: [pruSelector(n), groupSel(g), chSel(ch)],
					},
				})
				defs.push({
					id: `aud_delay_${n}_g${g}_ch${chp}`,
					name: 'Per-Channel Delay (Embedded)',
					path: `root/audio/audio-delay/audio-delay-${n}/adjust-delay/group-${g}/ch-${chp}/delay`,
					category: CATEGORY.GAIN_DELAY,
					group: {
						key: 'aud_delay',
						name: 'Per-Channel Delay (Embedded)',
						selectors: [pruSelector(n), groupSel(g), chSel(ch)],
					},
				})
			}
			defs.push({
				id: `aud_mute_${n}_g${g}`,
				name: 'Mute (Per Group/PRU)',
				path: `root/audio/audio-gain/audio-gain-${n}/group-${g}/master-mute`,
				category: CATEGORY.GAIN_DELAY,
				group: { key: 'aud_mute', name: 'Mute (Per Group/PRU)', selectors: [pruSelector(n), groupSel(g)] },
			})
			defs.push({
				id: `aud_test_${n}_g${g}`,
				name: 'Embedded Audio Test Signal',
				path: `root/audio/test-signal-mute/test-signal-mute-${n}/group-${g}/mode`,
				category: CATEGORY.TEST_SIGNALS,
				group: { key: 'aud_test', name: 'Embedded Audio Test Signal', selectors: [pruSelector(n), groupSel(g)] },
			})
		}
	}

	defs.push({
		id: 'aud_reference_level',
		name: 'Reference Level (-18/-20 dBFS)',
		path: 'root/audio/test-signal-mute/tone-level',
		category: CATEGORY.HARDWARE_STANDARDS,
	})
	return defs
}

// Primary load/save/delete are Ember+ Functions this module doesn't invoke; these are the
// Write-Only "alternative" parameters instead.
function eventDefinitions(): VariableDefinition[] {
	const event = 'root/utility/event'
	const defs: VariableDefinition[] = [
		{ id: 'event_load', name: 'Load Event (Number)', path: `${event}/alt-load-event`, category: CATEGORY.EVENT_MEMORY },
		{ id: 'event_save', name: 'Save Event (Number)', path: `${event}/alt-save-event`, category: CATEGORY.EVENT_MEMORY },
		{
			id: 'event_delete',
			name: 'Delete Event (Number)',
			path: `${event}/alt-delete-event`,
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
			path: `${event}/event-item/${bucket}/event${pad(i, 3)}/overwrite`,
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

// FA-1616-only: user + preset labels.
function labelDefinitions(): VariableDefinition[] {
	const defs: VariableDefinition[] = []
	const common = 'root/processor/video/color-processor/common'
	const add = (id: string, name: string, path: string, group?: ControlGroup) =>
		defs.push({ id, name, path, category: CATEGORY.METADATA_LABELING, group })

	// User labels 01–50, bucketed in twenties (user-label-01-20 / 21-40 / 41-50).
	for (const i of range(1, 50)) {
		const bucketStart = Math.floor((i - 1) / 20) * 20 + 1
		const bucketEnd = Math.min(bucketStart + 19, 50)
		const bucket = `user-label-${pad(bucketStart, 2)}-${pad(bucketEnd, 2)}`
		add(`user_label_${pad(i, 2)}`, `User Label ${pad(i, 2)}`, `${common}/${bucket}/u-${pad(i, 2)}/name`, {
			key: 'user_label',
			name: 'User Label',
			selectors: [{ dim: 'label', value: pad(i, 2), label: `Label ${pad(i, 2)}` }],
		})
	}
	for (const i of range(1, 20)) {
		add(`preset_label_${pad(i, 2)}`, `Preset Label ${pad(i, 2)}`, `${common}/preset-label-01-20/p-${pad(i, 2)}/name`, {
			key: 'preset_label',
			name: 'Preset Label',
			selectors: [{ dim: 'label', value: pad(i, 2), label: `Label ${pad(i, 2)}` }],
		})
	}
	return defs
}

export function buildFa1616Definitions(): VariableDefinition[] {
	return [
		...colorProcessorDefinitions(),
		...synchronizerDefinitions(),
		...freezeDefinitions(),
		...pathDefinitions(),
		...audioDefinitions(),
		...eventDefinitions(),
		...labelDefinitions(),
	]
}
