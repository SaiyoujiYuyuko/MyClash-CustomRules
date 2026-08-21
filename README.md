# MyClash CustomRules

本仓库根据以下两个上游项目自动生成带 CustomRules 的 Mihomo/Clash 覆写脚本：

- [AIsouler/MyClash](https://github.com/AIsouler/MyClash)
- [Sakyvo/sing-mix](https://github.com/Sakyvo/sing-mix)

## 覆写地址

根据所用客户端和上游脚本偏好任选其一：

```text
https://raw.githubusercontent.com/SaiyoujiYuyuko/MyClash-CustomRules/main/Script/mihomoScript.js
```

```text
https://raw.githubusercontent.com/SaiyoujiYuyuko/MyClash-CustomRules/main/Script/sing-mix.js
```

## 定制内容

两个覆写脚本均新增 `非日本` 地区组，其节点为脚本实际日本地区节点的严格补集，并新增以下四个 CustomRules 规则集：

| 规则集                                                                                                       | `mihomoScript.js` 目标 | `sing-mix.js` 目标 |
| ------------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------ |
| [`direct.yaml`](https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/direct.yaml) | `直连`                 | `DIRECT`           |
| [`proxy.yaml`](https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/proxy.yaml)   | `默认代理`             | `main`             |
| [`JP.yaml`](https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/JP.yaml)         | `日本`                 | `JP`               |
| [`NoJP.yaml`](https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/NoJP.yaml)     | `非日本`               | `非日本`           |

自定义规则按 `直连 -> 日本 -> 非日本 -> 代理` 的顺序优先匹配。日本与非日本策略组始终存在；无匹配节点时显式使用 `REJECT`，避免规则引用不存在的策略组或生成静态空组。

## 自动更新

GitHub Actions 每天北京时间 09:17 分别检查：

- `AIsouler/MyClash` 的 `Script/mihomoScript.js`
- `Sakyvo/sing-mix` 的 `sing-mix_origin`

也可以在 Actions 页面手动运行。同步过程会下载各自最新提交中的原始脚本、重新应用定制、运行零依赖回归测试，并仅在生成结果变化时提交。若任一上游结构变化导致定制锚点失效，工作流会失败且不会提交不完整结果。

本地验证：

```powershell
node --check Script/mihomoScript.js
node --check Script/sing-mix.js
node Test/test-customized-script.mjs
node scripts/sync-upstream.mjs --check
```

## 文件说明

- `Script/mihomoScript.js`：基于 `AIsouler/MyClash` 的生成结果。
- `Script/sing-mix.js`：基于 `Sakyvo/sing-mix` 的生成结果。
- `CustomRules/*.yaml`：两个覆写脚本使用的自定义规则集。
- `scripts/sync-upstream.mjs`：双上游下载与确定性定制生成器。
- `.upstream/*.sha`：各生成结果对应的上游提交。
- `Test/test-customized-script.mjs`：定制规则和地区组的零依赖测试。
- `.github/workflows/sync_upstream.yaml`：定时、手动同步工作流。

本仓库保留原脚本中的作者与来源信息；使用及再分发应分别遵守两个上游项目的许可与授权要求。
