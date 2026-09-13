#!/bin/sh
# Every list-4 element and every one of its mutants, in one command.
#
#   sh tools/list4-gates.sh          # needs tools/static_server.py running on :8842
#
# The element must read GATE: PASS. Every mutant must read GATE: FAIL, because
# a mutant is a copy of the element with one refusal broken on purpose: if the
# gate stays green against it, the gate is not testing that refusal.
#
# 🔴 A PAGE THAT SAYS NOTHING IS A FAILURE, NOT A BLANK. The first version of
# this script printed "?" for a page with no GATE line and carried on, which
# meant a harness that threw before it reached its report, or a URL that 404ed,
# read as neither pass nor fail and scrolled past. It was worse than that: the
# whole script pointed at a path that no longer existed, so for a while it ran
# nothing at all and looked calm doing it. A runner that cannot tell "the page
# said nothing" from "the page passed" is the same fault as a gate that cannot
# go red, and silent green is the dangerous direction. Exit status is the point
# of this file.
#
# 🔴 AND THE PARSER IS PROVED, NOT THE PIPELINE. selftest() below runs the same
# parser this script uses against ten sample outputs, including other spellings
# used elsewhere in this tree and the three ways a page can say nothing at all,
# and refuses to run anything if it cannot tell them apart. The parser
# is the piece most likely to be silently wrong, because it is the piece nobody
# watches fail. (The idea is the npm/cli session's, after its own runner
# counted twenty-two healthy pages as failures for reporting "13 of 13 pass".)
#
# ⚠️ THIS RUNNER ACCEPTS ONE SPELLING ON PURPOSE. The kit's 43 harness pages
# report their result in FIVE different ways, found by the npm/cli session by
# opening them in a real browser after its runner called seven of them dead:
#
#   1. GATE: PASS / GATE: FAIL                       (these five, and others)
#   2. "13 of 13 pass"
#   3. "34 passed, 2 failed, 5/5 controls failed as required"
#   4. {"total": 18, "passed": 18, "failed": [], "controlDidFail": true}
#      (chart, flap, flip, gl, redraw, reticle)
#   5. "8/8 passed, control failed as it must"        (reveal)
#
# All five of these harnesses use spelling 1, so this runner requires it and
# treats anything else as no verdict at all. That is deliberate: teaching it
# spellings it will never meet would add code paths nothing here exercises, and
# if one of these five ever STOPS printing a GATE line, that is a change worth
# failing over rather than absorbing. Widen it and you must widen selftest()
# with it, and the method that found those spellings is the transferable part:
# when a runner says a page is silent, open the page before believing it.
#
# ⚠️ THE BUDGET IS PER PAGE, and 8s suits these five. Other harnesses need
# their own: at a 5s budget map-test and radar-test print no result line at all
# and chart-test and gl-test report zero passes, which are budget artifacts
# rather than regressions. If this runner is ever widened past the five, give
# each page a budget rather than loosening the rule above.
set -u

CHROME=${OV_CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
BASE=${OV_BASE:-http://127.0.0.1:8842/tools}
BUDGET=8000
fails=0

# Reads a dumped DOM on stdin, prints "<PASS|FAIL|NONE>|<summary line>".
# NONE covers every way a page can decline to give a verdict: no output block,
# an empty one, a harness still saying "running...", and a page that reports
# some other way. None of those is a pass.
PARSER='
import sys, re, html
d = sys.stdin.read()
# ATTRIBUTE-TOLERANT ON PURPOSE. This matched <pre id="out"> verbatim and so
# read every harness whose block carries another attribute as SILENT, about
# thirty of them, all healthy. Now that no verdict is a failure, a parser
# reporting silence where there is none turns healthy pages red: the same
# fault the npm/cli session found in its own runner, in mine.
m = re.search(r"<pre[^>]*\bid=\"out\"[^>]*>(.*?)</pre>", d, re.S)
if not m:
    print("NONE|no <pre id=\"out\"> on the page at all")
    raise SystemExit
lines = [l for l in html.unescape(m.group(1)).split(chr(10)) if l.strip()]
last = lines[-1] if lines else ""
word = "PASS" if last.endswith("GATE: PASS") else "FAIL" if last.endswith("GATE: FAIL") else "NONE"
summary = lines[-2] if word != "NONE" and len(lines) > 1 else (last or "(nothing in the output block)")
print(f"{word}|{summary}")
'

parse() { python3 -c "$PARSER"; }

# ── prove the parser before trusting a single page ─────────────────────────
selftest() {
  bad=0
  # sample text                                  | expected verdict
  set -- \
    "38 passed, 0 failed${nl}GATE: PASS|PASS" \
    "36 passed, 2 failed${nl}GATE: FAIL|FAIL" \
    "13 of 13 pass|NONE" \
    "11 of 13 pass|NONE" \
    "34 passed, 2 failed|NONE" \
    "36 passed, 0 failed|NONE" \
    "running...|NONE" \
    "|NONE"
  for case in "$@"; do
    body=${case%|*}
    want=${case##*|}
    got=$(printf '<pre id="out">%s</pre>' "$body" | parse)
    got=${got%%|*}
    if [ "$got" != "$want" ]; then
      printf 'selftest: %s -> %s, wanted %s\n' "$(printf '%s' "$body" | head -1)" "$got" "$want"
      bad=$((bad + 1))
    fi
  done
  # A page with no output block at all is the ninth case, and the commonest:
  # it is what a 404 looks like.
  got=$(printf '<html>404</html>' | parse); got=${got%%|*}
  [ "$got" = NONE ] || { printf 'selftest: a page with no output block -> %s, wanted NONE\n' "$got"; bad=$((bad + 1)); }
  # The tenth case, and the one that bit: a block with another attribute on it
  # is still an output block.
  got=$(printf '<pre id="out" class="report">ok\nGATE: PASS</pre>' | parse); got=${got%%|*}
  [ "$got" = PASS ] || { printf 'selftest: a block with another attribute -> %s, wanted PASS\n' "$got"; bad=$((bad + 1)); }
  if [ "$bad" -ne 0 ]; then
    printf '\nlist4-gates: THE PARSER IS WRONG, so no result it produced could be trusted.\n'
    exit 2
  fi
}

verdict() {
  "$CHROME" --headless=new --virtual-time-budget=$BUDGET --dump-dom "$1" 2>/dev/null | parse
}

check() {                                  # check <want> <label> <url>
  want=$1; label=$2; url=$3
  out=$(verdict "$url")
  got=${out%%|*}
  summary=${out#*|}
  if [ "$got" = "$want" ]; then
    printf '  ok   %-22s %s\n' "$label" "$summary"
  else
    fails=$((fails + 1))
    printf '  FAIL %-22s wanted GATE: %s, got %s\n       %s\n' "$label" "$want" "$got" "$summary"
    [ "$got" = NONE ] && printf '       a page that reports nothing has not passed: check the URL and the console\n'
  fi
}

nl='
'
selftest
printf 'parser ok (10 cases)\n\n'

for n in quorum station mosaic balance position clearance score switch avatar vitals ecg player geomap tactical; do
  printf '%s\n' "$n"
  check PASS "$n" "$BASE/$n-test/"
  for f in tools/"$n"-test/mut/*.js; do
    [ -e "$f" ] || { printf '  FAIL %-22s no mutants on disk; run mut/make.py\n' "$n"; fails=$((fails + 1)); break; }
    m=$(basename "$f" .js)
    check FAIL "$m" "$BASE/$n-test/?src=mut/$m.js"
  done
done

# The shared option, which belongs to no single element. It has no mutants
# because its subject is a CSS rule and a set of class marks rather than a
# refusal in one module, so mut/make.py has nothing to copy. Its eight controls
# carry the same guarantee: each one asserts something bare must NOT be allowed
# to do, and each must fail. It was also proved red by hand, twice - once by
# deleting the rule from chrome.css, once by marking a refusal as prose.
printf 'chrome="bare"\n'
check PASS "bare" "$BASE/bare-test/"

printf '\n'
if [ "$fails" -eq 0 ]; then
  printf 'ALL GATES AS EXPECTED: 14 elements and the bare option pass, every mutant turns them red\n'
else
  printf '%s CHECK(S) NOT AS EXPECTED\n' "$fails"
fi
exit $((fails > 0))
