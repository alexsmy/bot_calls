import json
import hmac
import hashlib
from urllib.parse import parse_qs, unquote
from typing import Dict, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import os

app = FastAPI()

# Монтируем статические файлы и шаблоны
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

class ConnectionManager:
    """Управляет активными WebSocket соединениями и статусами пользователей."""
    def __init__(self):
        # Словарь для хранения активных соединений: {user_id: WebSocket}
        self.active_connections: Dict[int, WebSocket] = {}
        # Словарь для хранения информации о пользователях: {user_id: user_data}
        self.users: Dict[int, dict] = {}

    async def connect(self, websocket: WebSocket, user_id: int, user_data: dict):
        """Принимает новое WebSocket соединение."""
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.users[user_id] = {**user_data, "status": "available"} # 'available' or 'busy'
        await self.broadcast_user_list()

    def disconnect(self, user_id: int):
        """Обрабатывает отключение пользователя."""
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        if user_id in self.users:
            del self.users[user_id]

    async def broadcast_user_list(self):
        """Рассылает обновленный список пользователей всем подключенным клиентам."""
        user_list = list(self.users.values())
        message = {"type": "user_list", "data": user_list}
        for connection in self.active_connections.values():
            await connection.send_json(message)

    async def send_personal_message(self, message: dict, user_id: int):
        """Отправляет личное сообщение конкретному пользователю."""
        if user_id in self.active_connections:
            await self.active_connections[user_id].send_json(message)

    async def set_user_status(self, user_id: int, status: str):
        """Устанавливает статус пользователя и оповещает всех."""
        if user_id in self.users:
            self.users[user_id]["status"] = status
            await self.broadcast_user_list()

manager = ConnectionManager()

def validate_init_data(init_data: str) -> dict | None:
    """Проверяет подлинность данных, полученных от Telegram."""
    bot_token = os.environ.get("BOT_TOKEN")
    if not bot_token:
        return None

    try:
        parsed_data = parse_qs(init_data)
        hash_from_telegram = parsed_data.pop('hash')[0]
        
        data_check_string = "\n".join(f"{k}={v[0]}" for k, v in sorted(parsed_data.items()))
        
        secret_key = hmac.new("WebAppData".encode(), bot_token.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

        if calculated_hash == hash_from_telegram:
            user_data_str = parsed_data.get('user', ['{}'])[0]
            return json.loads(unquote(user_data_str))
        return None
    except (KeyError, IndexError, Exception):
        return None

@app.get("/", response_class=HTMLResponse)
async def get_root(request: Request):
    """Отдает главную HTML страницу."""
    return templates.TemplateResponse("index.html", {"request": request})

@app.websocket("/ws/{init_data}")
async def websocket_endpoint(websocket: WebSocket, init_data: str):
    """Основная точка входа для WebSocket соединений."""
    user_data = validate_init_data(init_data)
    if not user_data:
        await websocket.close(code=1008)
        return

    user_id = user_data['id']
    await manager.connect(websocket, user_id, user_data)

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")
            
            # --- Логика сигнализации WebRTC ---
            
            if message_type == "call_user":
                # Пользователь user_id хочет позвонить target_id
                target_id = message["data"]["target_id"]
                print(f"User {user_id} is calling {target_id}")
                await manager.set_user_status(user_id, "busy")
                await manager.set_user_status(target_id, "busy")
                await manager.send_personal_message(
                    {"type": "incoming_call", "data": {"from": user_id, "from_user": manager.users[user_id]}},
                    target_id
                )

            elif message_type == "call_accepted":
                # Цель звонка приняла вызов
                target_id = message["data"]["target_id"]
                print(f"Call accepted between {user_id} and {target_id}")
                await manager.send_personal_message(
                    {"type": "call_accepted", "data": {"from": user_id}},
                    target_id
                )

            elif message_type == "offer" or message_type == "answer" or message_type == "candidate":
                # Пересылка WebRTC сигналов
                target_id = message["data"]["target_id"]
                # Добавляем, от кого пришел сигнал
                message["data"]["from"] = user_id
                print(f"Relaying '{message_type}' from {user_id} to {target_id}")
                await manager.send_personal_message(message, target_id)

            elif message_type == "hangup" or message_type == "call_declined":
                # Завершение или отклонение звонка
                target_id = message["data"]["target_id"]
                print(f"Hangup/decline between {user_id} and {target_id}")
                # Отправляем подтверждение другому пользователю
                await manager.send_personal_message({"type": "call_ended"}, target_id)
                # Освобождаем обоих пользователей
                await manager.set_user_status(user_id, "available")
                await manager.set_user_status(target_id, "available")

    except WebSocketDisconnect:
        print(f"User {user_id} disconnected.")
        manager.disconnect(user_id)
        await manager.broadcast_user_list()
