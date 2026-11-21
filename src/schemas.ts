import { z } from "zod";

export const computerIdSchema = z
  .string()
  .length(16)
  .regex(/^comp_[A-Za-z0-9]{11}$/u);

const time = z.iso.datetime();
const nameAndId = z.object({ id: z.string(), pretty_name: z.string() });
const summary = nameAndId.extend({
  assigned_user_id: z.string().nullable(),
  created_at: time,
  updated_at: time,
  ended_at: z.null(),
});
export const computers = z.object({ computers: z.array(summary) });

const specs = z.object({
  isBareMetal: z.boolean(),
  cpu: z.object({
    model: z.string().nullable(),
    cores: z.number().nullable(),
    threads: z.number().nullable(),
    frequencyMhz: z.number().nullable(),
  }),
  memoryGb: z.number(),
  isEccMemory: z.boolean(),
  diskGb: z.number(),
  diskType: z.enum(["ssd", "hdd"]),
  diskInterface: z.enum(["nvme", "sas", "sata"]),
  publicBandwidthMbps: z.number(),
});
export const orders = z.object({
  orders: z.array(
    z.object({
      id: z.string(),
      indicativeStatusPrettyString: z.string(),
      indicativeBillingStatusPrettyString: z.string(),
      createdAt: time,
      cancelAtPeriodEnd: z.boolean(),
      cancelAt: time.nullable(),
      canceledAt: time.nullable(),
      endedAt: time.nullable(),
      purchase: z.object({ specs, country: z.string() }).nullable(),
      recurring: z
        .object({
          amountBeforeTax: z.int(),
          currency: z.string(),
          interval: z.string(),
          currentPeriodStart: time,
          currentPeriodEnd: time,
        })
        .nullable(),
      computer: nameAndId.extend({ createdAt: time, updatedAt: time }).nullable(),
    }),
  ),
});

const usage = z.object({ usage: z.number().nullish() }).nullish();
const container = z.object({
  name: z.string().nullish(),
  status: z.string().nullish(),
  status_code: z.int().nullish(),
  created_at: z.string().nullish(),
  config: z.object({ "user.roycomputing.is-marked-as": z.string().nullish() }).nullish(),
  devices: z.record(z.string(), z.record(z.string(), z.string())).nullish(),
  state: z.object({ cpu: usage, memory: usage }).nullish(),
});
export type Container = z.infer<typeof container>;
const cache = z
  .object({
    lastUpdatedAt: time.nullable(),
    lastRefreshAttemptAt: time,
    previousRefreshAttemptAt: time.nullable(),
    snapshot: z.object({ capturedAt: time, containers: z.array(container) }).nullable(),
  })
  .nullable();
export const detail = z.object({
  computer: summary.extend({
    state_cache: cache,
    server: z.object({
      ipv4: z.ipv4(),
      country: z.string(),
      specs,
      updated_at: time,
      isMarkedAsInstalling: z.boolean(),
      installation: z
        .object({
          status: z.string(),
          observedAt: time.nullable(),
          approximateTotalProgressPercent: z.int().nullable(),
        })
        .nullable(),
    }),
  }),
});
export const refresh = z.object({
  state_cache: cache,
  refreshed: z.boolean(),
  retryAfterMs: z.int().nonnegative(),
});
export const sshKeys = z.object({
  keys: z.array(z.object({ key: z.string(), comment: z.string(), options: z.string() })),
  invalidLineNumbers: z.array(z.int()).optional(),
});
export const identity = z.object({
  userId: z.string().min(1),
  orgId: z.string().min(1),
  orgName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.email().optional(),
});
export type Identity = z.infer<typeof identity>;
