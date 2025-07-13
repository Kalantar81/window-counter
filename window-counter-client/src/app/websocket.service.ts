import { Injectable } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private socket$: WebSocketSubject<any> | null = null;

  constructor() { }

  public connect(url: string): WebSocketSubject<any> {
    if (!this.socket$ || this.socket$.closed) {
      this.socket$ = webSocket(url);
    }
    return this.socket$;
  }

  public sendMessage(message: any) {
    if (this.socket$) {
      this.socket$.next(message);
    }
  }

  public close() {
    if (this.socket$) {
      this.socket$.complete();
    }
  }
}
