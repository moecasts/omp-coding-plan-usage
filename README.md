# omp-coding-plan-usage

English | [简体中文](./README.zh-CN.md)

Real-time quota for the [Zhipu GLM Coding Plan](https://docs.bigmodel.cn/cn/coding-plan/overview)
(domestic `open.bigmodel.cn`) inside [omp](https://omp.sh) — feeding `omp usage`,
the in-session `/usage` command, and the status-line quota segment.

omp's built-in usage registry only wires the international `zai` provider
(`api.z.ai`); the domestic `zhipu-coding-plan` provider always shows
`API key — no usage data`. This plugin registers the missing usage provider via
`pi.registerProvider`'s `usage` slot, without touching the chat model catalog
or stored credentials. Upstream tracking:
[can1357/oh-my-pi#8644](https://github.com/can1357/oh-my-pi/issues/8644).

## Install

```sh
omp plugin marketplace add moecasts/omp-coding-plan-usage
omp plugin install zhipu-quota@coding-plan-usage
```

`marketplace add` accepts the GitHub `owner/repo` shorthand; a local clone
works too (pass the directory path). Restart omp after installing — marketplace
installs do not hot-load extension modules — then:

```sh
omp usage                        # terminal
omp usage --history --days 30    # historical snapshots
```

In a session, `/usage` shows the same report; add the quota segment to the
status line for a live indicator.

## What it reports

The extension calls the monitor endpoint `GET /api/monitor/usage/quota/limit`
(the same path Zhipu's own glm-plan-usage plugin uses) and maps three entry
kinds:

| Response type | Meaning | Label |
|---|---|---|
| `TOKENS_LIMIT` (unit 3=hours, 6=weeks) | 5-hour / weekly token windows | `GLM Coding 5h tokens`, … |
| `CREDIT_LIMIT` (newer credit-based plans) | 5-hour / weekly credit windows | `GLM Coding … credits` |
| `TIME_LIMIT` (unit 5=months) | monthly MCP / tool-call count | `GLM Coding Monthly requests` |

The plan tier (`lite` / `pro` / `max`) is included in the report metadata.

## How it works

- The extension registers a usage provider only:
  `registerProvider("zhipu-coding-plan", { usage })` — no `apiKey`, no
  `models`, so the built-in chat path and `/login` credentials are untouched.
- Authentication reuses the credential omp already stores (the key saved by
  `/login zhipu-coding-plan` or an OAuth token), sent as a raw
  `Authorization` header (no Bearer prefix, matching the official plugin).
- The response JSON is schema-parsed once at the boundary with `pi.zod`.
- Reports enter omp's shared usage cache (`agent.db`, 60s default TTL);
  `omp usage invalidate --provider zhipu-coding-plan` forces a refresh.

## Development

The plugin has zero runtime dependencies; `@oh-my-pi/*` packages exist only as
devDependencies for editor hints and static checking. All references are
`import type`, which omp's Bun runtime strips (and rewrites `@oh-my-pi/*`
specifiers onto host-bundled copies), so the installed plugin never resolves
them.

```sh
cd plugin/zhipu-quota
bun install
bun run typecheck   # tsc --noEmit, strict (TypeScript 7)
```

- Entry point: `src/index.ts`, declared in `package.json` `omp.extensions`.
- Keep devDependency versions aligned with the omp release you target
  (currently `^18.10.3`); after an omp upgrade run
  `bun update @oh-my-pi/pi-coding-agent @oh-my-pi/pi-ai` and typecheck.
- `registerProvider`'s `usage` config, the `fetchUsage(params, ctx)`
  signature, and `UsageReport` / `UsageLimit` types come from the official
  packages, so API changes surface at compile time.

## Notes

- The monitor endpoint is not part of Zhipu's public OpenAPI catalog; it is
  the internal path the official plugin uses and its response shape may
  change. Parse failures degrade silently (usage falls back to
  `no usage data`) and never affect chat.
- Personal plans only; domestic endpoint only (`open.bigmodel.cn`). For the
  international plan use omp's built-in `zai` provider.
- Compatible with omp v18.10.x; the `usage` field of `registerProvider` is a
  documented extension API.

## License

[MIT](./LICENSE)
