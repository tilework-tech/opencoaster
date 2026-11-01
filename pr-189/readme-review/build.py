"""Builds the README review page: an editable README with changed lines highlighted, plus the diff.

Usage: python3 -I build.py OLD_README NEW_README OUT_HTML
"""
import difflib, html, json, sys

old = open(sys.argv[1]).read().splitlines()
new = open(sys.argv[2]).read().splitlines()
sm = difflib.SequenceMatcher(a=old, b=new, autojunk=False)
changed = set()
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag != 'equal':
        changed.update(range(j1, j2))
diff = list(difflib.unified_diff(old, new, 'README.md (main)', 'README.md (this PR)', lineterm='', n=2))

lines = ''.join(
    f'<div class="ln{" add" if i in changed else ""}">{html.escape(t) or "<br>"}</div>' for i, t in enumerate(new)
)
diff_html = ''.join(
    f'<div class="{"d-add" if d.startswith("+") and not d.startswith("+++") else "d-del" if d.startswith("-") and not d.startswith("---") else "d-hunk" if d.startswith("@@") else ""}">{html.escape(d) or "&nbsp;"}</div>'
    for d in diff
)
page = open('template.html').read()
page = page.replace('{{LINES}}', lines).replace('{{DIFF}}', diff_html)
page = page.replace('{{STATS}}', f'{len(changed)} of {len(new)} lines new or changed')
page = page.replace('{{ORIGINAL}}', json.dumps('\n'.join(new)))
open(sys.argv[3], 'w').write(page)
