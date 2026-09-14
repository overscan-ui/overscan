#!/bin/zsh
# Install the PACKED TARBALL into a scratch project and use it as a consumer
# would. This is the only check that can catch a broken `exports` map, a file
# missing from `files`, or types that do not compile once packaged: nothing
# run inside the repo touches any of that.
#
# Needs tools/static_server.py already running on :8842 (the scratch project lives at
# tmp/consumer/, inside the repo, so the running server serves it).
#
# Prove it can fail:
#   - break an exports key           -> resolve.mjs turns red
#   - drop "src/" from `files`       -> the install has no elements
#   - break a refusal in an element  -> the browser page turns red
#   - build the shader URL at runtime in ov-gl.js again
#                                    -> vite build and dev pages turn red,
#                                       the no-build control stays green
set -e
cd "$(dirname "$0")/.."

echo '=== pack ==='
TGZ=$(npm pack --silent | tail -1)
echo "packed $TGZ"

echo '=== install into tmp/consumer ==='
rm -rf tmp/consumer
mkdir -p tmp/consumer
cp tools/consumer/package.json tools/consumer/resolve.mjs tools/consumer/index.html \
   tools/consumer/script-tag.html tmp/consumer/
mv "$TGZ" tmp/consumer/
(cd tmp/consumer && npm install --silent --no-audit --no-fund "./$TGZ")

echo '=== node resolves every advertised specifier ==='
(cd tmp/consumer && node resolve.mjs)

echo '=== types compile against the PACKAGED .d.ts ==='
node_modules/.bin/tsc --noEmit --lib es2022,dom --strict tmp/consumer/node_modules/overscan/types/overscan.d.ts
echo 'OK  packaged types compile'

# OVERSCAN_CHROME names the browser binary (CI sets it); the default is macOS's.
CHROME="${OVERSCAN_CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "REFUSED: no Chrome at $CHROME (set OVERSCAN_CHROME)"; exit 1; }
export OVERSCAN_CHROME="$CHROME"
# The server that serves this checkout. Same variable as tools/release.py, so
# a copy of the repo elsewhere can be tested without touching :8842.
BASE_URL="${OVERSCAN_URL:-http://localhost:8842/}"

# One headless page, one verdict. "running..." left in the output block, or no
# block at all, is a failure: a page that never finished did not pass.
browser_page() {
  local page="$1" what="$2"
  local out
  out=$("$CHROME" --headless=new --disable-gpu --virtual-time-budget=8000 \
    --dump-dom "${BASE_URL}tmp/consumer/$page" 2>/dev/null | python3 -c "
import sys, re, html
d = re.sub(r'<script\b.*?</script>', '', sys.stdin.read(), flags=re.S)
m = re.search(r'<pre id=\"out\"[^>]*>(.*?)</pre>', d, re.S)
print(html.unescape(m.group(1)) if m else 'NO OUTPUT: the page did not run')
")
  echo "$out"
  if ! echo "$out" | grep -q 'GATE: PASS'; then
    echo "REFUSED: $what"
    exit 1
  fi
}

echo '=== a no-build browser consumer, through an import map ==='
browser_page '' 'the packaged kit does not work in a plain browser page'

# ⭐ The home page's second install route, exactly as written there: one link,
# one module script, no import map. The import-map page above CANNOT catch a
# bare specifier creeping into src/, because its map would resolve it.
echo
echo '=== one script tag, no import map (the home page install route) ==='
browser_page 'script-tag.html' 'one script tag no longer loads the kit: a bare specifier in src/?'

# ⭐ A BUNDLED APP. Every page above has no build step, and the kit can work
# there while failing in every Vite or webpack app. Measured 2026-09-12 against
# the packed tarball: every shader 404'd in both `vite build` and `vite dev`
# (the elements said `missing` and the console said nothing), and importing ONE
# React component registered all 79 elements. Neither was visible from here.
#
# vite, react and react-dom resolve from the repo's devDependencies, because
# tmp/ is inside the repo; only the tarball is installed into the fixture.
# 🔴 Checked in a REAL renderer (tools/consumer/pages.cjs), not --dump-dom:
# virtual time cannot see whether ov-gl's pool lent a canvas.
echo
echo '=== a bundled app: vite build, preview and dev, in a real renderer ==='
rm -rf tmp/consumer-vite
mkdir -p tmp/consumer-vite
cp tools/consumer/vite/*(.) tmp/consumer-vite/
(cd tmp/consumer-vite && npm install --silent --no-audit --no-fund "../consumer/$TGZ")
VITE="$PWD/node_modules/.bin/vite"
VFAIL=0
vpids=()
trap 'for p in $vpids; do kill $p 2>/dev/null; done' EXIT

"$VITE" build tmp/consumer-vite --logLevel warn || VFAIL=$((VFAIL+1))

# What ONE wrapper component costs net of React itself: the scripts react.html
# loads minus the scripts reactonly.html loads, gzip -9. Shared chunks count on
# both sides and cancel.
python3 - tmp/consumer-vite/dist <<'PY' || VFAIL=$((VFAIL+1))
import gzip, pathlib, re, sys
d = pathlib.Path(sys.argv[1])
def cost(page):
    files = set(re.findall(r'(?:src|href)="/?(assets/[^"]+\.js)"', (d / page).read_text()))
    if not files:
        print(f'FAIL  {page} references no scripts: the measure is broken'); sys.exit(1)
    return sum(len(gzip.compress((d / f).read_bytes(), 9, mtime=0)) for f in files)
BUDGET = 20000
full, base = cost('react.html'), cost('reactonly.html')
delta = full - base
print(f'{"PASS" if delta <= BUDGET else "FAIL"}  one React component costs {delta} B gzip '
      f'over React alone ({full} - {base}), budget {BUDGET}')
sys.exit(0 if delta <= BUDGET else 1)
PY

"$VITE" preview tmp/consumer-vite --port 4173 --strictPort --host 127.0.0.1 >/dev/null 2>&1 & vpids+=$!
"$VITE" tmp/consumer-vite --port 5173 --strictPort --host 127.0.0.1 >/dev/null 2>&1 & vpids+=$!
for u in http://127.0.0.1:4173/field.html http://127.0.0.1:5173/field.html; do
  for i in {1..60}; do curl -sf -o /dev/null "$u" && break; sleep 0.5; done
done

node tools/consumer/pages.cjs \
  "${BASE_URL}tmp/consumer-vite/control.html" \
  http://127.0.0.1:4173/field.html http://127.0.0.1:4173/react.html \
  http://127.0.0.1:5173/field.html http://127.0.0.1:5173/react.html \
  || VFAIL=$((VFAIL+$?))

if [ $VFAIL -ne 0 ]; then
  echo "REFUSED: $VFAIL bundled-app check(s) failed: the kit does not work in a Vite app"
  exit 1
fi
echo 'OK  a bundled app: shaders load and link in vite build and dev, and one'
echo '    React component costs its own element, not the kit.'

echo
echo 'OK  the tarball works for a consumer: specifiers resolve, types compile,'
echo '    elements upgrade, paint and still refuse, through an import map AND'
echo '    through one script tag with no map at all.'
