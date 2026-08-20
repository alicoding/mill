package seeding

import (
	"encoding/json"
	"flag"
	"os"
	"sort"
	"strconv"
	"testing"
)

// seedFingerprintsPath is the committed record every golden's content
// is checked against (docs/goals/0037 item 7 -- authoring discipline,
// CI-enforced).
const seedFingerprintsPath = "seed_fingerprints.json"

// TestSeedFingerprints_MatchCommittedRecord fails the build when a
// golden's content changed without its SeedRevision being bumped --
// the exact "shipped content silently drifts with nothing to signal an
// existing install should reconsider it" gap docs/goals/0037 exists to
// close. Also fails on a brand-new golden with no committed entry yet
// (same fix: add it to seed_fingerprints.json). The failure message
// prints the complete up-to-date file content so fixing this is a
// straight copy-paste, not hand-computation.
// -update rewrites the committed record from the code's current state
// (the standard golden-file convention) -- `task regen` runs it so a
// deliberate seed change is one command, not a failed-commit round
// trip. The AUTHORING discipline is unchanged: the revision bump in
// the constructor is still yours to write; -update only records it.
var updateFingerprints = flag.Bool("update", false, "rewrite seed_fingerprints.json from the current code state")

func TestSeedFingerprints_MatchCommittedRecord(t *testing.T) {
	current := AllSeedFingerprints()

	if *updateFingerprints {
		data, err := json.MarshalIndent(current, "", "  ")
		if err != nil {
			t.Fatalf("marshal fingerprints: %v", err)
		}
		if err := os.WriteFile(seedFingerprintsPath, append(data, '\n'), 0o600); err != nil {
			t.Fatalf("write %s: %v", seedFingerprintsPath, err)
		}
		t.Logf("rewrote %s (%d goldens)", seedFingerprintsPath, len(current))
		return
	}

	raw, err := os.ReadFile(seedFingerprintsPath)
	if err != nil {
		t.Fatalf("read %s: %v (a fresh checkout should always have this committed file)", seedFingerprintsPath, err)
	}
	var committed map[string]SeedFingerprint
	if err := json.Unmarshal(raw, &committed); err != nil {
		t.Fatalf("parse %s: %v", seedFingerprintsPath, err)
	}

	var problems []string
	for id, cur := range current {
		com, ok := committed[id]
		switch {
		case !ok:
			problems = append(problems, id+": new golden, no committed fingerprint yet")
		case com.SeedRevision != cur.SeedRevision:
			problems = append(problems, id+": committed SeedRevision "+strconv.Itoa(com.SeedRevision)+" != code's "+strconv.Itoa(cur.SeedRevision))
		case com.Fingerprint != cur.Fingerprint:
			problems = append(problems, id+": content changed (fingerprint differs) but SeedRevision "+strconv.Itoa(cur.SeedRevision)+" was not bumped")
		}
	}
	for id := range committed {
		if _, ok := current[id]; !ok {
			problems = append(problems, id+": committed fingerprint has no matching golden anymore (removed?) -- delete its entry")
		}
	}

	if len(problems) == 0 {
		return
	}
	sort.Strings(problems)

	updated, err := json.MarshalIndent(current, "", "  ")
	if err != nil {
		t.Fatalf("marshal up-to-date fingerprints: %v", err)
	}

	msg := "seed_fingerprints.json is out of date with the actual golden content/revisions:\n"
	for _, p := range problems {
		msg += "  - " + p + "\n"
	}
	msg += "\nIf this is a DELIBERATE content change: bump that golden's SeedRevision in its BuiltIn()/" +
		"BuiltInWorkflows() constructor (docs/goals/0037 item 7's authoring discipline -- an unbumped " +
		"revision means reconcile silently upgrades an existing install's copy over top of it), then " +
		"replace " + seedFingerprintsPath + "'s content with:\n\n" + string(updated) + "\n"
	t.Fatal(msg)
}
