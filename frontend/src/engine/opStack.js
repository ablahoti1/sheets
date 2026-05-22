// Operation stack — replaces the snapshot-based createHistory.
//
// Each entry is an Operation (see op.js).  push() appends; undo() rewinds one
// step by calling op.undo(ctx); redo() re-applies it.  A discard branch fires
// when push() lands while pointed below the top (standard linear-history rule).
//
// Coalescing: if the new op exposes coalesce(prev) and the previous op is
// within the typing-burst window, the two collapse into a single entry — so
// "type 'hello'" is one undo step instead of five.

export function createOpStack({ ctx, maxSize = 500, coalesceMs = 800,
                                onChange = null } = {}) {
	const stack = []
	let index = -1
	let lastPushTs = 0

	function push(op) {
		const now = Date.now()
		const prev = stack[index]
		// Try to coalesce with the most recent op if it's still within the
		// typing window — only edit-cell ops opt into this today.
		if (prev && op.coalesce && (now - lastPushTs) < coalesceMs) {
			const merged = op.coalesce(prev)
			if (merged) {
				stack[index] = merged
				lastPushTs = now
				onChange?.()
				return merged
			}
		}
		// Discard redo branch on new mutation.
		if (index < stack.length - 1) stack.splice(index + 1)
		stack.push(op)
		index++
		if (stack.length > maxSize) { stack.shift(); index-- }
		lastPushTs = now
		onChange?.()
		return op
	}

	function undo() {
		if (index < 0) return null
		const op = stack[index]
		op.undo(ctx)
		index--
		// Reset coalesce window so the next edit starts a fresh group.
		lastPushTs = 0
		onChange?.()
		return op
	}

	function redo() {
		if (index >= stack.length - 1) return null
		const op = stack[++index]
		op.do(ctx)
		lastPushTs = 0
		onChange?.()
		return op
	}

	function canUndo() { return index >= 0 }
	function canRedo() { return index < stack.length - 1 }

	function clear() { stack.length = 0; index = -1; lastPushTs = 0; onChange?.() }

	// Break any active coalesce group — call this on blur, Enter, selection
	// change, or any commit boundary.  The next push() will start its own
	// undo entry even if it's the same cell+type.
	function commitGroup() { lastPushTs = 0 }

	function serialize() {
		return {
			ops:   stack.map(op => op.serialize()),
			index,
		}
	}

	return {
		push, undo, redo, canUndo, canRedo, clear, commitGroup,
		serialize,
		// Inspection — useful for tests + Phase-4 cell history derivation.
		_inspect: () => ({ stack, index }),
	}
}
