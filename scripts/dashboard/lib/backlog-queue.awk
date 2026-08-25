# Parses docs/goals/BACKLOG.md's queue lines into one JSON object per
# line on stdout (comma-joined by derive.sh, which wraps the array).
# A queue line is any line whose first token is immediately followed by
# " [ ]", " [x]", or " [~]" (BACKLOG.md's own checkbox convention, which
# accepts a bare "-" or a lane label like "0P4." as that leading token).
# Below-goal-granularity lines carry no [NNNN — Title](path) link -- the
# id/title/link fields come back null rather than guessed.

function jesc(s) {
  gsub(/\\/, "\\\\", s)
  gsub(/"/, "\\\"", s)
  return s
}

{
  if (match($0, /^[^ ]+ \[[ x~]\]/) == 0) next

  label = substr($0, 1, RSTART + RLENGTH - 1)
  checked = substr($0, RSTART + RLENGTH - 2, 1)
  sub(/ \[[ x~]\]$/, "", label)
  rest = substr($0, RSTART + RLENGTH)
  sub(/^ +/, "", rest)

  goal_id = ""; title = ""; link = ""
  if (substr(rest, 1, 1) == "[") {
    close_b = index(rest, "]")
    if (close_b > 0) {
      inner = substr(rest, 2, close_b - 2)
      after = substr(rest, close_b + 1)
      if (substr(after, 1, 1) == "(") {
        close_p = index(after, ")")
        if (close_p > 0) {
          link = substr(after, 2, close_p - 2)
          em = index(inner, " — ")
          if (em > 0) {
            # " — " is 5 BYTES here (awk is byte-, not char-, indexed;
            # the em dash is a 3-byte UTF-8 sequence) -- em+5 skips
            # past all of " — ", not just the ASCII part of it.
            goal_id = substr(inner, 1, em - 1)
            title = substr(inner, em + 5)
          } else {
            title = inner
          }
        }
      }
    }
  }

  status_phrase = ""
  b1 = index(rest, "**")
  if (b1 > 0) {
    tail = substr(rest, b1 + 2)
    b2 = index(tail, "**")
    if (b2 > 0) status_phrase = substr(tail, 1, b2 - 1)
  }

  id_json = (goal_id == "" ? "null" : "\"" jesc(goal_id) "\"")
  title_json = (title == "" ? "null" : "\"" jesc(title) "\"")
  link_json = (link == "" ? "null" : "\"" jesc(link) "\"")
  phrase_json = (status_phrase == "" ? "null" : "\"" jesc(status_phrase) "\"")

  printf "{\"label\":\"%s\",\"checked\":\"%s\",\"id\":%s,\"title\":%s,\"link\":%s,\"status_phrase\":%s}\n", \
    jesc(label), checked, id_json, title_json, link_json, phrase_json
}
