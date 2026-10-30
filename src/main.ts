import { InstanceBase, runEntrypoint, type SomeCompanionConfigField } from '@companion-module/base'
import { UpdateActions } from './actions.js'
import { ForaApi } from './api.js'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { buildLogicalControls, type LogicalControl } from './logical-controls.js'
import { UpdatePresets } from './presets.js'
import {
	buildDefinitions,
	DeviceStateStore,
	NO_DEVICE_CHOICES,
	type ChoiceLabels,
	type DeviceChoices,
	type VariableDefinition,
} from './state.js'
import { UpgradeScripts } from './upgrades.js'
import { errorMessage } from './util.js'
import { UpdateVariableDefinitions } from './variables.js'

export class ModuleInstance extends InstanceBase<ModuleConfig> {
	config!: ModuleConfig
	api!: ForaApi
	state!: DeviceStateStore
	// The selected model's fixed parameter table
	definitions: readonly VariableDefinition[] = []
	logicalControls: readonly LogicalControl[] = []
	// Enum choices read off the device on the current connection; empty until the first read lands.
	#deviceChoices: DeviceChoices = NO_DEVICE_CHOICES

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
		this.state.destroy()
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		// A different unit (or model) names its slots differently; the next connection reads them.
		this.#deviceChoices = NO_DEVICE_CHOICES
		this.#rebuildForModel()
		this.#startConnection()
	}

	// Rebuilding replaces every action, feedback and preset, so it only runs when the choices differ
	// from what the UI already shows — a reconnect to the same unit reads the same strings back.
	applyDeviceChoices(choices: DeviceChoices): void {
		if (deviceChoicesEqual(this.#deviceChoices, choices)) return
		this.#deviceChoices = choices
		this.#rebuildForModel()
	}

	#rebuildForModel(): void {
		this.definitions = buildDefinitions(this.config.model, this.#deviceChoices)
		this.logicalControls = buildLogicalControls(this.definitions)
		UpdateVariableDefinitions(this)
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdatePresets(this)
	}

	#startConnection(): void {
		this.api.connect().catch((error: unknown) => {
			this.log('error', `Connection failed: ${errorMessage(error)}`)
		})
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}
}

function deviceChoicesEqual(a: DeviceChoices, b: DeviceChoices): boolean {
	if (!choiceLabelsEqual(a.labels, b.labels) || a.perInstance.size !== b.perInstance.size) return false
	for (const [id, choices] of a.perInstance) {
		if (JSON.stringify(choices) !== JSON.stringify(b.perInstance.get(id))) return false
	}
	return true
}

function choiceLabelsEqual(a: ChoiceLabels, b: ChoiceLabels): boolean {
	if (a.size !== b.size) return false
	for (const [key, labels] of a) {
		const other = b.get(key)
		if (!other || other.size !== labels.size) return false
		for (const [id, label] of labels) {
			if (other.get(id) !== label) return false
		}
	}
	return true
}

runEntrypoint(ModuleInstance, UpgradeScripts)
