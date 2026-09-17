# MyClash CustomRules

本仓库根据以下两个上游项目自动生成带 CustomRules 的 Mihomo/Clash 覆写脚本：

- [AIsouler/MyClash](https://github.com/AIsouler/MyClash)
- [Sakyvo/sing-mix](https://github.com/Sakyvo/sing-mix)

## 覆写地址

根据所用客户端和上游脚本偏好任选其一：

### mihomoScript.js

GitHub Raw 地址：

```text
https://raw.githubusercontent.com/SaiyoujiYuyuko/MyClash-CustomRules/main/Script/mihomoScript.js
```

jsDelivr 加速地址：

```text
https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/Script/mihomoScript.js
```

### sing-mix.js

GitHub Raw 地址：

```text
https://raw.githubusercontent.com/SaiyoujiYuyuko/MyClash-CustomRules/main/Script/sing-mix.js
```

jsDelivr 加速地址：

```text
https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/Script/sing-mix.js
```

## 定制内容

两个覆写脚本均新增 `非日本` 地区组，其节点为脚本实际日本地区节点的严格补集，并新增以下四个 CustomRules 规则集：

| 规则集                                                                                                       | `mihomoScript.js` 目标 | `sing-mix.js` 目标 |
| ------------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------ |
| [`direct.yaml`](https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/direct.yaml) | `直连`                 | `DIRECT`           |
| [`proxy.yaml`](https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/proxy.yaml)   | `默认代理`             | `main`             |
| [`JP.yaml`](https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/JP.yaml)         | `日本`                 | `JP`               |
| [`NoJP.yaml`](https://cdn.jsdelivr.net/gh/SaiyoujiYuyuko/MyClash-CustomRules@main/CustomRules/NoJP.yaml)     | `非日本`               | `非日本`           |

规则首先匹配 `DOMAIN-SUFFIX,gov.cn,DIRECT`，覆盖 `gov.cn` 本域及任意层级子域，直接使用内置 `DIRECT` 出口。其他自定义规则按 `直连 -> 日本 -> 非日本 -> 代理` 的顺序匹配。启用地区自动选择时，所有地区组均默认进入各自的自动选择组；日本与非日本策略组即使没有匹配节点也会保留，并添加显式 `DIRECT` 候选和 `empty-fallback: DIRECT`，保持直连回退行为。仅设置 `empty-fallback` 仍会因 `proxies: []` 被 Mihomo 拒绝。

## DNS 与 sniffer 定制

生成器参考 `example.yaml` 的 DNS/sniffer 设置作了选择性补充，两份生成脚本均可独立使用；定时更新会自动重新应用这些设置，无需手工修改生成结果。示例文件仅用于对照，不参与生成，也不导入其中的订阅、节点、策略组或面板设置。

| 配置               | 定制后的行为                                                                                          | 原因                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 国内 DNS           | 国内域名策略与直连出口使用阿里、腾讯 DoH，明确指定 `#DIRECT`                                          | 避免由代理策略决定国内解析器的出口；sing-mix 不再将 `system` 混入公共 DNS 列表 |
| 国内域名分流       | 两者均有 `rule-set:cn` 的 `nameserver-policy`；sing-mix 保留输入中已有的策略覆盖                      | fake-ip 例外不等于 DNS 分流，返回真实 IP 的国内查询也需要明确解析器            |
| 国外 DNS           | mihomo 保留原有双 DoH；sing-mix 增加 Google DoH，与 Cloudflare 一起通过 `main` 查询                   | 增加解析器冗余；使用各自实际存在的策略组                                       |
| DNS 引导与节点解析 | 保留 `default-nameserver`、独立的 `proxy-server-nameserver` 及上游节点专用策略处理                    | 防止先建立代理才能解析代理节点的循环依赖；引导 DNS 仍可能使用普通 UDP          |
| DNS 连接路由       | `respect-rules: true`、`prefer-h3: false`                                                             | 配合独立节点解析器使用，避免 HTTP/3 与此选项的兼容问题                         |
| fake-ip            | 保留上游规则集及节点例外，补充本地域名、Windows 网络检测、常用 NTP/STUN 域名模式；使用 blacklist 模式 | 降低常见服务与 fake-ip 的兼容问题，不复制整份静态网站清单                      |
| fake-ip 缓存       | 两者均启用 `store-fake-ip`                                                                            | 在内核使用持久化缓存时，重启后可恢复映射，减少客户端仍缓存旧 fake-ip 的问题    |
| sniffer            | 默认启用 HTTP（80、8080–8880）、TLS/QUIC（443、8443），开启 DNS 映射和纯 IP 流量嗅探                  | 补齐 mihomoScript 的嗅探配置；仅有 IP 的流量可尝试补充域名用于规则匹配         |
| 嗅探目标改写       | 全局默认关闭，HTTP 单独启用                                                                           | TLS/QUIC 默认保留原连接目标，减少嗅探域名与原目标不一致造成的问题              |
| 嗅探例外           | 合并 `+.oray.com`、`Mijia Cloud`、`+.push.apple.com`；保留输入的开关、端口及其他例外                  | 兼容向日葵、米家和 Apple 推送，也允许输入配置显式关闭嗅探                      |

这些脚本面向 **Mihomo**。`example.yaml` 的 sniffer 实际为关闭状态，参数更多不代表更适合当前脚本：

- IPv6、TUN 栈、路由和监听地址保留各自上游行为；mihomo 的 DNS 默认启用 IPv6，sing-mix 默认关闭。不能据此保证所有网络环境都可用。
- 保留 `use-hosts` / `use-system-hosts`，避免破坏上游 hosts 映射。没有复制示例中的 `geosite` 数据库依赖，继续使用仓库已有的 rule-provider。
- 不引入 `disable-keep-alive: true`、15 秒保活、全局指纹和额外 GEO/NTP 配置；它们与设备、连接方式有关，不是通用加速参数。
- fake-ip 例外只决定是否返回真实 IP，不代表强制直连，也不能让公共 DNS 解析局域网私有域名；私有域名仍需适当的 hosts 或本地 DNS 策略。
- QUIC 嗅探不会绕过已有的 QUIC 拦截规则；mihomoScript 的“屏蔽国外QUIC”开关仍按上游逻辑生效。

维护时修改 `scripts/sync-upstream.mjs` 再重新生成。DNS/sniffer 的锚点不匹配会使生成失败，回归测试会检查规则集引用、节点解析器、输入嗅探设置保留及重复调用隔离。

配置语义参考：[Mihomo DNS](https://wiki.metacubex.one/config/dns/)、[域名嗅探](https://wiki.metacubex.one/config/sniff/)。

### gov.cn 专用直连

两份脚本同时生成以下设置；它们独立于远端 `cn` 规则集是否收录某个网站：

- 将 `DOMAIN-SUFFIX,gov.cn,DIRECT` 放在规则首位，避免被后续日本、非日本或代理规则抢先匹配，也不受“直连”策略组保存的 IPv4/IPv6 选项影响。
- `nameserver-policy` 的 `+.gov.cn` 仅使用 `system`，向当前电脑配置的系统 DNS 查询，适用于政务内网、单位网络等内部解析场景；不为这些域名配置阿里、腾讯或国外公共 DNS。
- 设置 `direct-nameserver-follow-policy: true`，让 DIRECT 出口建立连接时也遵循该系统 DNS 策略，避免再次用 `direct-nameserver` 中的公共 DNS 解析。同样，其他已有域名解析策略也会作用于直连出口；未命中策略的直连查询继续使用原来的 `direct-nameserver`。
- 将 `+.gov.cn` 加入 blacklist 模式的 `fake-ip-filter`，返回真实 IP，并加入 sniffer 的 `skip-domain`。

这些设置表示“不经过代理节点，使用电脑当前网络的 DNS”，仍由 Mihomo 处理 DNS 和连接；启用 TUN 时也仍经过 TUN。系统 DNS 是电脑当前配置的内网、路由器或运营商 DNS，并非指定某个公共 DNS。如果要让浏览器连接完全绕过 Mihomo，还需在客户端配置系统代理排除/PAC，并确保 TUN 没有再次接管；仅靠域名分流规则无法做到。跳转到其他后缀的域名仍按原有规则处理。

Mihomo v1.19.31 在 Windows 上的 `system` 会枚举已启用且有网关的网卡 DNS 后直接查询，不调用完整的 Windows DNS Client 流程，不能等同于 Windows NRPT 域名解析策略。内核在未枚举到系统 DNS 时内置了公共 DNS 回退；因此 `system` 不能保证在所有网卡/VPN 环境中都只访问内网 DNS。若要求内网域名绝不发往公共 DNS，应在实际客户端指定本网络的内网 DNS 地址，或在客户端与 TUN 两层实现完全绕过。仓库不硬编码某台电脑的内网 DNS 地址。

更新后请在客户端重新应用覆写并重载配置，重启浏览器后测试；必要时清理客户端 DNS/fake-ip 缓存及 Windows DNS 缓存（`ipconfig /flushdns`）。如果使用远程脚本地址，需要先将本地修改发布到仓库，再让客户端更新脚本；仅修改本地仓库不会改变客户端当前配置。

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
