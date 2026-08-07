export type ModelId = '1616' | '9600'

// Where a model reports its identity. The FA-9600 exposes a deviceID parameter; the FA-1616 has
// no such parameter and instead carries the model name as the description of its single root node.
export type IdentitySource =
	{ readonly kind: 'parameter'; readonly path: string } | { readonly kind: 'rootDescription'; readonly root: string }

export interface ModelSpec {
	id: ModelId
	label: string
	port: number
	identity: IdentitySource
	// Value the device reports at `identity`; used to verify the configured model matches the hardware.
	deviceId: string
}

export const MODELS: Record<ModelId, ModelSpec> = {
	'1616': {
		id: '1616',
		label: 'FOR-A 1616',
		port: 9000,
		identity: { kind: 'rootDescription', root: 'root' },
		deviceId: 'FA-1616',
	},
	'9600': {
		id: '9600',
		label: 'FOR-A 9600',
		port: 55000,
		identity: { kind: 'parameter', path: 'processor/identity/deviceConfig/deviceID' },
		deviceId: 'FA-9600',
	},
}

export function describeIdentitySource(identity: IdentitySource): string {
	return identity.kind === 'parameter' ? `parameter "${identity.path}"` : `description of root node "${identity.root}"`
}

export const DEFAULT_MODEL: ModelId = '1616'

export function getModelSpec(id: ModelId | undefined): ModelSpec {
	return MODELS[id ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL]
}
