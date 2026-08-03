import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from './api.service';

@Component({
  selector: 'app-console',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="card">
      <div class="row spread">
        <h2>Server log</h2>
        <div class="row">
          <label class="follow">
            <input type="checkbox" [(ngModel)]="follow" name="follow" /> follow
          </label>
          <select [(ngModel)]="lineCount" name="lines" (ngModelChange)="refresh()">
            <option [value]="200">200 lines</option>
            <option [value]="500">500 lines</option>
            <option [value]="1000">1000 lines</option>
          </select>
        </div>
      </div>
      <p class="muted">
        Live output of the game server and its manager — refreshes every 3 seconds. Includes
        startup, updates, backups and mod-loader events.
      </p>
      <pre class="logview" #logview>{{ logText() }}</pre>
    </div>
  `,
})
export class ConsoleComponent implements OnInit, OnDestroy, AfterViewChecked {
  private api = inject(Api);
  @ViewChild('logview') logview?: ElementRef<HTMLPreElement>;

  logText = signal('loading log…');
  follow = true;
  lineCount = 500;
  private timer?: ReturnType<typeof setInterval>;
  private shouldScroll = false;

  ngOnInit(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 3000);
  }
  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
  ngAfterViewChecked(): void {
    if (this.shouldScroll && this.follow && this.logview) {
      const el = this.logview.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }

  refresh(): void {
    this.api.logs(Number(this.lineCount) || 500).subscribe({
      next: (r) => {
        this.logText.set(r.lines.length ? r.lines.join('\n') : '(log is empty)');
        this.shouldScroll = true;
      },
      error: () => {},
    });
  }
}
