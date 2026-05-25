// Undo / redo history stack.
// Works with any object that implements snapshot() / restore(snap).
//
// Conflict-aware undo (optional):
//   Pass `getLocalTouches: () => Set<string>` and each push() captures the
//   set of "sheet|cellId" keys this client touched since the previous push.
//   restore() then receives `{ snapshot, touches }` so it can revert ONLY
//   those cells — leaving any remote-applied cell untouched. Without the
//   callback the history degrades to the original full-restore behaviour.

export function createHistory({ snapshot, restore, maxSize = 50, getLocalTouches } = {}) {
	const stack = []
	let index   = -1

	// Save current state after a mutation. Each entry remembers the local
	// cells the just-finished op touched — undo uses that to revert only
	// those cells when stepping past this entry.
	function push() {
		if (index < stack.length - 1) stack.splice(index + 1)
		const touches = getLocalTouches ? getLocalTouches() : null
		stack.push({ snap: snapshot(), touches })
		index++
		if (stack.length > maxSize) { stack.shift(); index-- }
	}

	function undo() {
		if (index <= 0) return false
		// The entry currently on top of stack holds the touches of the op we
		// are about to undo. Step the index back and restore that snapshot
		// with the touches as a hint.
		const undoingTouches = stack[index].touches || null
		index--
		restore(stack[index].snap, { touches: undoingTouches })
		return true
	}

	function redo() {
		if (index >= stack.length - 1) return false
		index++
		restore(stack[index].snap, { touches: null })
		return true
	}

	function canUndo() { return index > 0 }
	function canRedo() { return index < stack.length - 1 }

	// Seed the initial snapshot so the first undo lands on the blank state.
	function init() { if (stack.length === 0) push() }

	return { push, undo, redo, canUndo, canRedo, init }
}
