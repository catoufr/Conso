"""Assemble index.html (appli publique, sans aucune donnée personnelle) à partir de src/."""
import re, time
t = open('src/template.html', encoding='utf-8').read()
t = re.sub(r'<title>.*?</title>\s*', '', t, count=1)
t = re.sub(r'<meta name="claude:viewport-fit-sides"[^>]*>\s*', '', t, count=1)
t = t.replace('/*SEED*/null', 'null').replace('/*CORE*/', open('src/core.js', encoding='utf-8').read()).replace('/*APP*/', open('src/app.js', encoding='utf-8').read())
ver = str(int(time.time()))
head = '''<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#17808f">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Conso">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<title>Ma conso électrique</title>
'''
tail = '''
<script>
if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); }); }
</script>
</head>
</html>'''
# le contenu du gabarit (style + corps) va dans <head>/<body> : on ouvre le body après le dernier </style>
i = t.index('</style>') + len('</style>')
html = head + t[:i] + '\n</head>\n<body>' + t[i:] + '\n<script>\nif ("serviceWorker" in navigator) { window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); }); }\n</script>\n</body>\n</html>\n'
open('index.html', 'w', encoding='utf-8').write(html)
sw = open('sw.template.js', encoding='utf-8').read().replace('__VERSION__', ver)
open('sw.js', 'w', encoding='utf-8').write(sw)
print('ok', len(html), 'octets, cache', ver)
