import { InstanceStatus } from '@companion-module/base'
import { EmberClient, Model } from 'emberplus-connection'
import type { ModuleInstance } from './main.js'
import { DEVICE_ID_PATH, getModelSpec, type ModelSpec } from './models.js'

const RECONNECT_INTERVAL_MS = 5000

export class ForaApi {
	readonly #self: ModuleInstance
	#client: EmberClient | null = null
	#reconnectTimer: NodeJS.Timeout | null = null
	#destroyed = false

	constructor(self: ModuleInstance) {
		this.#self = self
	}

	async connect(): Promise<void> {
		this.#destroyed = false
		await this.#teardownClient()

		const { host, model } = this.#self.config
		if (!host) {
			this.#self.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}

		const spec = getModelSpec(model)
		const port = spec.port
		this.#self.log('debug', `Connecting to ${spec.label} at ${host}:${port}`)
		this.#self.updateStatus(InstanceStatus.Connecting)

		const client = new EmberClient(host, port)
		this.#client = client

		client.on('disconnected', () => this.#handleDrop('Disconnected'))
		client.on('error', (error: Error) => this.#handleDrop(error.message))

		let connectResult: void | Error
		try {
			connectResult = await client.connect()
		} catch (error) {
			this.#handleDrop(error instanceof Error ? error.message : String(error))
			return
		}
		if (connectResult instanceof Error) {
			this.#handleDrop(connectResult.message)
			return
		}
		if (this.#client !== client) return // superseded by a newer connect()/teardown

		this.#self.log('info', `Connected to ${spec.label} at ${host}:${port}, verifying identity`)
		await this.#verifyIdentity(client, spec)
	}

	// Read the device identity and confirm it matches the configured model.
	async #verifyIdentity(client: EmberClient, spec: ModelSpec): Promise<void> {
		let deviceId: string | undefined
		try {
			deviceId = await this.#readDeviceId(client)
		} catch (error) {
			// A failed read is treated as a transient connection problem.
			this.#handleDrop(error instanceof Error ? error.message : String(error))
			return
		}

		if (this.#client !== client) return // superseded while awaiting

		if (deviceId === undefined) {
			this.#handleDrop(`Could not read device identity at "${DEVICE_ID_PATH}"`)
			return
		}

		if (deviceId !== spec.deviceId) {
			this.#self.log(
				'error',
				`Model mismatch: device reports "${deviceId}" but config is set to ${spec.label} ("${spec.deviceId}")`,
			)
			this.#self.updateStatus(InstanceStatus.BadConfig, `Wrong model: device is "${deviceId}", expected ${spec.label}`)
			await this.#teardownClient() // config error, not transient — stop without reconnecting
			return
		}

		this.#self.log('info', `Identity confirmed: ${deviceId}`)
		this.#self.updateStatus(InstanceStatus.Ok)
		// TODO discover the model's parameters for actions/feedbacks/variables.
	}

	// Resolve the deviceID parameter and read its value.
	async #readDeviceId(client: EmberClient): Promise<string | undefined> {
		const rootReq = await client.getDirectory(client.tree)
		await rootReq.response

		const node = await client.getElementByPath(DEVICE_ID_PATH)
		const contents = node?.contents
		if (contents?.type !== Model.ElementType.Parameter) return undefined

		const value = contents.value
		return value === undefined || value === null ? undefined : String(value).trim()
	}

	#handleDrop(reason: string): void {
		if (this.#destroyed) return
		this.#self.log('warn', `Connection lost: ${reason}`)
		this.#self.updateStatus(InstanceStatus.ConnectionFailure, reason)
		this.#scheduleReconnect()
	}

	#scheduleReconnect(): void {
		if (this.#destroyed || this.#reconnectTimer) return
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null
			void this.connect()
		}, RECONNECT_INTERVAL_MS)
	}

	// Cancel any pending reconnect and dispose of the current client.
	async #teardownClient(): Promise<void> {
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer)
			this.#reconnectTimer = null
		}

		const client = this.#client
		this.#client = null
		if (!client) return

		client.removeAllListeners()
		try {
			await client.disconnect()
		} catch {
			// Already disconnected or never connected; nothing to do.
		}
		client.discard()
	}

	// Permanently shut down the API. No reconnect will be scheduled afterwards.
	async destroy(): Promise<void> {
		this.#destroyed = true
		await this.#teardownClient()
	}
}
