import { Injectable, signal } from '@angular/core';

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
  private apiUrl = 'http://localhost:3001/api/chat';

  messages = signal<ChatMessage[]>([]);
  isLoading = signal(false);
  currentLocation = signal<Coordenadas | null>(null);

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
      }

      this.messages.update(msgs => [
        ...msgs,
        {
          role: 'assistant',
          content: data.response || data.error || 'Sin respuesta.',
          timestamp: new Date(),
        },
      ]);
    } catch {
      this.messages.update(msgs => [
        ...msgs,
        {
          role: 'assistant',
          content: 'Error al conectar con el servidor. Asegúrate de que el backend esté corriendo en http://localhost:3001.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      this.isLoading.set(false);
    }
  }
}
