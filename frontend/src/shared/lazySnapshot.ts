// lazyArray -- a module-scope array constant whose CONTENTS are built
// on first access instead of at module eval (docs/goals/0249's
// boot-order contract): runtime plugins register into the registries
// after the module graph evaluates but before the first render, so a
// snapshot taken at eval would miss them, while one taken at first
// access (always a render- or event-time read) includes them. The
// Proxy materializes exactly once; consumers keep plain-array usage
// (`.map`, `.find`, iteration, indexing) untouched.
export function lazyArray<T>(build: () => T[]): T[] {
	let materialized: T[] | null = null
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
