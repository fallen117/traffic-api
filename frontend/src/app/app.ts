import { Component } from '@angular/core';
import { ChatPanel } from './components/chat-panel/chat-panel';
import { MapPanel } from './components/map-panel/map-panel';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ChatPanel, MapPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
