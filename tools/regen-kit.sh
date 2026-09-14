#!/bin/zsh
# The generators whose output ships in the package: src/, types/ and
# custom-elements.json. The kit repo runs this on its own; tools/regen.sh runs
# it first and then the site's pages. Stops if the manifest stage fails.
#
# palette.py --css writes all of src/tokens.css, code roles included, and
# refuses to write it while its contrast gate fails.
#
# ⚠️ NOT gen_countries.mjs. It rebuilds src/ov-countries.js only from a pinned
# download it verifies by checksum, so it is run by hand, never in a regen.
cd "${0:A:h}/.." || exit 1
fail=0
run() { out=$(python3 "$@" 2>&1); rc=$?; if [ $rc -ne 0 ]; then echo "FAIL rc=$rc: $*"; echo "$out" | tail -15; fail=1; fi; }
run tools/palette.py --css; [ $fail -ne 0 ] && exit 1
run tools/api.py; [ $fail -ne 0 ] && exit 1
run tools/gen_wrappers.py; [ $fail -ne 0 ] && exit 1
run tools/gen_entry.py
run tools/gen_icons.py
run tools/gen_player_icons.py
run tools/gen_shaders.py
exit $fail
