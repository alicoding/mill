# Parses one docs/goals/*.md file's YAML frontmatter plus its first H1
# into a single-line JSON object on stdout. Invoked once per file by
# derive.sh with -v path=<repo-relative path> -v archived=0|1 -v
# fallback_id=<NNNN parsed from the filename>.
#
# Frontmatter is optional (older goal files predate it) -- a file whose
# first line isn't "---" is treated as body-only and only its title is
# read. prs/proof/spec_refs appear in three committed forms, all
# folded to a proper JSON array here rather than copied through
# assuming JSON syntax (some are NOT valid JSON as written): inline
# quoted ("prs: [428]", "proof: [\"a.spec.ts\", \"b.spec.ts\"]"),
# inline bare-word (unquoted list items, e.g. one goal's file-path
# list), and YAML block-list (key on its own line, items on
# "  - "-prefixed lines below it). A quoted item may itself contain a
# comma (seen inside a parenthesized aside), so splitting an inline
# list happens char-by-char tracking quote state, never a bare
# split(...) on ",".

function jesc(s) {
  gsub(/\\/, "\\\\", s)
  gsub(/"/, "\\\"", s)
  return s
}

function json_scalar(item,    trimmed) {
  trimmed = item
  gsub(/^[ \t]+/, "", trimmed)
  gsub(/[ \t]+$/, "", trimmed)
  if (substr(trimmed, 1, 1) == "\"" && substr(trimmed, length(trimmed), 1) == "\"") {
    trimmed = substr(trimmed, 2, length(trimmed) - 2)
    return "\"" jesc(trimmed) "\""
  }
  if (trimmed ~ /^-?[0-9]+(\.[0-9]+)?$/) return trimmed
  return "\"" jesc(trimmed) "\""
}

# Splits str on commas OUTSIDE double-quoted spans (a quoted item may
# itself contain a literal comma) into arr[1..n], returns n.
function split_top_level(str, arr,    n, i, c, cur, in_q) {
  n = 0
  cur = ""
  in_q = 0
  for (i = 1; i <= length(str); i++) {
    c = substr(str, i, 1)
    if (c == "\"") { in_q = !in_q; cur = cur c; continue }
    if (c == "," && !in_q) { n++; arr[n] = cur; cur = ""; continue }
    cur = cur c
  }
  if (cur != "" || n > 0) { n++; arr[n] = cur }
  return n
}

function to_json_array(raw,    inner, n, parts, i, result, item) {
  inner = raw
  sub(/^\[/, "", inner)
  sub(/\]$/, "", inner)
  gsub(/^[ \t]+/, "", inner)
  gsub(/[ \t]+$/, "", inner)
  if (inner == "") return "[]"
  n = split_top_level(inner, parts)
  result = ""
  for (i = 1; i <= n; i++) {
    item = json_scalar(parts[i])
    result = (result == "" ? item : result "," item)
  }
  return "[" result "]"
}

function flush_collecting() {
  if (collecting_key == "prs") prs = "[" prs_items "]"
  else if (collecting_key == "proof") proof = "[" proof_items "]"
  else if (collecting_key == "spec_refs") spec_refs = "[" specrefs_items "]"
  collecting_key = ""
}

BEGIN {
  in_fm = 0; fm_done = 0; got_title = 0
  id = ""; status = ""; date = ""; defect_class = ""
  prs = "[]"; proof = "[]"; spec_refs = "[]"; title = ""
  collecting_key = ""; prs_items = ""; proof_items = ""; specrefs_items = ""
}

NR == 1 && $0 == "---" { in_fm = 1; next }
NR == 1 && $0 != "---" { fm_done = 1 }

in_fm {
  if ($0 == "---") { flush_collecting(); in_fm = 0; fm_done = 1; next }

  if (collecting_key != "") {
    if ($0 ~ /^  - /) {
      item = $0
      sub(/^  - /, "", item)
      json_item = json_scalar(item)
      if (collecting_key == "prs") {
        prs_items = (prs_items == "" ? json_item : prs_items "," json_item)
      } else if (collecting_key == "proof") {
        proof_items = (proof_items == "" ? json_item : proof_items "," json_item)
      } else {
        specrefs_items = (specrefs_items == "" ? json_item : specrefs_items "," json_item)
      }
      next
    }
    flush_collecting()
  }

  line = $0
  if (index(line, "id:") == 1) {
    sub(/^id: */, "", line); gsub(/"/, "", line); id = line
  } else if (index(line, "status:") == 1) {
    sub(/^status: */, "", line); status = line
  } else if (index(line, "date:") == 1) {
    sub(/^date: */, "", line); gsub(/"/, "", line); date = line
  } else if (index(line, "defect_class:") == 1) {
    sub(/^defect_class: */, "", line); defect_class = line
  } else if (index(line, "prs:") == 1) {
    sub(/^prs: */, "", line)
    if (line == "") { collecting_key = "prs"; prs_items = "" } else { prs = to_json_array(line) }
  } else if (index(line, "proof:") == 1) {
    sub(/^proof: */, "", line)
    if (line == "") { collecting_key = "proof"; proof_items = "" } else { proof = to_json_array(line) }
  } else if (index(line, "spec_refs:") == 1) {
    sub(/^spec_refs: */, "", line)
    if (line == "") { collecting_key = "spec_refs"; specrefs_items = "" } else { spec_refs = to_json_array(line) }
  }
  next
}

fm_done && !got_title && index($0, "# ") == 1 {
  t = $0
  sub(/^# */, "", t)
  title = t
  got_title = 1
  next
}

END {
  if (id == "") { id = fallback_id }
  status_json = (status == "" ? "null" : "\"" jesc(status) "\"")
  date_json = (date == "" ? "null" : "\"" jesc(date) "\"")
  defect_json = (defect_class == "" ? "null" : "\"" jesc(defect_class) "\"")
  printf "{\"id\":\"%s\",\"status\":%s,\"date\":%s,\"defect_class\":%s,\"title\":\"%s\",\"path\":\"%s\",\"archived\":%s,\"prs\":%s,\"proof\":%s,\"spec_refs\":%s}", \
    jesc(id), status_json, date_json, defect_json, jesc(title), jesc(path), \
    (archived == "1" ? "true" : "false"), prs, proof, spec_refs
}
