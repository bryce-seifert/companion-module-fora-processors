export type ModelId = '1616' | '9600'

export interface ModelSpec {
	id: ModelId
	label: string
	port: number
	rootPath: string
	// Value the device reports at DEVICE_ID_PATH; used to verify the configured model matches the hardware.
	deviceId: string
}

export const MODELS: Record<ModelId, ModelSpec> = {
	'1616': { id: '1616', label: 'FOR-A 1616', port: 9000, rootPath: '1', deviceId: 'FA-1616' },
	'9600': { id: '9600', label: 'FOR-A 9600', port: 55000, rootPath: '1', deviceId: 'FA-9600' },
}

// VERIFY (FA-1616): this FA-9600-only path has no equivalent on the FA-1616 tree, so identity
// verification will fail there and the module will loop reconnecting without ever populating.
export const DEVICE_ID_PATH = 'processor.identity.deviceConfig.deviceID'

export const DEFAULT_MODEL: ModelId = '1616'

export function getModelSpec(id: ModelId | undefined): ModelSpec {
	return MODELS[id ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL]
}
