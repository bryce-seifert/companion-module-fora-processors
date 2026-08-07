import { combineRgb, type CompanionOptionValues, type CompanionPresetDefinitions } from '@companion-module/base'
import { isReadable, isWritable } from './definitions/controls.js'
import { CATEGORY } from './definitions/shared.js'
import {
	actionId,
	defaultOptions,
	feedbackId,
	resolveId,
	type LogicalControl,
	type Selector,
} from './logical-controls.js'
import type { ModuleInstance } from './main.js'

const BUTTON_TEXT = combineRgb(255, 255, 255)
const BUTTON_BG = combineRgb(0, 0, 0)
const STATUS_BG = combineRgb(40, 40, 40)

// Preset feedbacks turn the background green when active; nothing else about the style changes.
const activeStyle = { bgcolor: combineRgb(0, 170, 0) }

const buttonStyle = (text: string, interactive: boolean) => ({
	text,
	size: '14' as const,
	color: BUTTON_TEXT,
	bgcolor: interactive ? BUTTON_BG : STATUS_BG,
	show_topbar: false as const,
})

// A text-only preset that titles the group of buttons following it in the category.
function addDivider(presets: CompanionPresetDefinitions, key: string, category: string, name: string): void {
	presets[`${key}_label`] = {
		type: 'text',
		category,
		name,
		text: '',
	}
}

function addBoolean(presets: CompanionPresetDefinitions, logical: LogicalControl, interactive: boolean): void {
	const options = defaultOptions(logical)
	presets[logical.key] = {
		type: 'button',
		category: logical.category ?? '',
		name: logical.name,
		style: buttonStyle(logical.name, interactive),
		steps: interactive
			? [{ down: [{ actionId: actionId(logical), options: { ...options, mode: 'toggle' } }], up: [] }]
			: [],
		// Write-only controls never report a value back, so there's no feedback to light this with.
		feedbacks: isReadable(logical.spec) ? [{ feedbackId: feedbackId(logical), options, style: activeStyle }] : [],
	}
}

// Event Memory enums (event_load, event_save, startup_event, …) run to 100+ choices; a preset
// per choice would swamp the category, so only the first 10 get buttons.
const EVENT_PRESET_LIMIT = 10

// "Event 001" alone doesn't say what pressing the button does — prefix it with the action, keyed
// by logical control key (these are all ungrouped, so key === definition id).
const EVENT_ACTION_LABEL: Record<string, string> = {
	event_load: 'LOAD',
	event_save: 'SAVE',
	event_delete: 'DELETE',
	startup_event: 'STARTUP',
	startup_event_number: 'STARTUP',
	startup_event_type: 'STARTUP',
}

// Selector dims whose choice label alone doesn't say which dimension it's from ("A1", "A") get a
// spelled-out prefix in Path & Routing context text ("PRU A1", "Lane A"); dims like `fs` whose
// choice labels are already self-describing ("FS1") are left bare.
const SELECTOR_CONTEXT_PREFIX: Record<string, string> = { pru: 'PRU', lane: 'Lane' }

const selectorContext = (combo: readonly { dim: string; label: string }[]): string =>
	combo
		.map((c) => (SELECTOR_CONTEXT_PREFIX[c.dim] ? `${SELECTOR_CONTEXT_PREFIX[c.dim]} ${c.label}` : c.label))
		.join(' - ')

// Selector dims that become a bare sub-header divider ("Lane A") within the Path & Routing
// category, instead of folding into the category name itself.
const PATH_ROUTING_HEADER_DIMS = new Set(['lane'])

// One button per enum choice, lit by the feedback when that choice is the live value. Path &
// Routing enums (FS/PRU input-select) are grouped by an instance selector that would otherwise
// silently default to a single fixed instance (e.g. always FS1); those get expanded so every
// instance gets its own preset set. Dims in PATH_ROUTING_HEADER_DIMS (Lane) split into a header
// divider inside the category rather than a category of their own (e.g. "Path & Routing - PRU A1"
// with "Lane A"/"Lane B"/... headers, instead of one category per PRU x Lane).
function addEnum(presets: CompanionPresetDefinitions, logical: LogicalControl, interactive: boolean): void {
	if (logical.spec.kind !== 'enum') return
	const choices =
		logical.category === CATEGORY.EVENT_MEMORY
			? logical.spec.choices.slice(0, EVENT_PRESET_LIMIT)
			: logical.spec.choices
	// Write-only controls (event load/save/delete, ...) never report a value back, so there's no
	// feedback to light these buttons with.
	const showsFeedback = isReadable(logical.spec)

	if (logical.category === CATEGORY.PATH_ROUTING && logical.selectors.length > 0) {
		const categorySelectors = logical.selectors.filter((s) => !PATH_ROUTING_HEADER_DIMS.has(s.dim))
		const headerSelectors = logical.selectors.filter((s) => PATH_ROUTING_HEADER_DIMS.has(s.dim))

		for (const categoryCombo of expandChoices(categorySelectors)) {
			const categoryContext = selectorContext(categoryCombo)
			const category = `${logical.category} - ${categoryContext}`
			const categoryOptions = Object.fromEntries(categoryCombo.map((c) => [c.dim, c.id]))

			for (const headerCombo of expandChoices(headerSelectors)) {
				const headerContext = selectorContext(headerCombo)
				const combo = [...categoryCombo, ...headerCombo]
				const comboKey = `${logical.key}_${combo.map((c) => c.id).join('_')}`
				const comboOptions = { ...categoryOptions, ...Object.fromEntries(headerCombo.map((c) => [c.dim, c.id])) }
				const buttonContext = headerContext || categoryContext
				addDivider(presets, comboKey, category, headerContext || `${logical.name} ${categoryContext}`)
				for (const choice of choices) {
					const options = { ...comboOptions, value: choice.id }
					presets[`${comboKey}_${choice.id}`] = {
						type: 'button',
						category,
						name: `${logical.name} ${categoryContext}${headerContext ? ` ${headerContext}` : ''}: ${choice.label}`,
						style: buttonStyle(`${buttonContext}\n${choice.label}`, interactive),
						steps: interactive ? [{ down: [{ actionId: actionId(logical), options }], up: [] }] : [],
						feedbacks: showsFeedback ? [{ feedbackId: feedbackId(logical), options, style: activeStyle }] : [],
					}
				}
			}
		}
		return
	}

	addDivider(presets, logical.key, logical.category ?? '', logical.name)
	const selectorDefaults = defaultOptions(logical)
	const actionLabel = EVENT_ACTION_LABEL[logical.key]
	for (const choice of choices) {
		const options = { ...selectorDefaults, value: choice.id }
		// Skip the prefix when the choice already says it ("Delete All" under DELETE).
		const prefix = actionLabel && !choice.label.toUpperCase().startsWith(actionLabel) ? actionLabel : undefined
		presets[`${logical.key}_${choice.id}`] = {
			type: 'button',
			category: logical.category ?? '',
			name: prefix ? `${prefix} ${choice.label}` : `${logical.name}: ${choice.label}`,
			style: buttonStyle(prefix ? `${prefix}\n${choice.label}` : choice.label, interactive),
			steps: interactive ? [{ down: [{ actionId: actionId(logical), options }], up: [] }] : [],
			feedbacks: showsFeedback ? [{ feedbackId: feedbackId(logical), options, style: activeStyle }] : [],
		}
	}
}

// Selector dimensions that are sibling *values* of the same parameter (Color, Component) rather
// than device instances (PRU, Lane, Channel, ...). These are small and worth a preset trio each;
// every other dimension collapses to its default choice, same as before.
const PRESET_EXPAND_DIMS = new Set(['color', 'comp'])

// Every combination of choices across `selectors`, e.g. [colorSelector] -> [[red], [green], [blue]].
function expandChoices(selectors: readonly Selector[]): { dim: string; id: string; label: string }[][] {
	return selectors.reduce<{ dim: string; id: string; label: string }[][]>(
		(combos, selector) =>
			combos.flatMap((combo) => selector.choices.map((choice) => [...combo, { dim: selector.dim, ...choice }])),
		[[]],
	)
}

// Writable numbers get +1/-1 nudge buttons flanking a status button showing the live value. One
// trio is built per combination of the logical control's PRESET_EXPAND_DIMS selectors (e.g. one
// per Color or Component); any other selector dimension stays at its default choice.
function addNumber(
	self: ModuleInstance,
	presets: CompanionPresetDefinitions,
	logical: LogicalControl,
	interactive: boolean,
): void {
	const base = defaultOptions(logical)
	const expandable = logical.selectors.filter((selector) => PRESET_EXPAND_DIMS.has(selector.dim))

	for (const combo of expandChoices(expandable)) {
		const options: CompanionOptionValues = { ...base, ...Object.fromEntries(combo.map((c) => [c.dim, c.id])) }
		const key = combo.length ? `${logical.key}_${combo.map((c) => c.id.replace(/-/g, '')).join('_')}` : logical.key
		// logical.name carries a "(R/G/B)"-style listing of every sibling choice (for the divider
		// and the action/feedback dropdown); drop it here so the per-choice preset names only the
		// one value they actually target.
		const variantLabel = combo.map((c) => c.label).join('/')
		const name = combo.length ? `${logical.name.replace(/\s*\([^)]*\)\s*$/, '')} ${variantLabel}` : logical.name
		addNumberPreset(self, presets, logical, interactive, options, key, name, variantLabel)
	}
}

function addNumberPreset(
	self: ModuleInstance,
	presets: CompanionPresetDefinitions,
	logical: LogicalControl,
	interactive: boolean,
	options: CompanionOptionValues,
	key: string,
	name: string,
	variantLabel: string,
): void {
	const category = logical.category ?? ''
	const valueRef = `$(${self.label}:${resolveId(logical, options)})`
	const unit = logical.spec.kind === 'number' && logical.spec.unit ? ` ${logical.spec.unit}` : ''

	const nudge = (suffix: string, mode: 'increase' | 'decrease', text: string) => {
		const buttonText = variantLabel ? `${text}\n${variantLabel}` : text
		presets[`${key}_${suffix}`] = {
			type: 'button',
			category,
			name: `${name} ${text}`,
			style: { ...buttonStyle(buttonText, true), size: '14' as const },
			steps: [{ down: [{ actionId: actionId(logical), options: { ...options, mode, value: 1 } }], up: [] }],
			feedbacks: [],
		}
	}

	if (interactive) nudge('inc', 'increase', '+1')

	presets[`${key}_status`] = {
		type: 'button',
		category,
		name: `${name} Status`,
		style: buttonStyle(`${name}\n${valueRef}${unit}`, false),
		steps: [],
		feedbacks: [],
	}

	if (interactive) nudge('dec', 'decrease', '-1')
}

// Writable controls get an interactive preset (action + feedback); read-only ones get a
// status-only preset. Free-text labels have no feedback to drive a button, so they're skipped.
export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions = {}

	for (const logical of self.logicalControls) {
		if (logical.category === CATEGORY.METADATA_LABELING) continue
		const interactive = isWritable(logical.spec)

		if (logical.spec.kind === 'boolean') {
			addDivider(presets, logical.key, logical.category ?? '', logical.name)
			addBoolean(presets, logical, interactive)
		} else if (logical.spec.kind === 'enum') {
			// addEnum manages its own divider(s) — Path & Routing enums split into one per instance.
			addEnum(presets, logical, interactive)
		} else if (logical.spec.kind === 'number') {
			addDivider(presets, logical.key, logical.category ?? '', logical.name)
			addNumber(self, presets, logical, interactive)
		}
	}

	self.setPresetDefinitions(presets)
}
