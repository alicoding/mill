package pluginsvc

import "os"

func openArtifactFile(root *os.Root, name string) (*os.File, error) {
	return root.Open(name)
}
