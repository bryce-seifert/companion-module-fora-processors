import type { GroupSelector, VariableDefinition } from './definitions/shared.js'
import type { ModuleInstance } from './main.js'

/**
 * Selector dims that identify a device instance and lead the variable name
 * ("FS1 - Video Test Signal", "PRU A1 - Lane B - Sync Mode").
 * Everything else trails the parameter name ("Output Channel Gain - Emb2 - Ch01").
 */
const INSTANCE_DIMS = new Set(['fs', 'pru'])

/** Compact/readable token for one selector in a variable display name. */
function selectorToken(selector: GroupSelector): string {
	switch (selector.dim) {
		case 'pru':
			return `PRU ${selector.label}`
		case 'lane':
			return `Lane ${selector.label}`
		case 'emb':
		case 'ch':
		case 'group':
			// "Emb 2" → "Emb2", "Ch 01" → "Ch01", "Grp 1" → "Grp1"
			return selector.label.replace(/\s+/g, '')
		default:
			return selector.label
	}
}

/**
 * Grouped parameters get " - "-separated names so Companion's variable list reads in
 * clear hierarchy. Ungrouped parameters keep the definition's own name. Audio categories
 * (already prefixed "Audio - …") get a leading "Audio" so they sort and read apart from
 * video parameters that share words like Gain.
 */
export function variableDisplayName(def: VariableDefinition): string {
	const group = def.group
	let name: string
	if (!group?.selectors.length) {
		name = def.name
	} else {
		// Strip trailing "(R/G/B)"-style choice listings only when a color/comp selector is present —
		// names like "Per-Channel Gain (Embedded)" must keep their parenthetical.
		const hasChoiceListing = group.selectors.some((selector) => selector.dim === 'color' || selector.dim === 'comp')
		const base = hasChoiceListing ? group.name.replace(/\s*\([^)]*\)\s*$/, '') : group.name

		const lead = group.selectors.filter((selector) => INSTANCE_DIMS.has(selector.dim)).map(selectorToken)
		const rest = group.selectors.filter((selector) => !INSTANCE_DIMS.has(selector.dim)).map(selectorToken)
		name = (lead.length > 0 ? [...lead, base, ...rest] : [base, ...rest]).join(' - ')
	}

	if (def.category?.startsWith('Audio')) {
		return name.startsWith('Audio') ? name : `Audio - ${name}`
	}
	return name
}

// Every parameter the model can carry becomes a variable. A unit that doesn't have one simply
// leaves it blank, which keeps variable names stable across reconnects and option changes.
export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions(self.definitions.map((def) => ({ variableId: def.id, name: variableDisplayName(def) })))
}
