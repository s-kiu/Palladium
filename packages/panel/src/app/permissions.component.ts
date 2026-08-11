import { Component } from '@angular/core';

// The permissions page is the studio, embedded. One codebase answers "who may
// do what" everywhere: offline on the docs site against an uploaded file, and
// here against the live server — same origin, so the panel's session makes it
// live and every write goes through the audited /api/bridge/call door. The
// old hand-built editor this replaces spoke to the same capabilities; the
// studio simply speaks them with the agent's own resolver behind the answers.
@Component({
  selector: 'app-permissions',
  standalone: true,
  template: `
    <iframe
      src="/studio/index.html?embed=panel"
      title="Palladium Studio"
      class="studio-frame"
      allow="clipboard-write"
    ></iframe>
  `,
  styles: [
    `
      :host {
        display: block;
        height: calc(100vh - 7.5rem);
      }
      .studio-frame {
        width: 100%;
        height: 100%;
        border: 0;
        border-radius: 12px;
        background: transparent;
      }
    `,
  ],
})
export class PermissionsComponent {}
