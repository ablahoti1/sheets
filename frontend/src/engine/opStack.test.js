import { describe, it, expect, vi } from 'vitest'
import { createOpStack } from './opStack.js'

// Inline trivial op factories so the stack tests don't depend on op.js
// internals — keeps the suite focused on stack mechanics.
function valOp(target, before, after) {
	return {
		type: 'val',
		target,
		do(ctx)   { ctx.values[target] = after },
		undo(ctx) { ctx.values[target] = before },
		coalesce(prev) {
			if (!prev || prev.type !== 'val' || prev.target !== target) return null
			return valOp(target, prev.before ?? before, after)
		},
		serialize() { return { type: 'val', target, before, after } },
		before, after,
	}
}
function makeCtx() { return { values: {} } }

describe('createOpStack', () => {
	it('push then undo/redo applies and reverts', () => {
		const ctx   = makeCtx()
		const stack = createOpStack({ ctx, coalesceMs: 0 })
		ctx.values.a = 1
		stack.push(valOp('a', 1, 2))
		ctx.values.a = 2
		stack.undo(); expect(ctx.values.a).toBe(1)
		stack.redo(); expect(ctx.values.a).toBe(2)
	})

	it('canUndo / canRedo reflect the cursor position', () => {
		const ctx   = makeCtx()
		const stack = createOpStack({ ctx, coalesceMs: 0 })
		expect(stack.canUndo()).toBe(false)
		stack.push(valOp('a', 0, 1))
		expect(stack.canUndo()).toBe(true)
		expect(stack.canRedo()).toBe(false)
		stack.undo()
		expect(stack.canUndo()).toBe(false)
		expect(stack.canRedo()).toBe(true)
	})

	it('discards redo branch when a new op is pushed after undo', () => {
		const ctx   = makeCtx()
		const stack = createOpStack({ ctx, coalesceMs: 0 })
		stack.push(valOp('a', 0, 1))
		stack.push(valOp('a', 1, 2))
		stack.undo()                            // back to a=1
		stack.push(valOp('b', 0, 9))            // new branch, redo to 2 gone
		expect(stack.canRedo()).toBe(false)
	})

	it('coalesces consecutive ops in the typing window', () => {
		const ctx   = makeCtx()
		const stack = createOpStack({ ctx, coalesceMs: 10_000 })
		stack.push(valOp('a', '',  'h'))
		stack.push(valOp('a', 'h', 'he'))
		stack.push(valOp('a', 'he','hel'))
		// All three should have merged into a single entry.
		expect(stack._inspect().stack.length).toBe(1)
		expect(stack._inspect().stack[0].serialize()).toEqual({ type: 'val', target: 'a', before: '', after: 'hel' })
	})

	it('commitGroup breaks the coalesce window', () => {
		const ctx   = makeCtx()
		const stack = createOpStack({ ctx, coalesceMs: 10_000 })
		stack.push(valOp('a', '', 'h'))
		stack.commitGroup()
		stack.push(valOp('a', 'h', 'he'))
		expect(stack._inspect().stack.length).toBe(2)
	})

	it('enforces maxSize by dropping oldest', () => {
		const ctx   = makeCtx()
		const stack = createOpStack({ ctx, coalesceMs: 0, maxSize: 3 })
		for (let i = 0; i < 5; i++) stack.push(valOp(`k${i}`, 0, 1))
		expect(stack._inspect().stack.length).toBe(3)
	})

	it('serializes the full op stream', () => {
		const ctx   = makeCtx()
		const stack = createOpStack({ ctx, coalesceMs: 0 })
		stack.push(valOp('a', 0, 1))
		stack.push(valOp('b', 0, 2))
		const dump = stack.serialize()
		expect(dump.ops.length).toBe(2)
		expect(dump.index).toBe(1)
	})

	it('fires onChange after every push/undo/redo', () => {
		const onChange = vi.fn()
		const stack = createOpStack({ ctx: makeCtx(), coalesceMs: 0, onChange })
		stack.push(valOp('a', 0, 1))
		stack.undo()
		stack.redo()
		expect(onChange).toHaveBeenCalledTimes(3)
	})
})
