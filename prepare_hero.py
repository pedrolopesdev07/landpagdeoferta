"""One-time capture: hero assets never follow subsequent feed updates."""
import urllib.request,json
from pathlib import Path
items=json.load(urllib.request.urlopen('http://127.0.0.1:8000/api/v1/offers',timeout=15))
targets=[('kit mobilador','60.98','Kit gamer completo'),('mesa de cabeceira','28.90','Um achadinho para sua casa'),('caixa de som','99.99','Som ligado. Preço lá embaixo.')]
folder=Path('dist/assets');folder.mkdir(exist_ok=True)
slides=[]
for i,(query,price,title) in enumerate(targets,1):
 match=next((o for o in items if query in o.get('product',{}).get('title','').lower() and o.get('price_snapshot')==price),None)
 if not match:raise SystemExit('Missing pinned product '+query)
 req=urllib.request.Request(match['product']['image_url'],headers={'User-Agent':'Mozilla/5.0'})
 with urllib.request.urlopen(req,timeout=20) as r:raw=r.read()
 ext='webp' if raw[:4]==b'RIFF' else 'png' if raw[:8]==b'\x89PNG\r\n\x1a\n' else 'jpg'
 name=f'hero-{i}.{ext}';(folder/name).write_bytes(raw)
 slides.append({'name':title,'alt':match['product']['title'],'image':'/assets/'+name,'old':match['original_price_snapshot'].replace('.',','),'price':match['price_snapshot'].replace('.',',')})
 print('Saved',name,len(raw))
Path('src/data/hero.json').write_text(json.dumps(slides,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Fixed selection saved. Run npm run build to update the page.')
