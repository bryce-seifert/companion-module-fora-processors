import { combineRgb, type CompanionPresetDefinitions } from '@companion-module/base'
import { ID_PREFIX, defaultOptions, resolveId, toLogical, type LogicalControl } from './logical-controls.js'
import type { ModuleInstance } from './main.js'

const BUTTON_TEXT = combineRgb(255, 255, 255)
const BUTTON_BG = combineRgb(0, 0, 0)
const STATUS_BG = combineRgb(40, 40, 40)
const ACTIVE_BG = combineRgb(0, 170, 0)

// Preset feedbacks turn the background green when active; nothing else about the style changes.
const activeStyle = { bgcolor: ACTIVE_BG }

function addDivider(presets: CompanionPresetDefinitions, logical: LogicalControl): void {
	presets[`${logical.id}_label`] = {
		type: 'text',
		category: logical.category ?? '',
		name: logical.name,
		text: '',
	}
}

function addBoolean(
	presets: CompanionPresetDefinitions,
	logical: LogicalControl,
	feedbackId: string,
	actionId: string | undefined,
): void {
	const options = defaultOptions(logical)
	presets[logical.id] = {
		type: 'button',
		category: logical.category ?? '',
		name: logical.name,
		style: {
			text: logical.name,
			size: 'auto',
			color: BUTTON_TEXT,
			bgcolor: actionId ? BUTTON_BG : STATUS_BG,
			show_topbar: false,
		},
		steps: actionId ? [{ down: [{ actionId, options: { ...options, mode: 'toggle' } }], up: [] }] : [],
		feedbacks: [{ feedbackId, options, style: activeStyle }],
	}
}

function addEnum(
	presets: CompanionPresetDefinitions,
	logical: LogicalControl,
	feedbackId: string,
	actionId: string | undefined,
): void {
	const selectorDefaults = defaultOptions(logical)
	for (const choice of logical.choices ?? []) {
		const options = { ...selectorDefaults, value: choice.id }
		presets[`${logical.id}_${choice.id}`] = {
			type: 'button',
			category: logical.category ?? '',
			name: `${logical.name}: ${choice.label}`,
			style: {
				text: choice.label,
				size: 'auto',
				color: BUTTON_TEXT,
				bgcolor: actionId ? BUTTON_BG : STATUS_BG,
				show_topbar: false,
			},
			steps: actionId ? [{ down: [{ actionId, options }], up: [] }] : [],
			feedbacks: [{ feedbackId, options, style: activeStyle }],
		}
	}
}

// Writable numbers get +1/-1 nudge buttons flanking a status button showing the live value.
function addNumber(
	self: ModuleInstance,
	presets: CompanionPresetDefinitions,
	logical: LogicalControl,
	actionId: string | undefined,
): void {
	const category = logical.category ?? ''
	const options = defaultOptions(logical)
	const valueRef = `$(${self.label}:${resolveId(logical, options)})`

	if (actionId) {
		presets[`${logical.id}_inc`] = {
			type: 'button',
			category,
			name: `${logical.name} +1`,
			style: { text: '+1', size: '24', color: BUTTON_TEXT, bgcolor: BUTTON_BG, show_topbar: false },
			steps: [{ down: [{ actionId, options: { ...options, mode: 'increase', value: 1 } }], up: [] }],
			feedbacks: [],
		}
	}

	presets[`${logical.id}_status`] = {
		type: 'button',
		category,
		name: `${logical.name} Status`,
		style: {
			text: `${logical.name}\n${valueRef}`,
			size: 'auto',
			color: BUTTON_TEXT,
			bgcolor: STATUS_BG,
			show_topbar: false,
		},
		steps: [],
		feedbacks: [],
	}

	if (actionId) {
		presets[`${logical.id}_dec`] = {
			type: 'button',
			category,
			name: `${logical.name} -1`,
			style: { text: '-1', size: '24', color: BUTTON_TEXT, bgcolor: BUTTON_BG, show_topbar: false },
			steps: [{ down: [{ actionId, options: { ...options, mode: 'decrease', value: 1 } }], up: [] }],
			feedbacks: [],
		}
	}
}

// The action id `logical` (built with a feedback-side prefix) would have, if it's writable.
function toActionId(feedbackPrefix: string, actionPrefix: string, feedbackLogicalId: string): string {
	return actionPrefix + feedbackLogicalId.slice(feedbackPrefix.length)
}

// Writable controls get an interactive preset (action + feedback); read-only ones get a status-only preset.
export function UpdatePresets(self: ModuleInstance): void {
	const controls = self.api.describeControls()
	const all = self.api.describeAllProperties()
	self.log(
		'debug',
		`[presets] counts — controls: num=${controls.numbers.length} bool=${controls.booleans.length} enum=${controls.enums.length}; ` +
			`all: num=${all.numbers.length} bool=${all.booleans.length} enum=${all.enums.length} str=${all.strings.length}`,
	)
	const presets: CompanionPresetDefinitions = {}

	const interactiveNumberIds = new Set(
		toLogical(controls.numbers, ID_PREFIX.number.action).map((logical) => logical.id),
	)
	const interactiveBooleanIds = new Set(
		toLogical(controls.booleans, ID_PREFIX.boolean.action).map((logical) => logical.id),
	)
	const interactiveEnumIds = new Set(toLogical(controls.enums, ID_PREFIX.enum.action).map((logical) => logical.id))

	for (const logical of toLogical(all.booleans, ID_PREFIX.boolean.feedback)) {
		const actionId = toActionId(ID_PREFIX.boolean.feedback, ID_PREFIX.boolean.action, logical.id)
		addDivider(presets, logical)
		addBoolean(presets, logical, logical.id, interactiveBooleanIds.has(actionId) ? actionId : undefined)
	}

	for (const logical of toLogical(all.enums, ID_PREFIX.enum.feedback)) {
		const actionId = toActionId(ID_PREFIX.enum.feedback, ID_PREFIX.enum.action, logical.id)
		addDivider(presets, logical)
		addEnum(presets, logical, logical.id, interactiveEnumIds.has(actionId) ? actionId : undefined)
	}

	for (const logical of toLogical(all.numbers, ID_PREFIX.number.feedback)) {
		const actionId = toActionId(ID_PREFIX.number.feedback, ID_PREFIX.number.action, logical.id)
		addDivider(presets, logical)
		addNumber(self, presets, logical, interactiveNumberIds.has(actionId) ? actionId : undefined)
	}

	self.log(
		'debug',
		`[presets] built ${Object.keys(presets).length} presets; sample: ${JSON.stringify(Object.values(presets)[0])}`,
	)
	self.setPresetDefinitions(presets)
}
