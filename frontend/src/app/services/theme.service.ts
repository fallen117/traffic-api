import { Injectable, signal, effect } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  isDarkMode = signal(false);

  constructor() {
    const saved = localStorage.getItem('quillatraffic-theme');
    if (saved === 'dark') {
      this.isDarkMode.set(true);
    }

    effect(() => {
      document.documentElement.classList.toggle('dark-mode', this.isDarkMode());
      localStorage.setItem('quillatraffic-theme', this.isDarkMode() ? 'dark' : 'light');
    });
  }

  toggle(): void {
    this.isDarkMode.update(v => !v);
  }
}
