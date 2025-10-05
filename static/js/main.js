// static/js/main.js
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// --- DOM Элементы ---
const userList = document.getElementById('user-list');
const connectionStatus = document.getElementById('connection-status');
const mainScreen = document.getElementById('main-screen');
const callScreen = document.getElementById('call-screen');
const incomingCallModal = document.getElementById('incoming-call-modal');
const callerInfo = document.getElementById('caller-info');
const acceptBtn = document.getElementById('accept-btn');
const declineBtn = document.getElementById('decline-btn');
const hangupBtn = document.getElementById('hangup-btn');
const remoteUserName = document.getElementById('remote-user-name');
const callTimer = document.getElementById('call-timer');
const localAudio = document.getElementById('localAudio');
const remoteAudio = document.getElementById('remoteAudio');

// --- Глобальные переменные ---
let ws;
let peerConnection;
let localStream;
let currentUser = {};
let targetUser = {};
let callTimerInterval;

// Конфигурация для WebRTC
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// --- Инициализация ---
document.addEventListener('DOMContentLoaded', () => {
    if (!tg.initData) {
        connectionStatus.textContent = "Ошибка: Запустите через Telegram";
        return;
    }
    
    try {
        const initData = new URLSearchParams(tg.initData);
        currentUser = JSON.parse(initData.get('user'));
    } catch (e) {
        connectionStatus.textContent = "Ошибка: Неверные данные пользователя";
        return;
    }

    connectWebSocket();
});

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${tg.initData}`;
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        connectionStatus.textContent = "В сети";
        console.log("WebSocket connected");
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log("Received message:", message);

        switch (message.type) {
            case 'user_list':
                updateUserList(message.data);
                break;
            case 'incoming_call':
                handleIncomingCall(message.data);
                break;
            case 'call_accepted':
                startCall(targetUser.id, false); // isCaller = false
                break;
            case 'offer':
                handleOffer(message.data);
                break;
            case 'answer':
                handleAnswer(message.data);
                break;
            case 'candidate':
                handleCandidate(message.data);
                break;
            case 'call_ended':
                endCall(false); // isInitiator = false
                break;
        }
    };

    ws.onclose = () => {
        connectionStatus.textContent = "Переподключение...";
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        ws.close();
    };
}

function sendMessage(message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

// --- Управление UI ---
function updateUserList(users) {
    userList.innerHTML = '';
    users.forEach(user => {
        if (user.id === currentUser.id) return;

        const card = document.createElement('div');
        card.className = 'user-card';
        card.innerHTML = `
            <div class="user-info">
                <span class="user-name">${user.first_name} ${user.last_name || ''}</span>
                <span class="user-status ${user.status}">${user.status === 'available' ? 'Доступен' : 'Занят'}</span>
            </div>
            <button class="call-btn" data-user-id="${user.id}" ${user.status !== 'available' ? 'disabled' : ''}>
                📞
            </button>
        `;
        userList.appendChild(card);
    });

    document.querySelectorAll('.call-btn').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = parseInt(button.dataset.userId);
            const userToCall = users.find(u => u.id === targetId);
            if (userToCall) {
                targetUser = userToCall;
                sendMessage({ type: 'call_user', data: { target_id: targetId } });
                showScreen('call');
                remoteUserName.textContent = `${targetUser.first_name} ${targetUser.last_name || ''}`;
                callTimer.textContent = "Соединение...";
            }
        });
    });
}

function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`${screenName}-screen`).classList.add('active');
}

// --- Логика звонков (WebRTC) ---

async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendMessage({
                type: 'candidate',
                data: { target_id: targetUser.id, candidate: event.candidate }
            });
        }
    };

    peerConnection.ontrack = event => {
        remoteAudio.srcObject = event.streams[0];
    };

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localAudio.srcObject = localStream;
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
}

async function startCall(targetId, isCaller) {
    targetUser.id = targetId;
    await createPeerConnection();

    if (isCaller) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendMessage({ type: 'offer', data: { target_id: targetId, offer: offer } });
    }
}

function handleIncomingCall(data) {
    targetUser = data.from_user;
    callerInfo.textContent = `Вам звонит ${targetUser.first_name} ${targetUser.last_name || ''}`;
    incomingCallModal.style.display = 'flex';
}

acceptBtn.onclick = async () => {
    incomingCallModal.style.display = 'none';
    sendMessage({ type: 'call_accepted', data: { target_id: targetUser.id } });
    await startCall(targetUser.id, false); // isCaller = false
};

declineBtn.onclick = () => {
    incomingCallModal.style.display = 'none';
    sendMessage({ type: 'call_declined', data: { target_id: targetUser.id } });
};

async function handleOffer(data) {
    if (!peerConnection) {
        await startCall(data.from, false);
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendMessage({ type: 'answer', data: { target_id: data.from, answer: answer } });
    
    showScreen('call');
    remoteUserName.textContent = `${targetUser.first_name} ${targetUser.last_name || ''}`;
    startTimer();
}

async function handleAnswer(data) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    startTimer();
}

async function handleCandidate(data) {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
}

hangupBtn.onclick = () => {
    endCall(true); // isInitiator = true
};

function endCall(isInitiator) {
    if (isInitiator) {
        sendMessage({ type: 'hangup', data: { target_id: targetUser.id } });
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    localAudio.srcObject = null;
    remoteAudio.srcObject = null;
    
    stopTimer();
    showScreen('main');
    targetUser = {};
}

// --- Таймер ---
function startTimer() {
    let seconds = 0;
    callTimer.textContent = '00:00';
    callTimerInterval = setInterval(() => {
        seconds++;
        const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
        const secs = String(seconds % 60).padStart(2, '0');
        callTimer.textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(callTimerInterval);
    callTimer.textContent = '00:00';
}
