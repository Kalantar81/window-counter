const express = require('express');
const http = require('http');
const { Server } = require('ws');
const cors = require('cors');
const url = require('url');

const app = express();
app.use(cors());
app.use(express.json()); // Add middleware to parse JSON bodies

const server = http.createServer(app);
const wss = new Server({ server });

const clients = new Map();

function broadcastState() {
  const state = getClientStates();
  console.log('Current Server State:', JSON.stringify(state, null, 2));
  const message = JSON.stringify({ type: 'stateUpdate', state });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

function getClientStates() {
  const clientStates = [];
  
  // Process all clients and return simplified structure
  for (const [clientId, data] of clients.entries()) {
    clientStates.push({
      clientId: data.clientId || clientId,
      tabId: data.tabId || clientId, // Use clientId as fallback for tabId
      isVisible: data.isVisible,
      lastUpdated: data.lastUpdated,
      lastVisibilityChange: data.lastVisibilityChange,
      tabLocation: data.tabLocation || 'unknown'
    });
  }
  
  return clientStates;
}

wss.on('connection', (ws, req) => {
  const parameters = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const clientId = parameters.get('clientId');

  if (!clientId) {
    ws.close(1008, "Client ID is required");
    return;
  }

  ws.id = clientId;
  if (!clients.has(ws.id)) {
    clients.set(ws.id, { 
      connections: [], 
      clientId: clientId,
      tabId: null,
      isVisible: true, // Default to visible when first connected
      lastUpdated: Date.now(),
      lastVisibilityChange: Date.now(),
      tabLocation: 'unknown'
    });
  }
  clients.get(ws.id).connections.push(ws);


  console.log(`Client ${clientId} connected`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const clientData = clients.get(ws.id);

      if (data.type === 'updateState') {
        // Update client state with new simplified structure
        clientData.clientId = data.state.clientId;
        clientData.tabId = data.state.tabId;
        clientData.isVisible = data.state.isVisible;
        clientData.lastUpdated = data.state.lastUpdated;
        clientData.lastVisibilityChange = data.state.lastVisibilityChange;
        clientData.tabLocation = data.state.tabLocation;
        clients.set(ws.id, clientData);
        broadcastState();
      } else if (data.type === 'visibilityChange') {
        console.log(`📱 Client ${ws.id} visibility changed to: ${data.isVisible ? '👁️  VISIBLE' : '🙈 HIDDEN'} at ${new Date(data.timestamp).toISOString()}`);
        // Update the client's visibility status
        clientData.isVisible = data.isVisible;
        clientData.lastVisibilityChange = data.timestamp;
        clientData.lastUpdated = data.timestamp;
        clients.set(ws.id, clientData);
        broadcastState();
      }
    } catch (error) {
      console.error('Failed to parse message or update state:', error);
    }
  });

  ws.on('close', () => {
    console.log(`Client ${clientId} disconnected`);
    const clientData = clients.get(ws.id);
    if (clientData) {
      clientData.connections = clientData.connections.filter(conn => conn !== ws);
      if (clientData.connections.length === 0) {
        clients.delete(ws.id);
      }
    }
    broadcastState();
  });

 

  broadcastState();
});

app.get('/api/state', (req, res) => {
    const state = getClientStates();
    res.json({ state });
});

// New endpoint to handle location data
app.post('/api/location', (req, res) => {
    const locationData = req.body;
    console.log('Received location data:', locationData);
    
    // Find visible clients with tabLocation = "map"
    const visibleMapClients = [];
    for (const [clientId, data] of clients.entries()) {
        if (data.isVisible && data.tabLocation === 'map') {
            visibleMapClients.push({
                clientId: data.clientId,
                lastUpdated: data.lastUpdated,
                connections: data.connections
            });
        }
    }
    
    console.log(`Found ${visibleMapClients.length} visible clients on map tab`);
    
    if (visibleMapClients.length > 0) {
        let targetClient;
        
        if (visibleMapClients.length === 1) {
            targetClient = visibleMapClients[0];
        } else {
            // If multiple clients, find the one with the most recent lastUpdated
            targetClient = visibleMapClients.reduce((latest, current) => {
                return current.lastUpdated > latest.lastUpdated ? current : latest;
            });
        }
        
        console.log(`Sending location data to client: ${targetClient.clientId}`);
        
        // Send location data to the target client's connections
        const message = JSON.stringify({
            type: 'drawLocation',
            locationData: locationData
        });
        
        targetClient.connections.forEach(ws => {
            if (ws.readyState === ws.OPEN) {
                ws.send(message);
            }
        });
        
        res.json({ 
            success: true, 
            message: `Location data sent to client ${targetClient.clientId}`,
            targetClient: targetClient.clientId
        });
    } else {
        res.json({ 
            success: false, 
            message: 'No visible clients found on map tab' 
        });
    }
});

const port = 3000;
server.listen(port, () => {
  console.log(`Server with WebSocket listening on http://localhost:${port}`);
});
