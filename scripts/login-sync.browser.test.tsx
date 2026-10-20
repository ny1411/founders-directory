import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('login prevents redirect on network/401/500 failures, blocks duplicate submissions and retries without another popup', { timeout: 60_000 }, async (t) => {
  // Browser plugin not available. Exercise the real LoginPage and sync helper in
  // Playwright; replace only Firebase, navigation, images, and the fetch transport.
  // No credentials, Google popups, live API calls, or user records are needed.
  const mocks: Record<string, string> = {
    '@/lib/firebase': 'export const auth = {currentUser:null}; export const googleProvider = {};',
    'firebase/auth': `import {auth} from '@/lib/firebase';
      export async function signInWithPopup() {
        window.loginTest.popups++;
        const user = {uid:'test-user', getIdToken:async()=>{window.loginTest.tokens++;return 'test-token'}};
        auth.currentUser = user;
        return {user};
      }`,
    'next/navigation': `export function useRouter(){return {push(path){window.loginTest.redirects.push(path);history.pushState({},'',path)}}}`,
    'next/image': `import React from 'react';export default function Image({alt}){return React.createElement('span',{'aria-label':alt})}`,
  };
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';
        import LoginPage from './src/app/login/page';
        window.loginTest = {popups:0,tokens:0,requests:0,redirects:[],failure:null,release:null};
        window.fetch = async (url, options) => {
          const state=window.loginTest; state.requests++;
          if(url!='/api/auth/sync'||options.method!=='POST'||options.headers.Authorization!=='Bearer test-token') throw new Error('Invalid sync request');
          await new Promise(resolve=>{state.release=resolve});
          if(state.failure==='network') throw new TypeError('private transport diagnostic');
          return Response.json({}, {status: state.failure || 200});
        };
        createRoot(document.getElementById('root')).render(<LoginPage/>);`,
      resolveDir: process.cwd(), loader: 'tsx',
    },
    plugins: [{ name: 'login-boundary-mocks', setup(plugin) {
      plugin.onResolve({ filter: /^(firebase\/auth|@\/lib\/firebase|next\/navigation|next\/image)$/ }, args => ({path: args.path, namespace:'login-mock'}));
      plugin.onLoad({ filter: /.*/, namespace: 'login-mock' }, args => ({contents:mocks[args.path], loader:'js', resolveDir:process.cwd()}));
    }}],
    bundle:true, write:false, format:'iife', platform:'browser', jsx:'automatic',
    define:{'process.env.NODE_ENV':'"production"'}, tsconfig:'tsconfig.json',
  });
  const server = createServer((req, res) => {
    if(req.url === '/client.js') {res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(req.url === '/favicon.ico') {res.statusCode=204;res.end();return;}
    res.setHeader('content-type','text/html');
    res.end('<!doctype html><html lang="en"><head><title>Login regression fixture</title></head><body><main id="root"></main><script src="/client.js"></script></body></html>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address=server.address();
  assert.ok(address && typeof address !== 'string');
  const origin=`http://127.0.0.1:${address.port}`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)});
  t.after(async()=>{await browser.close(); await new Promise<void>(resolve=>server.close(()=>resolve()));});

  for(const failure of ['network',401,500]) {
    await t.test(`${failure} stays on login; retry redirects after successful sync`, async()=>{
      const page=await browser.newPage({viewport:{width:1280,height:900}});
      const errors:string[]=[];
      page.on('pageerror', error=>errors.push(error.message));
      page.on('console', message=>{if(message.type()==='error') errors.push(message.text());});
      await page.goto(`${origin}/login`);
      assert.equal(await page.title(),'Login regression fixture');
      await page.getByRole('heading',{name:'Welcome Back'}).waitFor();
      await page.evaluate(failure=>{Object.assign((window as unknown as {loginTest:object}).loginTest,{failure});},failure);
      // Dispatch twice in the same event turn to exercise the ref guard before
      // React has rendered disabled; ordinary user clicks are disabled as well.
      await page.getByRole('button',{name:'Sign in with Google'}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
      await page.waitForFunction(()=>{
        const state=(window as unknown as {loginTest:{requests:number}}).loginTest;
        return state.requests===1;
      });
      const pending=page.getByRole('button',{name:'Signing in…'});
      assert.equal(await pending.isDisabled(),true);
      assert.equal(await pending.getAttribute('aria-busy'),'true');
      const snapshot=await page.evaluate(()=>{
        const state=(window as unknown as {loginTest:{popups:number;requests:number;redirects:string[]}}).loginTest;
        return {popups:state.popups,requests:state.requests,redirects:state.redirects};
      });
      assert.deepEqual(snapshot,{popups:1,requests:1,redirects:[]});
      await page.evaluate(()=>(window as unknown as {loginTest:{release:()=>void}}).loginTest.release());
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').innerText(), /Could not finish signing in\..*try again\./i);
      assert.doesNotMatch(await page.getByRole('alert').innerText(), /private|TypeError/);
      assert.equal(page.url(),`${origin}/login`);
      const retry=page.getByRole('button',{name:'Try again'});
      assert.equal(await retry.isEnabled(),true);
      if(failure==='network' && process.env.LOGIN_SCREENSHOT_PATH) await page.screenshot({path:process.env.LOGIN_SCREENSHOT_PATH});
      await page.evaluate(()=>{(window as unknown as {loginTest:{failure:null}}).loginTest.failure=null;});
      await retry.click();
      await page.waitForFunction(()=>(window as unknown as {loginTest:{requests:number}}).loginTest.requests===2);
      assert.equal(page.url(),`${origin}/login`,'do not redirect while retry sync is pending');
      await page.evaluate(()=>(window as unknown as {loginTest:{release:()=>void}}).loginTest.release());
      await page.waitForURL(`${origin}/profile`);
      assert.deepEqual(await page.evaluate(()=>{
        const s=(window as unknown as {loginTest:{popups:number;requests:number;tokens:number;redirects:string[]}}).loginTest;
        return {popups:s.popups,requests:s.requests,tokens:s.tokens,redirects:s.redirects};
      }),{popups:1,requests:2,tokens:2,redirects:['/profile']});
      assert.equal(await page.getByRole('alert').count(),0);
      assert.deepEqual(errors,[],'no browser runtime or application console errors');
      await page.close();
    });
  }
});
