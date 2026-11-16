import copy, unittest
from datetime import datetime,timezone,timedelta
from unittest.mock import patch
from affiliate_feed import normalize,AffiliateFeed,safe_url

NOW=datetime(2026,11,16,tzinfo=timezone.utc)
OFFER={'id':'a','affiliate_url':'https://s.shopee.com.br/affiliate-code',
 'affiliate_generated_at':(NOW-timedelta(hours=1)).isoformat(),
 'price_snapshot':'49.90','original_price_snapshot':'100.00','discount_snapshot':50,
 'estimated_direct_commission':'12.50','generated_text':'private',
 'product':{'title':'Produto','image_url':'https://images.example/image.jpg','marketplace':'shopee'}}
SENT={'offer_id':'a','status':'sent','sent_at':NOW.isoformat(),'destination':'private group','text':'private'}

class FeedTests(unittest.TestCase):
 def test_only_confirmed_sends_and_deduplicated(self):
  pending=dict(SENT,status='pending');failed=dict(SENT,status='failed');processing=dict(SENT,status='processing')
  self.assertEqual(normalize([OFFER],[pending,failed,processing],NOW),[])
  rows=normalize([OFFER],[SENT,SENT],NOW)
  self.assertEqual(len(rows),1);self.assertEqual(rows[0]['url'],OFFER['affiliate_url'])
  self.assertEqual(rows[0]['price'],'49,90')
  self.assertEqual(rows[0]['group_name'],SENT['destination'])
  self.assertFalse({'estimated_direct_commission','generated_text','destination','text'}&rows[0].keys())
 def test_carries_only_authoritative_audience_metadata(self):
  rows=normalize([OFFER],[SENT],NOW,audience_by_id={'a':'feminino'})
  self.assertEqual(rows[0]['audience'],'feminino')
  self.assertEqual(normalize([OFFER],[SENT],NOW)[0]['audience'],'nao_identificado')
 def test_reads_backend_audiences_and_rejects_ignored_filters(self):
  feed=AffiliateFeed()
  all_offers=[{'id':key} for key in ['male','female','both','unknown']]
  def fetch(path):
   return [{'id':key} for key in (['male','both'] if path.endswith('true') else ['male'] if 'homem' in path else ['female'])]
  with patch.object(feed,'fetch',side_effect=fetch):
   self.assertEqual(feed.audiences(all_offers),{'male':'masculino','female':'feminino','both':'unissex','unknown':'nao_identificado'})
  with patch.object(feed,'fetch',return_value=all_offers):
   with self.assertRaises(ValueError):feed.audiences(all_offers)
 def test_expired_generation_is_not_republished(self):
  old=dict(OFFER,affiliate_generated_at=(NOW-timedelta(days=8)).isoformat())
  self.assertEqual(normalize([old],[SENT],NOW),[])
 def test_mercado_livre_window(self):
  offer=copy.deepcopy(OFFER);offer['product']['marketplace']='mercado_livre'
  offer['affiliate_generated_at']=(NOW-timedelta(hours=25)).isoformat()
  self.assertEqual(normalize([offer],[SENT],NOW),[])
 def test_no_link_and_unsafe_links(self):
  for link in ('','javascript:alert(1)','http://example.com','https://user:secret@example.com'):
   self.assertEqual(normalize([dict(OFFER,affiliate_url=link)],[SENT],NOW),[])
 def test_product_unavailable(self):
  offer=copy.deepcopy(OFFER);offer['product']['available']=False
  self.assertEqual(normalize([offer],[SENT],NOW),[])
 def test_unavailable_service_and_cache(self):
  feed=AffiliateFeed()
  with patch('affiliate_feed.api_base',return_value='http://127.0.0.1:8000/api/v1'),patch.object(feed,'fetch',side_effect=OSError('private error')):
   result=feed.read();self.assertEqual(result['status'],'unavailable');self.assertEqual(result['offers'],[])
   self.assertNotIn('private error',str(result))
 def test_disabled(self):
  with patch('affiliate_feed.api_base',return_value=''):
   self.assertFalse(AffiliateFeed().read()['enabled'])
 def test_thirty_newest_replace_the_oldest(self):
  offers=[];sent=[]
  for index in range(31):
   identity=str(index)
   offers.append(dict(OFFER,id=identity))
   sent.append(dict(SENT,offer_id=identity,sent_at=(NOW-timedelta(minutes=31-index)).isoformat()))
  before=normalize(offers[:30],sent[:30],NOW)
  after=normalize(offers,sent,NOW)
  self.assertEqual(len(before),30);self.assertEqual(len(after),30)
  self.assertEqual(after[0]['id'],'30')
  self.assertIn('0',{o['id'] for o in before});self.assertNotIn('0',{o['id'] for o in after})
  self.assertEqual([o['id'] for o in after],[str(i) for i in range(30,0,-1)])
  self.assertEqual(len(normalize(offers,sent,NOW,limit=None)),31)

if __name__=='__main__':unittest.main()
