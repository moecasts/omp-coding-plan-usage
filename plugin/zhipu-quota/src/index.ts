// Zhipu Coding Plan (domestic open.bigmodel.cn) usage provider for omp.
// Feeds `omp usage`, `/usage`, and the status-line quota segment.
// Upstream: https://github.com/can1357/oh-my-pi/issues/8644
//
// All imports are type-only: at runtime omp strips them (and rewrites
// @oh-my-pi specifiers onto its host-bundled copies), so the published plugin
// has zero runtime dependencies. The devDependencies exist purely for editor
// hints and `pnpm typecheck`.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type {
	UsageCredential,
	UsageFetchContext,
	UsageFetchParams,
	UsageLimit,
	UsageReport,
	UsageStatus,
	UsageUnit,
	UsageWindow,
} from "@oh-my-pi/pi-ai";

const QUOTA_PATH = "/api/monitor/usage/quota/limit";
const DEFAULT_ORIGIN = "https://open.bigmodel.cn";

/** One entry of the monitor endpoint's `data.limits[]` (schema-parsed). */
type QuotaLimit = {
	type?: string;
	unit?: number;
	number?: number;
	usage?: number;
	currentValue?: number;
	remaining?: number;
	percentage?: number;
	nextResetTime?: number;
};

function epochMs(value: unknown): number | undefined {
	// Zhipu returns epoch milliseconds; normalize seconds just in case.
	if (typeof value !== "number") return undefined;
	return value > 1e12 ? value : value * 1000;
}

function percentageToFraction(percentage: unknown): number | undefined {
	if (typeof percentage !== "number") return undefined;
	return Math.min(Math.max(percentage / 100, 0), 1);
}

function statusFor(usedFraction: number | undefined): UsageStatus | undefined {
	if (usedFraction === undefined) return undefined;
	if (usedFraction >= 1) return "exhausted";
	if (usedFraction >= 0.8) return "warning";
	return "ok";
}

function windowOf(l: QuotaLimit): UsageWindow {
	const n = typeof l.number === "number" && l.number > 0 ? l.number : 1;
	const base = { resetsAt: epochMs(l.nextResetTime) };
	switch (l.unit) {
		case 3:
			return { id: `${n}h`, label: `${n}h`, durationMs: n * 3_600_000, ...base };
		case 4:
			return { id: `${n}d`, label: `${n}d`, durationMs: n * 86_400_000, ...base };
		case 5:
			return { id: `${n}mo`, label: n === 1 ? "Monthly" : `${n}mo`, durationMs: n * 30 * 86_400_000, ...base };
		case 6:
			return { id: "1w", label: "Weekly", durationMs: 7 * 86_400_000, ...base };
		default:
			return { id: "quota", label: "Quota", ...base };
	}
}

function unitFor(type: string): UsageUnit {
	if (type === "CREDIT_LIMIT") return "credits";
	if (type === "TIME_LIMIT") return "requests";
	return "tokens";
}

function mapLimit(l: QuotaLimit, provider: string): UsageLimit {
	const unit = unitFor(l.type ?? "");
	const window = windowOf(l);
	const amount: UsageLimit["amount"] = { unit };
	if (typeof l.currentValue === "number") amount.used = l.currentValue;
	if (typeof l.usage === "number" && l.usage > 0) amount.limit = l.usage;
	if (typeof l.remaining === "number") amount.remaining = l.remaining;
	const hasAbsoluteCap = typeof l.usage === "number" && l.usage > 0;
	if (!hasAbsoluteCap) {
		amount.usedFraction = percentageToFraction(l.percentage);
	}
	return {
		id: `zhipu:${unit}:${window.id}`,
		label: `GLM Coding ${window.label} ${unit}`,
		scope: { provider, windowId: window.id, shared: true },
		window,
		amount,
		status: statusFor(amount.usedFraction),
	};
}

function credentialKey(cred: UsageCredential | undefined): string | undefined {
	if (!cred) return undefined;
	if (cred.type === "oauth") return cred.accessToken;
	return cred.apiKey;
}

export default function (pi: ExtensionAPI) {
	const z = pi.zod;

	// Parse-once boundary for the monitor endpoint's JSON (fields we don't
	// consume are dropped by the object schemas).
	const LimitSchema = z.object({
		type: z.string().optional(),
		unit: z.number().optional(),
		number: z.number().optional(),
		usage: z.number().optional(),
		currentValue: z.number().optional(),
		remaining: z.number().optional(),
		percentage: z.number().optional(),
		nextResetTime: z.number().optional(),
	});
	const QuotaSchema = z.object({
		success: z.boolean(),
		code: z.unknown().optional(),
		msg: z.string().optional(),
		data: z
			.object({
				limits: z.array(LimitSchema).optional(),
				level: z.string().optional(),
			})
			.optional(),
	});

	async function fetchZhipuUsage(params: UsageFetchParams, ctx: UsageFetchContext): Promise<UsageReport | null> {
		const key = credentialKey(params.credential);
		if (!key) return null;
		let base = DEFAULT_ORIGIN;
		if (params.baseUrl?.trim()) {
			try {
				base = new URL(params.baseUrl.trim()).origin;
			} catch {
				// keep default origin on malformed baseUrl
			}
		}
		try {
			const res = await ctx.fetch(`${base}${QUOTA_PATH}`, {
				headers: { Authorization: key, "Content-Type": "application/json" },
				signal: params.signal,
			});
			if (!res.ok) {
				ctx.logger?.warn(`zhipu usage fetch failed: ${res.status} ${res.statusText}`);
				return null;
			}
			const body = QuotaSchema.parse(await res.json());
			if (body.success !== true) {
				ctx.logger?.warn(`zhipu usage response invalid`, { code: body.code ?? null, msg: body.msg ?? null });
				return null;
			}
			const limits = (body.data?.limits ?? []).map((l: QuotaLimit) => mapLimit(l, params.provider));
			if (limits.length === 0) return null;
			return {
				provider: params.provider,
				fetchedAt: Date.now(),
				limits,
				metadata: {
					endpoint: `${base}${QUOTA_PATH}`,
					...(body.data?.level ? { planType: body.data.level } : {}),
				},
			};
		} catch (err) {
			ctx.logger?.warn(`zhipu usage fetch error: ${String(err)}`);
			return null;
		}
	}

	// Config-only registration: no apiKey (the stored /login credential stays
	// authoritative for chat), no models (built-in catalog untouched). Only the
	// usage slot is set.
	pi.registerProvider("zhipu-coding-plan", {
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		usage: {
			id: "zhipu-coding-plan",
			cacheVersion: 1,
			fetchUsage: fetchZhipuUsage,
			supports: (params: UsageFetchParams) => Boolean(credentialKey(params.credential)),
		},
	});
}
