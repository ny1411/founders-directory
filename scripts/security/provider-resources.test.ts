import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseSaleshandyResponse, readSaleshandyResponse, saleshandyRequest, MAX_SALESHANDY_RESPONSE_BYTES} from '../../src/lib/saleshandy';

const signal = () => new AbortController().signal;

test('chunked provider responses are cancelled on byte overflow without content-length', async () => {
  let cancelled=false;
  const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_SALESHANDY_RESPONSE_BYTES));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}}));
  await assert.rejects(readSaleshandyResponse(response,signal()),/PROVIDER_RESPONSE_TOO_LARGE/);
  assert.equal(cancelled,true);
});

test('declared oversize rejects before reading and ignores dishonest small content-length', async () => {
  let cancelled=false;
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-length':String(MAX_SALESHANDY_RESPONSE_BYTES+1)}});
  await assert.rejects(readSaleshandyResponse(response,signal()),/PROVIDER_RESPONSE_TOO_LARGE/);
  assert.equal(cancelled,true);
  await assert.rejects(readSaleshandyResponse(new Response('x'.repeat(MAX_SALESHANDY_RESPONSE_BYTES+1),{headers:{'content-length':'1'}}),signal()),/PROVIDER_RESPONSE_TOO_LARGE/);
});

test('body deadline aborts hanging chunks and cancels the reader', async () => {
  let cancelled=false;
  const controller=new AbortController();
  const result=readSaleshandyResponse(new Response(new ReadableStream({cancel(){cancelled=true;}})),controller.signal);
  controller.abort();
  await assert.rejects(result,/PROVIDER_TIMEOUT/);
  assert.equal(cancelled,true);
});

test('invalid provider JSON/shapes reject with safe errors and valid records drop unknown fields', async () => {
  for(const value of [null, [], {}, {payload:[]}, {payload:{requestId:'bad/id'}}, {payload:{status:3}}, {payload:{results:{}}}, {payload:{status:'completed'}}, {payload:{results:[null]}}, {payload:{results:[{emails:{}}]}}]) {
    assert.throws(()=>parseSaleshandyResponse(value),/^Error: INVALID_PROVIDER_RESPONSE$/);
  }
  await assert.rejects(readSaleshandyResponse(new Response('private provider invalid JSON'),signal()),/^Error: INVALID_PROVIDER_RESPONSE$/);
  assert.deepEqual(parseSaleshandyResponse({payload:{status:'completed',results:[{first_name:'Ada',email:'ada@example.com',privateField:'discard'}]},privateMetadata:'discard'}),{payload:{requestId:undefined,status:'completed',results:[{first_name:'Ada',email:'ada@example.com'}]}});
});

test('paid POST failure makes exactly one bounded provider request and never retries', async () => {
  const saved={base:process.env.SALESHANDY_BASE_URL,key:process.env.SALESHANDY_API_KEY};
  process.env.SALESHANDY_BASE_URL='https://provider.example/v1';process.env.SALESHANDY_API_KEY='fixture-key';
  let calls=0;
  try {
    await assert.rejects(saleshandyRequest('/enrich/contact',{method:'POST'},async(_url,init)=>{
      calls++;assert.equal(init?.method,'POST');assert.ok(init?.signal);assert.equal(init.signal.aborted,false);
      return new Response('private provider credentials',{status:502});
    }),/^Error: PROVIDER_ERROR$/);
    assert.equal(calls,1);
  } finally {
    if(saved.base===undefined)delete process.env.SALESHANDY_BASE_URL;else process.env.SALESHANDY_BASE_URL=saved.base;
    if(saved.key===undefined)delete process.env.SALESHANDY_API_KEY;else process.env.SALESHANDY_API_KEY=saved.key;
  }
});
