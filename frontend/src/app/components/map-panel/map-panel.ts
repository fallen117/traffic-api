import { Component, computed, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-map-panel',
  standalone: true,
  imports: [],
  templateUrl: './map-panel.html',
  styleUrl: './map-panel.scss',
})
export class MapPanel {
  private sanitizer = inject(DomSanitizer);
  private chatService = inject(ChatService);

  mapUrl = computed<SafeResourceUrl>(() => {
    const loc = this.chatService.currentLocation();
    const zoom = loc ? 15 : 13;
    const lat = loc?.lat ?? 10.9639;
    const lon = loc?.lon ?? -74.7964;
    const url = `https://embed.waze.com/iframe?zoom=${zoom}&lat=${lat}&lon=${lon}&pin=1`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });
}
