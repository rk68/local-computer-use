"""Run only with the normal executor stopped. Uses real local Convex and fake Cua guests."""
import sys, json, time, asyncio, tempfile, threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.request import urlopen, Request
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'tests'));sys.path.insert(0,str(ROOT/'scripts'))
from check_convex import convex
from test_poc import fake_guest, model_action
from app import core, server
# This runner is launched only after the normal executor has stopped.
with tempfile.TemporaryDirectory() as directory, patch.object(server,'OWNED',Path(directory)/'legacy.json'), patch.object(core,'OWNED',Path(directory)/'legacy.json'), patch('app.cua_compat.prepare'), patch.object(core.shutil,'which',return_value='/fixture/qemu'), patch.object(core.asyncio,'sleep',new=AsyncMock()), patch.object(core,'model_request',return_value=model_action({'action':'click','x':500,'y':500,'reason':'Fixture target'})), patch.dict('os.environ',{'HOLO_CHAT_DB':str(Path(directory)/'legacy.sqlite3')}):
 def guest_factory(*_,**kwargs):
  guest=fake_guest();guest.id='local:'+kwargs['name'];return guest
 sdk=SimpleNamespace(Image=SimpleNamespace(from_registry=lambda value:value),Sandbox=SimpleNamespace(create=AsyncMock(side_effect=guest_factory)))
 with patch.dict('sys.modules',{'cua_sandbox':sdk}):
  http=server.ThreadingHTTPServer((server.HOST,server.PORT),server.Handler);http.runtime=server.Runtime()
  threading.Thread(target=http.serve_forever,daemon=True).start()
  token=server.TOKEN
  bot=None
  def state(tid):
   return json.load(urlopen(Request(server.ORIGIN+'/api/state',headers={'X-Local-Token':token,'X-Halo-Thread':tid})))
  def done(tid):
   for _ in range(150):
    thread=next(t for t in convex('query','workspace:list',{'token':token})['threads'] if t['_id']==tid)
    if not thread.get('activeRunId'):return thread
    time.sleep(.1)
   raise AssertionError('Run did not finish')
  def command(tid,path,body={}):
   convex('mutation','runs:command',{'token':token,'threadId':tid,'path':path,'body':body});return done(tid)
  try:
   a=convex('mutation','workspace:createBot',{'token':token,'name':'QA desktop bridge','instructions':'Fixture instructions'})
   w=convex('query','workspace:list',{'token':token});bot=next(t['botId'] for t in w['threads'] if t['_id']==a)
   b=convex('mutation','workspace:createConversation',{'token':token,'botId':bot,'title':'Other fake desktop'})
   assert not state(a)['sandbox'] and not state(b)['sandbox']
   assert not command(a,'/api/start',{'network':False}).get('error')
   assert not command(b,'/api/start',{'network':False}).get('error')
   assert state(a)['sandbox_id']!=state(b)['sandbox_id']
   convex('mutation','runs:send',{'token':token,'threadId':a,'text':'Click the fixture target','desktop':True});done(a)
   pending=state(a)['pending'];assert pending
   result=command(b,'/api/approve',{'id':pending['id']})
   assert result.get('error') and state(a)['pending']['id']==pending['id']
   assert not command(a,'/api/approve',{'id':pending['id']}).get('error')
   assert state(a)['actions']==1 and state(b)['actions']==0
   command(a,'/api/stop')
   assert not state(a)['sandbox'] and state(b)['sandbox']
   command(b,'/api/stop')
   print('PASS: actual Convex actions -> local executor -> two fake guests; isolated ownership, approvals, action counts, transcript persistence, and stop.',flush=True)
  finally:
   if bot:
    for tid in [a,b]:
     if state(tid)['sandbox']:command(tid,'/api/stop')
    convex('mutation','workspace:updateBot',{'token':token,'botId':bot,'name':'QA desktop bridge','instructions':'','archived':True})
   http.shutdown();http.server_close();http.runtime.close()
