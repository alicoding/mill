# Parses docs/goals/DISPATCH.md into one JSON object on stdout:
# {"rows":[{"goal":...,"what":...,"state":...,"touch_set":...,"pr":...},
# ...],"queued":"..."} (goal 0210 S3). A row is any pipe-delimited table
# line whose first cell isn't the "goal" header label and isn't a
# "---"-style separator cell. "Queued next:" is matched by line prefix
# and passed through verbatim -- no further parsing of its content.

function jesc(s) {
  gsub(/\\/, "\\\\", s)
  gsub(/"/, "\\\"", s)
  return s
}

function trim(s) {
  gsub(/^[ \t]+|[ \t]+$/, "", s)
  return s
}

BEGIN { n = 0; queued = "" }

/^\|/ {
  line = $0
  sub(/^\|[ \t]*/, "", line)
  sub(/[ \t]*\|[ \t]*$/, "", line)
  ncol = split(line, cols, "|")
  for (i = 1; i <= ncol; i++) cols[i] = trim(cols[i])
  if (ncol < 5) next
  if (cols[1] == "goal") next
  if (cols[1] ~ /^-+$/) next
  rows[n] = sprintf("{\"goal\":\"%s\",\"what\":\"%s\",\"state\":\"%s\",\"touch_set\":\"%s\",\"pr\":\"%s\"}", \
    jesc(cols[1]), jesc(cols[2]), jesc(cols[3]), jesc(cols[4]), jesc(cols[5]))
  n++
  next
}

/^Queued next:/ {
  q = $0
  sub(/^Queued next:[ \t]*/, "", q)
  queued = q
}

END {
  printf "{\"rows\":["
  for (i = 0; i < n; i++) {
    if (i > 0) printf ","
    printf "%s", rows[i]
  }
  printf "],\"queued\":\"%s\"}", jesc(queued)
}
