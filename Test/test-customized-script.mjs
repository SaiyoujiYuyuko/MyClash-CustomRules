import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { customizeScript } from '../scripts/sync-upstream.mjs';

const scriptPath = new URL('../Script/mihomoScript.js', import.meta.url);
const source = await readFile(scriptPath, 'utf8');

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadMain() {
  const sandbox = {
    module: { exports: {} },
    console,
    process,
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;module.exports = { main };`, sandbox, {
    filename: 'mihomoScript.js',
  });
  return sandbox.module.exports.main;
}

function makeProxy(name, server) {
  return {
    name,
    type: 'ss',
    server,
    port: 443,
    cipher: 'aes-256-gcm',
    password: 'test',
  };
}

function groupByName(output, name) {
  return output['proxy-groups'].find((group) => group.name === name);
}

const main = loadMain();
const output = main({
  proxies: [
    makeProxy('日本 Tokyo 01', 'jp.example.com'),
    makeProxy('香港 HK 01', 'hk.example.com'),
    makeProxy('美国 US 01', 'us.example.com'),
  ],
});

const expectedProviders = {
  custom_direct: {
    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/CustomRules@main/custom-rules/direct.yaml',
    path: './ruleset/custom_direct.yaml',
  },
  custom_proxy: {
    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/CustomRules@main/custom-rules/proxy.yaml',
    path: './ruleset/custom_proxy.yaml',
  },
  custom_jp: {
    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/CustomRules@main/custom-rules/JP.yaml',
    path: './ruleset/custom_jp.yaml',
  },
  custom_nojp: {
    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/CustomRules@main/custom-rules/NoJP.yaml',
    path: './ruleset/custom_nojp.yaml',
  },
};

for (const [name, expected] of Object.entries(expectedProviders)) {
  const provider = output['rule-providers'][name];
  assert.ok(provider, `缺少规则集 ${name}`);
  assert.deepEqual(
    normalize({
      type: provider.type,
      behavior: provider.behavior,
      format: provider.format,
      interval: provider.interval,
      url: provider.url,
      path: provider.path,
    }),
    {
      type: 'http',
      behavior: 'classical',
      format: 'yaml',
      interval: 86400,
      ...expected,
    },
  );
}

const expectedRules = [
  'RULE-SET,custom_direct,直连',
  'RULE-SET,custom_jp,日本',
  'RULE-SET,custom_nojp,非日本',
  'RULE-SET,custom_proxy,默认代理',
];
assert.deepEqual(normalize(output.rules.slice(0, expectedRules.length)), expectedRules);

const groupNames = new Set(output['proxy-groups'].map((group) => group.name));
for (const rule of expectedRules) {
  assert.ok(groupNames.has(rule.split(',')[2]), `规则目标策略组不存在：${rule}`);
}

const proxyNames = normalize(output.proxies.filter((proxy) => proxy.type !== 'direct').map((proxy) => proxy.name));
const japanProxyNames = normalize(groupByName(output, '日本-自动选择').proxies);
const nonJapanProxyNames = normalize(groupByName(output, '非日本-自动选择').proxies);
const japanSet = new Set(japanProxyNames);
assert.deepEqual(
  nonJapanProxyNames,
  proxyNames.filter((name) => !japanSet.has(name)),
  '非日本节点组必须是日本节点组的严格补集',
);
assert.ok(
  nonJapanProxyNames.every((name) => !japanSet.has(name)),
  '日本与非日本节点组不应有交集',
);

const onlyJapan = main({ proxies: [makeProxy('日本 ONLY', 'jp-only.example.com')] });
assert.equal(groupByName(onlyJapan, '日本-自动选择').proxies.length, 1);
assert.equal(groupByName(onlyJapan, '非日本-自动选择').proxies.length, 0);

const onlyNonJapan = main({ proxies: [makeProxy('美国 ONLY', 'us-only.example.com')] });
assert.equal(groupByName(onlyNonJapan, '日本-自动选择').proxies.length, 0);
assert.equal(groupByName(onlyNonJapan, '非日本-自动选择').proxies.length, 1);
assert.equal(groupByName(onlyNonJapan, '默认代理').proxies[0], '美国', '空日本组不应成为默认代理首选项');

assert.throws(() => customizeScript(source), /已经包含自定义修改/);
assert.throws(() => customizeScript(''), /prefixRules/);
assert.throws(() => customizeScript('const prefixRules = [\nconst prefixRules = [\n'), /不再唯一：prefixRules/);

assert.ok(Array.isArray(output.proxies) && output.proxies.length > 0, 'proxies 输出无效');
assert.ok(Array.isArray(output['proxy-groups']) && output['proxy-groups'].length > 0, 'proxy-groups 输出无效');
assert.ok(Array.isArray(output.rules) && output.rules.length > 0, 'rules 输出无效');

console.log('定制脚本测试通过');
