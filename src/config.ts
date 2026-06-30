import { Regex, type SomeCompanionConfigField } from '@companion-module/base'
import { DEFAULT_MODEL, MODELS, type ModelId } from './models.js'

export interface ModuleConfig {
	model: ModelId
	host: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'dropdown',
			id: 'model',
			label: 'Model',
			width: 12,
			default: DEFAULT_MODEL,
			choices: Object.values(MODELS).map((model) => ({ id: model.id, label: model.label })),
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Target IP',
			width: 8,
			regex: Regex.IP,
		},
	]
}
