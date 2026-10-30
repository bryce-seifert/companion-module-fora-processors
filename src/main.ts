import { InstanceBase, runEntrypoint, type SomeCompanionConfigField } from '@companion-module/base'
import { UpdateActions } from './actions.js'
import { ForaApi } from './api.js'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { buildLogicalControls, type LogicalControl } from './logical-controls.js'
import { UpdatePresets } from './presets.js'
import { getModelSpec } from './models.js'
import {
	buildDefinitions,
	DeviceStateStore,
	NO_DEVICE_FIT,
	type ChoiceLabels,
	type DeviceFit,
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
	// Every control this unit carries; drives feedbacks and presets.
	logicalControls: readonly LogicalControl[] = []
	// The same, less what the unit reports read-only; drives actions.
	actionControls: readonly LogicalControl[] = []
	// What the unit reported about its fit on the current connection; empty until the first walk lands.
	#deviceFit: DeviceFit = NO_DEVICE_FIT

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
		this.#deviceFit = NO_DEVICE_FIT
		this.#rebuildForModel()
		this.#startConnection()
	}

	// Rebuilding replaces every action, feedback and preset, so it only runs when the fit differs
	// from what the UI already shows — a reconnect to the same unit reads the same back.
	applyDeviceFit(fit: DeviceFit): void {
		if (deviceFitEqual(this.#deviceFit, fit)) return
		this.#deviceFit = fit
		this.#rebuildForModel()
	}

	#rebuildForModel(): void {
		const { absent, readOnly } = this.#deviceFit
		const perInstanceValueKeys = new Set(getModelSpec(this.config.model).perInstanceValueControls)
		this.definitions = buildDefinitions(this.config.model, this.#deviceFit)
		// Variables keep every definition, so their names stay stable whatever the unit carries.
		const present = this.definitions.filter((def) => !absent.has(def.id))
		this.logicalControls = buildLogicalControls(present, perInstanceValueKeys)
		this.actionControls = buildLogicalControls(
			present.filter((def) => !readOnly.has(def.id)),
			perInstanceValueKeys,
		)
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

function deviceFitEqual(a: DeviceFit, b: DeviceFit): boolean {
	if (!choiceLabelsEqual(a.labels, b.labels) || a.perInstance.size !== b.perInstance.size) return false
	if (!setsEqual(a.absent, b.absent) || !setsEqual(a.readOnly, b.readOnly)) return false
	for (const [id, choices] of a.perInstance) {
		if (JSON.stringify(choices) !== JSON.stringify(b.perInstance.get(id))) return false
	}
	return true
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
	return a.size === b.size && [...a].every((value) => b.has(value))
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
