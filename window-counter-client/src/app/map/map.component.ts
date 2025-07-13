import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import Map from '@arcgis/core/Map';
import MapView from '@arcgis/core/views/MapView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol';
import PopupTemplate from '@arcgis/core/PopupTemplate';
import CoordinateConversion from '@arcgis/core/widgets/CoordinateConversion';
import { WebsocketService } from '../websocket.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.sass']
})
export class MapComponent implements OnInit, OnDestroy {
  @ViewChild('mapViewNode', { static: true }) private mapViewEl!: ElementRef;
  
  clients: any[] = [];
  selectedClient: any = null;
  Math = Math; // Make Math available in template
  
  private map!: Map;
  private view!: MapView;
  private graphicsLayer!: GraphicsLayer;
  private locationGraphicsLayer!: GraphicsLayer;
  private coordinateWidget!: CoordinateConversion;
  private websocketSubscription?: Subscription;
  private clientId = 'map-client-' + Date.now();

  constructor(private http: HttpClient, private websocketService: WebsocketService) { }

  ngOnInit(): void {
    this.initializeMap();
    this.loadClients();
    this.setupWebSocket();
  }

  ngOnDestroy(): void {
    if (this.view) {
      this.view.destroy();
    }
    if (this.websocketSubscription) {
      this.websocketSubscription.unsubscribe();
    }
    this.websocketService.close();
  }

  private initializeMap(): void {
    // Create the map
    this.map = new Map({
      basemap: 'streets-navigation-vector'
    });

    // Create the graphics layer for client markers
    this.graphicsLayer = new GraphicsLayer();
    this.map.add(this.graphicsLayer);

    // Create a separate graphics layer for location markers
    this.locationGraphicsLayer = new GraphicsLayer();
    this.map.add(this.locationGraphicsLayer);

    // Create the map view
    this.view = new MapView({
      container: this.mapViewEl.nativeElement,
      map: this.map,
      center: [34.8594, 32.3215], // Netanya, Israel
      zoom: 10
    });

    // Add coordinate conversion widget
    this.coordinateWidget = new CoordinateConversion({
      view: this.view
    });
    this.view.ui.add(this.coordinateWidget, "bottom-right");
  }

  loadClients() {
    this.http.get<any>('http://localhost:3000/api/state').subscribe(data => {
      this.clients = data.state;
      this.updateMapMarkers();
    });
  }

  private updateMapMarkers(): void {
    if (!this.graphicsLayer) return;
    
    // Clear existing graphics
    this.graphicsLayer.removeAll();
    
    this.clients.forEach((client, index) => {
      // Generate random coordinates around Los Angeles for demo
      const lat = 34.052 + (Math.random() - 0.5) * 0.5;
      const lng = -118.244 + (Math.random() - 0.5) * 0.5;
      
      const point = new Point({
        longitude: lng,
        latitude: lat
      });

      const symbol = new SimpleMarkerSymbol({
        color: client.isVisible ? [40, 167, 69] : [220, 53, 69], // Green for visible, red for hidden
        size: 12,
        outline: {
          color: [255, 255, 255],
          width: 2
        }
      });

      const popupTemplate = new PopupTemplate({
        title: `Client ${client.clientId.slice(-8)}`,
        content: `
          <div>
            <p><strong>Status:</strong> ${client.isVisible ? 'Visible' : 'Hidden'}</p>
            <p><strong>Tab ID:</strong> ${client.tabId.slice(-8)}</p>
            <p><strong>Last Updated:</strong> ${new Date(client.lastUpdated).toLocaleString()}</p>
            <p><strong>Last Visibility Change:</strong> ${new Date(client.lastVisibilityChange).toLocaleString()}</p>
          </div>
        `
      });

      const graphic = new Graphic({
        geometry: point,
        symbol: symbol,
        popupTemplate: popupTemplate,
        attributes: {
          clientData: client
        }
      });

      this.graphicsLayer.add(graphic);
    });
  }

  refreshMap() {
    this.loadClients();
  }

  selectClient(client: any) {
    this.selectedClient = client;
    
    // Find the graphic for this client and zoom to it
    if (this.view && this.graphicsLayer) {
      const graphic = this.graphicsLayer.graphics.find(g => 
        g.attributes.clientData.clientId === client.clientId
      );
      
      if (graphic && graphic.geometry) {
        this.view.goTo({
          target: graphic.geometry,
          zoom: 15
        });
      }
    }
  }

  private setupWebSocket(): void {
    const wsUrl = `ws://localhost:3000?clientId=${this.clientId}`;
    console.log('Connecting to WebSocket:', wsUrl);
    
    const socket$ = this.websocketService.connect(wsUrl);
    
    this.websocketSubscription = socket$.subscribe({
      next: (message) => {
        console.log('Received WebSocket message:', message);
        
        if (message.type === 'drawLocation') {
          console.log('Processing drawLocation message:', message.locationData);
          this.drawLocationOnMap(message.locationData);
        } else if (message.type === 'stateUpdate') {
          console.log('State update received:', message.state);
          // Update local clients state if needed
          this.clients = message.state;
          this.updateMapMarkers();
        }
      },
      error: (error) => {
        console.error('WebSocket error:', error);
        // Try to reconnect after 5 seconds
        setTimeout(() => {
          console.log('Attempting to reconnect WebSocket...');
          this.setupWebSocket();
        }, 5000);
      },
      complete: () => {
        console.log('WebSocket connection closed');
      }
    });

    // Send initial state to server indicating this client is on the map tab
    setTimeout(() => {
      this.websocketService.sendMessage({
        type: 'updateState',
        state: {
          clientId: this.clientId,
          tabId: this.clientId,
          isVisible: true,
          lastUpdated: Date.now(),
          lastVisibilityChange: Date.now(),
          tabLocation: 'map'
        }
      });
      console.log('Sent initial state to server for client:', this.clientId);
    }, 1000); // Wait 1 second for connection to establish

    // Listen for visibility changes
    document.addEventListener('visibilitychange', () => {
      const isVisible = !document.hidden;
      console.log('Visibility changed:', isVisible);
      
      this.websocketService.sendMessage({
        type: 'visibilityChange',
        isVisible: isVisible,
        timestamp: Date.now()
      });
      
      // Update state as well
      this.websocketService.sendMessage({
        type: 'updateState',
        state: {
          clientId: this.clientId,
          tabId: this.clientId,
          isVisible: isVisible,
          lastUpdated: Date.now(),
          lastVisibilityChange: Date.now(),
          tabLocation: 'map'
        }
      });
    });
  }

  private drawLocationOnMap(locationData: any): void {
    console.log('Drawing location on map:', locationData);
    
    if (!this.locationGraphicsLayer || !this.view) {
      console.error('Map or location graphics layer not initialized');
      return;
    }

    try {
      const longitude = parseFloat(locationData.longitude);
      const latitude = parseFloat(locationData.latitude);
      
      if (isNaN(longitude) || isNaN(latitude)) {
        console.error('Invalid coordinates:', locationData);
        return;
      }

      const point = new Point({
        longitude: longitude,
        latitude: latitude
      });

      let symbol;

      // Use SVG if available, otherwise fallback to simple marker
      if (locationData.svg) {
        // Convert SVG to data URL for PictureMarkerSymbol
        const svgBlob = new Blob([locationData.svg], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(svgBlob);
        
        symbol = new PictureMarkerSymbol({
          url: svgUrl,
          width: "32px",
          height: "32px"
        });
      } else {
        // Fallback to simple marker with color mapping
        const colorMap: { [key: string]: number[] } = {
          'red': [255, 0, 0],
          'blue': [0, 0, 255],
          'green': [0, 255, 0],
          'yellow': [255, 255, 0],
          'purple': [128, 0, 128],
          'orange': [255, 165, 0],
          'pink': [255, 192, 203],
          'cyan': [0, 255, 255]
        };

        const markerColor = colorMap[locationData.color] || [255, 0, 0];

        symbol = new SimpleMarkerSymbol({
          color: markerColor,
          size: 16,
          outline: {
            color: [255, 255, 255],
            width: 2
          }
        });
      }

      const popupTemplate = new PopupTemplate({
        title: locationData.label || 'User Location',
        content: `
          <div>
            <p><strong>Label:</strong> ${locationData.label || 'N/A'}</p>
            <p><strong>Coordinates:</strong> ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</p>
            <p><strong>Color:</strong> ${locationData.color || 'red'}</p>
            <p><strong>Added:</strong> ${new Date().toLocaleString()}</p>
          </div>
        `
      });

      const graphic = new Graphic({
        geometry: point,
        symbol: symbol,
        popupTemplate: popupTemplate,
        attributes: {
          locationType: 'user-location',
          locationData: locationData
        }
      });

      this.locationGraphicsLayer.add(graphic);
      console.log('Location graphic added to map with SVG symbol');

      // Zoom to the new location at zoom level 15
      this.view.goTo({
        target: point,
        zoom: 15
      }).then(() => {
        console.log('Map zoomed to location:', latitude, longitude);
      }).catch((error) => {
        console.error('Error zooming to location:', error);
      });
      
    } catch (error) {
      console.error('Error drawing location on map:', error);
    }
  }

  cleanMap(): void {
    console.log('Cleaning all graphics from map...');
    
    // Clear client markers
    if (this.graphicsLayer) {
      this.graphicsLayer.removeAll();
      console.log('Client markers cleared');
    }
    
    // Clear location markers
    if (this.locationGraphicsLayer) {
      this.locationGraphicsLayer.removeAll();
      console.log('Location markers cleared');
    }
    
    // Reset selected client
    this.selectedClient = null;
    
    console.log('Map cleaned successfully');
  }

  clearLocationMarkers(): void {
    if (this.locationGraphicsLayer) {
      this.locationGraphicsLayer.removeAll();
      console.log('All location markers cleared from map');
    }
  }

  // Method to manually test location drawing (for debugging)
  testLocationDraw(): void {
    const testLocation = {
      latitude: 32.3215,
      longitude: 34.8594,
      label: 'Test Location',
      color: 'blue',
      svg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#0000ff"/>
      </svg>`
    };
    this.drawLocationOnMap(testLocation);
  }

  getClientColor(client: any): string {
    return client.isVisible ? '#28a745' : '#dc3545';
  }
}
