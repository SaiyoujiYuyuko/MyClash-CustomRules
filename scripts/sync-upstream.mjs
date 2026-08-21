import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UPSTREAM_REPOSITORY = 'AIsouler/MyClash';
const UPSTREAM_BRANCH = 'main';
const UPSTREAM_SCRIPT_PATH = 'Script/mihomoScript.js';
const DEFAULT_OUTPUT_PATH = UPSTREAM_SCRIPT_PATH;
const DEFAULT_STATE_PATH = '.upstream/mihomoScript.sha';
const CUSTOMIZATION_MARKER = 'CustomRules 自动同步定制';

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
      "    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/CustomRules@main/custom-rules/direct.yaml',\n" +
      "    path: './ruleset/custom_direct.yaml',\n" +
      '  },\n' +
      '  custom_proxy: {\n' +
      '    ...ruleProviderCommonClassical,\n' +
      "    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/CustomRules@main/custom-rules/proxy.yaml',\n" +
      "    path: './ruleset/custom_proxy.yaml',\n" +
      '  },\n' +
      '  custom_jp: {\n' +
      '    ...ruleProviderCommonClassical,\n' +
      "    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/CustomRules@main/custom-rules/JP.yaml',\n" +
      "    path: './ruleset/custom_jp.yaml',\n" +
      '  },\n' +
      '  custom_nojp: {\n' +
      '    ...ruleProviderCommonClassical,\n' +
      "    url: 'https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/CustomRules@main/custom-rules/NoJP.yaml',\n" +
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
      "  const nonJapanGroupProxies = nonJapanProxies.length > 0 ? nonJapanProxies : ['REJECT'];\n" +
      '  generatedRegionGroups.push(\n' +
      '    ...createRegionGroup(nonJapanRegionDefinition.name, nonJapanRegionDefinition.icon, nonJapanGroupProxies),\n' +
      '  );\n\n' +
      '  // 日本组被规则直接引用；无日本节点时追加 REJECT 兜底组，但不让它成为“默认代理”的首选项\n' +
      '  if (japanProxyNames.size === 0) {\n' +
      '    const japanRegionDefinition = regionDefinitions.find((region) => region.name === japanRegionName);\n' +
      "    generatedRegionGroups.push(...createRegionGroup(japanRegionName, japanRegionDefinition.icon, ['REJECT']));\n" +
      '  }\n\n' +
      '  if (otherProxies.length > 0) {',
    'buildRegionGroups 非日本组',
  );

  const requiredFragments = [
    "'RULE-SET,custom_direct,直连'",
    "'RULE-SET,custom_jp,日本'",
    "'RULE-SET,custom_nojp,非日本'",
    "'RULE-SET,custom_proxy,默认代理'",
    "behavior: 'classical'",
    'custom-rules/direct.yaml',
    'custom-rules/proxy.yaml',
    'custom-rules/JP.yaml',
    'custom-rules/NoJP.yaml',
    "name: '非日本'",
    "nonJapanProxies.length > 0 ? nonJapanProxies : ['REJECT']",
    "createRegionGroup(japanRegionName, japanRegionDefinition.icon, ['REJECT'])",
  ];
  for (const fragment of requiredFragments) {
    if (!source.includes(fragment)) {
      throw new Error(`生成结果缺少必要内容：${fragment}`);
    }
  }

  return source.endsWith('\n') ? source : `${source}\n`;
}

function parseArguments(argv) {
  const options = {
    input: null,
    output: DEFAULT_OUTPUT_PATH,
    state: DEFAULT_STATE_PATH,
    sha: null,
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      options.check = true;
      continue;
    }
    if (!['--input', '--output', '--state', '--sha'].includes(argument)) {
      throw new Error(`未知参数：${argument}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`参数 ${argument} 缺少值`);
    options[argument.slice(2)] = value;
    index += 1;
  }

  if (options.input && !options.sha) {
    throw new Error('使用 --input 时必须同时提供 --sha');
  }
  return options;
}

async function fetchLatestUpstreamScript() {
  const commitsUrl = new URL(`https://api.github.com/repos/${UPSTREAM_REPOSITORY}/commits`);
  commitsUrl.searchParams.set('sha', UPSTREAM_BRANCH);
  commitsUrl.searchParams.set('path', UPSTREAM_SCRIPT_PATH);
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
    throw new Error(`查询上游提交失败：HTTP ${commitResponse.status} ${await commitResponse.text()}`);
  }
  const commits = await commitResponse.json();
  const sha = commits?.[0]?.sha;
  if (!sha) throw new Error('上游提交查询未返回有效 SHA');

  const rawUrl = `https://raw.githubusercontent.com/${UPSTREAM_REPOSITORY}/${sha}/${UPSTREAM_SCRIPT_PATH}`;
  const scriptResponse = await fetch(rawUrl, { headers: { 'User-Agent': headers['User-Agent'] } });
  if (!scriptResponse.ok) {
    throw new Error(`下载上游脚本失败：HTTP ${scriptResponse.status} ${await scriptResponse.text()}`);
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

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const outputPath = resolve(options.output);
  const statePath = resolve(options.state);

  const upstream = options.input
    ? { sha: options.sha, source: await readFile(resolve(options.input), 'utf8') }
    : await fetchLatestUpstreamScript();
  const generated = customizeScript(upstream.source);
  const state = `${upstream.sha}\n`;

  if (options.check) {
    const [currentOutput, currentState] = await Promise.all([readCurrentFile(outputPath), readCurrentFile(statePath)]);
    if (currentOutput !== generated || currentState !== state) {
      throw new Error(`定制脚本不是上游 ${upstream.sha} 的最新生成结果`);
    }
    console.log(`定制脚本已与上游 ${upstream.sha} 保持同步`);
    return;
  }

  await writeGeneratedFiles(outputPath, statePath, generated, upstream.sha);
  console.log(`已基于上游 ${upstream.sha} 生成 ${options.output}`);
}

const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
