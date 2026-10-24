import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { publicFounder } from '../../src/lib/public-founder';

test('real anonymous company page rendering and client-bound props exclude all private founder fields',async()=>{
  const secret='contact-sentinel-secret@example.com';
  const phone='phone-sentinel-secret';
  const privateNote='future-private-field-sentinel';
  const clientProps: unknown[]=[];
  const company={id:'c1',slug:'company',name:'Public Company',tags:[],website:null};
  const founder={id:'f1',companyId:'c1',name:'Public Founder',email:secret,phone,privateNote,bio:'Public biography',avatarUrl:null};
  const exports: {default?: (props: unknown)=>Promise<React.ReactNode>}={};
  const require=createRequire(import.meta.url);
  const source=readFileSync(new URL('../../src/app/company/[slug]/page.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  runInNewContext(code,{exports,require(name:string){
    if(name==='react/jsx-runtime')return require(name);
    if(name==='@/lib/company-query')return {getCompany:async()=>company,getCompanyFounders:async()=>[founder],normalizeCompanySlug:(s:string)=>s};
    if(name==='@/lib/public-founder')return {publicFounder};
    if(name==='next/navigation')return {notFound(){throw new Error('not found');}};
    if(name==='@/components/send-dm-button')return {SendDmButton:(props: unknown)=>{clientProps.push(props);return React.createElement('button',{},'Send Custom Text');}};
    if(name==='@/components/ui/button')return {buttonVariants:()=>''};
    if(name==='@/components/json-ld')return {JsonLd:({data}:{data:unknown})=>React.createElement('script',{type:'application/ld+json'},JSON.stringify(data))};
    if(name==='@/components/entity-image')return {EntityImage:()=>React.createElement('img',{alt:'public image'})};
    if(name==='@/lib/image-url')return {normalizeImageUrl:()=>null};
    if(name==='next/link')return {default:({children,...props}:React.PropsWithChildren<Record<string,unknown>>)=>React.createElement('a',props,children),__esModule:true};
    if(name==='next/image')return {default:()=>React.createElement('img',{alt:'public icon'}),__esModule:true};
    if(name==='lucide-react')return new Proxy({},{get:()=>()=>React.createElement('svg')});
    throw new Error(`Unexpected page dependency ${name}`);
  }});
  const tree=await exports.default!({params:Promise.resolve({slug:'company'})});
  const html=renderToStaticMarkup(tree);
  assert.match(html,/Public Founder/);
  assert.equal(clientProps.length,1);
  for(const value of [html,JSON.stringify(clientProps),JSON.stringify(tree)]) {
    for(const sentinel of [secret,phone,privateNote]) assert.ok(!value.includes(sentinel),`private sentinel reached anonymous output`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(clientProps)),[{founderId:'f1',founderName:'Public Founder',companySlug:'company'}]);
});
