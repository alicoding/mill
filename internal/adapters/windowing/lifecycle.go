package windowing

import "sync"

type shutdownApplication interface {
	OnShutdown(func())
	Run() error
}

// RunWithShutdown registers shutdown with the desktop lifecycle before Run,
// then uses the same exactly-once function as the return/error fallback for
// platforms and startup failures where the native shutdown hook did not run.
func RunWithShutdown(app shutdownApplication, shutdown func()) error {
	shutdownOnce := sync.OnceFunc(shutdown)
	app.OnShutdown(shutdownOnce)
	defer shutdownOnce()
	return app.Run()
}
