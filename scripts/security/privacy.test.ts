import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { publicFounder } from '../../src/lib/public-founder';
import type { Founder } from '../../src/lib/types';
import { createFounderContactHandler } from '../../src/lib/founder-contact';
import { readRecovery, writeRecovery, setRecoveryOwner } from '../../src/lib/onboarding/recovery-storage';
import { fixture, resumeFixture } from '../onboarding/fixture';

test('public founder props use an allowlist excluding contact and newly added private fields', () => {
  const founder = {id:'one', companyId:'company',name:'Ada',email:'private@example.com',phone:'secret-phone',privateNote:'secret-note'} as unknown as Founder;
  const serialized = JSON.stringify(publicFounder(founder));
  assert.equal(serialized.includes('private'),false);
  assert.equal(serialized.includes('secret'),false);
  const page = readFileSync(new URL('../../src/app/company/[slug]/page.tsx',import.meta.url),'utf8');
  assert.match(page,/founders: founders.map\(publicFounder\)/);
  assert.doesNotMatch(page,/email=|phone=/);
});

function request(token = 'valid', founderId = 'founder', companySlug = 'company') {
  return new Request('https://local/api/founder-contact',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({founderId,companySlug})});
}
test('contact reads require authenticated quota and valid matching target, with private responses',async () => {
  let lookups=0;
  const handler = createFounderContactHandler({
    verify: async token=>{if(token!=='valid')throw new Error('private token');return {uid:'owner'};},
    quota:async()=>({allowed:true,retryAfterSeconds:1}),
    lookup:async(id,slug)=>{lookups++;return id==='founder'&&slug==='company'?{email:'gated@example.com'}:null;},
  });
  assert.equal((await handler(request('invalid'))).status,401);
  assert.equal(lookups,0);
  assert.equal((await handler(request('valid','../invalid'))).status,400);
  assert.equal(lookups,0);
  assert.equal((await handler(request('valid','founder','wrong-company'))).status,404);
  const response=await handler(request());
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await response.json(),{email:'gated@example.com'});
  const limited=createFounderContactHandler({verify:async()=>({uid:'owner'}),quota:async()=>({allowed:false,retryAfterSeconds:30}),lookup:async()=>{throw new Error('must not read');}});
  assert.equal((await limited(request())).status,429);
});

class MemoryStorage {
  values = new Map<string,string>();
  get length(){return this.values.size;}
  key(i:number){return [...this.values.keys()][i]??null;}
  getItem(k:string){return this.values.get(k)??null;}
  setItem(k:string,v:string){this.values.set(k,v);}
  removeItem(k:string){this.values.delete(k);}
}
test('account switch/signout clears recovery and late old-account callbacks cannot recreate it',()=>{
  const local=new MemoryStorage();const session=new MemoryStorage();
  Object.defineProperty(globalThis,'localStorage',{value:local,configurable:true});
  Object.defineProperty(globalThis,'sessionStorage',{value:session,configurable:true});
  try {
    setRecoveryOwner('alice');
    writeRecovery('alice','onboarding-draft:v1:alice','private draft');
    assert.equal(readRecovery('alice','onboarding-draft:v1:alice'),'private draft');
    setRecoveryOwner('bob');
    assert.equal(local.length,0);
    writeRecovery('alice','onboarding-draft:v1:alice','late private draft');
    assert.equal(local.length,0);
    writeRecovery('bob','onboarding-draft:v1:bob','bob draft');
    setRecoveryOwner(null);
    writeRecovery('bob','onboarding-draft:v1:bob','late logout draft');
    assert.equal(local.length,0);
  } finally { Reflect.deleteProperty(globalThis,'localStorage');Reflect.deleteProperty(globalThis,'sessionStorage'); }
});

test('failed storage cleanup or owner updates disable recovery until a successful auth transition', () => {
  for (const failure of ['local-enumeration', 'local-removal', 'session-removal', 'session-update'] as const) {
    let failing = false;
    class LocalStorage extends MemoryStorage {
      get length() {
        if (failing && failure === 'local-enumeration') throw new Error('Storage unavailable');
        return super.length;
      }
      removeItem(key: string) {
        if (failing && failure === 'local-removal') throw new Error('Storage unavailable');
        super.removeItem(key);
      }
    }
    class SessionStorage extends MemoryStorage {
      removeItem(key: string) {
        if (failing && failure === 'session-removal') throw new Error('Storage unavailable');
        super.removeItem(key);
      }
      setItem(key: string, value: string) {
        if (failing && failure === 'session-update') throw new Error('Storage unavailable');
        super.setItem(key, value);
      }
    }
    const local = new LocalStorage();
    const session = new SessionStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
    const aliceKey = 'onboarding-draft:v1:alice';
    const bobKey = 'onboarding-draft:v1:bob';
    try {
      setRecoveryOwner('alice');
      writeRecovery('alice', aliceKey, 'private Alice draft');
      failing = true;
      setRecoveryOwner('bob');
      failing = false;
      // Even when storage immediately becomes usable again, old owner markers
      // and late callbacks cannot restore access without a fresh auth callback.
      assert.equal(readRecovery('alice', aliceKey), null, failure);
      const before = [...local.values];
      writeRecovery('alice', aliceKey, 'late Alice draft');
      writeRecovery('bob', bobKey, 'unconfirmed Bob draft');
      assert.deepEqual([...local.values], before, failure);
      setRecoveryOwner('bob');
      assert.equal(local.getItem(aliceKey), null, failure);
      writeRecovery('bob', bobKey, 'private Bob draft');
      assert.equal(readRecovery('bob', bobKey), 'private Bob draft', failure);
      failing = true;
      setRecoveryOwner(null);
      failing = false;
      assert.equal(readRecovery('bob', bobKey), null, failure);
      const afterSignout = [...local.values];
      writeRecovery('bob', bobKey, 'late signout draft');
      assert.deepEqual([...local.values], afterSignout, failure);
    } finally {
      failing = false;
      setRecoveryOwner(null);
      Reflect.deleteProperty(globalThis, 'localStorage');
      Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  }
});

test('superseded resumes get timestamp TTL; reactivating old content clears TTL and remains owner-scoped', async()=>{
  const f=fixture('owner');
  await f.post({action:'select_intent',intent:'job',stage:'actively_looking'});
  await f.store.saveResume(f.uid,resumeFixture);
  const first=(await f.state()).profile.resumeSourceId!;
  await f.store.saveResume(f.uid,{...resumeFixture,name:'New name'});
  const second=(await f.state()).profile.resumeSourceId!;
  const retired=f.memory.records.get(`users/owner/sources/${first}`)!;
  assert.ok(retired.deleteAfter instanceof Date);
  assert.equal(retired.deleteAfter.getTime()-Date.parse(retired.supersededAt),30*86_400_000);
  assert.equal(f.memory.records.get(`users/owner/sources/${second}`)!.deleteAfter,null);
  await f.store.saveResume(f.uid,resumeFixture);
  assert.equal((await f.state()).profile.resumeSourceId,first);
  assert.equal(f.memory.records.get(`users/owner/sources/${first}`)!.deleteAfter,null);
  const other=fixture('other',f.memory);
  await other.post({action:'select_intent',intent:'job',stage:'actively_looking'});
  assert.equal(await other.store.getResumeContext(other.uid,await other.state()),null);
});
