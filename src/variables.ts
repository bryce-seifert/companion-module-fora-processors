import type { ModuleInstance } from './main.js'

// Every parameter the model can carry becomes a variable. A unit that doesn't have one simply
// leaves it blank, which keeps variable names stable across reconnects and option changes.
export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions(self.definitions.map((def) => ({ variableId: def.id, name: def.name })))
}
