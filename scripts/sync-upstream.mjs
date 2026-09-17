import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CUSTOMIZATION_MARKER = 'CustomRules 自动同步定制';
const SING_MIX_CUSTOMIZATION_MARKER = 'CustomRules 自动同步定制（sing-mix）';

const TARGETS = {
  mihomo: {
    name: 'AIsouler/MyClash mihomoScript',
    repository: 'AIsouler/MyClash',
    branch: 'main',
    upstreamPath: 'Script/mihomoScript.js',
    outputPath: 'Script/mihomoScript.js',
    statePath: '.upstream/mihomoScript.sha',
    customize: customizeScript,
  },
  'sing-mix': {
    name: 'Sakyvo/sing-mix',
    repository: 'Sakyvo/sing-mix',
    branch: 'main',
    upstreamPath: 'sing-mix_origin',
    outputPath: 'Script/sing-mix.js',
    statePath: '.upstream/sing-mix.sha',
    customize: customizeSingMixScript,
  },
};

function replaceOnce(source, anchor, replacement, label) {
  const firstIndex = source.indexOf(anchor);
  const lastIndex = source.lastIndexOf(anchor);

  if (firstIndex === -1) {
    throw new Error(`上游结构已变化，找不到定制锚点：${label}`);
  }
  if (firstIndex !== lastIndex) {
    throw new Error(`上游结构已变化，定制锚点不再唯一：${label}`);
  }

  return `${source.slice(0, firstIndex)}${replacement}${source.slice(firstIndex + anchor.length)}`;
}

// 序列化到两份独立覆写脚本中；不能依赖生成器作用域或 Node.js API。
function buildCustomSniffer(original = {}) {
  original = original || {};
  return {
    ...original,
    enable: original.enable ?? true,
    'force-dns-mapping': original['force-dns-mapping'] ?? true,
    'parse-pure-ip': original['parse-pure-ip'] ?? true,
    'override-destination': original['override-destination'] ?? false,
    sniff: {
      ...original.sniff,
      HTTP: { ports: [80, '8080-8880'], 'override-destination': true, ...original.sniff?.HTTP },
      TLS: { ports: [443, 8443], ...original.sniff?.TLS },
      QUIC: { ports: [443, 8443], ...original.sniff?.QUIC },
    },
    'skip-domain': [
      ...new Set(['+.gov.cn', '+.oray.com', 'Mijia Cloud', '+.push.apple.com', ...(original['skip-domain'] || [])]),
    ],
  };
}

function applyCustomDns(config) {
  const dns = config.dns;
  dns['prefer-h3'] = false;
  dns['respect-rules'] = true;
  dns['fake-ip-filter-mode'] = 'blacklist';
  // 政务站点可能只有当前内网 DNS 能解析；查询和 DIRECT 出口重解析均遵循系统 DNS 策略。
  dns['nameserver-policy'] = {
    ...dns['nameserver-policy'],
    '+.gov.cn': ['system'],
  };
  dns['direct-nameserver-follow-policy'] = true;
  // 保留上游动态规则集和节点域名例外，仅补充无需远端规则集的基础兼容项。
  dns['fake-ip-filter'] = [
    ...new Set([
      ...(dns['fake-ip-filter'] || []),
      '+.gov.cn',
      'localhost',
      '+.localhost',
      '+.lan',
      '+.local',
      '+.msftconnecttest.com',
      '+.msftncsi.com',
      'time.*.com',
      'time.*.gov',
      'time.*.edu.cn',
      'time.*.apple.com',
      'ntp.*.com',
      '+.pool.ntp.org',
      '+.stun.*.*',
      '+.stun.*.*.*',
    ]),
  ];
}

function appendNetworkHelpers(source) {
  return `${source.trimEnd()}\n\n// --- CustomRules 自动同步定制：DNS 与嗅探兼容设置 ---\n${buildCustomSniffer.toString()}\n\n${applyCustomDns.toString()}\n`;
}

export function customizeScript(upstreamSource) {
  let source = upstreamSource.replace(/\r\n?/g, '\n');

  if (source.includes(CUSTOMIZATION_MARKER)) {
    throw new Error('输入文件已经包含自定义修改，必须使用未修改的上游脚本作为输入');
  }

  const prefixAnchor = 'const prefixRules = [\n';
  source = replaceOnce(
    source,
    prefixAnchor,
    `${prefixAnchor}  // --- ${CUSTOMIZATION_MARKER}：高优先级规则 ---\n` +
      "  'DOMAIN-SUFFIX,gov.cn,DIRECT',\n" +
      "  'RULE-SET,custom_direct,直连',\n" +
      "  'RULE-SET,custom_jp,日本',\n" +
      "  'RULE-SET,custom_nojp,非日本',\n" +
      "  'RULE-SET,custom_proxy,默认代理',\n\n",
    'prefixRules',
  );

  const regionAnchor = '// 定义倍率策略组\n';
  source = replaceOnce(
    source,
    regionAnchor,
    `// --- ${CUSTOMIZATION_MARKER}：非日本地区 ---\n` +
      "const japanRegionName = '日本';\n" +
      'const nonJapanRegionDefinition = {\n' +
      "  name: '非日本',\n" +
      "  icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/World_Map.png',\n" +
      '};\n\n' +
      regionAnchor,
    'regionDefinitions 尾部',
  );

  const regionGroupOptionsAnchor =
    'function createRegionGroup(name, icon, proxies) {\n' +
    '  const generateRegionAutoSelectEnabled = ruleOptionsEnable.生成地区自动选择组;\n' +
    '  const hideManualSelectGroupEnabled = ruleOptionsEnable.隐藏地区手动选择组;\n';
  source = replaceOnce(
    source,
    regionGroupOptionsAnchor,
    regionGroupOptionsAnchor +
      '  const isGeographicRegion =\n' +
      '    regionDefinitions.some((region) => region.name === name) || name === nonJapanRegionDefinition.name;\n',
    '地区组默认自动选择标记',
  );

  const regionAutoSelectGroupAnchor = '        name: urlTestName,\n        proxies,\n';
  source = replaceOnce(
    source,
    regionAutoSelectGroupAnchor,
    '        name: urlTestName,\n' +
      "        proxies: isGeographicRegion && proxies.length === 0 ? ['DIRECT'] : proxies,\n" +
      "        ...(isGeographicRegion && { 'empty-fallback': 'DIRECT' }),\n",
    '地区自动选择组 DIRECT 兜底',
  );

  const regionSelectProxiesAnchor = '        proxies: [...proxies, urlTestName],\n';
  source = replaceOnce(
    source,
    regionSelectProxiesAnchor,
    '        proxies: isGeographicRegion ? [urlTestName, ...proxies] : [...proxies, urlTestName],\n' +
      "        ...(isGeographicRegion && { 'default-selected': urlTestName }),\n",
    '地区组默认自动选择策略',
  );

  const regionManualSelectAnchor =
    '      name,\n      icon,\n      proxies,\n      hidden: hideManualSelectGroupEnabled,\n';
  source = replaceOnce(
    source,
    regionManualSelectAnchor,
    '      name,\n' +
      '      icon,\n' +
      "      proxies: isGeographicRegion && proxies.length === 0 ? ['DIRECT'] : proxies,\n" +
      "      ...(isGeographicRegion && { 'empty-fallback': 'DIRECT' }),\n" +
      '      hidden: hideManualSelectGroupEnabled,\n',
    '未生成自动选择组时的地区空组兜底',
  );

  const providerCommonAnchor = '// 定义基础 Rule Providers\n';
  source = replaceOnce(
    source,
    providerCommonAnchor,
    `// --- ${CUSTOMIZATION_MARKER}：classical YAML 规则集 ---\n` +
      'const ruleProviderCommonClassical = {\n' +
      "  type: 'http',\n" +
      "  format: 'yaml',\n" +
      '  interval: 86400,\n' +
      "  behavior: 'classical',\n" +
      '};\n\n' +
      providerCommonAnchor,
    'Rule Provider 通用配置尾部',
  );

  const providersAnchor = 'const baseRuleProviders = {\n';
  source = replaceOnce(
    source,
    providersAnchor,
    `${providersAnchor}  // --- ${CUSTOMIZATION_MARKER}：自定义规则集 ---\n` +
      '  custom_direct: {\n' +
      '    ...ruleProviderCommonClassical,\n' +
      "    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/direct.yaml',\n" +
      "    path: './ruleset/custom_direct.yaml',\n" +
      '  },\n' +
      '  custom_proxy: {\n' +
      '    ...ruleProviderCommonClassical,\n' +
      "    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/proxy.yaml',\n" +
      "    path: './ruleset/custom_proxy.yaml',\n" +
      '  },\n' +
      '  custom_jp: {\n' +
      '    ...ruleProviderCommonClassical,\n' +
      "    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/JP.yaml',\n" +
      "    path: './ruleset/custom_jp.yaml',\n" +
      '  },\n' +
      '  custom_nojp: {\n' +
      '    ...ruleProviderCommonClassical,\n' +
      "    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/NoJP.yaml',\n" +
      "    path: './ruleset/custom_nojp.yaml',\n" +
      '  },\n\n',
    'baseRuleProviders',
  );

  const allProxiesAnchor =
    '  const otherProxies = [];\n\n  for (const proxy of [...filteredProxies, ...customProxies]) {';
  source = replaceOnce(
    source,
    allProxiesAnchor,
    '  const otherProxies = [];\n' +
      '  const allProxies = [...filteredProxies, ...customProxies];\n\n' +
      '  for (const proxy of allProxies) {',
    'buildRegionGroups 节点集合',
  );

  const nonJapanAnchor =
    '    .flatMap((r) => createRegionGroup(r.name, r.icon, regionGroups[r.name]));\n\n  if (otherProxies.length > 0) {';
  source = replaceOnce(
    source,
    nonJapanAnchor,
    '    .flatMap((r) => createRegionGroup(r.name, r.icon, regionGroups[r.name]));\n\n' +
      `  // --- ${CUSTOMIZATION_MARKER}：日本节点的严格补集 ---\n` +
      '  const japanProxyNames = new Set(regionGroups[japanRegionName]);\n' +
      '  const nonJapanProxies = allProxies.map((proxy) => proxy.name).filter((name) => !japanProxyNames.has(name));\n' +
      '  generatedRegionGroups.push(\n' +
      '    ...createRegionGroup(nonJapanRegionDefinition.name, nonJapanRegionDefinition.icon, nonJapanProxies),\n' +
      '  );\n\n' +
      '  // 日本组被规则直接引用；无日本节点时追加含 DIRECT 候选的兜底组\n' +
      '  if (japanProxyNames.size === 0) {\n' +
      '    const japanRegionDefinition = regionDefinitions.find((region) => region.name === japanRegionName);\n' +
      '    generatedRegionGroups.push(...createRegionGroup(japanRegionName, japanRegionDefinition.icon, []));\n' +
      '  }\n\n' +
      '  if (otherProxies.length > 0) {',
    'buildRegionGroups 非日本组',
  );

  const defaultProxyBaseGroupsAnchor =
    '  const baseGroupNames = baseGroups.filter((g) => ruleOptionsEnable[g.name]).map((g) => g.name);\n';
  source = replaceOnce(
    source,
    defaultProxyBaseGroupsAnchor,
    defaultProxyBaseGroupsAnchor +
      `  // --- ${CUSTOMIZATION_MARKER}：默认代理候选顺序 ---\n` +
      "  const defaultProxyBaseGroupOrder = ['自动选择', '手动选择', '负载均衡'];\n" +
      '  const defaultProxyBaseGroupNames = [\n' +
      '    ...defaultProxyBaseGroupOrder.filter((name) => baseGroupNames.includes(name)),\n' +
      '    ...baseGroupNames.filter((name) => !defaultProxyBaseGroupOrder.includes(name)),\n' +
      '  ];\n',
    '默认代理基础组顺序',
  );

  const defaultProxyListAnchor = '    proxies: [...groupNamesOfSelect, ...baseGroupNames, ...customGroupNames],\n';
  source = replaceOnce(
    source,
    defaultProxyListAnchor,
    '    proxies: [...defaultProxyBaseGroupNames, ...groupNamesOfSelect, ...customGroupNames],\n',
    '默认代理候选列表顺序',
  );

  const fallbackGroupAnchor =
    "    name: '漏网之鱼',\n" +
    "    proxies: ['默认代理', '直连', ...groupNamesOfSelect],\n" +
    "    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Stack.png',\n";
  source = replaceOnce(
    source,
    fallbackGroupAnchor,
    "    name: '漏网之鱼',\n" +
      "    proxies: ['默认代理', '直连', ...groupNamesOfSelect],\n" +
      "    'default-selected': '直连',\n" +
      "    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Stack.png',\n",
    '漏网之鱼默认选择',
  );

  const requiredFragments = [
    "'RULE-SET,custom_direct,直连'",
    "'RULE-SET,custom_jp,日本'",
    "'RULE-SET,custom_nojp,非日本'",
    "'RULE-SET,custom_proxy,默认代理'",
    "behavior: 'classical'",
    'CustomRules/direct.yaml',
    'CustomRules/proxy.yaml',
    'CustomRules/JP.yaml',
    'CustomRules/NoJP.yaml',
    "name: '非日本'",
    'regionDefinitions.some((region) => region.name === name) || name === nonJapanRegionDefinition.name',
    "...(isGeographicRegion && { 'empty-fallback': 'DIRECT' })",
    "...(isGeographicRegion && { 'default-selected': urlTestName })",
    'createRegionGroup(japanRegionName, japanRegionDefinition.icon, [])',
    "const defaultProxyBaseGroupOrder = ['自动选择', '手动选择', '负载均衡'];",
    'proxies: [...defaultProxyBaseGroupNames, ...groupNamesOfSelect, ...customGroupNames]',
    "'default-selected': '直连'",
  ];
  for (const fragment of requiredFragments) {
    if (!source.includes(fragment)) {
      throw new Error(`生成结果缺少必要内容：${fragment}`);
    }
  }

  source = replaceOnce(
    source,
    "const chinaDNS = ['223.5.5.5#DIRECT', '119.29.29.29#DIRECT'];",
    "const chinaDNS = ['https://dns.alidns.com/dns-query#DIRECT', 'https://doh.pub/dns-query#DIRECT'];",
    'mihomo 国内 DoH',
  );
  source = replaceOnce(
    source,
    '  return newConfig;\n}',
    '  newConfig.sniffer = buildCustomSniffer(config.sniffer);\n' +
      '  applyCustomDns(newConfig);\n\n' +
      '  return newConfig;\n}',
    'mihomo DNS 与嗅探定制入口',
  );
  return appendNetworkHelpers(source);
}

export function customizeSingMixScript(upstreamSource) {
  let source = upstreamSource.replace(/\r\n?/g, '\n');

  if (source.includes(SING_MIX_CUSTOMIZATION_MARKER)) {
    throw new Error('输入文件已经包含 sing-mix 自定义修改，必须使用未修改的上游脚本作为输入');
  }

  const providersAnchor = '  return providers;\n};';
  source = replaceOnce(
    source,
    providersAnchor,
    `  // --- ${SING_MIX_CUSTOMIZATION_MARKER}：classical YAML 规则集 ---\n` +
      '  const customRuleProviderBase = {\n' +
      '    type: "http",\n' +
      '    behavior: "classical",\n' +
      '    format: "yaml",\n' +
      '    interval: 86400\n' +
      '  };\n\n' +
      '  providers.custom_direct = {\n' +
      '    ...customRuleProviderBase,\n' +
      '    url: "https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/direct.yaml",\n' +
      '    path: "./rules/custom_direct.yaml"\n' +
      '  };\n' +
      '  providers.custom_proxy = {\n' +
      '    ...customRuleProviderBase,\n' +
      '    url: "https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/proxy.yaml",\n' +
      '    path: "./rules/custom_proxy.yaml"\n' +
      '  };\n' +
      '  providers.custom_jp = {\n' +
      '    ...customRuleProviderBase,\n' +
      '    url: "https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/JP.yaml",\n' +
      '    path: "./rules/custom_jp.yaml"\n' +
      '  };\n' +
      '  providers.custom_nojp = {\n' +
      '    ...customRuleProviderBase,\n' +
      '    url: "https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/NoJP.yaml",\n' +
      '    path: "./rules/custom_nojp.yaml"\n' +
      '  };\n\n' +
      providersAnchor,
    'sing-mix buildRuleProviders 返回值',
  );

  const rulesAnchor = 'const STATIC_RULES = [\n';
  source = replaceOnce(
    source,
    rulesAnchor,
    `${rulesAnchor}  // --- ${SING_MIX_CUSTOMIZATION_MARKER}：高优先级规则 ---\n` +
      '  "DOMAIN-SUFFIX,gov.cn,DIRECT",\n' +
      '  "RULE-SET,custom_direct,DIRECT",\n' +
      '  "RULE-SET,custom_jp,JP",\n' +
      '  "RULE-SET,custom_nojp,非日本",\n' +
      '  "RULE-SET,custom_proxy,main",\n\n',
    'sing-mix STATIC_RULES',
  );

  const proxyGroupsSignatureAnchor =
    'const buildProxyGroups = ({\n' +
    '  allNames,\n' +
    '  allAiNames,\n' +
    '  activeRegionMap,\n' +
    '  activeRegionNameSet,\n' +
    '  otherProxyNames,\n' +
    '  infoNames\n' +
    '}) => {';
  source = replaceOnce(
    source,
    proxyGroupsSignatureAnchor,
    'const buildProxyGroups = ({\n' +
      '  allNames,\n' +
      '  allAiNames,\n' +
      '  activeRegionMap,\n' +
      '  activeRegionNameSet,\n' +
      '  nonJapanNames,\n' +
      '  otherProxyNames,\n' +
      '  infoNames\n' +
      '}) => {',
    'sing-mix buildProxyGroups 参数',
  );

  const mainGroupAnchor =
    '    const mainEntries = ["All", ...regionEntries];\n' +
    '    if (otherProxyNames.length) mainEntries.push("Other");';
  source = replaceOnce(
    source,
    mainGroupAnchor,
    '    const mainEntries = ["All", ...regionEntries];\n' +
      '    if (nonJapanNames.length) mainEntries.push("非日本");\n' +
      '    if (otherProxyNames.length) mainEntries.push("Other");',
    'sing-mix main 组',
  );

  const addConditionAnchor = '    if (name && proxies.length) {';
  source = replaceOnce(
    source,
    addConditionAnchor,
    '    const hasEmptyFallback = Boolean(extra["empty-fallback"]);\n' +
      '    if (name && (proxies.length || hasEmptyFallback)) {',
    'sing-mix 允许 empty-fallback 空组',
  );

  const addRegionGroupAnchor = '  };\n\n  add("fcm", "select", ["DIRECT"], "Google_Search.png", { hidden: true });';
  source = replaceOnce(
    source,
    addRegionGroupAnchor,
    '  };\n\n' +
      '  const addRegionGroup = (name, proxies, icon) => {\n' +
      '    const autoSelectName = `URL Test - ${name}`;\n' +
      '    add(autoSelectName, "url-test", proxies.length ? proxies : ["DIRECT"], icon, {\n' +
      '      ...SETTINGS.URL_TEST_EXTRA,\n' +
      '      "empty-fallback": "DIRECT"\n' +
      '    });\n' +
      '    add(name, "select", [autoSelectName, ...proxies], icon, {\n' +
      '      "default-selected": autoSelectName\n' +
      '    });\n' +
      '  };\n\n' +
      '  add("fcm", "select", ["DIRECT"], "Google_Search.png", { hidden: true });',
    'sing-mix 统一地区组构造器',
  );

  const regionGroupsAnchor =
    '    add(`URL Test - ${region.name}`, "url-test", region.proxies, region.icon, SETTINGS.URL_TEST_EXTRA);\n' +
    '    add(region.name, "select", [`URL Test - ${region.name}`, ...region.proxies], region.icon);';
  source = replaceOnce(
    source,
    regionGroupsAnchor,
    '    addRegionGroup(region.name, region.proxies, region.icon);',
    'sing-mix 地区组默认自动选择策略',
  );

  const customGroupsAnchor = '  // Other 组\n';
  source = replaceOnce(
    source,
    customGroupsAnchor,
    `  // --- ${SING_MIX_CUSTOMIZATION_MARKER}：稳定的固定规则目标 ---\n` +
      '  if (!groups.some((group) => group.name === "main")) {\n' +
      '    add("main", "select", ["REJECT"], "Available.png");\n' +
      '  }\n' +
      '  if (!groups.some((group) => group.name === "ai")) {\n' +
      '    add("ai", "select", ["REJECT"], "ChatGPT.png");\n' +
      '  }\n' +
      '  if (!groups.some((group) => group.name === "tg")) {\n' +
      '    add("tg", "select", ["REJECT"], "Telegram.png");\n' +
      '  }\n\n' +
      '  if (!activeRegionNameSet.has("JP")) {\n' +
      '    addRegionGroup("JP", [], "Japan.png");\n' +
      '  }\n\n' +
      '  addRegionGroup("非日本", nonJapanNames, "World_Map.png");\n\n' +
      customGroupsAnchor,
    'sing-mix 自定义地区组',
  );

  const globalGroupAnchor = '      ...regionEntries,\n' + '      ...(otherProxyNames.length ? ["Other"] : []),';
  source = replaceOnce(
    source,
    globalGroupAnchor,
    '      ...regionEntries,\n' +
      '      ...(nonJapanNames.length ? ["非日本"] : []),\n' +
      '      ...(otherProxyNames.length ? ["Other"] : []),',
    'sing-mix GLOBAL 组',
  );

  const nonJapanNamesAnchor = '    const allAiNames = buildAllAiProxyList(activeRegions, otherProxyNames, allNames);';
  source = replaceOnce(
    source,
    nonJapanNamesAnchor,
    `    // --- ${SING_MIX_CUSTOMIZATION_MARKER}：JP 实际分组的严格补集 ---\n` +
      '    const japanProxyNames = new Set((activeRegionMap.get("JP") || {}).proxies || []);\n' +
      '    const nonJapanNames = allNames.filter((name) => !japanProxyNames.has(name));\n\n' +
      nonJapanNamesAnchor,
    'sing-mix 非日本节点集合',
  );

  const populatedGroupCallAnchor =
    '      activeRegionMap,\n' +
    '      activeRegionNameSet,\n' +
    '      otherProxyNames,\n' +
    '      infoNames\n' +
    '    });';
  source = replaceOnce(
    source,
    populatedGroupCallAnchor,
    '      activeRegionMap,\n' +
      '      activeRegionNameSet,\n' +
      '      nonJapanNames,\n' +
      '      otherProxyNames,\n' +
      '      infoNames\n' +
      '    });',
    'sing-mix 非空节点组调用',
  );

  const emptyGroupCallAnchor =
    '      activeRegionMap: new Map(),\n' + '      activeRegionNameSet: new Set(),\n' + '      otherProxyNames: [],';
  source = replaceOnce(
    source,
    emptyGroupCallAnchor,
    '      activeRegionMap: new Map(),\n' +
      '      activeRegionNameSet: new Set(),\n' +
      '      nonJapanNames: [],\n' +
      '      otherProxyNames: [],',
    'sing-mix 空节点组调用',
  );

  const requiredFragments = [
    '"RULE-SET,custom_direct,DIRECT"',
    '"RULE-SET,custom_jp,JP"',
    '"RULE-SET,custom_nojp,非日本"',
    '"RULE-SET,custom_proxy,main"',
    'providers.custom_direct',
    'CustomRules/direct.yaml',
    'CustomRules/proxy.yaml',
    'CustomRules/JP.yaml',
    'CustomRules/NoJP.yaml',
    'const nonJapanNames = allNames.filter((name) => !japanProxyNames.has(name))',
    'add("main", "select", ["REJECT"], "Available.png")',
    'add("ai", "select", ["REJECT"], "ChatGPT.png")',
    'add("tg", "select", ["REJECT"], "Telegram.png")',
    'const hasEmptyFallback = Boolean(extra["empty-fallback"])',
    'const addRegionGroup = (name, proxies, icon) =>',
    '"empty-fallback": "DIRECT"',
    '"default-selected": autoSelectName',
    'addRegionGroup("JP", [], "Japan.png")',
    'addRegionGroup("非日本", nonJapanNames, "World_Map.png")',
  ];
  for (const fragment of requiredFragments) {
    if (!source.includes(fragment)) {
      throw new Error(`sing-mix 生成结果缺少必要内容：${fragment}`);
    }
  }

  source = replaceOnce(
    source,
    '  const chinaDNS = [\n' +
      '    "system",\n' +
      '    "https://dns.alidns.com/dns-query",\n' +
      '    "https://doh.pub/dns-query"\n' +
      '  ];',
    '  const chinaDNS = [\n' +
      '    "https://dns.alidns.com/dns-query#DIRECT",\n' +
      '    "https://doh.pub/dns-query#DIRECT"\n' +
      '  ];',
    'sing-mix 国内 DoH',
  );
  source = replaceOnce(
    source,
    '  const foreignDNS = ["https://1.1.1.1/dns-query#main"];',
    '  const foreignDNS = ["https://1.1.1.1/dns-query#main", "https://dns.google/dns-query#main"];',
    'sing-mix 国外 DoH 冗余',
  );
  source = replaceOnce(
    source,
    '    nameserver: foreignDNS,\n',
    '    nameserver: foreignDNS,\n' +
      '    "nameserver-policy": {\n' +
      '      "rule-set:cn": chinaDNS,\n' +
      '      ...(dns["nameserver-policy"] || {})\n' +
      '    },\n',
    'sing-mix 国内域名解析策略',
  );
  source = replaceOnce(
    source,
    'const applySniffer = (cfg) => {\n' +
      '  cfg.sniffer = {\n' +
      '    ...(cfg.sniffer || {}),\n' +
      '    enable: true,\n' +
      '    "force-dns-mapping": true,\n' +
      '    "parse-pure-ip": true,\n' +
      '    "override-destination": true,\n' +
      '    sniff: {\n' +
      '      HTTP: { ports: [80, "8080-8880"], "override-destination": true },\n' +
      '      TLS: { ports: [443, 8443] },\n' +
      '      QUIC: { ports: [443, 8443] }\n' +
      '    }\n' +
      '  };\n' +
      '};',
    'const applySniffer = (cfg) => {\n  cfg.sniffer = buildCustomSniffer(cfg.sniffer);\n};',
    'sing-mix 嗅探定制入口',
  );
  source = replaceOnce(
    source,
    '  applyDns(config);',
    '  applyDns(config);\n  applyCustomDns(config);',
    'sing-mix DNS 定制入口',
  );
  source = replaceOnce(source, '    "store-fake-ip": false', '    "store-fake-ip": true', 'sing-mix fake-ip 持久化');
  return appendNetworkHelpers(source);
}

function parseArguments(argv) {
  const options = {
    target: null,
    input: null,
    output: null,
    state: null,
    sha: null,
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      options.check = true;
      continue;
    }
    if (!['--target', '--input', '--output', '--state', '--sha'].includes(argument)) {
      throw new Error(`未知参数：${argument}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`参数 ${argument} 缺少值`);
    options[argument.slice(2)] = value;
    index += 1;
  }

  if (Boolean(options.input) !== Boolean(options.sha)) {
    throw new Error('--input 与 --sha 必须同时提供');
  }

  const hasSingleTargetOptions = Boolean(options.input || options.output || options.state || options.sha);
  if (hasSingleTargetOptions && !options.target) options.target = 'mihomo';
  if (options.target && !TARGETS[options.target]) {
    throw new Error(`未知同步目标：${options.target}，可选值为 ${Object.keys(TARGETS).join('、')}`);
  }

  return options;
}

async function fetchLatestUpstreamScript(target) {
  const commitsUrl = new URL(`https://api.github.com/repos/${target.repository}/commits`);
  commitsUrl.searchParams.set('sha', target.branch);
  commitsUrl.searchParams.set('path', target.upstreamPath);
  commitsUrl.searchParams.set('per_page', '1');

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'MyClash-custom-sync',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const commitResponse = await fetch(commitsUrl, { headers });
  if (!commitResponse.ok) {
    throw new Error(`${target.name} 查询上游提交失败：HTTP ${commitResponse.status} ${await commitResponse.text()}`);
  }
  const commits = await commitResponse.json();
  const sha = commits?.[0]?.sha;
  if (!sha) throw new Error(`${target.name} 上游提交查询未返回有效 SHA`);

  const rawUrl = `https://raw.githubusercontent.com/${target.repository}/${sha}/${target.upstreamPath}`;
  const scriptResponse = await fetch(rawUrl, { headers: { 'User-Agent': headers['User-Agent'] } });
  if (!scriptResponse.ok) {
    throw new Error(`${target.name} 下载上游脚本失败：HTTP ${scriptResponse.status} ${await scriptResponse.text()}`);
  }

  return { sha, source: await scriptResponse.text() };
}

async function readCurrentFile(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeGeneratedFiles(outputPath, statePath, generated, sha) {
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
  await writeFile(statePath, `${sha}\n`, 'utf8');
}

async function processTarget(target, options) {
  const output = options.output || target.outputPath;
  const stateFile = options.state || target.statePath;
  const outputPath = resolve(output);
  const statePath = resolve(stateFile);

  const upstream = options.input
    ? { sha: options.sha, source: await readFile(resolve(options.input), 'utf8') }
    : await fetchLatestUpstreamScript(target);
  const generated = target.customize(upstream.source);
  const state = `${upstream.sha}\n`;

  if (options.check) {
    const [currentOutput, currentState] = await Promise.all([readCurrentFile(outputPath), readCurrentFile(statePath)]);
    if (currentOutput !== generated || currentState !== state) {
      throw new Error(`${target.name} 定制脚本不是上游 ${upstream.sha} 的最新生成结果`);
    }
    console.log(`${target.name} 定制脚本已与上游 ${upstream.sha} 保持同步`);
    return;
  }

  await writeGeneratedFiles(outputPath, statePath, generated, upstream.sha);
  console.log(`已基于 ${target.name} 上游 ${upstream.sha} 生成 ${output}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const selectedTargets = options.target ? [TARGETS[options.target]] : Object.values(TARGETS);

  for (const target of selectedTargets) {
    await processTarget(target, options);
  }
}

const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
