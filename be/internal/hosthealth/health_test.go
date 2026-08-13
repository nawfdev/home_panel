package hosthealth

import (
	"strings"
	"testing"
)

func TestRemoteCommandCollectsNonLoopbackBandwidthTotals(t *testing.T) {
	t.Parallel()

	for _, fragment := range []string{
		`/proc/net/dev`,
		`if(iface!="lo")`,
		`rx+=a[1]`,
		`tx+=a[9]`,
		`downloaded=%s`,
		`uploaded=%s`,
	} {
		if !strings.Contains(remoteCommand, fragment) {
			t.Fatalf("remote health command missing %q", fragment)
		}
	}
}
