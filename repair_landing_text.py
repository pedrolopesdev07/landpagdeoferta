"""Repair known text corrupted by the Windows stdin code page; no affiliate DB access."""
import json
import sqlite3

with sqlite3.connect('data/content.sqlite3') as connection:
    row = connection.execute("SELECT value FROM config WHERE key='content'").fetchone()
    if row:
        content = json.loads(row[0])
        settings = content['settings']
        fixes = {
            'name': ('lopesdapromo??o', 'lopesdapromoção'),
            'headline': ('O pr?ximo achado est? logo abaixo.', 'O próximo achado está logo abaixo.'),
            'description': (
                'Arraste a tela e veja as ofertas que est?o rolando no grupo agora. Gostou de alguma? O link est? a um toque.',
                'Arraste a tela e veja as ofertas que estão rolando no grupo agora. Gostou de alguma? O link está a um toque.',
            ),
        }
        for key, (broken, correct) in fixes.items():
            if settings.get(key) == broken:
                settings[key] = correct
        connection.execute("UPDATE config SET value=? WHERE key='content'", (json.dumps(content, ensure_ascii=False),))
        print('Repaired known landing text; groups, offers and reviews preserved.')
