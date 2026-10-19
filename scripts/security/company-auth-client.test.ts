import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../../src/app/company/new/page.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

type State = { error: string };
type Element = { type: unknown; props: Record<string, unknown> };

function fixture(options: { refreshError?: boolean; pending?: boolean; error?: string; signedOut?: boolean } = {}) {
  let completion: Promise<void> | undefined;
  let state: State = { error: options.error ?? '' };
  const refreshes: boolean[] = [];
  const submissions: Array<{ data: FormData; token: string }> = [];
  const exports: { default?: () => Element } = {};
  const user = {
    async getIdToken(forceRefresh: boolean) {
      refreshes.push(forceRefresh);
      if (options.refreshError) throw new Error('private Firebase error');
      return 'new-id-token';
    },
  };
  runInNewContext(compiled, {
    exports,
    // The real browser constructs this from the submitted HTMLFormElement.
    FormData: class { constructor(data: FormData) { return data; } },
    require(name: string) {
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react') return {
        useState: (initial: unknown) => typeof initial === 'number' ? [1, () => {}] : [state, (next: State) => { state = next; }],
        useEffect() {},
        useTransition() {
          return [options.pending ?? false, (action: () => Promise<void>) => { completion = action(); }];
        },
      };
      if (name === 'next/navigation') return { useRouter: () => ({ push() {} }) };
      if (name === '@/context/AuthContext') return { useAuth: () => ({ user: options.signedOut ? null : user, loading: false }) };
      if (name === '@/app/actions') return {
        async createCompany(data: FormData, token: string) {
          submissions.push({ data, token });
          return { error: 'Server-side rejection' };
        },
      };
      if (name === 'next/link') return { default: 'a' };
      if (name === '@/components/ui/button') return { Button: 'button', buttonVariants: () => '' };
      if (name === '@/components/ui/card') return { Card: 'div', CardHeader: 'div', CardTitle: 'h2', CardContent: 'div' };
      if (name === '@/components/ui/input') return { Input: 'input' };
      if (name === '@/components/bot-id-protection') return { BotIdProtection: () => null };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  assert.ok(exports.default);
  const tree = exports.default();
  return {
    tree, refreshes, submissions,
    async submit(data: FormData) {
      const form = elements(tree).find(node => node.type === 'form');
      assert.ok(form);
      assert.equal(form.props.action, undefined, 'native onSubmit avoids React form-action reset on error');
      let preventedDefault = false;
      const handler = form.props.onSubmit as (event: unknown) => void;
      handler({ currentTarget: data, preventDefault() { preventedDefault = true; } });
      assert.equal(preventedDefault, true);
      await completion;
      return state;
    },
  };
}

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

test('the real form handler refreshes identity and forwards the fresh token without adding it to form data', async () => {
  const page = fixture();
  const data = new FormData();
  data.set('name', 'New Company');
  const result = await page.submit(data);
  assert.deepEqual(page.refreshes, [true]);
  assert.equal(page.submissions.length, 1);
  assert.equal(page.submissions[0].token, 'new-id-token');
  assert.equal(page.submissions[0].data, data);
  assert.deepEqual([...data.keys()], ['name']);
  assert.equal(result.error, 'Server-side rejection');
});

test('token refresh failure displays an actionable error and never invokes the server action', async () => {
  const page = fixture({ refreshError: true });
  const result = await page.submit(new FormData());
  assert.equal(result.error, 'Your session could not be refreshed. Please sign in again.');
  assert.equal(page.submissions.length, 0);
});

test('pending submission disables submit and add-founder controls and exposes errors accessibly', () => {
  const page = fixture({ pending: true, error: 'Please sign in again.' });
  const nodes = elements(page.tree);
  const form = nodes.find(node => node.type === 'form');
  assert.equal(form?.props['aria-busy'], true);
  const submit = nodes.find(node => node.type === 'button' && node.props.type === 'submit');
  assert.equal(submit?.props.disabled, true);
  assert.equal(submit?.props.children, 'Saving Company…');
  const addFounder = nodes.find(node => node.type === 'button' && node.props.type === 'button');
  assert.equal(addFounder?.props.disabled, true);
  const alert = nodes.find(node => node.props.role === 'alert');
  assert.equal(alert?.props.children, 'Please sign in again.');
});
