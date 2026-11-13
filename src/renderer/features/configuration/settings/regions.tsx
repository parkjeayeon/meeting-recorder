import { Fragment, useRef, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { commit } from '../../../shared/page-host/index.tsx';
import { Num, useNativeEvent } from '../../../shared/ui/index.tsx';
import type { AccountView, ActionView, PermissionView, ProviderView, SetupView, UsageView } from './view.ts';

export function settingsRegionRenderer<V>(host: HTMLElement, Region: ComponentType<{ view: V }>) {
  const root = createRoot(host);
  let generation = 0;
  const rebuild = () => {
    const instance = ++generation;
    return (view: V) => commit(() => root.render(<Region key={instance} view={view} />));
  };
  return {
    rebuild,
    render(view: V) {
      rebuild()(view);
    },
    unmount() {
      commit(() => root.unmount());
    },
  };
}

export function SettingsAction({ view }: { view: ActionView }) {
  const ref = useRef<HTMLButtonElement>(null);
  useNativeEvent(ref, 'click', (button) => view.click(button));
  return <button ref={ref} className={view.className} disabled={view.disabled}>{view.label}</button>;
}

export function SettingsUsage({ view }: { view: UsageView }) {
  return <>
    {view.rows.map((row, i) => <div key={i} className={`usage-row${row.left < 20 ? ' low' : ''}`}>
      <span className="usage-name">{row.name}</span>
      <span className="meter" role="meter" aria-valuenow={row.left} aria-valuemin={0} aria-valuemax={100} aria-label="남은 사용량"><i style={{ width: `${row.left}%` }} /></span>
      <Num>{`${row.left}% 남음`}</Num>
      <span className="usage-reset">{row.reset}</span>
    </div>)}
    <div className={view.footClass}><span>{view.footText}</span>{view.again && <SettingsAction view={view.again} />}</div>
  </>;
}

function ProviderRadio({ view }: { view: ProviderView }) {
  const ref = useRef<HTMLInputElement>(null);
  useNativeEvent(ref, 'change', view.change);
  return <input type="radio" ref={(node) => {
    ref.current = node;
    if (!node) return;
    node.name = 'provider';
    node.value = view.id;
    node.checked = view.checked;
    node.disabled = !view.usable;
  }} />;
}

export function SettingsProviders({ view }: { view: readonly ProviderView[] }) {
  return <>{view.map((row) => <Fragment key={row.id}>
    <label className={`choice${row.usable ? '' : ' off'}`}><ProviderRadio view={row} /><b>{row.name}</b><span className="who">{row.who}</span></label>
    {row.usage && <div className="usage" data-usage={row.id} />}
  </Fragment>)}</>;
}

export function SettingsPermissions({ view }: { view: readonly PermissionView[] }) {
  return <>{view.map((row, i) => <div key={i} className="perm">
    <div className="field-text"><b>{row.name}</b><span>{row.what}</span></div>
    {row.status !== null ? <span className="pill ok">{row.status}</span> : row.action && <SettingsAction view={row.action} />}
  </div>)}</>;
}

export function SettingsSetup({ view }: { view: readonly SetupView[] }) {
  return <>{view.map((row, i) => <div key={i} className="comp">
    <div className="comp-main"><b>{row.name}</b><span>{row.desc}</span></div>
    <div className="comp-side"><span className={`pill ${row.state[0]}`}>{row.state[1]}</span>{typeof row.size === 'string' ? <Num>{row.size}</Num> : row.size}</div>
    <div className="comp-acts">{row.actions.map((action, j) => <SettingsAction key={j} view={action} />)}</div>
    {row.progress && <div className="comp-progress"><div className={`bar${row.progress.indeterminate ? ' indeterminate' : ''}`}><i style={{ width: `${row.progress.width}%` }} /></div><span>{row.progress.text}</span></div>}
    {row.notes.map((note, j) => <div key={j} className={note.className}>{note.text}{note.action && <SettingsAction view={note.action} />}</div>)}
  </div>)}</>;
}

export function SettingsAccounts({ view }: { view: readonly AccountView[] }) {
  return <>{view.map((row, i) => <div key={i} className="account"><b>{row.name}</b><span className={row.className}>{row.text}</span></div>)}</>;
}
