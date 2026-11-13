// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { mountReact } from '../../shared/page-host/index.tsx';
import originalBody from './__fixtures__/dialog.html?raw';
import { ImportMeetingDialogBody } from './ui.tsx';

const normalize = (html: string) => html.replace(/>[ \t]*\n\s*</g, '><');

it('preserves the original import dialog HTML including attribute order and inline spaces', () => {
  const original = document.createElement('dialog');
  original.innerHTML = originalBody;
  const dialog = document.createElement('dialog');
  mountReact(dialog, ImportMeetingDialogBody, {});
  expect(normalize(dialog.innerHTML)).toBe(normalize(original.innerHTML));
  expect(dialog.querySelector('#importYes')!.lastChild!.nodeType).toBe(Node.TEXT_NODE);
});
