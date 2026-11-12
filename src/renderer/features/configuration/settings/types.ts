import type { UsageWindow as CoreUsageWindow } from '../../../../core/usage.mts';

export type UsageWindow = Omit<CoreUsageWindow, 'kind'> & { kind: CoreUsageWindow['kind'] | 'limit' };
export type UsageResult = { ok: false; error: string } | {
  ok: true;
  fetchedAt: string;
  windows: UsageWindow[];
  credits?: string | number | null;
  via?: string;
};

export interface ProviderInfo {
  installed: boolean;
  loggedIn: boolean;
  account?: string | null;
}

export interface SetupComponent {
  id: string;
  name: string;
  desc: string;
  installed: boolean;
  size: number | null;
  removable: boolean;
  partial?: boolean;
  blocker?: string | null;
  job?: { running?: boolean; error?: string | null; pct?: number | null; text?: string } | null;
}

export type TokenKind = 'hf' | 'anthropic';
export interface TokenSource {
  app: boolean;
  cli?: boolean;
  env?: boolean;
}
