"""Check the served React build, font, persistent encoding and the live feed."""
import json
import re
from pathlib import Path
from urllib.request import urlopen

base = 'http://127.0.0.1:8765'
with urlopen(base, timeout=10) as response:
    page = response.read().decode('utf-8')
assert '<meta charset="UTF-8"' in page
assert 'lopesdapromoção' in page and 'lopesdapromo??o' not in page
assert 'id="root"' in page
assets = re.findall(r'(?:src|href)="(/ui/[^\"]+)"', page)
assert len(assets) >= 2
for asset in assets:
    with urlopen(base + asset, timeout=10) as response:
        raw = response.read()
        assert response.status == 200 and raw
        if asset.endswith('.js'):
            script = raw.decode('utf-8')
            assert 'próximo' in script and 'promoção' in script
            video_url = re.search(r'/ui/criativo-[^\"\s]+\.mp4', script).group(0)
        if asset.endswith('.css'):
            font = re.search(r'url\((?:"|\')?([^\)\"\']+\.woff2)', raw.decode('utf-8')).group(1)
            font_url = font if font.startswith('/') else '/ui/' + font
            with urlopen(base + font_url, timeout=10) as font_response:
                assert font_response.read(4) == b'wOF2'

with urlopen(base + '/api/content', timeout=10) as response:
    content = json.load(response)
assert content['settings']['name'] == 'lopesdapromoção'
assert 'próximo' in content['settings']['headline']
assert 'estão' in content['settings']['description']
with urlopen(base + '/api/offers', timeout=25) as response:
    feed = json.load(response)
assert len(feed['offers']) <= 30
with urlopen(base + '/api/catalog', timeout=25) as response:
    catalog = json.load(response)
assert len(catalog['offers']) >= len(feed['offers'])
from urllib.request import Request
with urlopen(Request(base + video_url, headers={'Range': 'bytes=0-1023'}), timeout=15) as response:
    assert response.status == 206 and response.headers['Content-Type'] == 'video/mp4'
    assert response.read() == Path('criativo-pedro-e-lucas-4k-legendado.mp4').read_bytes()[:1024]
with urlopen(base + '/admin', timeout=10) as response:
    assert response.status == 200
for number in range(1, 4):
    with urlopen(f'{base}/assets/hero-{number}.jpg', timeout=10) as response:
        assert response.status == 200
print('OK: served VSL, MP4 byte ranges, React build, local font, admin and live catalog', len(catalog['offers']))
