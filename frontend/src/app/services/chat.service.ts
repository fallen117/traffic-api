import { Injectable, signal, isDevMode } from '@angular/core';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface Coordenadas {
  lat: number;
  lon: number;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private static readonly MSG_KEY = 'quillatraffic_chat_messages';
  private static readonly LOC_KEY = 'quillatraffic_current_location';

  private apiUrl = isDevMode()
    ? 'http://localhost:3001/api/chat'
    : '/api/chat';

  messages = signal<ChatMessage[]>([]);
  isLoading = signal(false);
  currentLocation = signal<Coordenadas | null>(null);

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(ChatService.MSG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        this.messages.set(parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) })));
      }
      const locRaw = localStorage.getItem(ChatService.LOC_KEY);
      if (locRaw) {
        this.currentLocation.set(JSON.parse(locRaw));
      }
    } catch { /* ignore parse errors */ }
  }

  private persistMessages(): void {
    try {
      localStorage.setItem(ChatService.MSG_KEY, JSON.stringify(this.messages()));
    } catch { /* ignore quota errors */ }
  }

  private persistLocation(): void {
    try {
      const loc = this.currentLocation();
      if (loc) {
        localStorage.setItem(ChatService.LOC_KEY, JSON.stringify(loc));
      } else {
        localStorage.removeItem(ChatService.LOC_KEY);
      }
    } catch { /* ignore */ }
  }

  clearChat(): void {
    this.messages.set([]);
    this.currentLocation.set(null);
    localStorage.removeItem(ChatService.MSG_KEY);
    localStorage.removeItem(ChatService.LOC_KEY);
  }

  private get history() {
    return this.messages().map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  }

  async sendMessage(text: string): Promise<void> {
    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    this.messages.update(msgs => [...msgs, userMsg]);
    this.persistMessages();
    this.isLoading.set(true);

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: this.history.slice(0, -1),
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      if (data.coordenadas?.lat && data.coordenadas?.lon) {
        this.currentLocation.set(data.coordenadas);
        this.persistLocation();
      }

      this.messages.update(msgs => [
        ...msgs,
        {
          role: 'assistant',
          content: data.response || data.error || 'Sin respuesta.',
          timestamp: new Date(),
        },
      ]);
      this.persistMessages();
    } catch {
      this.messages.update(msgs => [
        ...msgs,
        {
          role: 'assistant',
          content: isDevMode()
            ? 'Error al conectar con el servidor. Asegúrate de que el backend esté corriendo en http://localhost:3001.'
            : 'Error al conectar con el servidor. Intenta de nuevo más tarde.',
          timestamp: new Date(),
        },
      ]);
      this.persistMessages();
    } finally {
      this.isLoading.set(false);
    }
  }
}
