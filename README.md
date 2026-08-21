# MyClash CustomRules

基于 [AIsouler/MyClash](https://github.com/AIsouler/MyClash) 的 `mihomoScript.js` 自动生成定制覆写脚本。

## 覆写地址

```text
https://raw.githubusercontent.com/SaiyoujiYuyuko/MyClash-CustomRules/main/Script/mihomoScript.js
```

## 定制内容

- 新增 `非日本` 地区组，包含所有未被上游 `日本` 地区规则识别的代理节点。
- 新增以下 CustomRules 规则集：
  - `direct.yaml` -> `直连`
  - `proxy.yaml` -> `默认代理`
  - `JP.yaml` -> `日本`
  - `NoJP.yaml` -> `非日本`
- 自定义规则按 `直连 -> 日本 -> 非日本 -> 默认代理` 的顺序优先匹配。
- `日本` 与 `非日本` 策略组始终存在；无匹配节点时使用上游脚本的 `empty-fallback: REJECT`。

## 自动更新

GitHub Actions 每天北京时间 09:17 检查最近一次修改上游 `Script/mihomoScript.js` 的提交，也支持在 Actions 页面手动运行。

同步过程会下载对应提交的原始脚本、重新应用定制、运行零依赖回归测试，并仅在生成结果变化时提交。若上游结构变化导致定制锚点失效，工作流会失败且不会提交不完整结果。

本地验证：

```powershell
node --check Script/mihomoScript.js
node Test/test-customized-script.mjs
node scripts/sync-upstream.mjs --check
```

## 文件说明

- `Script/mihomoScript.js`：可直接导入 Mihomo/Clash 客户端的生成结果。
- `scripts/sync-upstream.mjs`：上游下载与确定性定制生成器。
- `.upstream/mihomoScript.sha`：当前生成结果对应的上游提交。
- `Test/test-customized-script.mjs`：定制规则和地区组的零依赖测试。
- `.github/workflows/sync_upstream.yaml`：定时、手动同步工作流。

上游当前未声明开源许可证。本仓库保留原脚本中的作者与来源信息；使用及再分发应遵守上游作者的授权要求。
