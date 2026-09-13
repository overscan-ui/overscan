#!/bin/zsh
# The generators whose output ships in the package: src/, types/ and
# custom-elements.json. The kit repo runs this on its own; tools/regen.sh runs
# it first and then the site's pages. Stops if the manifest stage fails.
#
# ⚠️ NOT palette.py --css. src/tokens.css also carries the code-role tokens
# (--ov-code-*), and no tool writes those: tools/highlight.py checks them but
# the block itself is committed. Emitting tokens.css from palette.py alone
# deletes it, so tokens.css is not regenerated here until one tool writes the
# whole file.
#
# ⚠️ NOT gen_countries.mjs. It rebuilds src/ov-countries.js only from a pinned
# download it verifies by checksum, so it is run by hand, never in a regen.
cd "${0:A:h}/.." || exit 1
fail=0
run() { out=$(python3 "$@" 2>&1); rc=$?; if [ $rc -ne 0 ]; then echo "FAIL rc=$rc: $*"; echo "$out" | tail -15; fail=1; fi; }
run tools/api.py; [ $fail -ne 0 ] && exit 1
run tools/gen_wrappers.py; [ $fail -ne 0 ] && exit 1
run tools/gen_entry.py
run tools/gen_icons.py
run tools/gen_player_icons.py
run tools/gen_shaders.py
exit $fail
