export interface ActionView {
  readonly className: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly click: (button: HTMLButtonElement) => unknown;
}

export interface UsageView {
  readonly rows: readonly {
    readonly left: number;
    readonly name: string | undefined;
    readonly reset: string;
  }[];
  readonly footClass: string;
  readonly footText: string;
  readonly again: ActionView | null;
}

export interface ProviderView {
  readonly id: string;
  readonly name: string;
  readonly who: string;
  readonly usable: boolean;
  readonly checked: boolean;
  readonly usage: boolean;
  readonly change: () => unknown;
}

export interface PermissionView {
  readonly name: string;
  readonly what: string;
  readonly status: string | null;
  readonly action: ActionView | null;
}

export interface SetupView {
  readonly name: string;
  readonly desc: string;
  readonly state: readonly [string, string];
  readonly size: string | number | null | false;
  readonly actions: readonly ActionView[];
  readonly progress: { readonly indeterminate: boolean; readonly width: number; readonly text: string } | null;
  readonly notes: readonly { readonly className: string; readonly text: string; readonly action: ActionView | null }[];
}

export interface AccountView {
  readonly name: string;
  readonly className: string;
  readonly text: string;
}
