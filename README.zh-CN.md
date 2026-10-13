# omp-coding-plan-usage

[English](./README.md) | 简体中文

[Zhipu GLM Coding Plan](https://docs.bigmodel.cn/cn/coding-plan/overview)（国内版
`open.bigmodel.cn`）的额度查询插件，为 [omp](https://omp.sh) 的 `omp usage`、会话内
`/usage` 和状态栏额度段提供实时配额数据。

omp 内置的 usage provider 注册表目前只收录了国际版 `zai`（`api.z.ai`），国内版
`zhipu-coding-plan` 在 `omp usage` 中始终显示 `API key — no usage data`。本插件通过
`pi.registerProvider` 的 `usage` 槽位补上缺失的注册，不改动 chat 模型目录与已存凭据。
上游跟踪：[can1357/oh-my-pi#8644](https://github.com/can1357/oh-my-pi/issues/8644)。

## 安装

```sh
omp plugin marketplace add moecasts/omp-coding-plan-usage
omp plugin install zhipu-quota@coding-plan-usage
```

`marketplace add` 支持 GitHub `owner/repo` 简写；已克隆到本地时也可以用目录路径。
安装后重启 omp 会话（marketplace 安装不会热加载扩展模块），然后：

```sh
omp usage                          # 终端直接查看
omp usage --history --days 30      # 历史用量快照
```

会话内输入 `/usage`，或在状态栏配置中加入 quota 段即可实时显示。

## 显示内容

调用智谱监控端点 `GET /api/monitor/usage/quota/limit`（与官方 glm-plan-usage 插件
相同的路径），解析三类条目：

| 响应类型 | 含义 | 展示 |
|---|---|---|
| `TOKENS_LIMIT`（unit 3=小时, 6=周） | 5 小时 / 每周 token 窗口 | `GLM Coding 5h tokens` 等 |
| `CREDIT_LIMIT`（新版积分制套餐） | 5 小时 / 每周积分窗口 | `GLM Coding … credits` |
| `TIME_LIMIT`（unit 5=月） | 每月 MCP / 工具调用次数 | `GLM Coding Monthly requests` |

同时在 metadata 中附带套餐档位（`plan: lite/pro/max`）。

## 工作原理

- 扩展只注册 usage provider：`registerProvider("zhipu-coding-plan", { usage })`，
  不声明 `apiKey`、不声明 `models`，内置 chat 通路与 `/login` 凭据完全不受影响。
- 认证使用 omp 已存储的凭据（`/login zhipu-coding-plan` 保存的 key 或 OAuth
  token），`Authorization: <raw key>`（与官方插件一致，无 Bearer 前缀）。
- 响应 JSON 在边界处用 `pi.zod` 一次性 schema 解析。
- 结果进入 omp 共享的 usage 缓存（`agent.db`），默认 60s TTL；`omp usage
  invalidate --provider zhipu-coding-plan` 可强制刷新。

## 开发

插件零运行时依赖；`@oh-my-pi/*` 仅作为 devDependencies 提供类型提示与静态检查。
扩展里对它们的引用全部是 `import type`，omp 的 Bun 运行时会剥离类型导入（并把
`@oh-my-pi/*` 说明符重写到宿主内置副本），所以安装后的插件不解析这些包。

```sh
cd plugin/zhipu-quota
bun install
bun run typecheck   # tsc --noEmit，strict（TypeScript 7）
```

- 入口文件为 `src/index.ts`，在 `package.json` 的 `omp.extensions` 中声明。
- devDependencies 版本随目标 omp 版本对齐（当前 `^18.10.3`）；omp 升级后执行
  `bun update @oh-my-pi/pi-coding-agent @oh-my-pi/pi-ai` 并跑一次 typecheck。
- `registerProvider` 的 `usage` 配置、`fetchUsage(params, ctx)` 签名、
  `UsageReport` / `UsageLimit` 等类型均来自官方包定义，改动 API 时编译期即可发现。

## 注意事项

- 该端点未列入智谱公开 OpenAPI 文档，属于官方插件内部使用的监控路径，响应结构
  可能变化；解析失败时插件静默返回空（usage 显示回落为 no usage data），不影响
  正常对话。
- 仅支持个人版套餐；仅国内版（`open.bigmodel.cn`）。国际版请直接使用内置 `zai`。
- 兼容 omp v18.10.x；`registerProvider` 的 `usage` 字段为已公开的扩展 API。

## License

[MIT](./LICENSE)
