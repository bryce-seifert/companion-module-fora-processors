import { InstanceBase, runEntrypoint, SomeCompanionConfigField } from '@companion-module/base'
import { UpdateActions } from './actions.js'
import { ForaApi } from './api.js'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { buildLogicalControls, type LogicalControl } from './logical-controls.js'
import { UpdatePresets } from './presets.js'
import { buildDefinitions, DeviceStateStore, type VariableDefinition } from './state.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateVariableDefinitions } from './variables.js'

export class ModuleInstance extends InstanceBase<ModuleConfig> {
	config!: ModuleConfig
	api!: ForaApi
	state!: DeviceStateStore
	// The selected model's fixed parameter table
	definitions: readonly VariableDefinition[] = []
	logicalControls: readonly LogicalControl[] = []

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		this.state = new DeviceStateStore(this)
		this.api = new ForaApi(this)

		this.#rebuildForModel()
		this.#startConnection()
	}

	async destroy(): Promise<void> {
		this.log('debug', 'destroy')
		await this.api.destroy()
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		this.#rebuildForModel()
		this.#startConnection()
	}

	#rebuildForModel(): void {
		this.definitions = buildDefinitions(this.config.model)
		this.logicalControls = buildLogicalControls(this.definitions)
		UpdateVariableDefinitions(this)
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdatePresets(this)
	}

	#startConnection(): void {
		this.api.connect().catch((error: unknown) => {
			this.log('error', `Connection failed: ${error instanceof Error ? error.message : String(error)}`)
		})
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}
}

runEntrypoint(ModuleInstance, UpgradeScripts)
