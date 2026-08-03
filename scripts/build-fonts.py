"""
Vendor and subset the two webfonts.

Run:  python scripts/build-fonts.py

WHY THIS EXISTS

The fonts used to load from fonts.googleapis.com through a render-blocking
<link> in index.html. Three reasons that was wrong for this app:

  1. Two extra DNS + TLS handshakes before a single word could paint, on
     restaurant wifi, for a guest whose whole visit is one page load. The
     service worker cached them, which helps the second visit — and a guest who
     scans a QR at a table only ever has a first.
  2. It sent every guest's IP to a third party before the page rendered, while
     /privacy tells them the app is first-party with no cross-visit identity.
     Whatever BiH law requires, the page should not claim one thing while the
     markup does another.
  3. A third-party outage took the typography with it.

WHY VARIABLE FONTS

Both families are kept variable, with the weight axis intact. Two files cover
every weight the UI uses instead of eight static ones — fewer requests, less
total weight, and adding a weight later costs nothing.

A NOTE ON THE SOURCE FILE, LEARNED THE HARD WAY

Do NOT subset Google's per-subset woff2 files. Google splits a face into
`latin` (U+0000-00FF) and `latin-ext` (U+0100 upward) as SEPARATE files. Taking
the latin-ext file and asking for Basic Latin yields a font with 31 glyphs — no
lowercase, no digits — which renders as a silent fallback everywhere and looks
almost right in a screenshot. Always subset from the full font.
"""
import io
import os
import urllib.request

from fontTools import subset as ft_subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'fonts')
CACHE = os.path.join(ROOT, 'node_modules', '.cache', 'fonts-src')

SOURCES = {
    'lora': 'https://github.com/google/fonts/raw/main/ofl/lora/Lora%5Bwght%5D.ttf',
    'inter': 'https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf',
}

# Google's latin-ext covers all of Central and Eastern Europe — Polish ogoneks,
# Romanian commas, Hungarian double acutes, Turkish dotless i. The menu is
# Bosnian, English and Arabic. Keep what is rendered, drop the rest.
#
# Arabic is deliberately absent: neither family has ever had Arabic glyphs, so
# the `ar` locale renders in the system Arabic font, exactly as before.
UNICODES = ','.join([
    'U+0020-007E',   # Basic Latin
    'U+00A0-00FF',   # Latin-1 Supplement
    'U+0106-0107',   # C c with acute
    'U+010C-010D',   # C c with caron
    'U+0110-0111',   # D d with stroke
    'U+0160-0161',   # S s with caron
    'U+017D-017E',   # Z z with caron
    'U+2010-2015',   # hyphens and dashes
    'U+2018-201A',   # curly single quotes
    'U+201C-201E',   # curly double quotes
    'U+2020-2022',   # dagger, bullet
    'U+2026',        # ellipsis
    'U+2030',        # per mille
    'U+2039-203A',   # guillemets
    'U+20AC',        # euro
    'U+2122',        # trademark
    'U+2190-2193',   # arrows used in staff copy
    'U+2212',        # minus sign
    'U+2713-2717',   # ticks and crosses
])

# Inter also carries an optical-size axis. Pin it and keep only weight; nothing
# in the UI varies optical size, and dropping the axis shrinks the file.
PIN_AXES = {'inter': {'opsz': 16}, 'lora': {}}

# Kept as a range so one file serves every weight. Inter's axis runs 100-900,
# but the UI only ever asks for 400 through 700, and clamping the range lets
# the instancer drop the deltas outside it.
WEIGHT_RANGE = {'lora': (400, 700), 'inter': (400, 700)}


def fetch(name, url):
    os.makedirs(CACHE, exist_ok=True)
    dst = os.path.join(CACHE, name + '.ttf')
    if os.path.exists(dst):
        return dst
    print('downloading ' + name + '...')
    req = urllib.request.Request(url, headers={'User-Agent': 'la-soul-build'})
    with urllib.request.urlopen(req, timeout=120) as r, open(dst, 'wb') as f:
        f.write(r.read())
    return dst


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.woff2'):
            os.remove(os.path.join(OUT, f))

    faces = []
    total_src = total_out = 0

    for name, url in SOURCES.items():
        src = fetch(name, url)
        dst = os.path.join(OUT, name + '.woff2')
        lo, hi = WEIGHT_RANGE[name]

        font = TTFont(src)

        # Pin the axes nothing varies, and clamp weight to the range the UI
        # asks for. `wght: (lo, hi)` keeps it an axis; a bare number would
        # freeze it and give us back a static font.
        limits = dict(PIN_AXES[name])
        limits['wght'] = (lo, hi)
        font = instancer.instantiateVariableFont(font, limits, updateFontNames=False)

        # Round-trip through a buffer before subsetting. The instancer leaves
        # some tables lazily bound to the original file, and the subsetter then
        # trips over a cmap entry whose glyph it cannot resolve (uni00A0 is the
        # one that shows up first). Saving and reopening materialises them.
        buf = io.BytesIO()
        font.save(buf)
        font.close()
        buf.seek(0)
        font = TTFont(buf)

        subsetter = ft_subset.Subsetter(options=ft_subset.Options(
            layout_features=['kern', 'liga', 'calt', 'tnum'],
            drop_tables=['DSIG'],
            notdef_outline=True,
        ))
        subsetter.populate(unicodes=ft_subset.parse_unicodes(UNICODES))
        subsetter.subset(font)

        font.flavor = 'woff2'
        font.save(dst)
        font.close()

        total_src += os.path.getsize(src)
        total_out += os.path.getsize(dst)
        print('%4d KB  %s.woff2' % (os.path.getsize(dst) // 1024, name))

        faces.append(
            "@font-face {\n"
            "  font-family: '" + name.capitalize() + "';\n"
            "  font-style: normal;\n"
            "  font-weight: " + str(lo) + " " + str(hi) + ";\n"
            "  font-display: swap;\n"
            "  src: url('/fonts/" + name + ".woff2') format('woff2');\n"
            "}"
        )

    header = (
        "/*\n"
        " * Self-hosted, subset webfonts. GENERATED — edit scripts/build-fonts.py.\n"
        " *\n"
        " * These used to come from fonts.googleapis.com via a render-blocking <link>,\n"
        " * which cost two extra handshakes before any text could paint and sent every\n"
        " * guest's IP to a third party while /privacy promised otherwise.\n"
        " *\n"
        " * Variable fonts with the weight axis kept, so these two files cover every\n"
        " * weight the UI uses. Subset to Latin plus the Bosnian diacritics and the\n"
        " * punctuation actually rendered. Arabic was never in either family and still\n"
        " * is not — the ar locale uses the system Arabic font, as before.\n"
        " *\n"
        " * " + str(total_src // 1024) + " KB of source font -> "
        + str(total_out // 1024) + " KB shipped.\n"
        " */\n"
    )

    path = os.path.join(ROOT, 'src', 'fonts.css')
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(header + '\n' + '\n\n'.join(faces) + '\n')

    print('\n%d KB source -> %d KB shipped' % (total_src // 1024, total_out // 1024))
    print('wrote src/fonts.css')


if __name__ == '__main__':
    main()
