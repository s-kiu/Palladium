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
import { Api, BridgeEvent } from './api.service';

// Live in-game chat, read from the bridge event stream. Read-only: the game's
// admin API can broadcast (Server actions → Broadcast) but cannot post as a
// player, so there is nothing to send from here.
@Component({
  selector: 'app-chat',
  standalone: true,
  template: `
    <div class="card">
      <div class="row spread">
        <h2>Chat</h2>
        <span class="tag">{{ lines().length }} message{{ lines().length === 1 ? '' : 's' }}</span>
      </div>
      <p class="muted">
        In-game chat for the current server run, refreshed every 3 seconds. Messages starting
        with <code>!</code> are commands — <code>!ping</code> is answered with a broadcast.
      </p>
      <div class="logview small chatlog" #stream>
        @for (e of lines(); track $index) {
          <div class="chatline">
            <span class="chat-time">{{ time(e.at) }}</span>
            <span class="chat-player">{{ e.player || 'unknown' }}</span>
            <span class="chat-text">{{ e.message }}</span>
          </div>
        } @empty {
          <span class="muted">{{ placeholder() }}</span>
        }
      </div>
    </div>
  `,
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  private api = inject(Api);
  @ViewChild('stream') stream?: ElementRef<HTMLDivElement>;

  lines = signal<BridgeEvent[]>([]);
  placeholder = signal('loading chat…');
  private cursor = 0;
  private timer?: ReturnType<typeof setInterval>;
  private shouldScroll = false;

  // Bounded so a long-running session cannot grow the view without limit.
  private static readonly KEEP = 300;

  ngOnInit(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 3000);
  }
  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
  ngAfterViewChecked(): void {
    if (this.shouldScroll && this.stream) {
      const el = this.stream.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }

  time(at: number): string {
    return new Date(at * 1000).toTimeString().slice(0, 8);
  }

  refresh(): void {
    this.api.bridgeEvents(this.cursor).subscribe({
      next: (r) => {
        // The event file is truncated when the server boots, so a cursor that
        // moved backwards means a new run: drop what belongs to the old one.
        if (r.cursor < this.cursor) this.lines.set([]);
        this.cursor = r.cursor;
        const chat = r.events.filter((e) => e.type === 'chat');
        if (chat.length) {
          this.lines.update((prev) => [...prev, ...chat].slice(-ChatComponent.KEEP));
          this.shouldScroll = true;
        }
        this.placeholder.set('(no chat yet this server run)');
      },
      error: () => this.placeholder.set('(chat unavailable)'),
    });
  }
}
