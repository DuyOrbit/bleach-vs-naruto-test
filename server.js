const http = require('http');
const express = require('express');
const compression = require('compression');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();

// 1. Kích hoạt nén Gzip / Deflate: giảm 60 - 75% băng thông cho JS, CSS, JSON, HTML
// BỎ QUA file .swf vì game.swf vốn đã được nén zlib sẵn.
// Tránh quá tải 100% CPU và tràn RAM khi nhiều người cùng tải.
app.use(compression({
    threshold: 1024,
    level: 6,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        if (req.path && req.path.endsWith('.swf')) {
            return false;
        }
        return compression.filter(req, res);
    }
}));

// 2. Bật CORS để hỗ trợ nếu Frontend được host tách biệt trên Cloudflare Pages / Vercel
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        return next();
    }
    express.json()(req, res, next);
});

// ==========================================
// VERCEL / SERVERLESS SIGNALING ENDPOINTS (HONG KONG / SINGAPORE - 15ms PING)
// Loại bỏ hoàn toàn máy chủ Mỹ (Render), người chơi tại Việt Nam kết nối siêu tốc
// ==========================================
const httpRooms = new Map();

// Tự động dọn phòng HTTP sau 30 phút
setInterval(() => {
    const now = Date.now();
    for (const [id, r] of httpRooms.entries()) {
        if (now - (r.lastActive || 0) > 30 * 60 * 1000) {
            httpRooms.delete(id);
        }
    }
}, 60000);

app.post('/api/room/create', (req, res) => {
    const { roomId, offer } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'Missing roomId' });
    let room = httpRooms.get(roomId);
    if (!room) {
        room = {
            roomId,
            createdAt: Date.now(),
            lastActive: Date.now(),
            offer: offer || null,
            answer: null,
            hostCandidates: [],
            guestCandidates: [],
            status: 'waiting'
        };
        httpRooms.set(roomId, room);
    } else {
        room.lastActive = Date.now();
        if (offer) room.offer = offer;
    }
    res.json({ ok: true, roomId });
});

app.post('/api/room/join', (req, res) => {
    const { roomId } = req.body || {};
    const room = httpRooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'Phòng không tồn tại hoặc đã hết hạn!' });
    room.lastActive = Date.now();
    room.status = 'matched';
    res.json({ ok: true, roomId, offer: room.offer });
});

app.post('/api/room/signal', (req, res) => {
    const { roomId, role, offer, answer } = req.body || {};
    const room = httpRooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'Phòng không tồn tại!' });
    room.lastActive = Date.now();
    if (offer) room.offer = offer;
    if (answer) room.answer = answer;
    res.json({ ok: true });
});

app.post('/api/room/answer', (req, res) => {
    const { roomId, answer } = req.body || {};
    const room = httpRooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'Phòng không tồn tại!' });
    room.lastActive = Date.now();
    room.answer = answer;
    res.json({ ok: true });
});

app.post('/api/room/candidate', (req, res) => {
    const { roomId, role, candidate } = req.body || {};
    const room = httpRooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'Phòng không tồn tại!' });
    room.lastActive = Date.now();
    if (candidate) {
        if (role === 'host') room.hostCandidates.push(candidate);
        else room.guestCandidates.push(candidate);
    }
    res.json({ ok: true });
});

app.get('/api/room/poll', (req, res) => {
    const { roomId, role } = req.query;
    const room = httpRooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'Phòng không tồn tại!' });
    room.lastActive = Date.now();
    if (role === 'host') {
        const candidates = room.guestCandidates;
        room.guestCandidates = [];
        res.json({ answer: room.answer, candidates, status: room.status });
    } else {
        const candidates = room.hostCandidates;
        room.hostCandidates = [];
        res.json({ offer: room.offer, candidates, status: room.status });
    }
});

// ==========================================
// QUICK MATCH (GHÉP TRẬN NGẪU NHIÊN GIỐNG ANIMUGEN /online)
// ==========================================
const matchQueue = []; // [{ playerId, name, joinedAt, matchedRoomId, role, opponentName }]
const matchedPlayers = new Map(); // playerId -> { roomId, role, opponentName, matchedAt }

function cleanupMatchmaking() {
    const now = Date.now();
    for (let i = matchQueue.length - 1; i >= 0; i--) {
        if (now - matchQueue[i].lastSeen > 25000) {
            matchQueue.splice(i, 1);
        }
    }
    for (const [pid, info] of matchedPlayers.entries()) {
        if (now - info.matchedAt > 5 * 60 * 1000) {
            matchedPlayers.delete(pid);
        }
    }
}

app.post('/api/matchmaking/join', (req, res) => {
    cleanupMatchmaking();
    const { playerId, name } = req.body || {};
    if (!playerId) return res.status(400).json({ error: 'Missing playerId' });

    const existingMatch = matchedPlayers.get(playerId);
    if (existingMatch) {
        return res.json({ state: 'matched', ...existingMatch, searching: matchQueue.length, playing: httpRooms.size });
    }

    let entry = matchQueue.find(p => p.playerId === playerId);
    if (!entry) {
        entry = { playerId, name: (name || 'Fighter').slice(0, 24), joinedAt: Date.now(), lastSeen: Date.now() };
        matchQueue.push(entry);
    } else {
        entry.lastSeen = Date.now();
    }

    if (matchQueue.length >= 2) {
        const p1 = matchQueue.shift();
        const p2 = matchQueue.shift();
        const roomId = 'qm-' + Math.random().toString(36).substring(2, 8);
        httpRooms.set(roomId, {
            roomId,
            createdAt: Date.now(),
            lastActive: Date.now(),
            offer: null,
            answer: null,
            hostCandidates: [],
            guestCandidates: [],
            status: 'waiting'
        });
        const now = Date.now();
        matchedPlayers.set(p1.playerId, { roomId, role: 'host', opponentName: p2.name, matchedAt: now });
        matchedPlayers.set(p2.playerId, { roomId, role: 'guest', opponentName: p1.name, matchedAt: now });
        const mine = matchedPlayers.get(playerId);
        return res.json({ state: 'matched', ...mine, searching: matchQueue.length, playing: httpRooms.size });
    }

    res.json({ state: 'searching', searching: matchQueue.length, playing: httpRooms.size });
});

app.get('/api/matchmaking/status', (req, res) => {
    cleanupMatchmaking();
    const { playerId } = req.query;
    if (!playerId) return res.status(400).json({ error: 'Missing playerId' });

    const matched = matchedPlayers.get(playerId);
    if (matched) {
        return res.json({ state: 'matched', ...matched, searching: matchQueue.length, playing: httpRooms.size });
    }
    const q = matchQueue.find(p => p.playerId === playerId);
    if (!q) {
        return res.json({ state: 'idle', searching: matchQueue.length, playing: httpRooms.size });
    }
    q.lastSeen = Date.now();
    res.json({ state: 'searching', searching: matchQueue.length, playing: httpRooms.size });
});

app.post('/api/matchmaking/leave', (req, res) => {
    const { playerId } = req.body || {};
    if (playerId) {
        const idx = matchQueue.findIndex(p => p.playerId === playerId);
        if (idx !== -1) matchQueue.splice(idx, 1);
        matchedPlayers.delete(playerId);
    }
    res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

// Rooms storage: roomId -> { host: ws, guest: ws, lastActive: number, createdAt: number }
const rooms = new Map();

// 3. Healthcheck endpoints (hỗ trợ cả Render, UptimeRobot lẫn Fly.io)
function getHealthData() {
    return {
        status: 'ok',
        uptime: Math.round(process.uptime()),
        rooms: rooms.size,
        activeWsClients: wss.clients.size,
        memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
    };
}
app.get('/health', (req, res) => res.json(getHealthData()));
app.get('/healthz', (req, res) => res.json(getHealthData()));

// 4. WebSocket Heartbeat: Giữ kết nối qua Proxy (chống timeout 60s) & dọn socket chết
const HEARTBEAT_INTERVAL = 30000; // 30s
const cleanupInterval = setInterval(() => {
    // A. Kiểm tra liveness của client
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        try {
            ws.ping();
        } catch (e) {
            ws.terminate();
        }
    });

    // B. Dọn dẹp các phòng mồ côi hoặc treo quá 2 tiếng để chống rò rỉ bộ nhớ (Memory Leak)
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
        const isHostAlive = room.host && room.host.readyState === 1; // 1 = OPEN
        const isGuestAlive = room.guest && room.guest.readyState === 1;
        if (!isHostAlive && !isGuestAlive) {
            rooms.delete(roomId);
        } else if (now - (room.lastActive || room.createdAt || 0) > 2 * 60 * 60 * 1000) {
            rooms.delete(roomId);
        }
    }
}, HEARTBEAT_INTERVAL);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    let currentRoom = null;
    let currentRole = null;

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('error', (err) => {
        console.warn('Lỗi socket client:', err.message);
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'create_room') {
                const roomId = data.roomId;
                rooms.set(roomId, { host: ws, guest: null, lastActive: Date.now(), createdAt: Date.now() });
                currentRoom = roomId;
                currentRole = 'host';
                ws.send(JSON.stringify({ type: 'room_created', roomId }));
            }
            else if (data.type === 'join_room') {
                const roomId = data.roomId;
                const room = rooms.get(roomId);
                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: `Phòng [${roomId}] không tồn tại!` }));
                    return;
                }
                if (room.guest && room.guest.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Phòng này đã có đủ 2 người chơi!' }));
                    return;
                }
                room.guest = ws;
                room.lastActive = Date.now();
                currentRoom = roomId;
                currentRole = 'guest';

                ws.send(JSON.stringify({ type: 'room_joined', roomId }));

                // Báo cho cả 2 bên biết đã kết nối thành công
                if (room.host && room.host.readyState === ws.OPEN) {
                    room.host.send(JSON.stringify({ type: 'peer_connected', role: 'host' }));
                    ws.send(JSON.stringify({ type: 'peer_connected', role: 'guest' }));
                }
            }
            else {
                // Relay các gói tin (game_input, sync_restart, ping, pong, v.v.) sang đối thủ
                if (currentRoom) {
                    const room = rooms.get(currentRoom);
                    if (room) {
                        room.lastActive = Date.now();
                        const target = currentRole === 'host' ? room.guest : room.host;
                        if (target && target.readyState === ws.OPEN) {
                            target.send(message.toString());
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Lỗi xử lý ws message:', e);
        }
    });

    ws.on('close', () => {
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                const target = currentRole === 'host' ? room.guest : room.host;
                if (target && target.readyState === ws.OPEN) {
                    try {
                        target.send(JSON.stringify({ type: 'peer_disconnected' }));
                    } catch (e) {}
                }
                if (currentRole === 'host') {
                    rooms.delete(currentRoom);
                } else if (room.guest === ws) {
                    room.guest = null;
                    if (!room.host || room.host.readyState !== ws.OPEN) {
                        rooms.delete(currentRoom);
                    }
                }
            }
        }
    });
});

// 5. Phục vụ file tĩnh (SWF, WASM, JS, CSS, ảnh)
const staticDirs = [process.cwd(), __dirname];
staticDirs.forEach(dir => {
    app.use(express.static(dir, {
        dotfiles: 'ignore',
        index: ['index.html'],
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) {
                res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
            } else if (filePath.match(/\.(swf|wasm|mp3|wav|ogg|png|jpg|jpeg|gif|webp|svg|ico)$/i)) {
                res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
            } else if (filePath.match(/\.(js|css)$/i)) {
                res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
            }
        }
    }));
});

// Route tường minh cho style.css để đảm bảo 100% trả về text/css đúng chuẩn (khử lỗi Vercel)
app.get('/style.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css; charset=UTF-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    const cssPath = path.join(process.cwd(), 'style.css');
    res.sendFile(cssPath, (err) => {
        if (err) res.sendFile(path.join(__dirname, 'style.css'));
    });
});

// Route tường minh cho main.js
app.get('/main.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    const jsPath = path.join(process.cwd(), 'main.js');
    res.sendFile(jsPath, (err) => {
        if (err) res.sendFile(path.join(__dirname, 'main.js'));
    });
});

// Điều hướng trang về index.html (chỉ áp dụng cho trang web, KHÔNG bắt nhầm file tĩnh .css, .js, .swf)
app.get('*', (req, res) => {
    if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
        return res.status(404).send('Static file not found: ' + req.path);
    }
    const htmlPath = path.join(process.cwd(), 'index.html');
    res.sendFile(htmlPath, (err) => {
        if (err) res.sendFile(path.join(__dirname, 'index.html'));
    });
});

// Xử lý lỗi an toàn
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// 6. Bảo vệ tiến trình không bao giờ crash bất ngờ
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// 7. Graceful shutdown khi Render hoặc Fly.io deploy bản mới
function gracefulShutdown(signal) {
    console.log(`[Server] Nhận tín hiệu ${signal}. Đang đóng các kết nối an toàn...`);
    clearInterval(cleanupInterval);
    wss.clients.forEach((ws) => {
        try {
            ws.close(1001, 'Máy chủ đang cập nhật khởi động lại');
        } catch (e) {}
    });
    server.close(() => {
        console.log('[Server] Máy chủ đã tắt hoàn tất.');
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;

if (!process.env.VERCEL) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server Bleach vs Naruto Online (HTTP + WebSocket) đang chạy trên cổng: ${PORT}`);
    });
}
