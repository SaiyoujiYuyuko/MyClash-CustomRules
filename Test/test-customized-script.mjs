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
    makeProxy('新加坡 SG 01', 'sg.example.com'),
    makeProxy('台湾 TW 01', 'tw.example.com'),
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
  'DOMAIN-SUFFIX,gov.cn,DIRECT',
  'RULE-SET,custom_direct,直连',
  'RULE-SET,custom_jp,日本',
  'RULE-SET,custom_nojp,非日本',
  'RULE-SET,custom_proxy,默认代理',
];
assert.deepEqual(normalize(output.rules.slice(0, expectedRules.length)), expectedRules);

const groupNames = new Set(output['proxy-groups'].map((group) => group.name));
for (const rule of expectedRules) {
  const target = rule.split(',')[2];
  assert.ok(target === 'DIRECT' || groupNames.has(target), `规则目标策略组不存在：${rule}`);
}

const defaultProxyGroup = groupByName(output, '默认代理');
assert.deepEqual(
  normalize(defaultProxyGroup.proxies.slice(0, 3)),
  ['自动选择', '手动选择', '负载均衡'],
  '默认代理应优先提供自动选择、手动选择和负载均衡',
);
for (const regionName of ['香港', '日本', '美国', '新加坡', '台湾省', '非日本']) {
  assert.ok(defaultProxyGroup.proxies.indexOf(regionName) >= 3, `默认代理的区域组 ${regionName} 应排在基础组之后`);
}
assert.equal(groupByName(output, '漏网之鱼')['default-selected'], '直连');

const proxyNames = normalize(output.proxies.filter((proxy) => proxy.type !== 'direct').map((proxy) => proxy.name));
const japanProxyNames = normalize(groupByName(output, '日本-自动选择').proxies);
const nonJapanProxyNames = normalize(groupByName(output, '非日本-自动选择').proxies);
const japanSet = new Set(japanProxyNames);
for (const [regionName, autoSelectName] of [
  ['香港', '香港-自动选择'],
  ['日本', '日本-自动选择'],
  ['美国', '美国-自动选择'],
  ['新加坡', '新加坡-自动选择'],
  ['台湾省', '台湾省-自动选择'],
  ['非日本', '非日本-自动选择'],
]) {
  const regionGroup = groupByName(output, regionName);
  assert.equal(regionGroup.proxies[0], autoSelectName, `${regionName} 应将自动选择组放在首位`);
  assert.equal(regionGroup['default-selected'], autoSelectName, `${regionName} 应默认使用自动选择组`);
  assert.equal(groupByName(output, autoSelectName)['empty-fallback'], 'DIRECT', `${autoSelectName} 空组应回退 DIRECT`);
}
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
assert.deepEqual(normalize(groupByName(onlyJapan, '非日本-自动选择').proxies), ['DIRECT']);
assert.equal(groupByName(onlyJapan, '非日本-自动选择')['empty-fallback'], 'DIRECT');
assert.deepEqual(normalize(groupByName(onlyJapan, '非日本').proxies), ['非日本-自动选择']);
assert.equal(groupByName(onlyJapan, '非日本')['default-selected'], '非日本-自动选择');

const onlyNonJapan = main({ proxies: [makeProxy('美国 ONLY', 'us-only.example.com')] });
assert.deepEqual(normalize(groupByName(onlyNonJapan, '日本-自动选择').proxies), ['DIRECT']);
assert.equal(groupByName(onlyNonJapan, '日本-自动选择')['empty-fallback'], 'DIRECT');
assert.deepEqual(normalize(groupByName(onlyNonJapan, '日本').proxies), ['日本-自动选择']);
assert.equal(groupByName(onlyNonJapan, '日本')['default-selected'], '日本-自动选择');
assert.deepEqual(normalize(groupByName(onlyNonJapan, '非日本-自动选择').proxies), ['🇺🇸 美国 ONLY']);
const onlyNonJapanDefaultProxy = groupByName(onlyNonJapan, '默认代理');
assert.deepEqual(
  normalize(onlyNonJapanDefaultProxy.proxies.slice(0, 4)),
  ['自动选择', '手动选择', '负载均衡', '美国'],
  '默认代理应先显示基础组，再显示有效区域组',
);
assert.ok(
  onlyNonJapanDefaultProxy.proxies.indexOf('日本') > onlyNonJapanDefaultProxy.proxies.indexOf('美国'),
  '空日本组不应排在有效非日本区域组之前',
);

const generateRegionAutoSelect = ruleOptionsEnable.生成地区自动选择组;
try {
  ruleOptionsEnable.生成地区自动选择组 = false;

  const onlyJapanWithoutAuto = main({ proxies: [makeProxy('日本 ONLY', 'jp-only.example.com')] });
  assert.equal(groupByName(onlyJapanWithoutAuto, '非日本-自动选择'), undefined);
  assert.deepEqual(normalize(groupByName(onlyJapanWithoutAuto, '非日本').proxies), ['DIRECT']);
  assert.equal(groupByName(onlyJapanWithoutAuto, '非日本')['empty-fallback'], 'DIRECT');

  const onlyNonJapanWithoutAuto = main({ proxies: [makeProxy('美国 ONLY', 'us-only.example.com')] });
  assert.equal(groupByName(onlyNonJapanWithoutAuto, '日本-自动选择'), undefined);
  assert.deepEqual(normalize(groupByName(onlyNonJapanWithoutAuto, '日本').proxies), ['DIRECT']);
  assert.equal(groupByName(onlyNonJapanWithoutAuto, '日本')['empty-fallback'], 'DIRECT');
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
    makeProxy('台湾 TW 01', 'tw-sing-mix.example.com'),
    makeProxy('新加坡 SG 01', 'sg-sing-mix.example.com'),
    makeProxy('韩国 KR 01', 'kr-sing-mix.example.com'),
    makeProxy('越南 VN 01', 'vn-sing-mix.example.com'),
  ],
});

assertCustomProviders(singMixOutput, './rules');

const expectedSingMixRules = [
  'DOMAIN-SUFFIX,gov.cn,DIRECT',
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
for (const [regionName, autoSelectName] of [
  ['HK', 'URL Test - HK'],
  ['TW', 'URL Test - TW'],
  ['SG', 'URL Test - SG'],
  ['JP', 'URL Test - JP'],
  ['KR', 'URL Test - KR'],
  ['AS', 'URL Test - AS'],
  ['US', 'URL Test - US'],
  ['非日本', 'URL Test - 非日本'],
]) {
  const regionGroup = groupByName(singMixOutput, regionName);
  assert.equal(regionGroup.proxies[0], autoSelectName, `sing-mix ${regionName} 应将自动选择组放在首位`);
  assert.equal(regionGroup['default-selected'], autoSelectName, `sing-mix ${regionName} 应默认使用自动选择组`);
  assert.equal(
    groupByName(singMixOutput, autoSelectName)['empty-fallback'],
    'DIRECT',
    `sing-mix ${autoSelectName} 空组应回退 DIRECT`,
  );
}
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
assert.deepEqual(normalize(groupByName(singMixOnlyJapan, 'URL Test - 非日本').proxies), ['DIRECT']);
assert.equal(groupByName(singMixOnlyJapan, 'URL Test - 非日本')['empty-fallback'], 'DIRECT');
assert.deepEqual(normalize(groupByName(singMixOnlyJapan, '非日本').proxies), ['URL Test - 非日本']);
assert.equal(groupByName(singMixOnlyJapan, '非日本')['default-selected'], 'URL Test - 非日本');
assert.ok(!groupByName(singMixOnlyJapan, 'main').proxies.includes('非日本'));

const singMixOnlyNonJapan = singMixMain({
  proxies: [makeProxy('美国 ONLY', 'us-only-sing-mix.example.com')],
});
assert.deepEqual(normalize(groupByName(singMixOnlyNonJapan, 'URL Test - JP').proxies), ['DIRECT']);
assert.equal(groupByName(singMixOnlyNonJapan, 'URL Test - JP')['empty-fallback'], 'DIRECT');
assert.deepEqual(normalize(groupByName(singMixOnlyNonJapan, 'JP').proxies), ['URL Test - JP']);
assert.equal(groupByName(singMixOnlyNonJapan, 'JP')['default-selected'], 'URL Test - JP');
assert.deepEqual(normalize(groupByName(singMixOnlyNonJapan, 'URL Test - 非日本').proxies), ['美国 ONLY']);
assert.ok(groupByName(singMixOnlyNonJapan, 'main').proxies.includes('非日本'));

const singMixOnlyInfo = singMixMain({
  proxies: [makeProxy('订阅到期信息', 'info-only-sing-mix.example.com')],
});
for (const groupName of ['main', 'ai', 'tg']) {
  assert.deepEqual(
    normalize(groupByName(singMixOnlyInfo, groupName).proxies),
    ['REJECT'],
    `sing-mix 仅有信息节点时 ${groupName} 应使用 REJECT 兜底`,
  );
}
assert.deepEqual(normalize(groupByName(singMixOnlyInfo, 'URL Test - JP').proxies), ['DIRECT']);
assert.equal(groupByName(singMixOnlyInfo, 'URL Test - JP')['empty-fallback'], 'DIRECT');
assert.deepEqual(normalize(groupByName(singMixOnlyInfo, 'JP').proxies), ['URL Test - JP']);
assert.equal(groupByName(singMixOnlyInfo, 'JP')['default-selected'], 'URL Test - JP');
assert.deepEqual(normalize(groupByName(singMixOnlyInfo, 'URL Test - 非日本').proxies), ['DIRECT']);
assert.equal(groupByName(singMixOnlyInfo, 'URL Test - 非日本')['empty-fallback'], 'DIRECT');
assert.deepEqual(normalize(groupByName(singMixOnlyInfo, '非日本').proxies), ['URL Test - 非日本']);
assert.equal(groupByName(singMixOnlyInfo, '非日本')['default-selected'], 'URL Test - 非日本');

for (const config of [singMixOnlyJapan, singMixOnlyNonJapan, singMixOnlyInfo]) {
  assert.ok(
    config['proxy-groups'].every((group) => Array.isArray(group.proxies) && group.proxies.length > 0),
    'sing-mix 策略组必须有显式候选，empty-fallback 不能使空列表合法',
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

// 覆写脚本需独立运行；验证 DNS 链路、例外保留和多次调用间的数据隔离。
for (const [label, runMain, proxyGroup] of [
  ['mihomo', main, '默认代理'],
  ['sing-mix', singMixMain, 'main'],
]) {
  const makeInput = () => ({ proxies: [makeProxy('日本 DNS Test', 'node.private.example')] });
  const config = runMain(makeInput());
  assert.equal(config.dns['respect-rules'], true, label);
  assert.equal(config.dns['prefer-h3'], false, label);
  assert.equal(config.dns['use-hosts'], true, label);
  assert.equal(config.dns['use-system-hosts'], true, label);
  assert.equal(config.dns['fake-ip-filter-mode'], 'blacklist', label);
  assert.equal(config.profile['store-fake-ip'], true, label);
  assert.equal(config.dns.nameserver.length, 2, `${label} 应有两个国外解析器`);
  for (const resolver of config.dns.nameserver) {
    assert.ok(resolver.startsWith('https://') && resolver.endsWith(`#${proxyGroup}`), label);
  }
  for (const key of ['direct-nameserver', 'proxy-server-nameserver']) {
    assert.ok(config.dns[key].length > 0, label);
    assert.ok(
      config.dns[key].every((resolver) => resolver.endsWith('#DIRECT')),
      `${label} ${key} 不能依赖代理`,
    );
  }
  assert.deepEqual(normalize(config.dns['nameserver-policy']['rule-set:cn']), [
    'https://dns.alidns.com/dns-query#DIRECT',
    'https://doh.pub/dns-query#DIRECT',
  ]);
  assert.equal(config.rules[0], 'DOMAIN-SUFFIX,gov.cn,DIRECT', `${label} 政务域名优先于所有自定义规则`);
  assert.deepEqual(
    normalize(config.dns['nameserver-policy']['+.gov.cn']),
    ['system'],
    `${label} 政务域名只使用系统 DNS，不能混入公共解析器`,
  );
  assert.equal(
    config.dns['direct-nameserver-follow-policy'],
    true,
    `${label} DIRECT 出口重解析必须遵循 gov.cn 的系统 DNS 策略`,
  );
  assert.ok(config.dns['fake-ip-filter'].includes('+.gov.cn'), `${label} 政务域名返回真实 IP`);
  assert.ok(config.sniffer['skip-domain'].includes('+.gov.cn'), `${label} 政务域名跳过嗅探`);
  for (const pattern of ['+.lan', '+.local', '+.msftconnecttest.com', '+.pool.ntp.org', '+.stun.*.*']) {
    assert.ok(config.dns['fake-ip-filter'].includes(pattern), `${label} 缺少 ${pattern}`);
  }
  for (const pattern of config.dns['fake-ip-filter']) {
    if (!pattern.startsWith('rule-set:')) continue;
    assert.ok(config['rule-providers'][pattern.slice(9)], `${label} DNS 引用不存在的规则集 ${pattern}`);
  }
  assert.equal(config.sniffer.enable, true, label);
  assert.equal(config.sniffer['override-destination'], false, label);
  assert.equal(config.sniffer.sniff.HTTP['override-destination'], true, label);
  assert.deepEqual(normalize(config.sniffer.sniff.TLS.ports), [443, 8443]);
  assert.deepEqual(normalize(config.sniffer.sniff.QUIC.ports), [443, 8443]);
  assert.ok(config.sniffer['skip-domain'].includes('Mijia Cloud'), label);

  const customSniffer = {
    enable: false,
    'parse-pure-ip': false,
    'override-destination': true,
    'skip-domain': ['+.internal.example', 'Mijia Cloud'],
    'skip-dst-address': ['192.168.1.0/24'],
    sniff: { TLS: { ports: [9443], 'override-destination': false } },
  };
  const before = normalize(customSniffer);
  const overridden = runMain({ ...makeInput(), sniffer: customSniffer });
  assert.equal(overridden.sniffer.enable, false, `${label} 保留显式关闭`);
  assert.equal(overridden.sniffer['parse-pure-ip'], false, label);
  assert.equal(overridden.sniffer['override-destination'], true, label);
  assert.deepEqual(normalize(overridden.sniffer.sniff.TLS), before.sniff.TLS);
  assert.deepEqual(normalize(overridden.sniffer['skip-dst-address']), before['skip-dst-address']);
  assert.ok(overridden.sniffer['skip-domain'].includes('+.internal.example'), label);
  assert.equal(overridden.sniffer['skip-domain'].filter((domain) => domain === 'Mijia Cloud').length, 1, label);
  assert.deepEqual(normalize(customSniffer), before, `${label} 不修改输入嗅探对象`);
  const conflictingDns = runMain({
    ...makeInput(),
    dns: {
      'nameserver-policy': { '+.gov.cn': [`https://1.1.1.1/dns-query#${proxyGroup}`] },
      'direct-nameserver-follow-policy': false,
    },
    sniffer: { 'skip-domain': ['+.gov.cn', '+.internal.example'] },
  });
  assert.deepEqual(
    normalize(conflictingDns.dns['nameserver-policy']['+.gov.cn']),
    ['system'],
    `${label} 输入的同名 gov.cn DNS 策略不能恢复公共 DNS 解析`,
  );
  assert.equal(conflictingDns.dns['direct-nameserver-follow-policy'], true, label);
  assert.equal(conflictingDns.sniffer['skip-domain'].filter((domain) => domain === '+.gov.cn').length, 1, label);
  assert.ok(conflictingDns.sniffer['skip-domain'].includes('+.internal.example'), label);
  overridden.dns['fake-ip-filter'].push('isolated.example');
  overridden.sniffer['skip-domain'].push('isolated.example');
  const next = runMain(makeInput());
  assert.ok(!next.dns['fake-ip-filter'].includes('isolated.example'), label);
  assert.ok(!next.sniffer['skip-domain'].includes('isolated.example'), label);
}

const privateDnsOutput = main({
  proxies: [makeProxy('日本 Private DNS', 'node.private.example')],
  dns: {
    'proxy-server-nameserver': ['10.0.0.53'],
    'proxy-server-nameserver-policy': { 'node.private.example': ['10.0.0.54'] },
    'fake-ip-filter': ['node.private.example'],
  },
});
assert.deepEqual(normalize(privateDnsOutput.dns['proxy-server-nameserver-policy']), {
  'node.private.example': ['10.0.0.54'],
});
assert.ok(privateDnsOutput.dns['fake-ip-filter'].includes('node.private.example'));
const singMixPrivateDns = singMixMain({
  proxies: [makeProxy('日本 Private DNS', 'node.private.example')],
  dns: {
    'nameserver-policy': { '+.internal.example': ['10.0.0.53'] },
    'proxy-server-nameserver-policy': { 'node.private.example': ['10.0.0.54'] },
    'fake-ip-filter': ['+.internal.example'],
  },
});
assert.deepEqual(normalize(singMixPrivateDns.dns['nameserver-policy']['+.internal.example']), ['10.0.0.53']);
assert.deepEqual(normalize(singMixPrivateDns.dns['proxy-server-nameserver-policy']), {
  'node.private.example': ['10.0.0.54'],
});
assert.ok(singMixPrivateDns.dns['fake-ip-filter'].includes('+.internal.example'));
assert.equal(output.dns.ipv6, true, '保留 mihomo IPv6 默认值');
assert.equal(singMixOutput.dns.ipv6, false, '保留 sing-mix IPv6 默认值');

console.log('两个定制脚本测试通过（规则、地区组、DNS、sniffer）');
