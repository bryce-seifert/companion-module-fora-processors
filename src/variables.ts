import type { ModuleInstance } from './main.js'

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions(self.definitions.map((def) => ({ variableId: def.id, name: def.name })))
}
