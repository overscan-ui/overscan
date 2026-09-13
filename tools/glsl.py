#!/usr/bin/env python3
"""Compile every shader against a strict GLSL ES 1.00 compiler.

🔴 WHY THIS EXISTS. A fragment shader that does not compile does not raise: the
program fails to link, `ov-field` catches it with a bare guard, and the CSS
finish underneath still looks like a field. This project has already lost its
ENTIRE shader layer that way once, for as long as it took someone to notice
that every theme looked slightly wrong rather than broken. A browser is the
worst place to find out, because a browser is lenient.

⚠️ It found a real one on its first run: `field.glsl` used `active` as a
variable name, which is RESERVED in GLSL ES 1.00. Browsers compiled it anyway.
The kit's default field had never once been through a strict compiler.

🔴 IF THE COMPILER IS NOT INSTALLED THIS REPORTS THAT IT COULD NOT CHECK, AND
EXITS NON-ZERO. It does not print a pass. A gate that cannot run and says
nothing is worse than no gate, because it is a green light nobody earned.
    brew install glslang
"""
import pathlib
import shutil
import subprocess
import sys

# The loader prepends exactly this; a shader is never compiled without it.
PRELUDE = """#version 100
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
"""


def check():
    exe = shutil.which('glslangValidator')
    if not exe:
        print('glsl: CANNOT CHECK - glslangValidator is not installed.')
        print('      This is not a pass. Install it with:  brew install glslang')
        return 1

    shaders = sorted(pathlib.Path('src/shaders').glob('*.glsl'))
    if not shaders:
        print('glsl: CANNOT CHECK - no shaders found in src/shaders/.')
        return 1

    bad = 0
    tmp = pathlib.Path('/tmp/_ov_glsl.frag')
    for f in shaders:
        tmp.write_text(PRELUDE + f.read_text())
        r = subprocess.run([exe, '-S', 'frag', str(tmp)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            bad += 1
            print(f'  {f}')
            for line in (r.stdout + r.stderr).splitlines():
                # The compiler reports against the prelude-shifted file; put the
                # number back so it matches the file the author edits.
                if line.startswith('ERROR: 0:'):
                    n, _, rest = line[9:].partition(':')
                    if n.isdigit():
                        line = f'ERROR: {f.name}:{int(n) - PRELUDE.count(chr(10))}:{rest}'
                if line.strip():
                    print(f'    {line}')
    print(f'{len(shaders)} shaders, {bad} failed to compile')
    return 1 if bad else 0


def selftest():
    """Prove it can say no, or it is decoration."""
    exe = shutil.which('glslangValidator')
    if not exe:
        return True          # check() reports the real problem
    tmp = pathlib.Path('/tmp/_ov_glsl_self.frag')
    tmp.write_text(PRELUDE + 'void main(){ float active = 1.0; }\n')
    r = subprocess.run([exe, '-S', 'frag', str(tmp)], capture_output=True, text=True)
    if r.returncode == 0:
        print('glsl.py SELFTEST FAILED: a reserved word compiled clean')
        return False
    return True


if __name__ == '__main__':
    if not selftest():
        sys.exit(1)
    sys.exit(check())
