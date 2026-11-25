from collections import defaultdict
from fastapi import WebSocket

class QueueHub:
    def __init__(self):
        self.connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, clinic_id: int, websocket: WebSocket):
        await websocket.accept()
        self.connections[clinic_id].add(websocket)

    def disconnect(self, clinic_id: int, websocket: WebSocket):
        self.connections[clinic_id].discard(websocket)

    async def broadcast(self, clinic_id: int, message: dict):
        stale = []
        for ws in list(self.connections[clinic_id]):
            try:
                await ws.send_json(message)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.disconnect(clinic_id, ws)

hub = QueueHub()
