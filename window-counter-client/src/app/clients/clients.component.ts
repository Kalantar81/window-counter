import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WebsocketService } from '../websocket.service';

@Component({
  selector: 'app-clients',
  templateUrl: './clients.component.html',
  styleUrls: ['./clients.component.sass']
})
export class ClientsComponent implements OnInit {
  clients: any[] = [];
  serverState: any[] = [];

  constructor(private http: HttpClient, private websocketService: WebsocketService) { }

  ngOnInit(): void {
    this.loadClients();
    
    // Subscribe to real-time updates
    const socket = this.websocketService.connect('ws://localhost:3000?clientId=clients-view');
    socket.subscribe(
      (message) => {
        if (message.type === 'stateUpdate') {
          this.serverState = message.state;
        }
      },
      (err) => console.error('WebSocket error:', err)
    );
  }

  loadClients() {
    this.http.get<any>('http://localhost:3000/api/state').subscribe(data => {
      this.clients = data.state;
    });
  }

  refreshClients() {
    this.loadClients();
  }
}
