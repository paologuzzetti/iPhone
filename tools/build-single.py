"""Crea una versione in un unico file HTML (three.js da CDN), comoda da condividere."""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist' / 'frecce3d.html'
html = (root / 'index.html').read_text()
css = (root / 'css/style.css').read_text()
logic = (root / 'js/logic.js').read_text()
main = (root / 'js/main.js').read_text()
main = re.sub(r"import \{[^}]*\} from './logic.js';\n", '', main)
main = main.replace("import * as THREE from 'three';", '')
main = re.sub(r"\nif \('serviceWorker'.*", '\n', main, flags=re.S)
logic = logic.replace('export ', '')
js = "import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';\n" + logic + '\n' + main
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
body = re.sub(r'<script type="module" src="js/main.js"></script>', '', body)
page = f"""<title>Frecce 3D</title>
<meta name="theme-color" content="#0f2b33">
<style>
:root {{ color-scheme: dark; }}
{css}
</style>
{body}
<script type="module">
{js}
</script>
"""
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(page)
print(out)
