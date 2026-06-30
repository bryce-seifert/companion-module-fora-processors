export type ModelId = '1616' | '9600'

export interface ModelSpec {
	id: ModelId
	label: string
	port: number
	rootPath: string
	/** Value the device reports at DEVICE_ID_PATH; used to verify the configured model matches the hardware. */
	deviceId: string
}

export const MODELS: Record<ModelId, ModelSpec> = {
	// TODO: confirm deviceId for the 1616 against real hardware.
	'1616': { id: '1616', label: 'FOR-A 1616', port: 9000, rootPath: '1', deviceId: 'FA-1616' },
	'9600': { id: '9600', label: 'FOR-A 9600', port: 55000, rootPath: '1', deviceId: 'FA-9600' },
}

/**
 * Ember+ path to the deviceID parameter, read on connect to verify the model.
 * Resolved by identifier (getElementByPath matches number, identifier, or description).
 * Observed tree: processor > identity > deviceConfig > deviceID = "FA-9600".
 */
export const DEVICE_ID_PATH = 'processor.identity.deviceConfig.deviceID'

export const DEFAULT_MODEL: ModelId = '1616'

export function getModelSpec(id: ModelId | undefined): ModelSpec {
	return MODELS[id ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL]
}
