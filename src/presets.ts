import {
	combineRgb,
	type CompanionButtonStepActions,
	type CompanionOptionValues,
	type CompanionPresetDefinitions,
	type CompanionPresetFeedback,
} from '@companion-module/base'
import { isReadable, isWritable, type EnumChoice } from './definitions/controls.js'
import { CATEGORY } from './definitions/shared.js'
import {
	actionId,
	defaultOptions,
	expandChoices,
	feedbackId,
	optionsFromCombo,
	resolveId,
	type LogicalControl,
	type SelectorCombo,
} from './logical-controls.js'
import type { ModuleInstance } from './main.js'

const BUTTON_TEXT = combineRgb(255, 255, 255)
const BUTTON_BG = combineRgb(0, 0, 0)
const STATUS_BG = combineRgb(40, 40, 40)

/** Preset feedbacks turn the background green when active; nothing else about the style changes. */
const ACTIVE_STYLE = { bgcolor: combineRgb(0, 170, 0) }

/**
 * Event Memory enums (event_load, event_save, startup_event, …) run to 100+ choices; a preset
 * per choice would swamp the category, so only the first 10 get buttons.
 */
const EVENT_PRESET_LIMIT = 10

/**
 * "Event 001" alone doesn't say what pressing the button does — prefix it with the action, keyed
 * by logical control key (these are all ungrouped, so key === definition id).
 */
const EVENT_ACTION_LABEL: Record<string, string> = {
	event_load: 'LOAD',
	event_save: 'SAVE',
	event_delete: 'DELETE',
	startup_event: 'STARTUP',
	startup_event_number: 'STARTUP',
	startup_event_type: 'STARTUP',
}

/**
 * Selector dims whose choice label alone doesn't say which dimension it's from ("A1", "A") get a
 * spelled-out prefix in Path & Routing context text ("PRU A1", "Lane A"); dims like `fs` whose
 * choice labels are already self-describing ("FS1") are left bare.
 */
const SELECTOR_CONTEXT_PREFIX: Record<string, string> = { pru: 'PRU', lane: 'Lane' }

/**
 * Selector dims that become a bare sub-header divider ("Lane A") within the Path & Routing
 * category, instead of folding into the category name itself.
 */
const PATH_ROUTING_HEADER_DIMS = new Set(['lane'])

/**
 * Selector dimensions that are sibling *values* of the same parameter (Color, Component) rather
 * than device instances (PRU, Lane, Channel, ...). These are small and worth a preset trio each;
 * every other dimension collapses to its default choice.
 */
const PRESET_EXPAND_DIMS = new Set(['color', 'comp'])

const buttonStyle = (text: string, interactive: boolean) => ({
	text,
	size: '14' as const,
	color: BUTTON_TEXT,
	bgcolor: interactive ? BUTTON_BG : STATUS_BG,
	show_topbar: false as const,
})

const selectorContext = (combo: SelectorCombo): string =>
	combo
		.map((entry) =>
			SELECTOR_CONTEXT_PREFIX[entry.dim] ? `${SELECTOR_CONTEXT_PREFIX[entry.dim]} ${entry.label}` : entry.label,
		)
		.join(' - ')

/** A text-only preset that titles the group of buttons following it in the category. */
function addDivider(presets: CompanionPresetDefinitions, key: string, category: string, name: string): void {
	presets[`${key}_label`] = {
		type: 'text',
		category,
		name,
		text: '',
	}
}

function pressSteps(
	logical: LogicalControl,
	options: CompanionOptionValues,
	interactive: boolean,
): CompanionButtonStepActions[] {
	if (!interactive) return []
	return [{ down: [{ actionId: actionId(logical), options }], up: [] }]
}

function activeFeedbacks(
	logical: LogicalControl,
	options: CompanionOptionValues,
	showsFeedback: boolean,
): CompanionPresetFeedback[] {
	if (!showsFeedback) return []
	return [{ feedbackId: feedbackId(logical), options, style: ACTIVE_STYLE }]
}

function addBoolean(presets: CompanionPresetDefinitions, logical: LogicalControl, interactive: boolean): void {
	const options = defaultOptions(logical)
	presets[logical.key] = {
		type: 'button',
		category: logical.category ?? '',
		name: logical.name,
		style: buttonStyle(logical.name, interactive),
		steps: pressSteps(logical, { ...options, mode: 'toggle' }, interactive),
		// Write-only controls never report a value back, so there's no feedback to light this with.
		feedbacks: activeFeedbacks(logical, options, isReadable(logical.spec)),
	}
}

function addEnumChoiceButton(
	presets: CompanionPresetDefinitions,
	logical: LogicalControl,
	interactive: boolean,
	showsFeedback: boolean,
	args: {
		presetKey: string
		category: string
		name: string
		buttonText: string
		options: CompanionOptionValues
	},
): void {
	presets[args.presetKey] = {
		type: 'button',
		category: args.category,
		name: args.name,
		style: buttonStyle(args.buttonText, interactive),
		steps: pressSteps(logical, args.options, interactive),
		feedbacks: activeFeedbacks(logical, args.options, showsFeedback),
	}
}

/**
 * Path & Routing enums (FS/PRU input-select) are grouped by an instance selector that would
 * otherwise silently default to a single fixed instance. Expand every instance into its own
 * preset set; dims in PATH_ROUTING_HEADER_DIMS (Lane) become in-category headers rather than
 * separate categories.
 */
function addPathRoutingEnum(
	presets: CompanionPresetDefinitions,
	logical: LogicalControl,
	interactive: boolean,
	showsFeedback: boolean,
	choices: readonly EnumChoice[],
): void {
	const categorySelectors = logical.selectors.filter((selector) => !PATH_ROUTING_HEADER_DIMS.has(selector.dim))
	const headerSelectors = logical.selectors.filter((selector) => PATH_ROUTING_HEADER_DIMS.has(selector.dim))

	for (const categoryCombo of expandChoices(categorySelectors)) {
		const categoryContext = selectorContext(categoryCombo)
		const category = `${logical.category} - ${categoryContext}`
		const categoryOptions = optionsFromCombo(categoryCombo)

		for (const headerCombo of expandChoices(headerSelectors)) {
			const headerContext = selectorContext(headerCombo)
			const combo = [...categoryCombo, ...headerCombo]
			const comboKey = `${logical.key}_${combo.map((entry) => entry.id).join('_')}`
			const comboOptions = { ...categoryOptions, ...optionsFromCombo(headerCombo) }
			const buttonContext = headerContext || categoryContext

			addDivider(presets, comboKey, category, headerContext || `${logical.name} ${categoryContext}`)

			for (const choice of choices) {
				addEnumChoiceButton(presets, logical, interactive, showsFeedback, {
					presetKey: `${comboKey}_${choice.id}`,
					category,
					name: `${logical.name} ${categoryContext}${headerContext ? ` ${headerContext}` : ''}: ${choice.label}`,
					buttonText: `${buttonContext}\n${choice.label}`,
					options: { ...comboOptions, value: choice.id },
				})
			}
		}
	}
}

function addSimpleEnum(
	presets: CompanionPresetDefinitions,
	logical: LogicalControl,
	interactive: boolean,
	showsFeedback: boolean,
	choices: readonly EnumChoice[],
): void {
	addDivider(presets, logical.key, logical.category ?? '', logical.name)
	const selectorDefaults = defaultOptions(logical)
	const actionLabel = EVENT_ACTION_LABEL[logical.key]

	for (const choice of choices) {
		const options = { ...selectorDefaults, value: choice.id }
		// Skip the prefix when the choice already says it ("Delete All" under DELETE).
		const prefix = actionLabel && !choice.label.toUpperCase().startsWith(actionLabel) ? actionLabel : undefined
		addEnumChoiceButton(presets, logical, interactive, showsFeedback, {
			presetKey: `${logical.key}_${choice.id}`,
			category: logical.category ?? '',
			name: prefix ? `${prefix} ${choice.label}` : `${logical.name}: ${choice.label}`,
			buttonText: prefix ? `${prefix}\n${choice.label}` : choice.label,
			options,
		})
	}
}

function addEnum(presets: CompanionPresetDefinitions, logical: LogicalControl, interactive: boolean): void {
	if (logical.spec.kind !== 'enum') return

	const choices =
		logical.category === CATEGORY.EVENT_MEMORY
			? logical.spec.choices.slice(0, EVENT_PRESET_LIMIT)
			: logical.spec.choices
	const showsFeedback = isReadable(logical.spec)
	const isPathRouting = logical.category === CATEGORY.PATH_ROUTING && logical.selectors.length > 0

	if (isPathRouting) {
		addPathRoutingEnum(presets, logical, interactive, showsFeedback, choices)
		return
	}

	addSimpleEnum(presets, logical, interactive, showsFeedback, choices)
}

/**
 * Writable numbers get +1/-1 nudge buttons flanking a status button showing the live value. One
 * trio is built per combination of the logical control's PRESET_EXPAND_DIMS selectors; any other
 * selector dimension stays at its default choice.
 */
function addNumber(
	self: ModuleInstance,
	presets: CompanionPresetDefinitions,
	logical: LogicalControl,
	interactive: boolean,
): void {
	const base = defaultOptions(logical)
	const expandable = logical.selectors.filter((selector) => PRESET_EXPAND_DIMS.has(selector.dim))

	for (const combo of expandChoices(expandable)) {
		const options: CompanionOptionValues = { ...base, ...optionsFromCombo(combo) }
		const key = combo.length
			? `${logical.key}_${combo.map((entry) => entry.id.replace(/-/g, '')).join('_')}`
			: logical.key
		// logical.name carries a "(R/G/B)"-style listing of every sibling choice; drop it so the
		// per-choice preset names only the one value they actually target.
		const variantLabel = combo.map((entry) => entry.label).join('/')
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

	const nudge = (suffix: string, mode: 'increase' | 'decrease', text: string): void => {
		const buttonText = variantLabel ? `${text}\n${variantLabel}` : text
		presets[`${key}_${suffix}`] = {
			type: 'button',
			category,
			name: `${name} ${text}`,
			style: { ...buttonStyle(buttonText, true), size: '14' as const },
			steps: pressSteps(logical, { ...options, mode, value: 1 }, true),
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

/**
 * Writable controls get an interactive preset (action + feedback); read-only ones get a
 * status-only preset. Free-text labels have no feedback to drive a button, so they're skipped.
 */
export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions = {}

	for (const logical of self.logicalControls) {
		if (logical.category === CATEGORY.METADATA_LABELING) continue
		const interactive = isWritable(logical.spec)

		switch (logical.spec.kind) {
			case 'boolean':
				addDivider(presets, logical.key, logical.category ?? '', logical.name)
				addBoolean(presets, logical, interactive)
				break
			case 'enum':
				// addEnum manages its own divider(s) — Path & Routing enums split into one per instance.
				addEnum(presets, logical, interactive)
				break
			case 'number':
				addDivider(presets, logical.key, logical.category ?? '', logical.name)
				addNumber(self, presets, logical, interactive)
				break
			case 'string':
				break
		}
	}

	self.setPresetDefinitions(presets)
}
