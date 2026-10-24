import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../../src/components/cold-dm-modal.tsx', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
}).outputText;
type Element = {type: unknown; props: Record<string, unknown>};
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element; return [element, ...elements(element.props.children)];
}
function fixture(status: number, payload: object, networkError = false) {
  const keys: string[] = []; const errors: unknown[] = []; let uuid = 0; let stateIndex = 0;
  const exports: {ColdDmModal?: (props: object) => Element} = {};
  runInNewContext(compiled, {
    exports, AbortController, DOMException, Error, console,
    crypto: {randomUUID: () => `key-${++uuid}`},
    navigator: {clipboard: {writeText: async () => {}}},
    setTimeout: (fn: () => void) => {queueMicrotask(fn); return 1;}, clearTimeout() {},
    async fetch(_url: string, init: RequestInit) {
      if (_url === '/api/founder-contact') return Response.json({email: null});
      if (init.method === 'POST') {
        keys.push((init.headers as Record<string, string>)['Idempotency-Key']);
        return Response.json({statusUrl: '/api/enrich-contact/job'}, {status: 202});
      }
      if (networkError) throw new Error('network unavailable');
      return Response.json(payload, {status});
    },
    require(name: string) {
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react') return {
        useState: (value: unknown) => {const i = stateIndex++; return [i === 0 ? false : i === 3 ? 'A message' : value, (next: unknown) => {if(i === 7) errors.push(next);}];},
        useRef: (value: unknown) => ({current: value}), useEffect() {},
      };
      if (name === '@/context/AuthContext') return {useAuth: () => ({user: {uid: 'owner', getIdToken: async () => 'fresh-token'}})};
      if (name === 'next/navigation') return {useRouter: () => ({push() {}})};
      if (name === '@/components/ui/button') return {buttonVariants: () => ''};
      if (name === 'lucide-react') return {X: 'i', Copy: 'i', ExternalLink: 'i', Loader2: 'i'};
      if (name === '@/lib/firebase') return {};
      if (name === '@/lib/onboarding/message-client') return {MessageGenerationError: class extends Error {}};
      if (name === './cold-dm-error-panel') return {ColdDmErrorPanel: 'div'};
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const tree = exports.ColdDmModal!({founderId: 'one', founderName: 'One', companySlug: 'company', onClose() {}});
  const button = elements(tree).find(node => node.type === 'button' && elements(node.props.children).some(child => JSON.stringify(child.props.children)?.includes('Send Email')));
  assert.ok(button, 'rendered email control');
  return {keys, errors, click: button.props.onClick as () => Promise<void>};
}

test('real email handler rotates the idempotency key only after proved-unsubmitted authenticated budget denial', async () => {
  for (const status of [429, 503]) {
    const f = fixture(status, {status: 'failed', code: 'PROVIDER_BUDGET_REJECTED', error: 'Try again in 120 seconds.'});
    await f.click(); await f.click();
    assert.deepEqual(f.keys, ['key-1', 'key-2']);
    assert.equal(f.errors.at(-1), 'Try again in 120 seconds.');
  }
});
test('real email handler retains the key after ambiguous provider, ordinary quota, malformed denial and network errors', async () => {
  for (const f of [
    fixture(200, {status: 'failed', reason: 'PROVIDER_SUBMISSION_FAILED'}),
    fixture(429, {error: 'Admission quota exceeded'}),
    fixture(200, {status: 'failed', code: 'PROVIDER_BUDGET_REJECTED'}),
    fixture(503, {status: 'polling', code: 'PROVIDER_BUDGET_REJECTED'}),
    fixture(503, {}, true),
  ]) {
    await f.click(); await f.click(); assert.deepEqual(f.keys, ['key-1', 'key-1']);
  }
});
