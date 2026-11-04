import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtractor } from '../server/extractor.mjs';
import { examples } from '../server/examples.mjs';

const example = examples.find(e => e.id === 'history');
const config = { configured: true, endpoint: 'http://unused', apiKey: 'test-key', model: 'test-model', timeoutMs: 5000 };
const completion = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }), { status: 200 });

test('首次提取及一次修复均不发送客户端token上限，修复保留原稿上下文', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return completion(requests.length === 1 ? { wrong: true } : example.trajectory);
  };
  try {
    const result = await createExtractor(config)(example.content);
    assert.equal(requests.length, 2);
    for (const body of requests) {
      assert.equal(Object.hasOwn(body, 'max_tokens'), false);
      assert.equal(Object.hasOwn(body, 'max_completion_tokens'), false);
      assert.equal(body.model, 'test-model');
      assert.ok(body.messages[1].content.includes('1 | ' + example.content.split('\n')[0]));
    }
    assert.equal(requests[0].messages.length, 2);
    assert.equal(requests[1].messages.length, 4);
    assert.match(requests[1].messages.at(-1).content, /仅修复/);
    assert.equal(result.trajectory.outputs[0].type, 'scheme');
  } finally { globalThis.fetch = original; }
});
