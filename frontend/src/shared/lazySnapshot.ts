// lazyArray -- a module-scope array constant whose CONTENTS are built
// on first access instead of at module eval (docs/goals/0249's
// boot-order contract): runtime plugins register into the registries
// after the module graph evaluates but before the first render, so a
// snapshot taken at eval would miss them, while one taken at first
// access (always a render- or event-time read) includes them. The
// Proxy materializes on first read and again after resetLazyArrays;
// consumers keep plain-array usage (`.map`, `.find`, iteration,
// indexing) untouched.

// Every live snapshot's own reset, so one plugin reload (goal 0319)
// can invalidate them all: a reloaded plugin re-registers into the
// same registries these arrays are built from, and a snapshot taken
// before the reload would keep serving the previous module's
// callbacks. Rebuilding is pure -- each build() reads the registries
// as they stand now -- so resetting a snapshot no reload touched
// costs one rebuild and changes nothing.
const resets: (() => void)[] = []

export function resetLazyArrays(): void {
	for (const reset of resets) reset()
}

export function lazyArray<T>(build: () => T[]): T[] {
	let materialized: T[] | null = null
	resets.push(() => { materialized = null })
	const get = (): T[] => {
		if (materialized === null) materialized = build()
		return materialized
	}
	return new Proxy([] as T[], {
		get(_target, prop, receiver) {
			const value = Reflect.get(get(), prop, receiver)
			return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(get()) : value
		},
		has: (_t, prop) => Reflect.has(get(), prop),
		ownKeys: () => Reflect.ownKeys(get()),
		getOwnPropertyDescriptor: (_t, prop) => Reflect.getOwnPropertyDescriptor(get(), prop),
		getPrototypeOf: () => Array.prototype,
	})
}
