import { Component, inject, ElementRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    MatDividerModule,
  ],
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.scss',
})
export class ChatPanel {
  private chatService = inject(ChatService);

  messages = this.chatService.messages;
  isLoading = this.chatService.isLoading;
  inputText = '';

  private chatListRef = viewChild<ElementRef<HTMLDivElement>>('chatList');
  private textareaEl = viewChild<ElementRef<HTMLTextAreaElement>>('inputTextarea');

  private scrollToBottom(): void {
    const el = this.chatListRef()?.nativeElement;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      });
    }
  }

  onInput(): void {
    const el = this.textareaEl()?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  async send(): Promise<void> {
    const text = this.inputText.trim();
    if (!text || this.isLoading()) return;
    this.inputText = '';
    const el = this.textareaEl()?.nativeElement;
    if (el) el.style.height = 'auto';
    await this.chatService.sendMessage(text);
    this.scrollToBottom();
  }
}
