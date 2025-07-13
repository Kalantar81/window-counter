import { Component, OnDestroy, OnInit, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, NavigationEnd } from '@angular/router';
import { WebsocketService } from './websocket.service';
import { v4 as uuidv4 } from 'uuid';
import { BehaviorSubject } from 'rxjs';
import { filter } from 'rxjs/operators';

interface ClientState {
  clientId: string;
  tabId: string;
  isVisible: boolean;
  lastUpdated: number;
  lastVisibilityChange: number;
  tabLocation: string;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.sass']
})
export class AppComponent implements OnInit, OnDestroy {
  clientState: ClientState | null = null;
  serverState: any[] = [];
  serverStateFromRest: any = null;
  private clientId: string;
  private tabId: string;

  private _isTabVisible = new BehaviorSubject<boolean>(!document.hidden);
  public isTabVisible$ = this._isTabVisible.asObservable();

  constructor(private websocketService: WebsocketService, private http: HttpClient, private zone: NgZone, private router: Router) {
    this.clientId = `client_${uuidv4()}`;
    this.tabId = `tab_${uuidv4()}`;
    
    // Listen for visibility changes
    document.addEventListener('visibilitychange', () => {
      this.zone.run(() => {
        const isVisible = document.visibilityState === 'visible';
        this._isTabVisible.next(isVisible);
        this.updateTabVisibility(isVisible);
      });
    });
  }

  ngOnInit() {
    const socket = this.websocketService.connect(`ws://localhost:3000?clientId=${this.clientId}`);

    // Initialize client state
    this.clientState = {
      clientId: this.clientId,
      tabId: this.tabId,
      isVisible: !document.hidden,
      lastUpdated: Date.now(),
      lastVisibilityChange: Date.now(),
      tabLocation: this.getCurrentRoute()
    };
    
    this.sendStateUpdate();

    // Listen for route changes
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event) => {
      this.updateTabLocation((event as NavigationEnd).url);
    });

    socket.subscribe(
      (message) => {
        if (message.type === 'stateUpdate') {
          this.serverState = message.state;
        }
      },
      (err) => console.error(err),
      () => console.warn('Completed!')
    );
  }

  getRestState() {
    this.http.get<any>('http://localhost:3000/api/state').subscribe(data => {
      this.serverStateFromRest = data.state;
    });
  }

  ngOnDestroy() {
    this.websocketService.close();
  }

  sendStateUpdate() {
    if (this.clientState) {
      this.websocketService.sendMessage({
        type: 'updateState',
        state: this.clientState
      });
    }
  }

  updateTabVisibility(isVisible: boolean) {
    if (this.clientState) {
      // Update visibility in client state
      this.clientState.isVisible = isVisible;
      this.clientState.lastUpdated = Date.now();
      this.clientState.lastVisibilityChange = Date.now();
      // Ensure tabLocation is current
      this.clientState.tabLocation = this.getCurrentRoute();
    }
    
    // Send visibility update to server
    this.websocketService.sendMessage({
      type: 'visibilityChange',
      isVisible: isVisible,
      timestamp: Date.now()
    });
    
    // Also send full state update
    this.sendStateUpdate();
  }

  private getCurrentRoute(): string {
    const url = this.router.url;
    // Extract route name from URL (e.g., '/clients' -> 'clients')
    const route = url.split('/')[1] || 'clients'; // default to 'clients' if root
    return route;
  }

  private updateTabLocation(url: string): void {
    const route = url.split('/')[1] || 'clients'; // default to 'clients' if root
    
    if (this.clientState) {
      this.clientState.tabLocation = route;
      this.clientState.lastUpdated = Date.now();
      this.sendStateUpdate();
    }
  }
}
