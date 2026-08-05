import * as fs from 'node:fs';
import * as path from 'node:path';
import { PermissionSchema } from '@conduit/protocol';
import { getAppDataDir } from '@conduit/security';
import { z } from 'zod';

export const CONFIG_VERSION = 1 as const;

const DomainPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(?:\*\.)?(?:[a-z0-9-]+\.)*[a-z0-9-]+$/iu);

export const ConduitConfigSchema = z
  .object({
    version: z.literal(CONFIG_VERSION).default(CONFIG_VERSION),
    daemon: z
      .object({
        port: z.number().int().min(1).max(65_535).default(9_222),
        bindAddress: z.string().min(1).max(255).default('127.0.0.1'),
        requestTimeoutMs: z.number().int().min(1_000).max(300_000).default(45_000),
        maximumMessageBytes: z.number().int().min(1_024).max(16_777_216).default(1_048_576),
        sessionTimeoutMs: z.number().int().min(10_000).max(86_400_000).default(1_800_000),
      })
      .strict()
      .default({}),
    remote: z
      .object({
        enabled: z.boolean().default(false),
        tlsKeyPath: z.string().min(1).optional(),
        tlsCertificatePath: z.string().min(1).optional(),
        sessionTimeoutMs: z.number().int().min(10_000).max(86_400_000).default(900_000),
      })
      .strict()
      .default({}),
    security: z
      .object({
        permissions: z
          .array(PermissionSchema)
          .default([
            'browser.read',
            'browser.navigate',
            'browser.interact',
            'browser.forms',
            'browser.download',
          ]),
        domainMode: z.enum(['allowlist', 'blocklist', 'ask']).default('blocklist'),
        allowedDomains: z.array(DomainPatternSchema).default([]),
        blockedDomains: z.array(DomainPatternSchema).default([]),
        allowLocalhost: z.boolean().default(false),
        allowPrivateNetworks: z.boolean().default(false),
        uploadAllowlist: z.array(z.string().min(1)).default([]),
        maximumUploadFileBytes: z.number().int().min(1).max(1_073_741_824).default(10_485_760),
      })
      .strict()
      .default({}),
    logging: z
      .object({
        level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
        maximumAuditBytes: z.number().int().min(65_536).max(1_073_741_824).default(5_242_880),
        retentionDays: z.number().int().min(1).max(365).default(30),
      })
      .strict()
      .default({}),
    browser: z
      .object({
        screenshotDirectory: z.string().min(1).optional(),
        downloadBehavior: z.enum(['observe', 'allow', 'deny']).default('observe'),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((config, context) => {
    const loopback = ['127.0.0.1', '::1', 'localhost'].includes(config.daemon.bindAddress);
    if (!loopback && !config.remote.enabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['remote', 'enabled'],
        message: 'Remote mode must be enabled before using a non-loopback bind address.',
      });
    }
    if (!loopback && (!config.remote.tlsKeyPath || !config.remote.tlsCertificatePath)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['remote'],
        message: 'TLS key and certificate paths are required for non-loopback binding.',
      });
    }
  });

export type ConduitConfig = z.infer<typeof ConduitConfigSchema>;

export class ConfigError extends Error {
  public constructor(
    message: string,
    public readonly issues: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface ConfigStoreOptions {
  configPath?: string;
}

export class ConfigStore {
  private readonly configPath: string;

  public constructor(options: ConfigStoreOptions = {}) {
    this.configPath =
      options.configPath ??
      (process.env.CONDUIT_CONFIG_PATH
        ? path.resolve(process.env.CONDUIT_CONFIG_PATH)
        : path.join(getAppDataDir(), 'config.json'));
  }

  public load(): ConduitConfig {
    if (!fs.existsSync(this.configPath)) return ConduitConfigSchema.parse({});
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch {
      throw new ConfigError(`Configuration file is not valid JSON: ${this.configPath}`);
    }
    return parseConfig(value, this.configPath);
  }

  public save(value: unknown): ConduitConfig {
    const config = parseConfig(value, this.configPath);
    const directory = path.dirname(this.configPath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    try {
      if (fs.existsSync(this.configPath)) fs.rmSync(this.configPath);
      fs.renameSync(temporaryPath, this.configPath);
    } catch (error) {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
      throw error;
    }
    try {
      fs.chmodSync(directory, 0o700);
      fs.chmodSync(this.configPath, 0o600);
    } catch {
      // Windows uses profile ACLs instead of POSIX modes.
    }
    return config;
  }

  public update(pathExpression: string, rawValue: string): ConduitConfig {
    const segments = pathExpression.split('.').filter(Boolean);
    if (segments.length < 2) throw new ConfigError('Configuration path must include a section.');
    const next = structuredClone(this.load()) as Record<string, unknown>;
    let cursor = next;
    for (const segment of segments.slice(0, -1)) {
      const child = cursor[segment];
      if (!isRecord(child)) throw new ConfigError(`Unknown configuration path: ${pathExpression}`);
      cursor = child;
    }
    const leaf = segments.at(-1) as string;
    if (!(leaf in cursor)) throw new ConfigError(`Unknown configuration path: ${pathExpression}`);
    cursor[leaf] = parseConfigValue(rawValue);
    return this.save(next);
  }

  public getPath(): string {
    return this.configPath;
  }
}

export function parseConfigValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseConfig(value: unknown, source: string): ConduitConfig {
  const parsed = ConduitConfigSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  throw new ConfigError(`Configuration failed validation: ${source}`, issues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
