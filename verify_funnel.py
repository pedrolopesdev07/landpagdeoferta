"""Integration check against a temporary database; leaves real content untouched."""
import base64, copy, http.cookiejar, io, json, os, tempfile, threading, unittest
from unittest.mock import patch
from PIL import Image
import urllib.request, urllib.error
from pathlib import Path
import server

class FunnelTest(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.original_root=server.ROOT
  cls.temp=tempfile.TemporaryDirectory();server.ROOT=Path(cls.temp.name)
  (server.ROOT/'data').mkdir();(server.ROOT/'dist').mkdir()
  with patch.dict(os.environ,{'ADMIN_PASSWORD':'temporary-funnel-test-password'}):server.initialize()
  cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
  threading.Thread(target=cls.http.serve_forever,daemon=True).start()
  cls.base=f'http://127.0.0.1:{cls.http.server_port}'
 @classmethod
 def tearDownClass(cls):cls.http.shutdown();cls.http.server_close();server.ROOT=cls.original_root;cls.temp.cleanup()
 def test_content_upload_and_reviews(self):
  client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
  csrf=json.load(client.open(self.base+'/api/session'))['csrf_token']
  def post(path,data):
   try:return client.open(urllib.request.Request(self.base+path,json.dumps(data).encode(),{'Content-Type':'application/json','X-CSRF-Token':csrf}))
   except urllib.error.HTTPError as error:error.close();raise
  initial=json.load(client.open(self.base+'/api/content'))
  with self.assertRaises(urllib.error.HTTPError) as error:post('/api/content',initial)
  self.assertEqual(error.exception.code,401)
  # Temporary credentials stay inside this disposable server instance.
  token='integration-test-session';server.sessions[token]=server.time.time()+60
  client.addheaders=[('Cookie','session='+token+'; csrf='+csrf)]
  with self.assertRaises(urllib.error.HTTPError):post('/api/upload',{'data':base64.b64encode(b'<script>bad</script>').decode()})
  encoded=io.BytesIO();Image.new('RGB',(2,2),'white').save(encoded,format='PNG');png=encoded.getvalue()
  uploaded=json.load(post('/api/upload',{'data':base64.b64encode(png).decode()}))
  processed=client.open(self.base+uploaded['url']).read()
  with Image.open(io.BytesIO(processed)) as image:self.assertEqual(image.format,'WEBP')
  data=copy.deepcopy(initial)
  data['offers']=[{'name':'Teste de oferta','old':'100,00','price':'50,00','discount':'50%','icon':'','image':uploaded['url']}]
  data['reviews']=[{'name':'Teste','comment':'Comentário apenas para teste.','rating':5}]
  data['groups']=[{'name':'Grupo teste','category':'Ofertas','description':'Teste','icon':'','color':'sage','url':'https://chat.whatsapp.com/test','photo_url':uploaded['url'],'member_count':95,'capacity':100}]
  self.assertEqual(post('/api/content',data).status,200)
  self.assertEqual(json.load(client.open(self.base+'/api/content')),data)
  invalid=copy.deepcopy(data);invalid['groups'][0]['member_count']=101
  with self.assertRaises(urllib.error.HTTPError):post('/api/content',invalid)
  data['reviews'][0]['rating']=8
  with self.assertRaises(urllib.error.HTTPError):post('/api/content',data)
  data['reviews'][0]['rating']=5;data['offers'][0]['image']='javascript:alert(1)'
  with self.assertRaises(urllib.error.HTTPError):post('/api/content',data)
  self.assertEqual(post('/api/logout',{}).status,200)
  with self.assertRaises(urllib.error.HTTPError):post('/api/upload',{'data':base64.b64encode(png).decode()})

 def test_video_byte_ranges(self):
  raw=bytes(range(256))*20
  video=server.ROOT/'dist'/'example.mp4';video.write_bytes(raw)
  req=urllib.request.Request(self.base+'/example.mp4',headers={'Range':'bytes=100-199'})
  with urllib.request.urlopen(req) as response:
   self.assertEqual(response.status,206)
   self.assertEqual(response.headers['Content-Type'],'video/mp4')
   self.assertEqual(response.headers['Accept-Ranges'],'bytes')
   self.assertEqual(response.headers['Content-Range'],f'bytes 100-199/{len(raw)}')
   self.assertEqual(response.read(),raw[100:200])
  suffix=urllib.request.Request(self.base+'/example.mp4',headers={'Range':'bytes=-40'})
  with urllib.request.urlopen(suffix) as response:self.assertEqual(response.read(),raw[-40:])
  invalid=urllib.request.Request(self.base+'/example.mp4',headers={'Range':'bytes=999999-'})
  with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(invalid)
  self.assertEqual(error.exception.code,416)
  error.exception.close()

if __name__=='__main__':unittest.main()
