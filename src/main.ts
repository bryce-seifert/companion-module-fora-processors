import { InstanceBase, runEntrypoint, SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { ForaApi } from './api.js'
import { buildDefinitions, DeviceStateStore, type VariableDefinition } from './state.js'

export class ModuleInstance extends InstanceBase<ModuleConfig> {
	config!: ModuleConfig
	api!: ForaApi
	state!: DeviceStateStore
	definitions: readonly VariableDefinition[] = []

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		this.definitions = buildDefinitions(config.model)
		this.state = new DeviceStateStore(this)
		this.api = new ForaApi(this)

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()

		this.#startConnection()
	}

	async destroy(): Promise<void> {
		this.log('debug', 'destroy')
		await this.api.destroy()
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		// Model may have changed — rebuild definitions and re-register variables before reconnecting.
		this.definitions = buildDefinitions(config.model)
		this.updateVariableDefinitions()
		this.#startConnection()
	}

	#startConnection(): void {
		this.api.connect().catch((error: unknown) => {
			this.log('error', `Connection failed: ${error instanceof Error ? error.message : String(error)}`)
		})
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}
}

runEntrypoint(ModuleInstance, UpgradeScripts)
