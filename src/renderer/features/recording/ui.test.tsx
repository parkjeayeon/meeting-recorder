// @vitest-environment jsdom
import { expect, it } from 'vitest';
import html from '../../index.html?raw';
import originalMarkup from './__fixtures__/markup.html?raw';
import { mountReact } from '../../shared/page-host/index.tsx';
import { MeetingStartDialogBody, RecordingLiveBody, RecordingSpeakersBody, RecordingActionsBody } from './ui.tsx';

it('preserves the original recording HTML exactly, including whitespace between tags and attribute order', () => {
  const original = new DOMParser().parseFromString(originalMarkup, 'text/html');
  const page = new DOMParser().parseFromString(html, 'text/html');
  for (const [selector, Part] of [
    ['#meetStart', MeetingStartDialogBody],
    ['#live', RecordingLiveBody],
    ['#liveSpeakers', RecordingSpeakersBody],
    ['.top-acts', RecordingActionsBody],
  ] as const) {
    const host = page.querySelector<HTMLElement>(selector)!;
    expect(host.innerHTML).toBe('');
    mountReact(host, Part, {});
    expect(host.innerHTML).toBe(original.querySelector(selector)!.innerHTML);
    expect(host.outerHTML).toBe(original.querySelector(selector)!.outerHTML);
  }
  expect(page.querySelector('.topbar')!.outerHTML).toBe(original.querySelector('.topbar')!.outerHTML);
  expect(page.querySelector('#startSpeakers')!.childNodes).toHaveLength(0);
  expect(page.querySelectorAll('#startKind button')).toHaveLength(2);
  expect(page.querySelectorAll('#startKind [aria-checked]')).toHaveLength(0);
  expect(page.querySelector('#startMinutes')!.hasAttribute('checked')).toBe(false);
  expect(page.querySelector('#startYes')!.lastChild!.nodeType).toBe(Node.TEXT_NODE);
  const canvas = page.querySelector<HTMLCanvasElement>('#tape')!;
  expect([canvas.width, canvas.height, canvas.hidden]).toEqual([96, 18, true]);
});
