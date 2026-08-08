import { Component, Input } from '@angular/core';

// One place for the line art. A button carries an icon and a word; on a narrow
// screen CSS hides the word and the icon has to carry the meaning alone, which
// is why every icon button also needs a title — an icon you cannot hover is
// only a guess.
//
// The paths are written out rather than bound through innerHTML: Angular's
// sanitiser strips SVG children, and reaching for bypassSecurityTrustHtml to
// draw an arrow is a habit worth not starting.
export type IconName =
  | 'play' | 'pause' | 'logs' | 'records' | 'trash' | 'restore'
  | 'kick' | 'ban' | 'unban' | 'stats' | 'reset' | 'download';

@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      @switch (name) {
        @case ('play') { <polygon points="6,4 20,12 6,20" /> }
        @case ('pause') {
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        }
        @case ('logs') { <path d="M5 4h11l3 3v13H5z" /><path d="M8 11h8M8 15h5" /> }
        @case ('records') {
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
          <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        }
        @case ('trash') {
          <path d="M4 7h16" /><path d="M9 7V5h6v2" />
          <path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" />
        }
        @case ('restore') { <path d="M4 12a8 8 0 1 0 2.5-5.8" /><polyline points="4,4 4,9 9,9" /> }
        @case ('kick') {
          <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
          <path d="M10 17l-5-5 5-5" /><path d="M5 12h11" />
        }
        @case ('ban') { <circle cx="12" cy="12" r="8" /><path d="M6.5 6.5l11 11" /> }
        @case ('unban') { <circle cx="12" cy="12" r="8" /><polyline points="8.5,12 11,14.5 15.5,9.5" /> }
        @case ('stats') { <path d="M5 20V10M12 20V4M19 20v-7" /> }
        @case ('reset') { <path d="M20 12a8 8 0 1 1-2.5-5.8" /><polyline points="20,4 20,9 15,9" /> }
        @case ('download') {
          <path d="M12 4v11" /><polyline points="7.5,10.5 12,15 16.5,10.5" /><path d="M5 19h14" />
        }
      }
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; }
    svg {
      width: 15px; height: 15px; flex: none;
      fill: none; stroke: currentColor; stroke-width: 1.7;
      stroke-linecap: round; stroke-linejoin: round;
    }
  `],
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
}
