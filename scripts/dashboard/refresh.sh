#!/usr/bin/env bash
# One command = the whole regenerate (goal 0210 S1): derive.sh writes
# dashboard-data.json from repo truth, then render.sh turns that plus
# template.html into mill-control-room.html. Prints the rendered file's
# path so a caller can pipe it straight into a copy/paste or a diff.
set -euo pipefail

dashboard_dir="$(cd "$(dirname "$0")" && pwd)"

data_file="$("$dashboard_dir/derive.sh")"
"$dashboard_dir/render.sh" "$data_file"
