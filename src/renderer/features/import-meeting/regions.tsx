import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { clock } from '../../shared/lib/index.ts';
import { commit } from '../../shared/page-host/index.tsx';
import { Num } from '../../shared/ui/index.tsx';

export interface ImportFile {
  readonly path: string;
  readonly name: string;
  readonly durationSec: number | null;
}

export function importRegionRenderer<V>(host: HTMLElement, Region: ComponentType<{ view: V }>) {
  const root = createRoot(host);
  let generation = 0;
  return (view: V) => {
    const instance = ++generation;
    commit(() => root.render(<Region key={instance} view={view} />));
  };
}

export function ImportFiles({ view }: { view: readonly ImportFile[] }) {
  return <>{view.map((file, i) => <li key={i}>{file.name}{file.durationSec ? <Num>{clock(file.durationSec)}</Num> : null}</li>)}</>;
}

const IMPORT_SPEAKER_CHOICES = ['', '2', '3', '4', '5', '6', '7', '8'];
const importSpeakerLabel = (v: string) => (v ? `${v}명` : '자동');

export function ImportSpeakers({ view }: { view: (value: string) => void }) {
  return <>{IMPORT_SPEAKER_CHOICES.map((v) => <button key={v} type="button" role="radio" data-n={v}
    ref={(node) => { if (node) node.onclick = () => view(v); }}
  >{importSpeakerLabel(v)}</button>)}</>;
}
