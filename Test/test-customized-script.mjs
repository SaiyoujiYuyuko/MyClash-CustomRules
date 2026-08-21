import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { customizeScript, customizeSingMixScript } from '../scripts/sync-upstream.mjs';

const mihomoScriptPath = new URL('../Script/mihomoScript.js', import.meta.url);
const singMixScriptPath = new URL('../Script/sing-mix.js', import.meta.url);
const [mihomoSource, singMixSource] = await Promise.all([
  readFile(mihomoScriptPath, 'utf8'),
  readFile(singMixScriptPath, 'utf8'),
]);

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadRuntime(source, filename, exportedNames) {
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
  vm.runInContext(`${source}\n;module.exports = { ${exportedNames.join(', ')} };`, sandbox, {
    filename,
  });
  return sandbox.module.exports;
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

const { main, ruleOptionsEnable } = loadRuntime(mihomoSource, 'mihomoScript.js', ['main', 'ruleOptionsEnable']);
const output = main({
  proxies: [
    makeProxy('日本 Tokyo 01', 'jp.example.com'),
    makeProxy('香港 HK 01', 'hk.example.com'),
    makeProxy('美国 US 01', 'us.example.com'),
  ],
});

const expectedProviders = {
  custom_direct: {
    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/direct.yaml',
  },
  custom_proxy: {
    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/proxy.yaml',
  },
  custom_jp: {
    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/JP.yaml',
  },
  custom_nojp: {
    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/NoJP.yaml',
  },
};

function assertCustomProviders(config, pathPrefix) {
  for (const [name, expected] of Object.entries(expectedProviders)) {
    const provider = config['rule-providers'][name];
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
        url: expected.url,
        path: `${pathPrefix}/${name}.yaml`,
      },
    );
  }
}

assertCustomProviders(output, './ruleset');

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
assert.deepEqual(normalize(groupByName(onlyJapan, '日本-自动选择').proxies), ['🇯🇵 日本 ONLY']);
assert.deepEqual(normalize(groupByName(onlyJapan, '非日本-自动选择').proxies), ['REJECT']);
assert.deepEqual(normalize(groupByName(onlyJapan, '非日本').proxies), ['非日本-自动选择', 'REJECT']);

const onlyNonJapan = main({ proxies: [makeProxy('美国 ONLY', 'us-only.example.com')] });
assert.deepEqual(normalize(groupByName(onlyNonJapan, '日本-自动选择').proxies), ['REJECT']);
assert.deepEqual(normalize(groupByName(onlyNonJapan, '日本').proxies), ['日本-自动选择', 'REJECT']);
assert.deepEqual(normalize(groupByName(onlyNonJapan, '非日本-自动选择').proxies), ['🇺🇸 美国 ONLY']);
assert.equal(groupByName(onlyNonJapan, '默认代理').proxies[0], '美国', '空日本组不应成为默认代理首选项');

const generateRegionAutoSelect = ruleOptionsEnable.生成地区自动选择组;
try {
  ruleOptionsEnable.生成地区自动选择组 = false;

  const onlyJapanWithoutAuto = main({ proxies: [makeProxy('日本 ONLY', 'jp-only.example.com')] });
  assert.equal(groupByName(onlyJapanWithoutAuto, '非日本-自动选择'), undefined);
  assert.deepEqual(normalize(groupByName(onlyJapanWithoutAuto, '非日本').proxies), ['REJECT']);

  const onlyNonJapanWithoutAuto = main({ proxies: [makeProxy('美国 ONLY', 'us-only.example.com')] });
  assert.equal(groupByName(onlyNonJapanWithoutAuto, '日本-自动选择'), undefined);
  assert.deepEqual(normalize(groupByName(onlyNonJapanWithoutAuto, '日本').proxies), ['REJECT']);
} finally {
  ruleOptionsEnable.生成地区自动选择组 = generateRegionAutoSelect;
}

assert.throws(() => customizeScript(mihomoSource), /已经包含自定义修改/);
assert.throws(() => customizeScript(''), /prefixRules/);
assert.throws(() => customizeScript('const prefixRules = [\nconst prefixRules = [\n'), /不再唯一：prefixRules/);

const { main: singMixMain } = loadRuntime(singMixSource, 'sing-mix.js', ['main']);
const singMixOutput = singMixMain({
  proxies: [
    makeProxy('日本 Tokyo 01', 'jp-sing-mix.example.com'),
    makeProxy('香港 HK 01', 'hk-sing-mix.example.com'),
    makeProxy('美国 US 01', 'us-sing-mix.example.com'),
  ],
});

assertCustomProviders(singMixOutput, './rules');

const expectedSingMixRules = [
  'RULE-SET,custom_direct,DIRECT',
  'RULE-SET,custom_jp,JP',
  'RULE-SET,custom_nojp,非日本',
  'RULE-SET,custom_proxy,main',
];
assert.deepEqual(normalize(singMixOutput.rules.slice(0, expectedSingMixRules.length)), expectedSingMixRules);

const singMixGroupNames = new Set(singMixOutput['proxy-groups'].map((group) => group.name));
for (const rule of expectedSingMixRules) {
  const target = rule.split(',')[2];
  assert.ok(target === 'DIRECT' || singMixGroupNames.has(target), `sing-mix 规则目标不存在：${rule}`);
}

const singMixProxyNames = normalize(singMixOutput.proxies.map((proxy) => proxy.name));
const singMixJapanNames = normalize(groupByName(singMixOutput, 'URL Test - JP').proxies);
const singMixNonJapanNames = normalize(groupByName(singMixOutput, 'URL Test - 非日本').proxies);
const singMixJapanSet = new Set(singMixJapanNames);
assert.deepEqual(
  singMixNonJapanNames,
  singMixProxyNames.filter((name) => !singMixJapanSet.has(name)),
  'sing-mix 非日本节点组必须是 JP 实际节点组的严格补集',
);
assert.ok(
  singMixNonJapanNames.every((name) => !singMixJapanSet.has(name)),
  'sing-mix 的 JP 与非日本节点组不应有交集',
);
assert.ok(groupByName(singMixOutput, 'main').proxies.includes('非日本'), 'main 应提供非日本分组选项');

const singMixOnlyJapan = singMixMain({
  proxies: [makeProxy('日本 ONLY', 'jp-only-sing-mix.example.com')],
});
assert.deepEqual(normalize(groupByName(singMixOnlyJapan, 'URL Test - JP').proxies), ['日本 ONLY']);
assert.equal(groupByName(singMixOnlyJapan, 'URL Test - 非日本'), undefined);
assert.deepEqual(normalize(groupByName(singMixOnlyJapan, '非日本').proxies), ['REJECT']);
assert.ok(!groupByName(singMixOnlyJapan, 'main').proxies.includes('非日本'));

const singMixOnlyNonJapan = singMixMain({
  proxies: [makeProxy('美国 ONLY', 'us-only-sing-mix.example.com')],
});
assert.equal(groupByName(singMixOnlyNonJapan, 'URL Test - JP'), undefined);
assert.deepEqual(normalize(groupByName(singMixOnlyNonJapan, 'JP').proxies), ['REJECT']);
assert.deepEqual(normalize(groupByName(singMixOnlyNonJapan, 'URL Test - 非日本').proxies), ['美国 ONLY']);
assert.ok(groupByName(singMixOnlyNonJapan, 'main').proxies.includes('非日本'));

const singMixOnlyInfo = singMixMain({
  proxies: [makeProxy('订阅到期信息', 'info-only-sing-mix.example.com')],
});
for (const groupName of ['main', 'ai', 'tg', 'JP', '非日本']) {
  assert.deepEqual(
    normalize(groupByName(singMixOnlyInfo, groupName).proxies),
    ['REJECT'],
    `sing-mix 仅有信息节点时 ${groupName} 应使用 REJECT 兜底`,
  );
}

for (const config of [singMixOnlyJapan, singMixOnlyNonJapan, singMixOnlyInfo]) {
  assert.ok(
    config['proxy-groups'].every((group) => Array.isArray(group.proxies) && group.proxies.length > 0),
    'sing-mix 不应生成静态空策略组',
  );
}

assert.throws(() => customizeSingMixScript(singMixSource), /已经包含 sing-mix 自定义修改/);
assert.throws(() => customizeSingMixScript(''), /sing-mix buildRuleProviders 返回值/);
assert.throws(
  () => customizeSingMixScript('  return providers;\n};\n  return providers;\n};'),
  /不再唯一：sing-mix buildRuleProviders 返回值/,
);

assert.ok(Array.isArray(output.proxies) && output.proxies.length > 0, 'proxies 输出无效');
assert.ok(Array.isArray(output['proxy-groups']) && output['proxy-groups'].length > 0, 'proxy-groups 输出无效');
assert.ok(Array.isArray(output.rules) && output.rules.length > 0, 'rules 输出无效');
assert.ok(Array.isArray(singMixOutput.proxies) && singMixOutput.proxies.length > 0, 'sing-mix proxies 输出无效');
assert.ok(
  Array.isArray(singMixOutput['proxy-groups']) && singMixOutput['proxy-groups'].length > 0,
  'sing-mix proxy-groups 输出无效',
);
assert.ok(Array.isArray(singMixOutput.rules) && singMixOutput.rules.length > 0, 'sing-mix rules 输出无效');

console.log('两个定制脚本测试通过');
