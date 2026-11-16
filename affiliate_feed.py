"""Read-only adapter for OfertaBot's existing authenticated HTTP APIs."""
import json, logging, os, threading, time
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit
from urllib.request import Request, urlopen, HTTPRedirectHandler, build_opener
from pathlib import Path
from security import affiliate_url, safe_url

def api_base():
    if 'AFILIADO_API_URL' in os.environ:return os.environ['AFILIADO_API_URL'].rstrip('/')
    try:return json.loads((Path(__file__).parent/'integration.json').read_text(encoding='utf-8')).get('api_url','').rstrip('/')
    except (OSError,ValueError):return ''

def date(value):
    try:
        stamp=datetime.fromisoformat(value.replace('Z','+00:00'))
        return stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp
    except (ValueError,AttributeError,TypeError):return None

def money(value):
    try:
        amount=Decimal(str(value))
        if not amount.is_finite() or amount<0:return ''
        return f'{amount:.2f}'.replace('.',',')
    except (InvalidOperation,ValueError):return ''

def normalize(offers,publications,now=None,limit=30,audience_by_id=None):
    now=now or datetime.now(timezone.utc)
    by_id={str(o.get('id')):o for o in offers if isinstance(o,dict)}
    sent=sorted((p for p in publications if isinstance(p,dict) and p.get('status')=='sent' and date(p.get('sent_at'))),key=lambda p:date(p['sent_at']),reverse=True)
    result=[];seen=set()
    for p in sent:
        identity=str(p.get('offer_id'));offer=by_id.get(identity)
        if not offer or identity in seen:continue
        product=offer.get('product') or {};link=affiliate_url(offer.get('affiliate_url'))
        if not link or product.get('available') is False:continue
        published=date(p['sent_at'])
        # Use explicit generation time when exposed. Otherwise cap by send time.
        generated=date(offer.get('affiliate_generated_at')) or published
        days={'shopee':7,'mercado_livre':1}.get(product.get('marketplace'),1)
        expires=min(generated+timedelta(days=days),published+timedelta(days=days))
        if expires<=now or published>now or not product.get('title'):continue
        discount=offer.get('discount_snapshot')
        result.append({'id':identity,'name':str(product['title'])[:500],
          'price':money(offer.get('price_snapshot')),'old':money(offer.get('original_price_snapshot')),
          'discount':f'{discount}%' if isinstance(discount,(int,float)) and 0<discount<100 else '',
          'image':safe_url(product.get('image_url')),'url':link,'icon':'🛍️',
          'category':str(product.get('category') or 'Achadinhos')[:100],
          'audience':(audience_by_id or {}).get(identity,'nao_identificado'),
          'marketplace':str(product.get('marketplace') or '')[:50],
          'group_name':str(p.get('destination') or '')[:200],
          'published_at':published.isoformat(),'expires_at':expires.isoformat(),'source':'afiliado_bot'})
        seen.add(identity)
        if limit is not None and len(result)>=limit:break
    return result

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ValueError('Upstream redirect refused')

class AffiliateFeed:
    def __init__(self):self.lock=threading.Lock();self.cache=None;self.checked=0;self.updated=None
    def fetch(self,path):
        base=api_base()
        parsed=urlsplit(base)
        if not (parsed.scheme=='https' or (parsed.scheme=='http' and parsed.hostname in ('localhost','127.0.0.1','::1'))):raise ValueError('Use HTTPS or local loopback')
        headers={'Accept':'application/json'}
        token=os.environ.get('AFILIADO_ACCESS_TOKEN','')
        if token:headers['Cookie']='access_token='+token
        with build_opener(NoRedirect).open(Request(base+path,headers=headers),timeout=8) as response:
            raw=response.read(12_000_001)
            if len(raw)>12_000_000:raise ValueError('Response exceeds limit')
            data=json.loads(raw)
            if not isinstance(data,list):raise ValueError('Expected list')
            return data
    def audiences(self,offers):
        # Use OfertaBot's classifier (including its private product descriptions).
        # Strict male/female sets must not overlap: old APIs ignore unknown filters.
        ids=lambda rows:{str(o['id']) for o in rows if isinstance(o,dict) and o.get('id') is not None}
        male=ids(self.fetch('/offers?publico=homem&incluir_unissex=false'))
        female=ids(self.fetch('/offers?publico=mulher&incluir_unissex=false'))
        male_with_unisex=ids(self.fetch('/offers?publico=homem&incluir_unissex=true'))
        if male & female or not male <= male_with_unisex or female & male_with_unisex:
            raise ValueError('Upstream audience filters are not active or inconsistent')
        unisex=male_with_unisex-male
        return {str(o['id']):('masculino' if str(o['id']) in male else 'feminino' if str(o['id']) in female else 'unissex' if str(o['id']) in unisex else 'nao_identificado') for o in offers}
    def read(self,catalog=False):
        if not api_base():return {'enabled':False,'status':'disabled','offers':[]}
        with self.lock:
            now=time.time()
            if now-self.checked>=60:
                self.checked=now
                try:
                    offers=self.fetch('/offers')
                    audiences=self.audiences(offers)
                    self.cache=normalize(offers,self.fetch('/whatsapp/queue'),limit=None,audience_by_id=audiences)
                    self.updated=time.time()
                except Exception as error:
                    # Only the exception class is logged. URLs, credentials and response bodies remain private.
                    logging.getLogger('landing.security').warning('upstream_refresh_failed type=%s',type(error).__name__)
            fresh=self.updated is not None and time.time()-self.updated<300
            offers=[o for o in (self.cache or []) if date(o['expires_at'])>datetime.now(timezone.utc)] if fresh else []
            if not catalog:offers=offers[:30]
            return {'enabled':True,'status':'connected' if fresh and self.updated>=self.checked else 'cached' if fresh else 'unavailable',
              'offers':offers,'updated_at':datetime.fromtimestamp(self.updated,timezone.utc).isoformat() if self.updated else None}

feed=AffiliateFeed()
