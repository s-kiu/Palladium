// Streamer mode — one toggle that redacts everything the panel shows which
// should not survive a screenshot: connect addresses, API tokens, player ids
// and the raw server log.
//
// The redaction is CSS, not string rewriting: a value marked `secret` keeps
// its real text in the DOM (so click-to-copy still works) and is painted over
// with a solid block. Solid, not blurred — a blur can be undone frame by frame,
// a block cannot.
//
// The choice lives in localStorage rather than on the server: it is a property
// of the screen being shared, not of the account, and it must survive the
// reload that happens mid-stream.

import { signal } from '@angular/core';

const KEY = 'palup.streamer';

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const streamerMode = signal<boolean>(stored());

export function toggleStreamerMode(): void {
  const next = !streamerMode();
  streamerMode.set(next);
  try {
    localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    // A browser that refuses storage still gets the toggle for this session.
  }
}
