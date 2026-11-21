// ==========================================
// BLEACH VS NARUTO - 60FPS HD REMOTE PLAY
// Đồng bộ 1 game duy nhất • 100% Khớp màn hình
// WebRTC Canvas 60FPS HD Stream + Audio Sync
// 3 Option phím: WASD | 4 Mũi tên | Tự map (Custom)
// Tự động chuyển đổi sang Native P1 & Native P2 của Flash BVN
// ==========================================

// 0. WEBAUDIO CAPTURE HOOK (Bắt âm thanh game từ Ruffle để stream cho Guest)
(function setupAudioCapture() {
    try {
        const OrigAudioNodeConnect = AudioNode.prototype.connect;
        AudioNode.prototype.connect = function(destination, ...args) {
            if (destination && this.context) {
                if (!this.context._captureDest) {
                    try {
                        this.context._captureDest = this.context.createMediaStreamDestination();
                        window._ruffleAudioStream = this.context._captureDest.stream;
                    } catch (e) {}
                }
                if (this.context._captureDest && destination === this.context.destination) {
                    try {
                        OrigAudioNodeConnect.call(this, this.context._captureDest);
                    } catch (e) {}
                }
            }
            return OrigAudioNodeConnect.call(this, destination, ...args);
        };
    } catch (e) {
        console.warn("WebAudio capture hook not available:", e);
    }
})();

// ==========================================
// CẤU HÌNH WEBRTC & ICE SERVERS (STUN / TURN RELAY)
// ==========================================
const DEFAULT_STUN_SERVERS = [
    // Cloudflare STUN có máy chủ đặt tại Việt Nam (Hà Nội & TP.HCM), ping cực thấp
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    // Cụm TURN Relay Server xuyên tường lửa / NAT (Chuẩn Animugen Open Relay)
    {
        urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turn:openrelay.metered.ca:443?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
    }
];

function getIceServers() {
    const servers = [...DEFAULT_STUN_SERVERS];
    let customTurn = null;

    // 1. Nạp từ biến toàn cục window.BVN_TURN_CONFIG (từ file config.js hoặc nhúng ngoài)
    if (window.BVN_TURN_CONFIG && (Array.isArray(window.BVN_TURN_CONFIG) ? window.BVN_TURN_CONFIG.length > 0 : true)) {
        customTurn = window.BVN_TURN_CONFIG;
    }
    // 2. Nạp từ localStorage nếu người dùng cấu hình trực tiếp trên máy
    else {
        try {
            const stored = localStorage.getItem('bvn_turn_config');
            if (stored) {
                customTurn = JSON.parse(stored);
            }
        } catch (_) {}
    }

    if (customTurn) {
        if (Array.isArray(customTurn)) {
            servers.push(...customTurn);
        } else if (typeof customTurn === 'object') {
            servers.push(customTurn);
        }
        console.log(`[WebRTC] Đã tích hợp cấu hình TURN Server Relay thành công.`);
    }

    return servers;
}

const PEER_CONFIG = {
    get config() {
        return {
            iceServers: getIceServers(),
            iceCandidatePoolSize: 10,
            bundlePolicy: 'max-bundle', // Gom toàn bộ Audio/Video/Input vào 1 kết nối UDP duy nhất để giảm jitter và độ trễ
            rtcpMuxPolicy: 'require'
        };
    }
};

// ==========================================
// CẤU HÌNH CHẤT LƯỢNG STREAM 30FPS (Chuẩn khớp tốc độ khung hình gốc BVN 2.6)
// ==========================================
const STREAM_QUALITY_PRESETS = {
    smooth: {
        label: '⚡ Siêu mượt (2.5 Mbps)',
        maxBitrate: 2500000, // 2.5 Mbps: Nhẹ cho mạng, chống nghẽn và delay
        maxKbps: 2500,
        startKbps: 1500,     // 1.5 Mbps: Bắt đầu truyền ngay mà không làm nghẽn kết nối
        minKbps: 600,        // 600 kbps: Cho phép hạ sâu khi mạng yếu để giữ độ trễ thấp
        framerate: 30,
        degradationPreference: 'maintain-framerate' // Ưu tiên giữ vững 30 FPS, hạ độ nét khi mạng yếu
    },
    balanced: {
        label: '💎 Cân bằng HD (4.0 Mbps)',
        maxBitrate: 4000000, // 4.0 Mbps: Chuẩn HD sắc nét cho 1200x800 @ 30FPS
        maxKbps: 4000,
        startKbps: 2000,     // 2.0 Mbps
        minKbps: 700,        // 700 kbps
        framerate: 30,
        degradationPreference: 'maintain-framerate'
    },
    ultra: {
        label: '👑 Siêu nét HD (6.0 Mbps)',
        maxBitrate: 6000000, // 6.0 Mbps: Cho mạng LAN / cáp quang mạnh
        maxKbps: 6000,
        startKbps: 2500,     // 2.5 Mbps
        minKbps: 800,        // 800 kbps
        framerate: 30,
        degradationPreference: 'maintain-framerate'
    }
};

let currentStreamQuality = localStorage.getItem('bvn_stream_quality') || 'smooth';
let activeVideoSender = null;

// ==========================================
// 1. ĐỊNH NGHĨA PHÍM GỐC CỦA FLASH BVN 2.6
// ==========================================
// Flash Game Bleach vs Naruto 2.6 cố định nhận:
// - P1 Native: WASD (Di chuyển) + J (Đánh/Chọn) + K (Nhảy/Hủy) + L (Lướt) + U (Chiêu phụ) + I (Ulti) + O (Trợ thủ)
// - P2 Native: 4 Mũi tên (Di chuyển) + Numpad 1 (Đánh) + Numpad 2 (Nhảy) + Numpad 3 (Lướt) + Numpad 4 (Chiêu phụ) + Numpad 5 (Ulti) + Numpad 6 (Trợ thủ)
const ACTION_LABELS = {
    UP:     'Di chuyển: Lên (↑ / Nhảy trèo)',
    DOWN:   'Di chuyển: Xuống (↓ / Ngồi đỡ)',
    LEFT:   'Di chuyển: Trái (← / Lùi tiến)',
    RIGHT:  'Di chuyển: Phải (→ / Tiến lùi)',
    ATTACK: 'Tấn công / Đánh thường / Chọn',
    JUMP:   'Nhảy lên / Hủy bỏ Menu',
    DASH:   'Lướt né đòn (Dash)',
    SUB:    'Chiêu phụ (Sub Skill)',
    ULTI:   'Tuyệt kỹ Ulti (Special)',
    ASSIST: 'Gọi trợ thủ (Assist)'
};

const FLASH_NATIVE_KEYS = {
    p1: {
        UP:     { code: 'KeyW', key: 'w', keyCode: 87, label: 'Lên (Nhảy / Trèo)' },
        DOWN:   { code: 'KeyS', key: 's', keyCode: 83, label: 'Xuống (Ngồi / Đỡ)' },
        LEFT:   { code: 'KeyA', key: 'a', keyCode: 65, label: 'Trái (Tiến / Lùi)' },
        RIGHT:  { code: 'KeyD', key: 'd', keyCode: 68, label: 'Phải (Tiến / Lùi)' },
        ATTACK: { code: 'KeyJ', key: 'j', keyCode: 74, label: 'Đánh thường / Chọn (J)' },
        JUMP:   { code: 'KeyK', key: 'k', keyCode: 75, label: 'Nhảy / Hủy (K)' },
        DASH:   { code: 'KeyL', key: 'l', keyCode: 76, label: 'Lướt / Né (L)' },
        SUB:    { code: 'KeyU', key: 'u', keyCode: 85, label: 'Chiêu phụ (U)' },
        ULTI:   { code: 'KeyI', key: 'i', keyCode: 73, label: 'Tuyệt kỹ Ulti (I)' },
        ASSIST: { code: 'KeyO', key: 'o', keyCode: 79, label: 'Gọi hỗ trợ (O)' }
    },
    p2: {
        UP:     { code: 'ArrowUp', key: 'ArrowUp', keyCode: 38, label: 'Lên (↑)' },
        DOWN:   { code: 'ArrowDown', key: 'ArrowDown', keyCode: 40, label: 'Xuống (↓)' },
        LEFT:   { code: 'ArrowLeft', key: 'ArrowLeft', keyCode: 37, label: 'Trái (←)' },
        RIGHT:  { code: 'ArrowRight', key: 'ArrowRight', keyCode: 39, label: 'Phải (→)' },
        ATTACK: { code: 'Numpad1', key: '1', keyCode: 97, label: 'Tấn công (Numpad 1)' },
        JUMP:   { code: 'Numpad2', key: '2', keyCode: 98, label: 'Nhảy (Numpad 2)' },
        DASH:   { code: 'Numpad3', key: '3', keyCode: 99, label: 'Lướt né (Numpad 3)' },
        SUB:    { code: 'Numpad4', key: '4', keyCode: 100, label: 'Chiêu phụ (Numpad 4)' },
        ULTI:   { code: 'Numpad5', key: '5', keyCode: 101, label: 'Tuyệt kỹ Ulti (Numpad 5)' },
        ASSIST: { code: 'Numpad6', key: '6', keyCode: 102, label: 'Gọi hỗ trợ (Numpad 6)' }
    }
};

// ==========================================
// 2. CÁC OPTION ĐIỀU KHIỂN CHO NGƯỜI DÙNG
// ==========================================
const KEY_PRESETS = {
    // Kiểu 1: 4 Mũi tên + Đánh CHỮ JKLUIO (100% đánh bằng chữ, tối ưu nhất cho Laptop không có phím số)
    option_arrows_letters: {
        UP:     { code: 'ArrowUp', display: '↑' },
        DOWN:   { code: 'ArrowDown', display: '↓' },
        LEFT:   { code: 'ArrowLeft', display: '←' },
        RIGHT:  { code: 'ArrowRight', display: '→' },
        ATTACK: { code: 'KeyJ', display: 'J' },
        JUMP:   { code: 'KeyK', display: 'K' },
        DASH:   { code: 'KeyL', display: 'L' },
        SUB:    { code: 'KeyU', display: 'U' },
        ULTI:   { code: 'KeyI', display: 'I' },
        ASSIST: { code: 'KeyO', display: 'O' }
    },
    // Kiểu 2: Bộ phím CHỮ WASD + JKLUIO (Chuẩn đối kháng 100% Chữ)
    option_wasd: {
        UP:     { code: 'KeyW', display: 'W' },
        DOWN:   { code: 'KeyS', display: 'S' },
        LEFT:   { code: 'KeyA', display: 'A' },
        RIGHT:  { code: 'KeyD', display: 'D' },
        ATTACK: { code: 'KeyJ', display: 'J' },
        JUMP:   { code: 'KeyK', display: 'K' },
        DASH:   { code: 'KeyL', display: 'L' },
        SUB:    { code: 'KeyU', display: 'U' },
        ULTI:   { code: 'KeyI', display: 'I' },
        ASSIST: { code: 'KeyO', display: 'O' }
    },
    // Kiểu 3: 4 Mũi tên & Numpad (↑ ↓ ← → di chuyển + Numpad 1..6 ra đòn)
    option_arrows: {
        UP:     { code: 'ArrowUp', display: '↑' },
        DOWN:   { code: 'ArrowDown', display: '↓' },
        LEFT:   { code: 'ArrowLeft', display: '←' },
        RIGHT:  { code: 'ArrowRight', display: '→' },
        ATTACK: { code: 'Numpad1', display: 'Num 1' },
        JUMP:   { code: 'Numpad2', display: 'Num 2' },
        DASH:   { code: 'Numpad3', display: 'Num 3' },
        SUB:    { code: 'Numpad4', display: 'Num 4' },
        ULTI:   { code: 'Numpad5', display: 'Num 5' },
        ASSIST: { code: 'Numpad6', display: 'Num 6' }
    },
    // Kiểu 4: 4 Mũi tên & Phím số 1..6 hàng trên
    option_arrows_digits: {
        UP:     { code: 'ArrowUp', display: '↑' },
        DOWN:   { code: 'ArrowDown', display: '↓' },
        LEFT:   { code: 'ArrowLeft', display: '←' },
        RIGHT:  { code: 'ArrowRight', display: '→' },
        ATTACK: { code: 'Digit1', display: 'Số 1' },
        JUMP:   { code: 'Digit2', display: 'Số 2' },
        DASH:   { code: 'Digit3', display: 'Số 3' },
        SUB:    { code: 'Digit4', display: 'Số 4' },
        ULTI:   { code: 'Digit5', display: 'Số 5' },
        ASSIST: { code: 'Digit6', display: 'Số 6' }
    },
    // Kiểu 5: Bộ phím Laptop (IJKL di chuyển + ZXCVBN ra đòn)
    option_laptop: {
        UP:     { code: 'KeyI', display: 'I' },
        DOWN:   { code: 'KeyK', display: 'K' },
        LEFT:   { code: 'KeyJ', display: 'J' },
        RIGHT:  { code: 'KeyL', display: 'L' },
        ATTACK: { code: 'KeyZ', display: 'Z' },
        JUMP:   { code: 'KeyX', display: 'X' },
        DASH:   { code: 'KeyC', display: 'C' },
        SUB:    { code: 'KeyV', display: 'V' },
        ULTI:   { code: 'KeyB', display: 'B' },
        ASSIST: { code: 'KeyN', display: 'N' }
    }
};

// ==========================================
// 2B. CẤU HÌNH TAY CẦM (GAMEPAD)
// ==========================================
const GAMEPAD_BUTTON_NAMES = {
    0: 'A / ✕ (Nút 0)',
    1: 'B / ◯ (Nút 1)',
    2: 'X / ▢ (Nút 2)',
    3: 'Y / △ (Nút 3)',
    4: 'LB / L1 (Nút 4)',
    5: 'RB / R1 (Nút 5)',
    6: 'LT / L2 (Cò trái)',
    7: 'RT / R2 (Cò phải)',
    8: 'Back / Select (Nút 8)',
    9: 'Start / Menu (Nút 9)',
    10: 'L3 (Cần trái nhấn)',
    11: 'R3 (Cần phải nhấn)',
    12: 'D-Pad Lên ↑',
    13: 'D-Pad Xuống ↓',
    14: 'D-Pad Trái ←',
    15: 'D-Pad Phải →',
    16: 'Home / Logo'
};

const GAMEPAD_AXIS_NAMES = {
    'axis:0:-1': 'Cần trái ←',
    'axis:0:1': 'Cần trái →',
    'axis:1:-1': 'Cần trái ↑',
    'axis:1:1': 'Cần trái ↓',
    'axis:2:-1': 'Cần phải ←',
    'axis:2:1': 'Cần phải →',
    'axis:3:-1': 'Cần phải ↑',
    'axis:3:1': 'Cần phải ↓'
};

const GAMEPAD_ACTIONS = [
    { action: 'UP', label: 'Di chuyển: Lên (↑ / Nhảy trèo)' },
    { action: 'DOWN', label: 'Di chuyển: Xuống (↓ / Ngồi đỡ)' },
    { action: 'LEFT', label: 'Di chuyển: Trái (← / Lùi tiến)' },
    { action: 'RIGHT', label: 'Di chuyển: Phải (→ / Tiến lùi)' },
    { action: 'ATTACK', label: 'Đánh thường / Chọn Menu (J)' },
    { action: 'JUMP', label: 'Nhảy / Hủy Menu (K)' },
    { action: 'DASH', label: 'Lướt né đòn (L)' },
    { action: 'SUB', label: 'Chiêu phụ (U)' },
    { action: 'ULTI', label: 'Tuyệt kỹ Ulti (I)' },
    { action: 'ASSIST', label: 'Gọi hỗ trợ (O)' },
    { action: 'START', label: 'Nút Menu / Vào trận (Start / Enter)' }
];

const GAMEPAD_PRESETS = {
    standard: {
        name: 'Chuẩn Đối Kháng Arcade',
        buttons: {
            UP:     { type: 'button', index: 12, display: 'D-Pad ↑ / Cần trái ↑' },
            DOWN:   { type: 'button', index: 13, display: 'D-Pad ↓ / Cần trái ↓' },
            LEFT:   { type: 'button', index: 14, display: 'D-Pad ← / Cần trái ←' },
            RIGHT:  { type: 'button', index: 15, display: 'D-Pad → / Cần trái →' },
            ATTACK: { type: 'button', index: 0,  display: 'A / ✕ (Nút 0)' },
            JUMP:   { type: 'button', index: 1,  display: 'B / ◯ (Nút 1)' },
            DASH:   { type: 'button', index: 5,  display: 'RB / R1 (Nút 5)' },
            SUB:    { type: 'button', index: 2,  display: 'X / ▢ (Nút 2)' },
            ULTI:   { type: 'button', index: 3,  display: 'Y / △ (Nút 3)' },
            ASSIST: { type: 'button', index: 4,  display: 'LB / L1 (Nút 4)' },
            START:  { type: 'button', index: 9,  display: 'Start / Menu (Nút 9)' }
        }
    },
    ninja_storm: {
        name: 'Kiểu Ninja Storm',
        buttons: {
            UP:     { type: 'button', index: 12, display: 'D-Pad ↑ / Cần trái ↑' },
            DOWN:   { type: 'button', index: 13, display: 'D-Pad ↓ / Cần trái ↓' },
            LEFT:   { type: 'button', index: 14, display: 'D-Pad ← / Cần trái ←' },
            RIGHT:  { type: 'button', index: 15, display: 'D-Pad → / Cần trái →' },
            ATTACK: { type: 'button', index: 1,  display: 'B / ◯ (Nút 1)' },
            JUMP:   { type: 'button', index: 0,  display: 'A / ✕ (Nút 0)' },
            DASH:   { type: 'button', index: 5,  display: 'RB / R1 (Nút 5)' },
            SUB:    { type: 'button', index: 2,  display: 'X / ▢ (Nút 2)' },
            ULTI:   { type: 'button', index: 3,  display: 'Y / △ (Nút 3)' },
            ASSIST: { type: 'button', index: 4,  display: 'LB / L1 (Nút 4)' },
            START:  { type: 'button', index: 9,  display: 'Start / Menu (Nút 9)' }
        }
    },
    triggers: {
        name: 'Dùng Cò LT / RT',
        buttons: {
            UP:     { type: 'button', index: 12, display: 'D-Pad ↑ / Cần trái ↑' },
            DOWN:   { type: 'button', index: 13, display: 'D-Pad ↓ / Cần trái ↓' },
            LEFT:   { type: 'button', index: 14, display: 'D-Pad ← / Cần trái ←' },
            RIGHT:  { type: 'button', index: 15, display: 'D-Pad → / Cần trái →' },
            ATTACK: { type: 'button', index: 0,  display: 'A / ✕ (Nút 0)' },
            JUMP:   { type: 'button', index: 1,  display: 'B / ◯ (Nút 1)' },
            DASH:   { type: 'button', index: 7,  display: 'RT / R2 (Cò phải)' },
            SUB:    { type: 'button', index: 2,  display: 'X / ▢ (Nút 2)' },
            ULTI:   { type: 'button', index: 3,  display: 'Y / △ (Nút 3)' },
            ASSIST: { type: 'button', index: 6,  display: 'LT / L2 (Cò trái)' },
            START:  { type: 'button', index: 9,  display: 'Start / Menu (Nút 9)' }
        }
    }
};

let userGamepadConfig = loadGamepadConfig();

function loadGamepadConfig() {
    const saved = localStorage.getItem('bvn_user_gamepad_v1');
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            console.error("Lỗi parse saved gamepad config:", e);
        }
    }
    return {
        target: 'auto', // 'auto' | 'p1' | 'p2' | 'dual'
        preset: 'standard',
        buttons: JSON.parse(JSON.stringify(GAMEPAD_PRESETS.standard.buttons))
    };
}

function saveGamepadConfig(cfg) {
    userGamepadConfig = cfg;
    localStorage.setItem('bvn_user_gamepad_v1', JSON.stringify(cfg));
}

// Quản lý cấu hình phím
let userKeyBindings = loadKeyBindings();

function loadKeyBindings() {
    const saved = localStorage.getItem('bvn_user_keybindings_v5');
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            console.error("Lỗi parse saved bindings:", e);
        }
    }
    // Mặc định chuẩn xác:
    // - P1: WASD + JKLUIO (Chuẩn đối kháng)
    // - P2: 4 Mũi tên (↑ ↓ ← →) + Đánh CHỮ (J K L U I O) (100% Chữ, tối ưu cho Laptop!)
    return {
        p1Preset: 'option_wasd',
        p2Preset: 'option_arrows_letters',
        p1: JSON.parse(JSON.stringify(KEY_PRESETS.option_wasd)),
        p2: JSON.parse(JSON.stringify(KEY_PRESETS.option_arrows_letters))
    };
}

function saveKeyBindings(bindings) {
    userKeyBindings = bindings;
    localStorage.setItem('bvn_user_keybindings_v5', JSON.stringify(bindings));
    renderGuides();
    syncHudKeyLabels();
}

// Cập nhật đèn báo phím trên màn hình (Real-time Input HUD)
function updateInputHud(role, action, isActive) {
    const keyEl = document.getElementById(`hud_${role}_${action}`);
    if (keyEl) {
        if (isActive) {
            keyEl.classList.add('active');
        } else {
            keyEl.classList.remove('active');
        }
    }
}

// Đồng bộ nhãn phím hiển thị trên HUD
function syncHudKeyLabels() {
    ['p1', 'p2'].forEach(group => {
        const bindings = userKeyBindings[group];
        if (bindings) {
            for (const [action, conf] of Object.entries(bindings)) {
                const el = document.getElementById(`hud_${group}_${action}`);
                if (el && conf.display) {
                    el.innerText = conf.display.split(' ')[0];
                }
            }
        }
    });
}

// ==========================================
// 3. APPLICATION STATE & DOM REFERENCES
// ==========================================
// CẤU HÌNH CÁC PHIÊN BẢN GAME (DUAL EDITIONS)
const EDITIONS = {
    bvn26: {
        id: 'bvn26',
        name: 'Bleach vs Naruto 2.6 (Cổ Điển)',
        fps: 30,
        type: 'classic',
        url: 'game.swf',
        cdnUrl: 'https://cdn.jsdelivr.net/gh/DuyOrbit/naruto-vs-bleach-online@main/game.swf',
        base: './',
        badge: '⚔️ BVN 2.6 Cổ Điển (30 FPS)'
    },
    animebattle: {
        id: 'animebattle',
        name: 'Anime Battle 500 Tướng (An Nam Lục Cửu)',
        fps: 60,
        type: 'crossover',
        url: 'https://animugen-staging.tonyngyx.workers.dev/tceam-game/launch.swf',
        base: 'https://animugen-staging.tonyngyx.workers.dev/tceam-game/',
        parameters: { sfxVolume: '1', webLobby: 'true' },
        badge: '🔥 Anime Battle 500 Tướng (60 FPS)'
    }
};

let currentEdition = localStorage.getItem('bvn_game_edition') || 'bvn26';

let socket = null;
let peerConnection = null;
let myRole = 'solo'; // 'solo' | 'host' | 'guest'
let currentNetcodeMode = localStorage.getItem('bvn_netcode_mode') || 'stream'; // 'stream' (Remote Play) | 'input_sync' (0 MB Video)
let rufflePlayer = null;
let ruffleCanvas = null;
let pingInterval = null;

// DOM Elements
const gameEditionSelect = document.getElementById('gameEditionSelect');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const pingBadge = document.getElementById('pingBadge');
const pingVal = document.getElementById('pingVal');
const roleBadge = document.getElementById('roleBadge');
const netcodeBadge = document.getElementById('netcodeBadge');
const netplayModeSelect = document.getElementById('netplayModeSelect');
const streamQualityWrapper = document.getElementById('streamQualityWrapper');

const flashWrapper = document.getElementById('flashPlayerWrapper');
const remoteVideo = document.getElementById('remoteVideo');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMsg = document.getElementById('loadingMsg');
const loadingSubMsg = document.getElementById('loadingSubMsg');
const btnSkipIntro = document.getElementById('btnSkipIntro');

const btnCreateRoom = document.getElementById('btnCreateRoom');
const hostRoomInfo = document.getElementById('hostRoomInfo');
const hostRoomCode = document.getElementById('hostRoomCode');
const btnCopyCode = document.getElementById('btnCopyCode');
const btnCopyLink = document.getElementById('btnCopyLink');

const inputRoomCode = document.getElementById('inputRoomCode');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const guestConnectionMsg = document.getElementById('guestConnectionMsg');

const btnSyncRestart = document.getElementById('btnSyncRestart');
const btnFullscreen = document.getElementById('btnFullscreen');
const btnShareScreen = document.getElementById('btnShareScreen');
const streamQualitySelect = document.getElementById('streamQualitySelect');
const btnOpenKeyModal = document.getElementById('btnOpenKeyModal');

// Modal Elements
const keyModal = document.getElementById('keyModal');
const btnCloseKeyModal = document.getElementById('btnCloseKeyModal');
const presetSelect = document.getElementById('presetSelect');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const bindingListP1 = document.getElementById('bindingListP1');
const bindingListP2 = document.getElementById('bindingListP2');
const btnSaveKeys = document.getElementById('btnSaveKeys');
const btnResetDefaultKeys = document.getElementById('btnResetDefaultKeys');

// Gamepad Elements
const btnGamepadStatus = document.getElementById('btnGamepadStatus');
const gamepadStatusText = document.getElementById('gamepadStatusText');
const keyboardPresetSelector = document.getElementById('keyboardPresetSelector');
const gamepadInfoCard = document.getElementById('gamepadInfoCard');
const gpDeviceTitle = document.getElementById('gpDeviceTitle');
const gpDeviceDesc = document.getElementById('gpDeviceDesc');
const btnTestVibration = document.getElementById('btnTestVibration');
const gpTesterBadges = document.getElementById('gpTesterBadges');
const gamepadTargetSelect = document.getElementById('gamepadTargetSelect');
const gamepadPresetSelect = document.getElementById('gamepadPresetSelect');
const bindingListGamepad = document.getElementById('bindingListGamepad');

// Guide Grids
const guideGridP1 = document.getElementById('guideGridP1');
const guideGridP2 = document.getElementById('guideGridP2');

// Donate Elements
const btnHeaderDonate = document.getElementById('btnHeaderDonate');
const btnFooterDonate = document.getElementById('btnFooterDonate');
const btnOpenDonateModalBanner = document.getElementById('btnOpenDonateModalBanner');
const qrPreviewTrigger = document.getElementById('qrPreviewTrigger');
const donateModal = document.getElementById('donateModal');
const btnCloseDonateModal = document.getElementById('btnCloseDonateModal');
const btnCloseDonateBottom = document.getElementById('btnCloseDonateBottom');
const btnModalCopyStk = document.getElementById('btnModalCopyStk');
const btnModalCopyMemo = document.getElementById('btnModalCopyMemo');
const btnCopyStkBanner = document.getElementById('btnCopyStkBanner');
const bannerCopyStkBadge = document.getElementById('bannerCopyStkBadge');

// ==========================================
// 4. KHỞI TẠO VÀ ĐIỀU KHIỂN RUFFLE FLASH ENGINE
// ==========================================
function focusGame() {
    if (rufflePlayer) {
        rufflePlayer.focus();
        if (rufflePlayer.shadowRoot) {
            const container = rufflePlayer.shadowRoot.getElementById('container') || rufflePlayer.shadowRoot.querySelector('#container');
            if (container) {
                container.focus();
                container.dispatchEvent(new Event('focusin', { bubbles: true }));
                container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
            }
            const inner = rufflePlayer.shadowRoot.querySelector('canvas');
            if (inner) inner.focus();
        }
    }
    if (ruffleCanvas) {
        ruffleCanvas.focus();
    }
}

function pauseLocalRuffle() {
    try {
        setLocalRufflePaused(true);
        if (rufflePlayer) {
            const api = typeof rufflePlayer.ruffle === 'function' ? rufflePlayer.ruffle(1) : rufflePlayer;
            if (api) {
                if (typeof api.suspend === 'function') api.suspend();
                if (typeof api.pause === 'function') api.pause();
                if ('volume' in api) api.volume = 0;
            }
        }
        const rPlayer = document.getElementById('rufflePlayer');
        if (rPlayer) rPlayer.style.display = 'none';
    } catch (e) {
        console.warn("Không thể pause local ruffle:", e);
    }
}

function resumeLocalRuffle() {
    try {
        setLocalRufflePaused(false);
        if (rufflePlayer) {
            const api = typeof rufflePlayer.ruffle === 'function' ? rufflePlayer.ruffle(1) : rufflePlayer;
            if (api) {
                if (typeof api.resume === 'function') api.resume();
                if (typeof api.play === 'function') api.play();
                if ('volume' in api) api.volume = 1;
            }
        }
        const rPlayer = document.getElementById('rufflePlayer');
        if (rPlayer) rPlayer.style.display = 'block';
    } catch (e) {
        console.warn("Không thể resume local ruffle:", e);
    }
}

// Chuyển đổi giữa 2 chế độ: Mode 1 (Remote Play stream 30FPS) & Mode 2 (P2P Input Sync 0 MB Video)
function setNetcodeMode(mode, broadcast = false) {
    if (mode !== 'stream' && mode !== 'input_sync') mode = 'input_sync';
    currentNetcodeMode = mode;
    localStorage.setItem('bvn_netcode_mode', mode);

    if (netplayModeSelect && netplayModeSelect.value !== mode) {
        netplayModeSelect.value = mode;
    }

    if (streamQualityWrapper) {
        streamQualityWrapper.style.display = (mode === 'stream') ? 'inline-flex' : 'none';
    }

    if (netcodeBadge) {
        if (mode === 'input_sync') {
            netcodeBadge.innerText = '⚡ Mode: P2P Input Sync (0 MB Video)';
        } else {
            netcodeBadge.innerText = '📺 Mode: Remote Play (Stream 30FPS)';
        }
    }

    if (mode === 'input_sync') {
        if (myRole === 'guest') {
            resumeLocalRuffle();
            if (remoteVideo) remoteVideo.classList.add('hidden');
        }
    } else {
        if (myRole === 'guest') {
            pauseLocalRuffle();
            if (remoteVideo) remoteVideo.classList.remove('hidden');
        }
    }

    if (broadcast && myRole === 'host') {
        sendFastMessage({ type: 'sync_mode', mode });
    }
}

if (netplayModeSelect) {
    netplayModeSelect.value = currentNetcodeMode;
    netplayModeSelect.addEventListener('change', (e) => {
        setNetcodeMode(e.target.value, true);
        showSyncNotification(e.target.value === 'input_sync' 
            ? '⚡ Đã chọn: P2P Input Sync (0 MB Video • Chuẩn Animugen)'
            : '📺 Đã chọn: Remote Play (Stream Video 30FPS • 1 Trận Chung)');
    });
}

// Bắt sự kiện chuyển đổi phiên bản Game (BVN 2.6 Cổ Điển vs Anime Battle 500 Tướng)
if (gameEditionSelect) {
    gameEditionSelect.value = currentEdition;
    gameEditionSelect.addEventListener('change', (e) => {
        const selected = e.target.value;
        if (selected !== currentEdition && EDITIONS[selected]) {
            currentEdition = selected;
            localStorage.setItem('bvn_game_edition', currentEdition);
            const ed = EDITIONS[currentEdition];
            showSyncNotification(`🔄 Đang chuyển sang ${ed.name}...`);
            initRuffleGame();
            if (myRole === 'host') {
                sendFastMessage({ type: 'sync_edition', edition: currentEdition });
            }
        }
    });
}


// ==========================================
// TỐI ƯU HÓA BĂNG THÔNG CHO MÁY CHỦ
// Tải game.swf từ CDN jsDelivr + Lưu vào Cache Storage máy người chơi
// ==========================================
const GAME_SWF_CDN_URL = "https://cdn.jsdelivr.net/gh/DuyOrbit/naruto-vs-bleach-online@main/game.swf";
const GAME_SWF_LOCAL_URL = "game.swf";

async function getGameSwfUrl() {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost) {
        return GAME_SWF_LOCAL_URL + "?v=" + Date.now();
    }

    const CACHE_NAME = 'bvn-game-cache-v2';
    if ('caches' in window) {
        try {
            const cache = await caches.open(CACHE_NAME);
            const cachedResponse = await cache.match(GAME_SWF_LOCAL_URL);
            if (cachedResponse) {
                console.log("[BVN Cache] Nạp game.swf từ bộ nhớ đệm máy người chơi (0 MB băng thông máy chủ)!");
                const blob = await cachedResponse.blob();
                return URL.createObjectURL(blob);
            }

            console.log("[BVN CDN] Đang nạp game.swf từ CDN miễn phí jsDelivr...");
            try {
                const response = await fetch(GAME_SWF_CDN_URL);
                if (response.ok) {
                    const clonedRes = response.clone();
                    cache.put(GAME_SWF_LOCAL_URL, clonedRes).catch(() => {});
                    const blob = await response.blob();
                    console.log("[BVN CDN] Nạp thành công game.swf từ CDN và đã lưu Cache vĩnh viễn!");
                    return URL.createObjectURL(blob);
                }
            } catch (cdnErr) {
                console.warn("[BVN CDN] Lỗi CDN, chuyển sang fallback nội bộ:", cdnErr);
            }
        } catch (e) {
            console.warn("[BVN Cache] Lỗi Cache Storage:", e);
        }
    }
    return GAME_SWF_LOCAL_URL;
}

async function initRuffleGame() {
    try {
        const ruffle = window.RufflePlayer ? window.RufflePlayer.newest() : null;
        if (!ruffle) {
            loadingMsg.innerText = "Không thể tải Ruffle Flash Emulator. Vui lòng kiểm tra file thư viện!";
            return;
        }

        const container = document.getElementById('rufflePlayer');
        container.innerHTML = "";
        container.style.display = 'block';
        if (remoteVideo) remoteVideo.classList.add('hidden');

        rufflePlayer = ruffle.createPlayer();
        container.appendChild(rufflePlayer);

        rufflePlayer.style.width = "100%";
        rufflePlayer.style.height = "100%";

        const editionConfig = EDITIONS[currentEdition] || EDITIONS.bvn26;
        const isAnimeBattle = (currentEdition === 'animebattle');

        loadingOverlay.classList.remove('hidden');
        loadingMsg.innerText = `Đang nạp ${editionConfig.name}...`;
        if (loadingSubMsg) {
            loadingSubMsg.innerText = isAnimeBattle
                ? "Khởi động engine WebAssembly 60FPS & 500 Tướng từ Cloudflare CDN..."
                : "Khởi động engine WebAssembly 30FPS Cổ Điển sắc nét 100%";
        }
        if (btnSkipIntro) btnSkipIntro.classList.remove('hidden');

        const baseStaticUrl = isAnimeBattle
            ? editionConfig.base
            : window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

        rufflePlayer.config = {
            letterbox: "on",
            forceScale: true,
            quality: "high",
            preferredRenderer: "webgl",
            autoplay: "on",
            unmuteOverlay: "hidden",
            splashScreen: false,
            backgroundExecutionMode: "mainThread",
            allowScriptAccess: true,
            allowNetworking: isAnimeBattle ? "all" : "internal",
            openUrlMode: isAnimeBattle ? "deny" : "allow",
            base: baseStaticUrl
        };

        const hideIntroOverlay = () => {
            loadingOverlay.classList.add('hidden');
            if (window.bvnBridge && typeof window.bvnBridge.skipIntro === 'function') {
                try { window.bvnBridge.skipIntro(); } catch (e) {}
            }
            focusGame();
            if (myRole === 'host') {
                sendFastMessage({ type: 'sync_skip_to_menu' });
            }
        };

        if (btnSkipIntro) btnSkipIntro.onclick = hideIntroOverlay;
        loadingOverlay.onclick = hideIntroOverlay;

        const swfUrl = isAnimeBattle ? editionConfig.url : await getGameSwfUrl();
        const loadParams = {
            url: swfUrl,
            autoplay: "on",
            allowScriptAccess: true,
            allowNetworking: isAnimeBattle ? "all" : "internal"
        };
        if (isAnimeBattle && editionConfig.parameters) {
            loadParams.parameters = editionConfig.parameters;
        }

        rufflePlayer.load(loadParams).then(() => {
            console.log(`[Game] Đã nạp thành công phiên bản: ${editionConfig.name}`);
            findRuffleCanvas(rufflePlayer);
            setTimeout(hideIntroOverlay, 1500);
        }).catch((err) => {
            console.warn("Lỗi tải game SWF:", err);
            loadingMsg.innerHTML = `Lỗi tải phiên bản <strong>${editionConfig.name}</strong>.<br>Vui lòng kiểm tra file hoặc kết nối mạng.`;
        });
    } catch (e) {
        console.error("Lỗi khởi tạo Ruffle:", e);
    }
}

function findRuffleCanvas(player) {
    if (!player) return;
    if (player.shadowRoot) {
        ruffleCanvas = player.shadowRoot.querySelector('canvas');
    }
    if (!ruffleCanvas) {
        ruffleCanvas = player.querySelector('canvas');
    }
    if (!ruffleCanvas) {
        setTimeout(() => findRuffleCanvas(player), 300);
    } else {
        console.log("Đã tìm thấy Canvas của game:", ruffleCanvas);
        ruffleCanvas.setAttribute('tabindex', '0');
        ruffleCanvas.focus();
        setupCanvasResizeObserver();
    }
}

// Giám sát kích thước canvas và sự kiện fullscreen để tự động tinh chỉnh scaleResolutionDownBy
let canvasResizeObserverInitialized = false;
let resizeTuneTimeout = null;

function onHostViewChanged() {
    if (!activeVideoSender) return;
    clearTimeout(resizeTuneTimeout);
    resizeTuneTimeout = setTimeout(() => {
        if (activeVideoSender) {
            tuneVideoSenderForLowLatency(activeVideoSender);
        }
    }, 150);
}

function setupCanvasResizeObserver() {
    if (canvasResizeObserverInitialized) return;
    canvasResizeObserverInitialized = true;

    if (window.ResizeObserver) {
        const observer = new ResizeObserver(() => {
            onHostViewChanged();
        });
        if (ruffleCanvas) {
            observer.observe(ruffleCanvas);
        }
        const container = document.getElementById('gameContainer');
        if (container) {
            observer.observe(container);
        }
    }
    document.addEventListener('fullscreenchange', onHostViewChanged);
    document.addEventListener('webkitfullscreenchange', onHostViewChanged);
    window.addEventListener('resize', onHostViewChanged);
}

const gameContainer = document.getElementById('gameContainer');
if (gameContainer) {
    gameContainer.addEventListener('click', () => {
        focusGame();
    });
}

// Bắn sự kiện phím vào Ruffle Flash Player trên Host
function dispatchFlashKeyEvent(type, flashKeyInfo) {
    if (!flashKeyInfo) return;

    focusGame();

    const isNumpad = flashKeyInfo.code && flashKeyInfo.code.startsWith('Numpad');
    const locationVal = isNumpad ? 3 : 0;

    const eventInit = {
        key: flashKeyInfo.key,
        code: flashKeyInfo.code,
        keyCode: flashKeyInfo.keyCode,
        which: flashKeyInfo.keyCode,
        location: locationVal,
        bubbles: true,
        cancelable: true,
        composed: true
    };

    let ev;
    try {
        ev = new KeyboardEvent(type, eventInit);
        Object.defineProperty(ev, 'keyCode', { value: flashKeyInfo.keyCode, writable: false });
        Object.defineProperty(ev, 'which', { value: flashKeyInfo.keyCode, writable: false });
        Object.defineProperty(ev, 'location', { value: locationVal, writable: false });
    } catch (e) {
        ev = new KeyboardEvent(type, eventInit);
    }

    if (rufflePlayer && rufflePlayer.shadowRoot) {
        const shadowContainer = rufflePlayer.shadowRoot.getElementById('container') || rufflePlayer.shadowRoot.querySelector('#container');
        if (shadowContainer) {
            shadowContainer.dispatchEvent(ev);
        }
        const shadowCanvas = rufflePlayer.shadowRoot.querySelector('canvas');
        if (shadowCanvas && shadowCanvas !== ruffleCanvas) {
            shadowCanvas.dispatchEvent(ev);
        }
    }
    if (ruffleCanvas) {
        ruffleCanvas.dispatchEvent(ev);
    }
    if (rufflePlayer) {
        rufflePlayer.dispatchEvent(ev);
    }
    window.dispatchEvent(ev);
    document.dispatchEvent(ev);
}

// ==========================================
// CÂN BẰNG ĐỘ TRỄ 2 BÊN (SYMMETRIC INPUT DELAY - CHUẨN ANIMUGEN)
// ==========================================
let symmetricDelayEnabled = true;

function getSymmetricDelayMs() {
    if (!symmetricDelayEnabled || myRole !== 'host' || !peerConnection) return 0;
    const ping = parseInt(pingVal?.innerText, 10) || 0;
    if (ping <= 10) return 0;
    // Công thức cân bằng trễ Animugen lockstep:
    // delayFrames = Math.max(1, Math.min(5, Math.ceil(ping / 2 / 16.67)))
    const delayFrames = Math.max(1, Math.min(5, Math.ceil((ping / 2) / 16.67)));
    return delayFrames * 16.67;
}

function dispatchFlashKeyEventWithSymmetricDelay(type, flashKeyInfo) {
    const delayMs = getSymmetricDelayMs();
    if (delayMs > 0) {
        setTimeout(() => {
            dispatchFlashKeyEvent(type, flashKeyInfo);
        }, delayMs);
    } else {
        dispatchFlashKeyEvent(type, flashKeyInfo);
    }
}

// ==========================================
// 5. WEBRTC 60FPS HD CANVAS STREAMING ENGINE
// ==========================================

// Tối ưu bitrate SDP theo preset được chọn (smooth: 2.5 Mbps, balanced: 4.0 Mbps, ultra: 6.0 Mbps)
function boostSdpBitrate(sdp, maxKbps) {
    let preset = STREAM_QUALITY_PRESETS[currentStreamQuality] || STREAM_QUALITY_PRESETS.smooth;
    if (maxKbps) {
        const matched = Object.values(STREAM_QUALITY_PRESETS).find(p => p.maxKbps === maxKbps);
        if (matched) preset = matched;
    } else {
        maxKbps = preset.maxKbps;
    }
    // Hạ min-bitrate xuống khoảng 600-800 kbps để encoder hạ được khi mạng yếu, chống nghẽn và phình delay
    const minKbps = preset.minKbps || 600;
    // Giữ start-bitrate hợp lý (1500 - 2500 kbps) để vào trận lập tức mà không gây nghẽn kết nối
    const startKbps = preset.startKbps || Math.min(2000, maxKbps);

    let lines = sdp.split('\r\n');
    let mVideoIndex = lines.findIndex(l => l.startsWith('m=video'));
    if (mVideoIndex !== -1) {
        lines.splice(mVideoIndex + 1, 0, `b=AS:${maxKbps}`, `b=TIAS:${maxKbps * 1000}`);
    }

    // Bơm min-bitrate, start-bitrate và max-bitrate: Vào trận nét ổn định, linh hoạt hạ bitrate khi mạng lag
    lines = lines.map(line => {
        if (line.startsWith('a=fmtp:') && (line.includes('packetization-mode') || line.includes('profile-level-id') || line.includes('apt='))) {
            if (!line.includes('x-google-min-bitrate')) {
                return `${line};x-google-min-bitrate=${minKbps};x-google-start-bitrate=${startKbps};x-google-max-bitrate=${maxKbps}`;
            }
        }
        return line;
    });

    return lines.join('\r\n');
}

// HOST: Bắt hình từ Canvas và truyền qua WebRTC cho Guest

// Ưu tiên Codec H.264 tăng tốc phần cứng (GPU Hardware Acceleration)
// Giúp giảm độ trễ nén video xuống dưới 5ms và chống vỡ hạt chiêu thức
function preferH264Codec(pc) {
    if (!pc || !('getTransceivers' in pc)) return;
    try {
        const transceivers = pc.getTransceivers();
        for (const transceiver of transceivers) {
            const kind = transceiver.sender?.track?.kind || transceiver.receiver?.track?.kind;
            if (kind === 'video' && typeof transceiver.setCodecPreferences === 'function') {
                const capabilities = RTCRtpReceiver.getCapabilities ? RTCRtpReceiver.getCapabilities('video') : null;
                if (capabilities && capabilities.codecs) {
                    const h264Codecs = [];
                    const otherCodecs = [];
                    for (const codec of capabilities.codecs) {
                        if (codec.mimeType.toLowerCase() === 'video/h264') {
                            h264Codecs.push(codec);
                        } else {
                            otherCodecs.push(codec);
                        }
                    }
                    if (h264Codecs.length > 0) {
                        transceiver.setCodecPreferences([...h264Codecs, ...otherCodecs]);
                        console.log("WebRTC: Đã kích hoạt phần cứng GPU H.264 cho video stream!");
                    }
                }
            }
        }
    } catch (e) {
        console.warn("Không thể đặt ưu tiên H.264:", e);
    }
}

async function setupHostWebRtc() {
    console.log(`Khởi động WebRTC Host (${currentNetcodeMode})...`);
    if (peerConnection) {
        try { peerConnection.close(); } catch (e) {}
        peerConnection = null;
    }

    peerConnection = new RTCPeerConnection(PEER_CONFIG.config);
    pendingIceCandidates = [];

    // Kênh dữ liệu P2P trực tiếp cho phím bấm (không vòng qua server WebSocket)
    setupInputChannel(peerConnection.createDataChannel('bvn-input', { ordered: false, maxRetransmits: 0 }));
    let videoSender = null;

    if (currentNetcodeMode === 'stream') {
        // Mode 1: Remote Play (Stream Video HD 30FPS)
        if (!ruffleCanvas) {
            findRuffleCanvas(rufflePlayer);
        }
        let retry = 0;
        while (!ruffleCanvas && retry < 25) {
            await new Promise(r => setTimeout(r, 200));
            findRuffleCanvas(rufflePlayer);
            retry++;
        }

        if (ruffleCanvas && ruffleCanvas.captureStream) {
            try {
                setupCanvasResizeObserver();
                // 30 FPS cho BVN 2.6 Cổ Điển hoặc 60 FPS cho Anime Battle 500 Tướng (Chuẩn Animugen)
                const targetFps = (currentEdition === 'animebattle') ? 60 : 30;
                const canvasStream = ruffleCanvas.captureStream(targetFps);
                const videoTrack = canvasStream.getVideoTracks()[0];
                if (videoTrack) {
                    if ('contentHint' in videoTrack) {
                        videoTrack.contentHint = 'motion';
                    }
                }

                const outgoingStream = new MediaStream();
                if (videoTrack) outgoingStream.addTrack(videoTrack);

                // Thêm Audio Track nếu có
                if (window._ruffleAudioStream) {
                    const audioTracks = window._ruffleAudioStream.getAudioTracks();
                    if (audioTracks.length > 0) {
                        outgoingStream.addTrack(audioTracks[0]);
                    }
                }

                outgoingStream.getTracks().forEach(track => {
                    const sender = peerConnection.addTrack(track, outgoingStream);
                    if (track.kind === 'video') {
                        videoSender = sender;
                        activeVideoSender = sender;
                    }
                    console.log(`Host: Đã thêm ${track.kind} Track ${targetFps}FPS (${currentEdition}) vào WebRTC.`);
                });
            } catch (e) {
                console.error("Lỗi captureStream từ ruffleCanvas:", e);
            }
        } else {
            console.warn("ruffleCanvas không hỗ trợ captureStream!");
        }
    } else {
        // Mode 2: P2P Input Sync (Zero Video Bandwidth • 0 MB Video)
        console.log("Host: Kích hoạt P2P Input Sync (Không capture video stream, chỉ truyền phím DataChannel)");
        startHostP1StateSender();
        startHostReconciliation();
    }

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendNetworkMessage({
                type: 'webrtc_candidate',
                candidate: event.candidate
            });
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log("Host PeerConnection state:", peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            if (currentNetcodeMode === 'stream') {
                const preset = STREAM_QUALITY_PRESETS[currentStreamQuality] || STREAM_QUALITY_PRESETS.smooth;
                showSyncNotification(`🟢 Đã kết nối P2P 30FPS mượt mà (${preset.label}) cho Khách!`);
                if (videoSender) tuneVideoSenderForLowLatency(videoSender);
            } else {
                showSyncNotification("⚡ Đã kết nối P2P Input Sync (0 MB Video)! Hai máy đồng bộ 60FPS không tốn mạng.");
            }
        }
    };

    // Tạo Offer
    try {
        if (currentNetcodeMode === 'stream') {
            preferH264Codec(peerConnection);
        }
        const offer = await peerConnection.createOffer();
        const boostedSdp = (currentNetcodeMode === 'stream') ? boostSdpBitrate(offer.sdp) : offer.sdp;
        await peerConnection.setLocalDescription({ type: 'offer', sdp: boostedSdp });
        sendNetworkMessage({
            type: 'webrtc_offer',
            sdp: boostedSdp
        });
        if (videoSender && currentNetcodeMode === 'stream') await tuneVideoSenderForLowLatency(videoSender);
    } catch (e) {
        console.error("Host: Lỗi tạo WebRTC offer:", e);
    }
}

// Cấu hình bộ mã hóa video: duy trì 30 FPS mượt mà tuyệt đối (khớp frame rate 30 FPS của game.swf),
// giới hạn độ phân giải tối đa ~1200px chiều ngang (2x stage gốc 600x400) để không quá tải encoder
async function tuneVideoSenderForLowLatency(sender) {
    if (!sender) return;
    try {
        const preset = STREAM_QUALITY_PRESETS[currentStreamQuality] || STREAM_QUALITY_PRESETS.smooth;
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];

        // Giới hạn độ phân giải video gửi đi ở mức tối đa ~1200px chiều ngang (2x stage 600x400),
        // bất kể màn hình Host là 1080p, 1440p, 4K hay đang phóng to fullscreen
        const curWidth = (ruffleCanvas && ruffleCanvas.width) ? ruffleCanvas.width : 1200;
        const targetMaxWidth = 1200;
        const scale = curWidth > targetMaxWidth ? Math.max(1.0, curWidth / targetMaxWidth) : 1.0;

        params.encodings[0].scaleResolutionDownBy = scale;
        params.encodings[0].maxFramerate = preset.framerate; // 30 FPS
        params.encodings[0].maxBitrate = preset.maxBitrate;
        params.encodings[0].priority = 'high';
        params.encodings[0].networkPriority = 'high';
        // maintain-framerate để luôn giữ 30 FPS ổn định, không giật cục
        params.degradationPreference = preset.degradationPreference;
        await sender.setParameters(params);
        console.log(`Host: Encoder tuned: 30FPS maintain-framerate, maxBitrate: ${preset.maxBitrate / 1000}kbps, scale: ${scale.toFixed(2)} (gửi: ~${Math.round(curWidth / scale)}px)`);
    } catch (e) {
        console.warn("Không thể tinh chỉnh encoder:", e);
    }
}

// ==========================================
// KÊNH P2P TRỰC TIẾP CHO PHÍM BẤM (WebRTC DataChannel)
// ==========================================
let inputChannel = null;

function setupInputChannel(channel) {
    inputChannel = channel;
    channel.onopen = () => {
        console.log("DataChannel P2P đã mở: phím bấm đi trực tiếp giữa 2 máy.");
    };
    channel.onclose = () => {
        if (inputChannel === channel) inputChannel = null;
    };
    channel.onmessage = (ev) => {
        try {
            handleNetworkMessage(JSON.parse(ev.data));
        } catch (e) {
            console.error("Lỗi parse DataChannel msg:", e);
        }
    };
}

// Gửi tin nhắn cần độ trễ thấp (phím, ping): ưu tiên DataChannel P2P, dự phòng WebSocket
function sendFastMessage(data) {
    if (inputChannel && inputChannel.readyState === 'open') {
        inputChannel.send(JSON.stringify(data));
        return true;
    }
    return sendNetworkMessage(data);
}

// Tạm dừng / chạy lại Flash cục bộ (Khách ở Remote Play không cần chạy game riêng)
function setLocalRufflePaused(paused) {
    if (!rufflePlayer) return;
    try {
        const api = typeof rufflePlayer.ruffle === 'function' ? rufflePlayer.ruffle(1) : rufflePlayer;
        if (paused) {
            if (typeof api.suspend === 'function') api.suspend();
            else if (typeof api.pause === 'function') api.pause();
        } else if (typeof api.resume === 'function') {
            api.resume();
        } else if (typeof api.play === 'function') {
            api.play();
        }
        if ('volume' in api) api.volume = paused ? 0 : 1;
    } catch (e) {
        console.warn("Không thể pause/resume Ruffle:", e);
    }
}

// GUEST: Nhận luồng hình ảnh & âm thanh từ Host (stream) hoặc tham gia P2P Input Sync (input_sync)
function setupGuestWebRtc() {
    console.log(`Khởi động WebRTC Guest (${currentNetcodeMode})...`);
    if (peerConnection) {
        try { peerConnection.close(); } catch (e) {}
        peerConnection = null;
    }

    if (currentNetcodeMode === 'stream') {
        // Mode 1: Remote Play - Ẩn và TẠM DỪNG player Flash local của Guest để dành CPU/GPU cho giải mã video (giảm trễ)
        const rPlayer = document.getElementById('rufflePlayer');
        if (rPlayer) rPlayer.style.display = 'none';
        pauseLocalRuffle();

        if (remoteVideo) {
            remoteVideo.classList.remove('hidden');
            remoteVideo.muted = true; // Muted ban đầu để trình duyệt tự động phát hình không bị block autoplay
            remoteVideo.setAttribute('tabindex', '0');
            remoteVideo.playsInline = true;
            if ('disableRemotePlayback' in remoteVideo) remoteVideo.disableRemotePlayback = true;
            remoteVideo.addEventListener('click', () => remoteVideo.focus());
        }
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
        }

        // Tự động bật âm thanh khi người dùng click hoặc nhấn phím
        const enableAudio = () => {
            if (remoteVideo) remoteVideo.muted = false;
            window.removeEventListener('click', enableAudio);
            window.removeEventListener('keydown', enableAudio);
        };
        window.addEventListener('click', enableAudio);
        window.addEventListener('keydown', enableAudio);
    } else {
        // Mode 2: P2P Input Sync - Chạy trực tiếp game Flash trên máy Guest, ẩn remoteVideo
        resumeLocalRuffle();
        const rPlayer = document.getElementById('rufflePlayer');
        if (rPlayer) rPlayer.style.display = 'block';

        if (remoteVideo) {
            remoteVideo.classList.add('hidden');
            if (remoteVideo.srcObject) {
                try { remoteVideo.srcObject.getTracks().forEach(t => t.stop()); } catch (e) {}
                remoteVideo.srcObject = null;
            }
        }
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
        }
        startGuestP1Watchdog();
    }

    peerConnection = new RTCPeerConnection(PEER_CONFIG.config);

    // Nhận kênh P2P phím bấm do Host tạo
    peerConnection.ondatachannel = (event) => {
        setupInputChannel(event.channel);
    };

    if (currentNetcodeMode === 'stream') {
        peerConnection.ontrack = (event) => {
            console.log("[Guest WebRTC] Nhận media track:", event.track.kind);
            if (event.track.kind !== 'video') return;

            // Animugen 0ms Low Latency Receiver API (Ép hiển thị ngay khi giải mã xong)
            try {
                if ('jitterBufferTarget' in event.receiver) {
                    event.receiver.jitterBufferTarget = 0;
                }
            } catch (_) {}

            if (remoteVideo) {
                // Tạo MediaStream mới chứa đúng track vừa nhận (chuẩn Animugen, khử triệt để màn đen)
                remoteVideo.srcObject = new MediaStream([event.track]);
                void remoteVideo.play().catch(err => {
                    console.warn("[Guest] Video play cần cử chỉ tương tác người dùng:", err);
                });
            }
            applyLowLatencyReceiverHints(peerConnection);
        };
    }

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendNetworkMessage({
                type: 'webrtc_candidate',
                candidate: event.candidate
            });
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log("Guest PeerConnection state:", peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            if (currentNetcodeMode === 'stream') {
                applyLowLatencyReceiverHints(peerConnection);
                showSyncNotification("🟢 Đã đồng bộ màn hình trận đấu trực tiếp từ Chủ phòng (30FPS HD)!");
            } else {
                showSyncNotification("⚡ Đã kết nối P2P Input Sync (0 MB Video)! Sẵn sàng chiến đấu!");
            }
        }
    };
}

// Đặt jitterBufferTarget và playoutDelayHint ở mức thấp (0-50ms) cho máy Khách
function applyLowLatencyReceiverHints(pc) {
    if (!pc) return;
    try {
        const receivers = pc.getReceivers();
        receivers.forEach(receiver => {
            // playoutDelayHint: 0 - 0.05s (0-50ms)
            if ('playoutDelayHint' in receiver) {
                try { receiver.playoutDelayHint = 0; } catch (_) {}
            }
            if ('jitterBufferDelayHint' in receiver) {
                try { receiver.jitterBufferDelayHint = 0; } catch (_) {}
            }
            // jitterBufferTarget: thử 0ms, fallback 20ms
            if ('jitterBufferTarget' in receiver) {
                try { receiver.jitterBufferTarget = 0; } catch (_) {
                    try { receiver.jitterBufferTarget = 20; } catch (_) {}
                }
            }
        });
    } catch (e) {
        console.warn("Không thể thiết lập jitterBufferTarget/playoutDelayHint:", e);
    }
}

async function handleWebRtcOffer(sdp) {
    // Mỗi offer từ Host là một phiên mới (Host tạo lại PeerConnection khi khởi động lại game)
    // => Guest cũng tạo PeerConnection mới để không bị kẹt phiên cũ
    setupGuestWebRtc();
    pendingIceCandidates = [];
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        await flushPendingIceCandidates();
        preferH264Codec(peerConnection);
        const answer = await peerConnection.createAnswer();
        const boostedSdp = boostSdpBitrate(answer.sdp);
        await peerConnection.setLocalDescription({ type: 'answer', sdp: boostedSdp });
        sendNetworkMessage({
            type: 'webrtc_answer',
            sdp: boostedSdp
        });
    } catch (e) {
        console.error("Guest: Lỗi xử lý WebRTC offer:", e);
    }
}

async function handleWebRtcAnswer(sdp) {
    if (!peerConnection) return;
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
        await flushPendingIceCandidates();
    } catch (e) {
        console.error("Host: Lỗi xử lý WebRTC answer:", e);
    }
}

// ICE candidate đến trước khi có remoteDescription sẽ được xếp hàng, tránh mất kết nối
let pendingIceCandidates = [];

async function flushPendingIceCandidates() {
    const queued = pendingIceCandidates;
    pendingIceCandidates = [];
    for (const c of queued) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(c));
        } catch (e) {
            console.warn("Lỗi addIceCandidate (queued):", e);
        }
    }
}

async function handleWebRtcCandidate(candidate) {
    if (!peerConnection) return;
    if (!peerConnection.remoteDescription) {
        pendingIceCandidates.push(candidate);
        return;
    }
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
        console.warn("Lỗi addIceCandidate:", e);
    }
}

// ==========================================
// 6. ĐỒNG BỘ TRẠNG THÁI PHÍM P2 (STATE-BASED INPUT SYNC - CHỐNG KẸT PHÍM)
// ==========================================
const P2_INPUT_BITS = {
    UP:     1 << 0,  // 1
    DOWN:   1 << 1,  // 2
    LEFT:   1 << 2,  // 4
    RIGHT:  1 << 3,  // 8
    ATTACK: 1 << 4,  // 16
    JUMP:   1 << 5,  // 32
    DASH:   1 << 6,  // 64
    SUB:    1 << 7,  // 128
    ULTI:   1 << 8,  // 256
    ASSIST: 1 << 9,  // 512
    ENTER:  1 << 10  // 1024
};

// Phía Khách (Guest - P2)
let guestP2StateMask = 0;
let guestInputSequence = 0;
let guestStateTickInterval = null;

function setGuestKeyAction(action, isDown) {
    if (!P2_INPUT_BITS[action]) return;
    const bit = P2_INPUT_BITS[action];
    const prevMask = guestP2StateMask;
    if (isDown) {
        guestP2StateMask |= bit;
    } else {
        guestP2StateMask &= ~bit;
    }
    // Gửi ngay lập tức khi trạng thái thay đổi
    if (guestP2StateMask !== prevMask) {
        sendGuestP2State();
    }
}

function sendGuestP2State() {
    guestInputSequence++;
    sendFastMessage({
        type: 'p2_input_state',
        mask: guestP2StateMask,
        seq: guestInputSequence
    });
}

function startGuestStateSender() {
    if (guestStateTickInterval) clearInterval(guestStateTickInterval);
    // Gửi định kỳ mỗi 20ms (~50 lần/giây, nằm trong khoảng 16-33ms)
    guestStateTickInterval = setInterval(() => {
        if (myRole === 'guest') {
            sendGuestP2State();
        }
    }, 20);
}

function stopGuestStateSender() {
    if (guestStateTickInterval) {
        clearInterval(guestStateTickInterval);
        guestStateTickInterval = null;
    }
    guestP2StateMask = 0;
}

// Khi mất focus cửa sổ (Alt-Tab, click ngoài), lập tức nhả phím
window.addEventListener('blur', () => {
    if (myRole === 'guest' && guestP2StateMask !== 0) {
        guestP2StateMask = 0;
        sendGuestP2State();
    }
    if (myRole === 'host' && currentNetcodeMode === 'input_sync' && hostP1StateMask !== 0) {
        hostP1StateMask = 0;
        sendHostP1State();
    }
});

// ==========================================
// 6A. ĐỒNG BỘ TRẠNG THÁI PHÍM P1 (CHO CHẾ ĐỘ P2P INPUT SYNC)
// ==========================================
const P1_INPUT_BITS = {
    UP:     1 << 0,  // 1
    DOWN:   1 << 1,  // 2
    LEFT:   1 << 2,  // 4
    RIGHT:  1 << 3,  // 8
    ATTACK: 1 << 4,  // 16
    JUMP:   1 << 5,  // 32
    DASH:   1 << 6,  // 64
    SUB:    1 << 7,  // 128
    ULTI:   1 << 8,  // 256
    ASSIST: 1 << 9,  // 512
    ENTER:  1 << 10  // 1024
};

// Phía Chủ phòng (Host - P1)
let hostP1StateMask = 0;
let hostP1InputSequence = 0;
let hostP1StateTickInterval = null;

function setHostP1KeyAction(action, isDown) {
    if (!P1_INPUT_BITS[action]) return;
    const bit = P1_INPUT_BITS[action];
    const prevMask = hostP1StateMask;
    if (isDown) {
        hostP1StateMask |= bit;
    } else {
        hostP1StateMask &= ~bit;
    }
    if (hostP1StateMask !== prevMask && currentNetcodeMode === 'input_sync') {
        sendHostP1State();
    }
}

function sendHostP1State() {
    if (currentNetcodeMode !== 'input_sync') return;
    hostP1InputSequence++;
    sendFastMessage({
        type: 'p1_input_state',
        mask: hostP1StateMask,
        seq: hostP1InputSequence
    });
}

function startHostP1StateSender() {
    if (hostP1StateTickInterval) clearInterval(hostP1StateTickInterval);
    hostP1StateTickInterval = setInterval(() => {
        if (myRole === 'host' && currentNetcodeMode === 'input_sync') {
            sendHostP1State();
        }
    }, 20);
}

function stopHostP1StateSender() {
    if (hostP1StateTickInterval) {
        clearInterval(hostP1StateTickInterval);
        hostP1StateTickInterval = null;
    }
    hostP1StateMask = 0;
}

// Phía Khách (Guest - nhận P1 từ Host)
let guestLastP1Mask = 0;
let guestLastP1PacketTime = 0;
let guestP1WatchdogInterval = null;

function handleGuestP1State(data) {
    if (myRole !== 'guest' || currentNetcodeMode !== 'input_sync') return;
    const newMask = typeof data.mask === 'number' ? data.mask : 0;
    guestLastP1PacketTime = Date.now();

    const changed = newMask ^ guestLastP1Mask;
    if (changed !== 0) {
        for (const [action, bit] of Object.entries(P1_INPUT_BITS)) {
            if (changed & bit) {
                const isDown = (newMask & bit) !== 0;
                const eventType = isDown ? 'keydown' : 'keyup';

                if (action === 'ENTER') {
                    const enterKey = { code: 'Enter', key: 'Enter', keyCode: 13, which: 13 };
                    dispatchFlashKeyEvent(eventType, enterKey);
                } else {
                    const nativeKey = FLASH_NATIVE_KEYS.p1[action];
                    if (nativeKey) {
                        dispatchFlashKeyEvent(eventType, nativeKey);
                    }
                }

                if (action !== 'ENTER') {
                    updateInputHud('p1', action, isDown);
                }
            }
        }
        guestLastP1Mask = newMask;
    }
}

function startGuestP1Watchdog() {
    if (guestP1WatchdogInterval) clearInterval(guestP1WatchdogInterval);
    guestP1WatchdogInterval = setInterval(() => {
        if (myRole === 'guest' && currentNetcodeMode === 'input_sync' && guestLastP1Mask !== 0) {
            if (Date.now() - guestLastP1PacketTime > 300) {
                console.warn("[Guest Watchdog] Quá 300ms không nhận gói P1 từ Host -> Tự động nhả toàn bộ phím P1!");
                releaseAllGuestP1Keys();
            }
        }
    }, 50);
}

function stopGuestP1Watchdog() {
    if (guestP1WatchdogInterval) {
        clearInterval(guestP1WatchdogInterval);
        guestP1WatchdogInterval = null;
    }
    releaseAllGuestP1Keys();
}

function releaseAllGuestP1Keys() {
    if (guestLastP1Mask === 0) return;
    for (const [action, bit] of Object.entries(P1_INPUT_BITS)) {
        if (guestLastP1Mask & bit) {
            if (action === 'ENTER') {
                dispatchFlashKeyEvent('keyup', { code: 'Enter', key: 'Enter', keyCode: 13, which: 13 });
            } else {
                const nativeKey = FLASH_NATIVE_KEYS.p1[action];
                if (nativeKey) {
                    dispatchFlashKeyEvent('keyup', nativeKey);
                }
                updateInputHud('p1', action, false);
            }
        }
    }
    guestLastP1Mask = 0;
}

// Cơ chế cân bằng & khử lệch trạng thái (Authoritative Host Reconciliation)
let hostReconcileInterval = null;
function startHostReconciliation() {
    if (hostReconcileInterval) clearInterval(hostReconcileInterval);
    hostReconcileInterval = setInterval(() => {
        if (myRole === 'host' && currentNetcodeMode === 'input_sync') {
            if (window.bvnBridge && typeof window.bvnBridge.getBattleState === 'function') {
                const state = window.bvnBridge.getBattleState();
                if (state && state.inBattle) {
                    sendFastMessage({
                        type: 'battle_reconcile',
                        p1Hp: state.p1Hp,
                        p2Hp: state.p2Hp,
                        p1Qi: state.p1Qi,
                        p2Qi: state.p2Qi
                    });
                }
            }
        }
    }, 1000);
}

function stopHostReconciliation() {
    if (hostReconcileInterval) {
        clearInterval(hostReconcileInterval);
        hostReconcileInterval = null;
    }
}

// Phía Chủ phòng (Host - P1)
let hostLastP2Mask = 0;
let hostLastP2PacketTime = 0;
let hostP2WatchdogInterval = null;

function handleHostP2State(data) {
    if (myRole !== 'host') return;
    const newMask = typeof data.mask === 'number' ? data.mask : 0;
    hostLastP2PacketTime = Date.now();

    // Tính chênh lệch trạng thái (diff) so với gói trước
    const changed = newMask ^ hostLastP2Mask;
    if (changed !== 0) {
        for (const [action, bit] of Object.entries(P2_INPUT_BITS)) {
            if (changed & bit) {
                const isDown = (newMask & bit) !== 0;
                const eventType = isDown ? 'keydown' : 'keyup';

                if (action === 'ENTER') {
                    const enterKey = { code: 'Enter', key: 'Enter', keyCode: 13, which: 13 };
                    dispatchFlashKeyEvent(eventType, enterKey);
                } else {
                    const nativeKey = FLASH_NATIVE_KEYS.p2[action];
                    if (nativeKey) {
                        dispatchFlashKeyEvent(eventType, nativeKey);
                    }
                }

                // Cập nhật đèn báo HUD phím P2 trên Host
                if (action !== 'ENTER') {
                    updateInputHud('p2', action, isDown);
                }
            }
        }
        hostLastP2Mask = newMask;
    }
}

// Cơ chế an toàn Watchdog: nếu Host không nhận được gói nào từ Khách quá 300ms thì tự động nhả phím
function startHostP2Watchdog() {
    if (hostP2WatchdogInterval) clearInterval(hostP2WatchdogInterval);
    hostP2WatchdogInterval = setInterval(() => {
        if (myRole === 'host' && hostLastP2Mask !== 0) {
            if (Date.now() - hostLastP2PacketTime > 300) {
                console.warn("[Host Watchdog] Quá 300ms không nhận gói từ Khách -> Tự động nhả toàn bộ phím P2!");
                releaseAllP2Keys();
            }
        }
    }, 50);
}

function stopHostP2Watchdog() {
    if (hostP2WatchdogInterval) {
        clearInterval(hostP2WatchdogInterval);
        hostP2WatchdogInterval = null;
    }
    releaseAllP2Keys();
}

function releaseAllP2Keys() {
    if (hostLastP2Mask === 0) return;
    for (const [action, bit] of Object.entries(P2_INPUT_BITS)) {
        if (hostLastP2Mask & bit) {
            if (action === 'ENTER') {
                dispatchFlashKeyEvent('keyup', { code: 'Enter', key: 'Enter', keyCode: 13, which: 13 });
            } else {
                const nativeKey = FLASH_NATIVE_KEYS.p2[action];
                if (nativeKey) {
                    dispatchFlashKeyEvent('keyup', nativeKey);
                }
                updateInputHud('p2', action, false);
            }
        }
    }
    hostLastP2Mask = 0;
}

// ==========================================
// 6. XỬ LÝ PHÍM & TỰ ĐỘNG CHUYỂN NÚT (KEY TRANSLATION)
// ==========================================

// Tìm action tương ứng với mã phím người dùng ấn
function findActionByCode(bindingGroup, code) {
    if (!bindingGroup) return null;
    for (const [action, config] of Object.entries(bindingGroup)) {
        if (config.code === code) return action;
        // Hỗ trợ cả phím số hàng trên Digit1..6 lẫn Numpad1..6 cho tiện lợi
        if (config.code.startsWith('Digit') && code === config.code.replace('Digit', 'Numpad')) return action;
        if (config.code.startsWith('Numpad') && code === config.code.replace('Numpad', 'Digit')) return action;
    }
    return null;
}

window.addEventListener('keydown', (e) => handleUserKeyEvent(e, 'keydown'), true);
window.addEventListener('keyup', (e) => handleUserKeyEvent(e, 'keyup'), true);

function handleUserKeyEvent(e, eventType) {
    // Chỉ xử lý phím thật, tránh đệ quy từ synthetic event
    if (!e.isTrusted) return;

    // Không can thiệp nếu đang mở modal cài phím hoặc đang nhập liệu
    if (activeRecordingButton || (keyModal && !keyModal.classList.contains('hidden'))) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    const code = e.code;
    const isKeyDown = (eventType === 'keydown');

    // Khách bấm phím bất kỳ => bật tiếng stream (trình duyệt yêu cầu tương tác người dùng)
    if (myRole === 'guest' && remoteVideo && remoteVideo.muted && remoteVideo.srcObject) {
        remoteVideo.muted = false;
    }

    // Chặn cuộn màn hình trình duyệt với phím mũi tên & Space
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) {
        e.preventDefault();
    }

    // Chặn phím thật đi tiếp vào Flash: Flash chỉ nhận phím đã được code chuyển đổi.
    const swallow = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
    };

    // Phím Enter hoặc Space hỗ trợ chọn nhanh trên mọi Menu
    if (code === 'Enter' || code === 'Space') {
        swallow();
        if (e.repeat) return;
        const rawKey = (code === 'Enter') 
            ? { code: 'Enter', key: 'Enter', keyCode: 13, which: 13 }
            : { code: 'Space', key: ' ', keyCode: 32, which: 32 };

        if (myRole === 'guest') {
            updateInputHud('p2', 'ATTACK', isKeyDown);
            setGuestKeyAction('ATTACK', isKeyDown);
            setGuestKeyAction('ENTER', isKeyDown);
            if (currentNetcodeMode === 'input_sync') {
                dispatchFlashKeyEvent(eventType, FLASH_NATIVE_KEYS.p2.ATTACK);
                dispatchFlashKeyEvent(eventType, rawKey);
            }
        } else {
            updateInputHud('p1', 'ATTACK', isKeyDown);
            dispatchFlashKeyEventWithSymmetricDelay(eventType, FLASH_NATIVE_KEYS.p1.ATTACK);
            dispatchFlashKeyEventWithSymmetricDelay(eventType, rawKey);
            if (myRole === 'host' && currentNetcodeMode === 'input_sync') {
                setHostP1KeyAction('ATTACK', isKeyDown);
                setHostP1KeyAction('ENTER', isKeyDown);
                sendFastMessage({
                    type: 'raw_flash_key',
                    eventType,
                    keyInfo: rawKey
                });
            }
            sendFastMessage({
                type: 'hud_key',
                role: 'p1',
                action: 'ATTACK',
                isActive: isKeyDown
            });
        }
        return;
    }

    // 1. TRƯỜNG HỢP HOST:
    if (myRole === 'host') {
        // Phím P1 (WASD + JKLUIO)
        const actionP1 = findActionByCode(userKeyBindings.p1, code);
        if (actionP1) {
            swallow();
            if (e.repeat) return;
            updateInputHud('p1', actionP1, isKeyDown);
            dispatchFlashKeyEventWithSymmetricDelay(eventType, FLASH_NATIVE_KEYS.p1[actionP1]);
            if (currentNetcodeMode === 'input_sync') {
                setHostP1KeyAction(actionP1, isKeyDown);
                sendFastMessage({
                    type: 'raw_flash_key',
                    eventType,
                    keyInfo: FLASH_NATIVE_KEYS.p1[actionP1]
                });
            }
            sendFastMessage({
                type: 'hud_key',
                role: 'p1',
                action: actionP1,
                isActive: isKeyDown
            });
            return;
        }

        // Cho phép Host bấm 4 Mũi tên + Numpad điều khiển P2 trực tiếp trên máy Host
        const actionP2 = findActionByCode(userKeyBindings.p2, code);
        if (actionP2) {
            swallow();
            if (e.repeat) return;
            updateInputHud('p2', actionP2, isKeyDown);
            dispatchFlashKeyEvent(eventType, FLASH_NATIVE_KEYS.p2[actionP2]);
            return;
        }
    }
    // 2. TRƯỜNG HỢP GUEST (P2):
    else if (myRole === 'guest') {
        const action = findActionByCode(userKeyBindings.p2, code);
        if (action) {
            swallow();
            if (e.repeat) return;
            updateInputHud('p2', action, isKeyDown);
            setGuestKeyAction(action, isKeyDown);
            if (currentNetcodeMode === 'input_sync') {
                const nativeKey = FLASH_NATIVE_KEYS.p2[action];
                if (nativeKey) dispatchFlashKeyEvent(eventType, nativeKey);
            }
            return;
        }
    }
    // 3. TRƯỜNG HỢP CHƠI ĐƠN (SOLO):
    else {
        const actionP1 = findActionByCode(userKeyBindings.p1, code);
        if (actionP1) {
            swallow();
            if (e.repeat) return;
            updateInputHud('p1', actionP1, isKeyDown);
            dispatchFlashKeyEvent(eventType, FLASH_NATIVE_KEYS.p1[actionP1]);
            return;
        }
        const actionP2 = findActionByCode(userKeyBindings.p2, code);
        if (actionP2) {
            swallow();
            if (e.repeat) return;
            updateInputHud('p2', actionP2, isKeyDown);
            dispatchFlashKeyEvent(eventType, FLASH_NATIVE_KEYS.p2[actionP2]);
            return;
        }
    }
}

// ==========================================
// 7. GIAO THỨC MẠNG & XỬ LÝ ĐỒNG BỘ
// ==========================================
function sendNetworkMessage(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
        return true;
    }
    return false;
}

function handleNetworkMessage(data) {
    if (!data) return;

    // 1. Host tạo phòng thành công
    if (data.type === 'room_created') {
        myRole = 'host';
        btnCreateRoom.classList.add('hidden');
        hostRoomInfo.classList.remove('hidden');
        hostRoomCode.value = data.roomId;
        updateRoleDisplay('host');
        updateStatus('waiting', `Đang mở phòng [${data.roomId}] • Chờ bạn bè tham gia...`);
        return;
    }

    // 2. Guest vào phòng thành công
    if (data.type === 'room_joined') {
        myRole = 'guest';
        updateRoleDisplay('guest');
        updateStatus('waiting', `Đã vào phòng [${data.roomId}] • Đang bắt tay kết nối...`);
        guestConnectionMsg.innerHTML = `<span>Đang kết nối với Chủ phòng...</span>`;
        return;
    }

    // 3. Hai bên kết nối thành công!
    if (data.type === 'peer_connected') {
        if (data.role) {
            myRole = data.role;
            updateRoleDisplay(myRole);
        }

        const hostWaiting = document.querySelector('.host-waiting-msg');
        if (hostWaiting) hostWaiting.classList.add('hidden');
        guestConnectionMsg.innerHTML = `<span style="color: #00ff88;">✓ ĐÃ KẾT NỐI VỚI CHỦ PHÒNG THÀNH CÔNG!</span>`;
        pingBadge.classList.remove('hidden');
        startPingMeasurement();

        if (myRole === 'host') {
            sendFastMessage({ type: 'sync_mode', mode: currentNetcodeMode });
            sendFastMessage({ type: 'sync_edition', edition: currentEdition });
            sendFastMessage({ type: 'sync_skip_to_menu' });
            if (currentNetcodeMode === 'input_sync') {
                updateStatus('connected', `⚡ BẠN LÀ P1 (HOST): P2P Input Sync (0 MB Video) cùng Khách!`);
                showSyncNotification("⚡ Đã kết nối P2P Input Sync! Hai máy chạy độc lập siêu nhẹ 60FPS không tốn mạng.");
                startHostP2Watchdog();
                startHostP1StateSender();
                startHostReconciliation();
            } else {
                updateStatus('connected', `🟢 BẠN LÀ P1 (HOST): Đang phát trực tiếp 30FPS HD cho Khách!`);
                showSyncNotification("🎮 Đã kết nối với Khách! Host bấm S (xuống) chọn 'Vs Human' ➔ bấm Enter để cùng chọn tướng đấu 2 người!");
                startHostP2Watchdog();
            }
            setTimeout(setupHostWebRtc, 500);
        } else {
            if (currentNetcodeMode === 'input_sync') {
                updateStatus('connected', `⚡ BẠN LÀ P2 (KHÁCH): P2P Input Sync (0 MB Video) cùng Host!`);
                showSyncNotification("⚡ Đã kết nối P2P Input Sync! Bạn đang điều khiển P2 với 0ms trễ hình ảnh.");
                startGuestStateSender();
                startGuestP1Watchdog();
            } else {
                updateStatus('connected', `🟢 BẠN LÀ P2 (KHÁCH): Đang xem trực tiếp 30FPS HD từ Host!`);
                showSyncNotification("🟢 Đã kết nối với Chủ phòng (30FPS HD)! Bạn đang điều khiển P2. Sẵn sàng!");
                startGuestStateSender();
            }
            setupGuestWebRtc();
        }
        return;
    }

    // Đồng bộ chế độ mạng giữa Host và Guest
    if (data.type === 'sync_mode') {
        console.log("Đồng bộ chế độ mạng từ Host:", data.mode);
        setNetcodeMode(data.mode, false);
        return;
    }

    // Đồng bộ phiên bản game giữa Host và Guest
    if (data.type === 'sync_edition') {
        if (data.edition && EDITIONS[data.edition]) {
            currentEdition = data.edition;
            localStorage.setItem('bvn_game_edition', currentEdition);
            if (gameEditionSelect) gameEditionSelect.value = currentEdition;
            showSyncNotification(`🔄 Chủ phòng đã chọn phiên bản: ${EDITIONS[currentEdition].name}`);
            if (currentNetcodeMode === 'input_sync' && myRole === 'guest') {
                initRuffleGame();
            }
        }
        return;
    }

    // 4. WebRTC Signaling (Offer, Answer, Candidate)
    if (data.type === 'webrtc_offer') {
        handleWebRtcOffer(data.sdp);
        return;
    }
    if (data.type === 'webrtc_answer') {
        handleWebRtcAnswer(data.sdp);
        return;
    }
    if (data.type === 'webrtc_candidate') {
        handleWebRtcCandidate(data.candidate);
        return;
    }

    // 5. Host nhận gói trạng thái phím P2 liên tục (state-based mask) chống kẹt phím
    if (data.type === 'p2_input_state') {
        handleHostP2State(data);
        return;
    }

    // Guest nhận gói trạng thái phím P1 từ Host (Mode 2: Input Sync)
    if (data.type === 'p1_input_state') {
        handleGuestP1State(data);
        return;
    }

    // Đồng bộ Sảnh Ban/Pick Tướng Esports giữa Host và Guest
    if (data.type === 'bp_select') {
        if (typeof handleRemoteBanPickSelect === 'function') handleRemoteBanPickSelect(data);
        return;
    }
    if (data.type === 'bp_lock') {
        if (typeof handleRemoteBanPickLock === 'function') handleRemoteBanPickLock(data);
        return;
    }

    // Đồng bộ vào trận đấu từ Web Shell hoặc Ban/Pick Lobby
    if (data.type === 'sync_start_match') {
        console.log(`[Guest] Nhận lệnh khởi động trận đấu từ Host: ${data.p1} vs ${data.p2}`);
        if (typeof closeBanPickModal === 'function') closeBanPickModal();
        if (window.bvnBridge && typeof window.bvnBridge.startMatch === 'function') {
            window.bvnBridge.startMatch(data.p1, data.p2, data.p1Assist, data.p2Assist, data.stage, data.modo || 3);
        }
        showSyncNotification(`⚔️ Chủ phòng khởi động trận đấu: ${data.p1} vs ${data.p2}!`);
        focusGame();
        return;
    }

    // Đồng bộ các thao tác Web Shell (Cheat HP, Tạm dừng, Về Menu)
    if (data.type === 'sync_bridge_action') {
        if (window.bvnBridge) {
            if (data.action === 'set_hp') {
                window.bvnBridge.setFighterHp(data.player, data.hp);
            } else if (data.action === 'pause') {
                window.bvnBridge.pauseBattle();
            } else if (data.action === 'resume') {
                window.bvnBridge.resumeBattle();
            } else if (data.action === 'end_match') {
                window.bvnBridge.endMatchToMenu();
            }
        }
        return;
    }

    // Khử lệch trạng thái từ Host (Authoritative Reconciliation)
    if (data.type === 'battle_reconcile') {
        if (myRole === 'guest' && currentNetcodeMode === 'input_sync') {
            if (window.bvnBridge && typeof window.bvnBridge.getBattleState === 'function') {
                const localState = window.bvnBridge.getBattleState();
                if (localState && localState.inBattle) {
                    if (typeof data.p1Hp === 'number' && Math.abs(localState.p1Hp - data.p1Hp) > 25) {
                        window.bvnBridge.setFighterHp(1, data.p1Hp);
                    }
                    if (typeof data.p2Hp === 'number' && Math.abs(localState.p2Hp - data.p2Hp) > 25) {
                        window.bvnBridge.setFighterHp(2, data.p2Hp);
                    }
                }
            }
        }
        return;
    }

    // Fallback: Host nhận phím bấm dạng event nếu bên kia gửi kiểu cũ
    if (data.type === 'game_input') {
        // Cập nhật đèn báo phím P2 trên HUD của cả 2 máy
        updateInputHud('p2', data.action === 'MENU_CONFIRM' ? 'ATTACK' : data.action, data.eventType === 'keydown');

        if (myRole === 'host') {
            const nativeKey = FLASH_NATIVE_KEYS.p2[data.action];
            if (nativeKey) {
                dispatchFlashKeyEvent(data.eventType, nativeKey);
            }
        }
        return;
    }

    // Đồng bộ chuyển thẳng vào Menu chính giữa 2 máy
    if (data.type === 'sync_skip_to_menu') {
        if (window.bvnBridge && typeof window.bvnBridge.skipIntro === 'function') {
            try { window.bvnBridge.skipIntro(); } catch (e) {}
        }
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        focusGame();
        return;
    }

    if (data.type === 'raw_flash_key') {
        if (data.keyInfo) {
            dispatchFlashKeyEvent(data.eventType, data.keyInfo);
        }
        return;
    }

    // 6. Đồng bộ trạng thái đèn phím (HUD) giữa 2 máy
    if (data.type === 'hud_key') {
        updateInputHud(data.role, data.action, data.isActive);
        return;
    }

    // 8. Yêu cầu khởi động lại ván đấu đồng bộ
    if (data.type === 'sync_restart') {
        triggerSynchronizedRestart();
        return;
    }

    // 7. Đo Ping
    if (data.type === 'ping') {
        sendFastMessage({ type: 'pong', time: data.time });
        return;
    }
    if (data.type === 'pong') {
        const latency = Date.now() - data.time;
        pingVal.innerText = latency;
        return;
    }

    // 8. Đối thủ ngắt kết nối
    if (data.type === 'peer_disconnected') {
        stopHostP2Watchdog();
        stopGuestStateSender();
        stopHostP1StateSender();
        stopGuestP1Watchdog();
        stopHostReconciliation();
        stopStatsMonitoring();
        updateStatus('waiting', 'Đối thủ đã ngắt kết nối.');
        pingBadge.classList.add('hidden');
        if (pingInterval) clearInterval(pingInterval);
        alert("Đối thủ đã rời khỏi phòng.");
        location.reload();
        return;
    }

    // 9. Lỗi
    if (data.type === 'error') {
        alert(data.message || 'Lỗi kết nối phòng');
        btnJoinRoom.disabled = false;
        btnJoinRoom.innerText = "Vào phòng";
        return;
    }
}

// ==========================================
// 8. TẠO PHÒNG & THAM GIA PHÒNG
// ==========================================
btnCreateRoom.addEventListener('click', () => {
    btnCreateRoom.disabled = true;
    btnCreateRoom.innerText = "Đang tạo phòng...";
    const randomCode = Math.floor(1000 + Math.random() * 9000);
    const roomId = `bvn-${randomCode}`;
    connectWebSocketAndSend({ type: 'create_room', roomId });
});

btnJoinRoom.addEventListener('click', () => {
    const code = inputRoomCode.value.trim().toLowerCase();
    if (!code) {
        alert("Vui lòng nhập mã phòng!");
        return;
    }
    joinRoomAsGuest(code);
});

function joinRoomAsGuest(roomId) {
    btnJoinRoom.disabled = true;
    btnJoinRoom.innerText = "Đang kết nối...";
    guestConnectionMsg.classList.remove('hidden');
    guestConnectionMsg.innerText = `Đang tìm phòng [${roomId}]...`;

    // Nếu ở chế độ Stream (Remote Play), ngừng chạy Flash trên máy Khách để không tốn CPU/bộ nhớ
    if (currentNetcodeMode === 'stream') {
        pauseLocalRuffle();
        const rPlayer = document.getElementById('rufflePlayer');
        if (rPlayer) rPlayer.style.display = 'none';
    } else {
        resumeLocalRuffle();
        const rPlayer = document.getElementById('rufflePlayer');
        if (rPlayer) rPlayer.style.display = 'block';
    }

    // Giải phóng tiêu điểm (blur) khỏi ô nhập liệu để bàn phím không bị kẹt trong ô input!
    if (inputRoomCode) inputRoomCode.blur();
    if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
    }
    window.focus();

    connectWebSocketAndSend({ type: 'join_room', roomId });
}

// Tự động đánh thức máy chủ Render trong nền khi vừa mở trang (chống delay cold start)
function wakeUpSignalingServer() {
    try {
        const wsUrl = getWebSocketUrl();
        let httpUrl = null;
        if (wsUrl.startsWith('wss://')) {
            httpUrl = wsUrl.replace('wss://', 'https://').replace(/\/+$/, '') + '/healthz';
        } else if (wsUrl.startsWith('ws://')) {
            httpUrl = wsUrl.replace('ws://', 'http://').replace(/\/+$/, '') + '/healthz';
        }
        if (httpUrl && !httpUrl.includes('localhost') && !httpUrl.includes('127.0.0.1')) {
            fetch(httpUrl, { method: 'GET', mode: 'no-cors', cache: 'no-cache' })
                .then(() => console.log(`[Signaling] Đã gửi ping đánh thức máy chủ Render (${httpUrl})`))
                .catch(() => {});
        }
    } catch (_) {}
}

function getWebSocketUrl() {
    if (window.BVN_WS_URL) return window.BVN_WS_URL;
    const customWs = localStorage.getItem('bvn_custom_ws_url');
    if (customWs) return customWs;

    const port = window.location.port;
    // 1. Nếu mở trực tiếp qua cổng 3000 của node server.js (http://localhost:3000)
    if (port === '3000') {
        const wsProto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        return `${wsProto}${window.location.host}`;
    }

    // 2. Mặc định: Kết nối máy chủ Signaling đám mây (Render) để chơi Online qua Internet
    // (Áp dụng cho Wamp localhost:80, Vercel, Cloudflare Pages, GitHub Pages, điện thoại, máy bạn bè)
    return 'wss://naruto-vs-bleach-online.onrender.com';
}

function connectWebSocketAndSend(initialMsg) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(initialMsg));
        return;
    }

    const wsUrl = getWebSocketUrl();
    console.log("[Signaling] Đang kết nối tới:", wsUrl);
    updateStatus('waiting', `Đang kết nối máy chủ Signaling (${wsUrl.includes('render') ? 'Cloud' : 'Local'})...`);

    try {
        if (socket) {
            try { socket.close(); } catch (_) {}
            socket = null;
        }

        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log("[Signaling] Đã kết nối WebSocket thành công!");
            socket.send(JSON.stringify(initialMsg));
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleNetworkMessage(data);
            } catch (e) {
                console.error("Lỗi parse WS msg:", e);
            }
        };

        socket.onerror = (err) => {
            console.error("WebSocket error:", err);
            showSyncNotification("⚠️ Không thể kết nối máy chủ WebSocket. Nếu máy chủ Render đang khởi động, vui lòng thử lại sau vài giây!", 4000);
            updateStatus('waiting', "Chưa kết nối được máy chủ. Vui lòng bấm thử lại!");
            btnCreateRoom.disabled = false;
            btnCreateRoom.innerText = "➕ Tạo phòng mới";
            btnJoinRoom.disabled = false;
            btnJoinRoom.innerText = "Vào phòng";
        };

        socket.onclose = () => {
            console.log("[Signaling] WebSocket đã đóng.");
        };
    } catch (e) {
        console.error("Lỗi tạo WebSocket:", e);
        showSyncNotification("⚠️ Lỗi khởi tạo WebSocket: " + (e.message || e), 4000);
        btnCreateRoom.disabled = false;
        btnCreateRoom.innerText = "➕ Tạo phòng mới";
        btnJoinRoom.disabled = false;
        btnJoinRoom.innerText = "Vào phòng";
    }
}

// ==========================================
// THEO DÕI CHẤT LƯỢNG KẾT NỐI WEBRTC & GIẢM TRỄ (getStats)
// ==========================================
let statsMonitorInterval = null;
let lastPacketsLost = 0;
let lastPacketsTotal = 0;
let consecutiveLossCount = 0;
let autoDownscaleEnabled = localStorage.getItem('bvn_auto_downscale') !== 'false';

// Checkbox cho phép người dùng bật/tắt tính năng tự động hạ preset khi lag
const chkAutoDownscale = document.getElementById('chkAutoDownscale');
if (chkAutoDownscale) {
    chkAutoDownscale.checked = autoDownscaleEnabled;
    chkAutoDownscale.addEventListener('change', (e) => {
        autoDownscaleEnabled = e.target.checked;
        localStorage.setItem('bvn_auto_downscale', autoDownscaleEnabled ? 'true' : 'false');
    });
}

function startPingMeasurement() {
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
        sendFastMessage({ type: 'ping', time: Date.now() });
    }, 1000);
    startStatsMonitoring();
}

function startStatsMonitoring() {
    if (statsMonitorInterval) clearInterval(statsMonitorInterval);
    lastPacketsLost = 0;
    lastPacketsTotal = 0;
    consecutiveLossCount = 0;

    statsMonitorInterval = setInterval(async () => {
        if (!peerConnection || peerConnection.connectionState !== 'connected') return;
        try {
            const stats = await peerConnection.getStats();
            let rtt = null;
            let packetsLost = 0;
            let packetsTotal = 0;
            let framesDropped = 0;
            let jitterMs = 0;
            let cpuLimitation = false;

            stats.forEach(report => {
                // RTT từ candidate-pair đang hoạt động
                if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated) && typeof report.currentRoundTripTime === 'number') {
                    rtt = Math.round(report.currentRoundTripTime * 1000);
                }
                // Host kiểm tra mức tải CPU
                if (report.type === 'outbound-rtp' && report.kind === 'video') {
                    if (report.qualityLimitationReason === 'cpu') {
                        cpuLimitation = true;
                    }
                    if (typeof report.packetsSent === 'number') {
                        packetsTotal += report.packetsSent;
                    }
                }
                // Guest kiểm tra thống kê inbound
                if (report.type === 'inbound-rtp' && report.kind === 'video') {
                    if (typeof report.packetsLost === 'number') packetsLost = report.packetsLost;
                    if (typeof report.packetsReceived === 'number') packetsTotal = report.packetsReceived + packetsLost;
                    if (typeof report.framesDropped === 'number') framesDropped = report.framesDropped;
                    if (typeof report.jitter === 'number') jitterMs = Math.round(report.jitter * 1000);
                }
                // Host đọc remote-inbound-rtp để nắm tình trạng mạng phía Khách
                if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
                    if (typeof report.packetsLost === 'number') packetsLost = report.packetsLost;
                    if (typeof report.jitter === 'number') jitterMs = Math.round(report.jitter * 1000);
                    if (typeof report.roundTripTime === 'number' && rtt === null) {
                        rtt = Math.round(report.roundTripTime * 1000);
                    }
                }
            });

            // Tính tỷ lệ mất gói trong 2 giây vừa qua
            let lossPercent = 0;
            if (packetsTotal > lastPacketsTotal) {
                const deltaLost = Math.max(0, packetsLost - lastPacketsLost);
                const deltaTotal = packetsTotal - lastPacketsTotal;
                lossPercent = Math.min(100, Math.round((deltaLost / deltaTotal) * 100));
            }
            lastPacketsLost = packetsLost;
            lastPacketsTotal = packetsTotal;

            updateNetworkQualityBadge({
                rtt,
                lossPercent,
                framesDropped,
                jitterMs,
                cpuLimitation
            });

            // Tự động hạ preset nếu mất gói liên tục trong 10 giây (5 lần kiểm tra liên tiếp)
            if (lossPercent >= 4) {
                consecutiveLossCount++;
                if (consecutiveLossCount >= 5 && autoDownscaleEnabled) {
                    consecutiveLossCount = 0;
                    handleAutoDownscalePreset();
                }
            } else {
                consecutiveLossCount = Math.max(0, consecutiveLossCount - 1);
            }
        } catch (e) {
            console.warn("Lỗi đọc WebRTC getStats:", e);
        }
    }, 2000);
}

function stopStatsMonitoring() {
    if (statsMonitorInterval) {
        clearInterval(statsMonitorInterval);
        statsMonitorInterval = null;
    }
}

function updateNetworkQualityBadge({ rtt, lossPercent, framesDropped, jitterMs, cpuLimitation }) {
    if (!pingBadge) return;
    pingBadge.classList.remove('hidden');

    const pingDisplay = rtt !== null ? rtt : (pingVal?.innerText || '--');
    if (pingVal && rtt !== null) pingVal.innerText = pingDisplay;

    const netStatsExtra = document.getElementById('netStatsExtra');
    let extraText = '';
    if (lossPercent > 0) {
        extraText += ` • Loss: ${lossPercent}%`;
    }
    if (jitterMs > 10) {
        extraText += ` • Jitter: ${jitterMs}ms`;
    }
    if (netStatsExtra) {
        netStatsExtra.innerText = extraText;
    }

    // Đổi màu badge: Xanh, Vàng, Đỏ
    pingBadge.classList.remove('good', 'warning', 'bad');
    const numericPing = parseInt(pingDisplay, 10) || 0;

    if (cpuLimitation) {
        pingBadge.classList.add('bad');
        showSyncNotification("⚠️ Máy Host đang quá tải (CPU)! Giảm bớt ứng dụng nền hoặc hạ preset stream.", 4000);
    } else if (lossPercent > 5 || numericPing > 150) {
        pingBadge.classList.add('bad');
        if (lossPercent > 5 && currentStreamQuality !== 'smooth') {
            showSyncNotification("⚠️ Mạng mất gói cao! Gợi ý đổi sang preset Siêu mượt (2.5 Mbps).", 3000);
        }
    } else if (lossPercent > 1 || numericPing > 65 || jitterMs > 25) {
        pingBadge.classList.add('warning');
    } else {
        pingBadge.classList.add('good');
    }
}

async function handleAutoDownscalePreset() {
    let nextPresetKey = null;
    if (currentStreamQuality === 'ultra') {
        nextPresetKey = 'balanced';
    } else if (currentStreamQuality === 'balanced') {
        nextPresetKey = 'smooth';
    } else {
        return;
    }
    currentStreamQuality = nextPresetKey;
    localStorage.setItem('bvn_stream_quality', currentStreamQuality);
    if (streamQualitySelect) streamQualitySelect.value = currentStreamQuality;
    if (activeVideoSender) {
        await tuneVideoSenderForLowLatency(activeVideoSender);
    }
    const preset = STREAM_QUALITY_PRESETS[currentStreamQuality];
    showSyncNotification(`⚠️ Mạng yếu liên tục: Đã tự động hạ sang ${preset.label} để chống lag!`, 4000);
}

// Nút Đồng bộ lại / Khởi động lại
btnSyncRestart.addEventListener('click', () => {
    if (confirm("Khởi động lại game để đồng bộ ván mới từ Frame 0 trên cả 2 máy?")) {
        sendNetworkMessage({ type: 'sync_restart' });
        triggerSynchronizedRestart();
    }
});

function triggerSynchronizedRestart() {
    let count = 3;
    showSyncNotification(`🔄 Đồng bộ lại ván đấu từ Frame 0: ${count}...`, 3500);
    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            showSyncNotification(`🔄 Đồng bộ lại ván đấu từ Frame 0: ${count}...`, 1500);
        } else {
            clearInterval(interval);
            showSyncNotification("⚔️ BẮT ĐẦU VÁN MỚI! SẴN SÀNG CHIẾN ĐẤU!", 2500);
            if (currentNetcodeMode === 'stream' && myRole === 'guest') {
                // Remote Play: Khách không chạy game riêng, chờ Host gửi luồng hình mới
                return;
            }
            initRuffleGame();
            if (currentNetcodeMode === 'stream' && myRole === 'host') {
                setTimeout(setupHostWebRtc, 1000);
            }
        }
    }, 1000);
}

// Toàn màn hình
btnFullscreen.addEventListener('click', () => {
    const container = document.getElementById('gameContainer');
    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(err => {
            alert(`Lỗi toàn màn hình: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
});

function updateStatus(state, msg) {
    statusDot.className = `status-indicator ${state}`;
    statusText.innerText = msg;
}

function updateRoleDisplay(role) {
    if (role === 'host') {
        roleBadge.className = 'role-badge role-host';
        roleBadge.innerText = '🔴 BẠN LÀ P1 (HOST)';
        if (netcodeBadge) netcodeBadge.innerText = '⚡ 60FPS HD Remote Play (Host Engine)';
        if (btnShareScreen) btnShareScreen.classList.remove('hidden');
    } else if (role === 'guest') {
        roleBadge.className = 'role-badge role-guest';
        roleBadge.innerText = '🔵 BẠN LÀ P2 (KHÁCH)';
        if (netcodeBadge) netcodeBadge.innerText = '⚡ 60FPS HD Remote Play (Màn hình đồng bộ)';
        if (btnShareScreen) btnShareScreen.classList.add('hidden');
    } else {
        roleBadge.className = 'role-badge role-solo';
        roleBadge.innerText = '🎮 Chế độ: Chơi đơn';
        if (btnShareScreen) btnShareScreen.classList.add('hidden');
    }
}

// Nút chia sẻ trực tiếp Tab 60FPS siêu mượt cho Khách bằng phần cứng GPU
if (btnShareScreen) {
    btnShareScreen.addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    displaySurface: 'browser',
                    frameRate: { ideal: 60, max: 60 },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: true
            });
            const newVideoTrack = stream.getVideoTracks()[0];
            if (newVideoTrack && peerConnection) {
                if ('contentHint' in newVideoTrack) {
                    newVideoTrack.contentHint = 'motion';
                }
                const senders = peerConnection.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                if (videoSender) {
                    activeVideoSender = videoSender;
                    await videoSender.replaceTrack(newVideoTrack);
                    tuneVideoSenderForLowLatency(videoSender);
                    btnShareScreen.innerText = "✓ Đang phát Tab 60FPS GPU";
                    btnShareScreen.style.background = "#00ff88";
                    btnShareScreen.style.color = "#000";
                    showSyncNotification("🟢 Đã kích hoạt truyền hình ảnh Tab 60FPS GPU phần cứng siêu mượt cho Khách!");
                    newVideoTrack.onended = () => {
                        btnShareScreen.innerText = "📺 Bật Tab 60FPS GPU";
                        btnShareScreen.style.background = "";
                        btnShareScreen.style.color = "";
                    };
                }
            }
        } catch (e) {
            console.warn("Screen share cancelled or failed:", e);
        }
    });
}

// Bắt sự kiện đổi chất lượng truyền tải trực tiếp
if (streamQualitySelect) {
    streamQualitySelect.value = currentStreamQuality;
    streamQualitySelect.addEventListener('change', async (e) => {
        currentStreamQuality = e.target.value;
        localStorage.setItem('bvn_stream_quality', currentStreamQuality);
        const preset = STREAM_QUALITY_PRESETS[currentStreamQuality] || STREAM_QUALITY_PRESETS.smooth;
        if (activeVideoSender) {
            await tuneVideoSenderForLowLatency(activeVideoSender);
        }
        showSyncNotification(`🟢 Đã đổi chất lượng stream: ${preset.label}`);
    });
}

function showSyncNotification(msg, duration = 4000) {
    let notifyBox = document.getElementById('syncNotifyBox');
    if (!notifyBox) {
        notifyBox = document.createElement('div');
        notifyBox.id = 'syncNotifyBox';
        notifyBox.className = 'sync-notify-box';
        const wrapper = document.getElementById('flashPlayerWrapper') || document.body;
        wrapper.appendChild(notifyBox);
    }
    notifyBox.innerHTML = `<span>${msg}</span>`;
    notifyBox.classList.remove('hidden');
    clearTimeout(notifyBox._timer);
    notifyBox._timer = setTimeout(() => {
        notifyBox.classList.add('hidden');
    }, duration);
}

// Copy Code & Link
btnCopyCode.addEventListener('click', () => {
    navigator.clipboard.writeText(hostRoomCode.value);
    btnCopyCode.innerText = "Đã Copy!";
    setTimeout(() => { btnCopyCode.innerText = "Copy Mã"; }, 2000);
});

btnCopyLink.addEventListener('click', () => {
    const inviteLink = `${window.location.origin}${window.location.pathname}?room=${hostRoomCode.value}`;
    navigator.clipboard.writeText(inviteLink);
    btnCopyLink.innerText = "✓ Đã Copy Link!";
    setTimeout(() => { btnCopyLink.innerText = "🔗 Copy Link Mời Bạn Bè"; }, 2000);
});

// ==========================================
// 9. MODAL CÀI ĐẶT PHÍM (3 OPTIONS & CUSTOM MAP)
// ==========================================
let editingKeyGroup = 'p1'; // 'p1' | 'p2' | 'gamepad'
let activeRecordingButton = null;
let activeRecordingGamepadButton = null;
let tempBindings = JSON.parse(JSON.stringify(userKeyBindings));
let tempGamepadConfig = JSON.parse(JSON.stringify(userGamepadConfig));

btnOpenKeyModal.addEventListener('click', () => {
    tempBindings = JSON.parse(JSON.stringify(userKeyBindings));
    tempGamepadConfig = JSON.parse(JSON.stringify(userGamepadConfig));

    // Mặc định chọn tab phù hợp với vai trò hiện tại
    if (myRole === 'guest') {
        switchModalTab('tabP2');
    } else {
        switchModalTab('tabP1');
    }

    keyModal.classList.remove('hidden');
});

if (btnGamepadStatus) {
    btnGamepadStatus.addEventListener('click', () => {
        tempBindings = JSON.parse(JSON.stringify(userKeyBindings));
        tempGamepadConfig = JSON.parse(JSON.stringify(userGamepadConfig));
        switchModalTab('tabGamepad');
        keyModal.classList.remove('hidden');
    });
}

btnCloseKeyModal.addEventListener('click', () => {
    cancelActiveRecording();
    cancelActiveGamepadRecording();
    keyModal.classList.add('hidden');
});

function switchModalTab(tabId) {
    cancelActiveRecording();
    cancelActiveGamepadRecording();

    tabButtons.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
    });
    tabContents.forEach(c => {
        c.classList.toggle('active', c.id === tabId);
    });

    if (tabId === 'tabGamepad') {
        editingKeyGroup = 'gamepad';
        if (keyboardPresetSelector) keyboardPresetSelector.style.display = 'none';
        if (gamepadTargetSelect) gamepadTargetSelect.value = tempGamepadConfig.target || 'auto';
        if (gamepadPresetSelect) gamepadPresetSelect.value = tempGamepadConfig.preset || 'standard';
        renderGamepadBindings();
    } else {
        if (keyboardPresetSelector) keyboardPresetSelector.style.display = 'flex';
        editingKeyGroup = tabId === 'tabP1' ? 'p1' : 'p2';
        if (presetSelect) presetSelect.value = tempBindings[editingKeyGroup + 'Preset'] || 'option_custom';
        renderModalBindings();
    }
}

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        switchModalTab(targetTab);
    });
});

// Thay đổi Preset trong dropdown bàn phím
presetSelect.addEventListener('change', (e) => {
    const selected = e.target.value;
    if (KEY_PRESETS[selected]) {
        tempBindings[editingKeyGroup] = JSON.parse(JSON.stringify(KEY_PRESETS[selected]));
        tempBindings[editingKeyGroup + 'Preset'] = selected;
        renderModalBindings();
    } else {
        tempBindings[editingKeyGroup + 'Preset'] = 'option_custom';
    }
});

if (gamepadTargetSelect) {
    gamepadTargetSelect.addEventListener('change', (e) => {
        tempGamepadConfig.target = e.target.value;
    });
}

if (gamepadPresetSelect) {
    gamepadPresetSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val !== 'custom' && GAMEPAD_PRESETS[val]) {
            tempGamepadConfig.preset = val;
            tempGamepadConfig.buttons = JSON.parse(JSON.stringify(GAMEPAD_PRESETS[val].buttons));
            renderGamepadBindings();
        } else {
            tempGamepadConfig.preset = 'custom';
        }
    });
}

if (btnTestVibration) {
    btnTestVibration.addEventListener('click', () => {
        vibrateGamepad(250, 0.7, 0.7);
    });
}

function renderModalBindings() {
    renderBindingGroupList('p1', bindingListP1);
    renderBindingGroupList('p2', bindingListP2);
}

function renderBindingGroupList(group, container) {
    container.innerHTML = '';
    const nativeGroup = FLASH_NATIVE_KEYS[group];
    const currentGroup = tempBindings[group];

    for (const [action, nativeInfo] of Object.entries(nativeGroup)) {
        const boundKey = currentGroup[action] || { code: nativeInfo.code, display: nativeInfo.label };

        const row = document.createElement('div');
        row.className = 'binding-row';

        const label = document.createElement('span');
        label.className = 'binding-label';
        label.innerText = ACTION_LABELS[action] || nativeInfo.label;

        const btn = document.createElement('button');
        btn.className = 'bind-key-btn';
        btn.innerText = boundKey.display;
        btn.dataset.group = group;
        btn.dataset.action = action;

        btn.addEventListener('click', () => {
            startRecordingKey(btn, group, action);
        });

        row.appendChild(label);
        row.appendChild(btn);
        container.appendChild(row);
    }
}

function startRecordingKey(btn, group, action) {
    cancelActiveRecording();
    cancelActiveGamepadRecording();

    activeRecordingButton = btn;
    btn.classList.add('recording');
    btn.innerText = 'Nhấn phím bất kỳ...';

    const onKeyRecord = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const code = e.code;
        const display = formatKeyDisplay(e);

        tempBindings[group][action] = {
            code: code,
            display: display
        };
        tempBindings[group + 'Preset'] = 'option_custom';
        presetSelect.value = 'option_custom';

        btn.innerText = display;
        btn.classList.remove('recording');
        activeRecordingButton = null;

        window.removeEventListener('keydown', onKeyRecord, true);
    };

    window.addEventListener('keydown', onKeyRecord, true);
}

function cancelActiveRecording() {
    if (activeRecordingButton) {
        const group = activeRecordingButton.dataset.group;
        const action = activeRecordingButton.dataset.action;
        activeRecordingButton.innerText = tempBindings[group][action]?.display || '?';
        activeRecordingButton.classList.remove('recording');
        activeRecordingButton = null;
    }
}

function renderGamepadBindings() {
    if (!bindingListGamepad) return;
    bindingListGamepad.innerHTML = '';
    const currentButtons = tempGamepadConfig.buttons || {};

    GAMEPAD_ACTIONS.forEach(({ action, label }) => {
        const boundInfo = currentButtons[action] || { display: 'Chưa gán' };

        const row = document.createElement('div');
        row.className = 'binding-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'binding-label';
        labelEl.innerText = label;

        const btn = document.createElement('button');
        btn.className = 'bind-key-btn';
        btn.innerText = boundInfo.display;
        btn.dataset.action = action;

        btn.addEventListener('click', () => {
            startRecordingGamepadKey(btn, action);
        });

        row.appendChild(labelEl);
        row.appendChild(btn);
        bindingListGamepad.appendChild(row);
    });
}

function startRecordingGamepadKey(btn, action) {
    cancelActiveRecording();
    cancelActiveGamepadRecording();

    activeRecordingGamepadButton = { btn, action };
    btn.classList.add('recording');
    btn.innerText = 'Bấm nút trên tay cầm...';
}

function cancelActiveGamepadRecording() {
    if (activeRecordingGamepadButton) {
        const { btn, action } = activeRecordingGamepadButton;
        btn.innerText = tempGamepadConfig.buttons[action]?.display || 'Chưa gán';
        btn.classList.remove('recording');
        activeRecordingGamepadButton = null;
    }
}

function formatKeyDisplay(e) {
    if (e.code.startsWith('Key')) return e.code.replace('Key', '');
    if (e.code.startsWith('Digit')) return 'Số ' + e.code.replace('Digit', '');
    if (e.code.startsWith('Numpad')) return 'Num ' + e.code.replace('Numpad', '');
    if (e.code === 'ArrowUp') return '↑';
    if (e.code === 'ArrowDown') return '↓';
    if (e.code === 'ArrowLeft') return '←';
    if (e.code === 'ArrowRight') return '→';
    if (e.code === 'Space') return 'Space';
    return e.key ? e.key.toUpperCase() : e.code;
}

btnSaveKeys.addEventListener('click', () => {
    saveKeyBindings(tempBindings);
    saveGamepadConfig(tempGamepadConfig);
    keyModal.classList.add('hidden');
    showSyncNotification("✓ Đã lưu cài đặt bàn phím & tay cầm thành công!");
});

btnResetDefaultKeys.addEventListener('click', () => {
    if (editingKeyGroup === 'gamepad') {
        if (confirm("Khôi phục cấu hình tay cầm về mặc định Chuẩn Đối Kháng Arcade?")) {
            tempGamepadConfig = {
                target: 'auto',
                preset: 'standard',
                buttons: JSON.parse(JSON.stringify(GAMEPAD_PRESETS.standard.buttons))
            };
            if (gamepadTargetSelect) gamepadTargetSelect.value = 'auto';
            if (gamepadPresetSelect) gamepadPresetSelect.value = 'standard';
            renderGamepadBindings();
        }
    } else {
        if (confirm("Khôi phục về mặc định chuẩn: P1 dùng WASD + JKLUIO, P2 dùng 4 Mũi tên + Chữ JKLUIO?")) {
            tempBindings = {
                p1Preset: 'option_wasd',
                p2Preset: 'option_arrows_letters',
                p1: JSON.parse(JSON.stringify(KEY_PRESETS.option_wasd)),
                p2: JSON.parse(JSON.stringify(KEY_PRESETS.option_arrows_letters))
            };
            if (presetSelect) presetSelect.value = tempBindings[editingKeyGroup + 'Preset'];
            renderModalBindings();
        }
    }
});

// Escape key hủy gán phím hoặc tay cầm
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (activeRecordingButton) cancelActiveRecording();
        if (activeRecordingGamepadButton) cancelActiveGamepadRecording();
    }
});

// ==========================================
// 9B. ENGINE TAY CẦM (GAMEPAD POLLING & DISPATCH)
// ==========================================
let lastGamepadActionStates = { p1: {}, p2: {} };

function isButtonPressed(gp, bind) {
    if (!gp || !bind) return false;
    if (bind.type === 'button') {
        const btn = gp.buttons[bind.index];
        if (!btn) return false;
        return typeof btn === 'object' ? (btn.pressed || btn.value > 0.5) : btn > 0.5;
    }
    if (bind.type === 'axis') {
        const val = gp.axes[bind.axisIndex];
        if (val === undefined) return false;
        return bind.direction < 0 ? val < -0.5 : val > 0.5;
    }
    return false;
}

function vibrateGamepad(duration = 150, weak = 0.5, strong = 0.5) {
    try {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const gp of gamepads) {
            if (gp && gp.vibrationActuator && typeof gp.vibrationActuator.playEffect === 'function') {
                gp.vibrationActuator.playEffect('dual-rumble', {
                    startDelay: 0,
                    duration: duration,
                    weakMagnitude: weak,
                    strongMagnitude: strong
                }).catch(() => {});
            }
        }
    } catch (e) {}
}

function dispatchActionFromGamepad(targetRole, action, isDown) {
    const eventType = isDown ? 'keydown' : 'keyup';

    // 1. Phím START (Enter / Menu chọn / Bắt đầu trận)
    if (action === 'START') {
        const rawKey = { code: 'Enter', key: 'Enter', keyCode: 13, which: 13 };
        if (targetRole === 'p2' && myRole === 'guest') {
            updateInputHud('p2', 'ATTACK', isDown);
            setGuestKeyAction('ATTACK', isDown);
            setGuestKeyAction('ENTER', isDown);
            if (currentNetcodeMode === 'input_sync') {
                dispatchFlashKeyEvent(eventType, FLASH_NATIVE_KEYS.p2.ATTACK);
                dispatchFlashKeyEvent(eventType, rawKey);
            }
        } else {
            updateInputHud(targetRole, 'ATTACK', isDown);
            dispatchFlashKeyEvent(eventType, FLASH_NATIVE_KEYS[targetRole].ATTACK);
            dispatchFlashKeyEvent(eventType, rawKey);
            if (myRole === 'host') {
                if (currentNetcodeMode === 'input_sync') {
                    setHostP1KeyAction('ATTACK', isDown);
                    setHostP1KeyAction('ENTER', isDown);
                }
                sendFastMessage({
                    type: 'hud_key',
                    role: targetRole,
                    action: 'ATTACK',
                    isActive: isDown
                });
            }
        }
        return;
    }

    // 2. Các hành động thông thường (UP, DOWN, LEFT, RIGHT, ATTACK, JUMP, DASH, SUB, ULTI, ASSIST)
    if (targetRole === 'p1') {
        updateInputHud('p1', action, isDown);
        dispatchFlashKeyEvent(eventType, FLASH_NATIVE_KEYS.p1[action]);
        if (myRole === 'host') {
            if (currentNetcodeMode === 'input_sync') {
                setHostP1KeyAction(action, isDown);
            }
            sendFastMessage({
                type: 'hud_key',
                role: 'p1',
                action: action,
                isActive: isDown
            });
        }
    } else if (targetRole === 'p2') {
        updateInputHud('p2', action, isDown);
        if (myRole === 'guest') {
            setGuestKeyAction(action, isDown);
            if (currentNetcodeMode === 'input_sync') {
                const nativeKey = FLASH_NATIVE_KEYS.p2[action];
                if (nativeKey) dispatchFlashKeyEvent(eventType, nativeKey);
            }
        } else {
            dispatchFlashKeyEvent(eventType, FLASH_NATIVE_KEYS.p2[action]);
        }
    }
}

function updateGamepadToolbarStatus(activeGamepads) {
    if (!btnGamepadStatus || !gamepadStatusText) return;
    if (activeGamepads.length > 0) {
        btnGamepadStatus.classList.add('connected');
        const first = activeGamepads[0];
        let name = first.id || 'Gamepad';
        if (name.length > 18) name = name.substring(0, 16) + '...';
        gamepadStatusText.textContent = `Tay cầm: ${name}`;
    } else {
        btnGamepadStatus.classList.remove('connected');
        gamepadStatusText.textContent = 'Tay cầm: Chưa cắm';
    }
}

function updateGamepadModalUI(activeGamepads) {
    if (!gamepadInfoCard || !gpDeviceTitle || !gpDeviceDesc) return;

    if (activeGamepads.length > 0) {
        gamepadInfoCard.classList.add('connected');
        const gp = activeGamepads[0];
        let cleanId = gp.id || 'Gamepad';
        gpDeviceTitle.textContent = `✅ Đã kết nối: ${cleanId}`;
        gpDeviceDesc.textContent = `Số nút: ${gp.buttons.length} • Cần analog: ${gp.axes.length} trục • Cổng: #${gp.index}`;
        if (btnTestVibration) {
            btnTestVibration.classList.toggle('hidden', !gp.vibrationActuator);
        }

        // Live Button Tester
        if (gpTesterBadges) {
            const activeBadges = [];
            gp.buttons.forEach((btn, idx) => {
                if (btn && (btn.pressed || btn.value > 0.5)) {
                    const name = GAMEPAD_BUTTON_NAMES[idx] || `Nút ${idx}`;
                    activeBadges.push(`<span class="gp-tester-badge">${name}</span>`);
                }
            });
            gp.axes.forEach((val, idx) => {
                if (val < -0.5) {
                    const name = GAMEPAD_AXIS_NAMES[`axis:${idx}:-1`] || `Axis ${idx} -`;
                    activeBadges.push(`<span class="gp-tester-badge">${name}</span>`);
                } else if (val > 0.5) {
                    const name = GAMEPAD_AXIS_NAMES[`axis:${idx}:1`] || `Axis ${idx} +`;
                    activeBadges.push(`<span class="gp-tester-badge">${name}</span>`);
                }
            });

            if (activeBadges.length > 0) {
                gpTesterBadges.innerHTML = activeBadges.join('');
            } else {
                gpTesterBadges.innerHTML = `<span class="gp-empty-hint">Chưa có nút nào đang nhấn...</span>`;
            }
        }
    } else {
        gamepadInfoCard.classList.remove('connected');
        gpDeviceTitle.textContent = 'Chưa phát hiện tay cầm nào';
        gpDeviceDesc.textContent = 'Hãy cắm tay cầm (Xbox, PS4/PS5, Logitech, Dobe, Bluetooth...) và bấm phím bất kỳ trên tay cầm để kích hoạt nhận diện.';
        if (btnTestVibration) btnTestVibration.classList.add('hidden');
        if (gpTesterBadges) {
            gpTesterBadges.innerHTML = `<span class="gp-empty-hint">Vui lòng cắm tay cầm vào máy tính...</span>`;
        }
    }
}

function checkGamepadRecordingInput(activeGamepads) {
    if (!activeRecordingGamepadButton || activeGamepads.length === 0) return;
    const gp = activeGamepads[0];
    const { btn, action } = activeRecordingGamepadButton;

    // Quét kiểm tra nút bấm
    for (let i = 0; i < gp.buttons.length; i++) {
        const b = gp.buttons[i];
        if (b && (b.pressed || b.value > 0.6)) {
            const displayName = GAMEPAD_BUTTON_NAMES[i] || `Nút ${i}`;
            tempGamepadConfig.buttons[action] = {
                type: 'button',
                index: i,
                display: displayName
            };
            tempGamepadConfig.preset = 'custom';
            if (gamepadPresetSelect) gamepadPresetSelect.value = 'custom';
            btn.innerText = displayName;
            btn.classList.remove('recording');
            activeRecordingGamepadButton = null;
            vibrateGamepad(80, 0.4, 0.4);
            return;
        }
    }

    // Quét kiểm tra cần gạt analog
    for (let i = 0; i < gp.axes.length; i++) {
        const val = gp.axes[i];
        if (Math.abs(val) > 0.65) {
            const dir = val < 0 ? -1 : 1;
            const axisKey = `axis:${i}:${dir}`;
            const displayName = GAMEPAD_AXIS_NAMES[axisKey] || `Cần trục ${i} ${dir > 0 ? '+' : '-'}`;
            tempGamepadConfig.buttons[action] = {
                type: 'axis',
                axisIndex: i,
                direction: dir,
                display: displayName
            };
            tempGamepadConfig.preset = 'custom';
            if (gamepadPresetSelect) gamepadPresetSelect.value = 'custom';
            btn.innerText = displayName;
            btn.classList.remove('recording');
            activeRecordingGamepadButton = null;
            vibrateGamepad(80, 0.4, 0.4);
            return;
        }
    }
}

function processGamepadControls(activeGamepads) {
    if (activeGamepads.length === 0) return;

    const targetMode = userGamepadConfig.target || 'auto';

    activeGamepads.forEach((gp, idx) => {
        let assignedRole = null;
        if (targetMode === 'p1') {
            assignedRole = (idx === 0) ? 'p1' : null;
        } else if (targetMode === 'p2') {
            assignedRole = (idx === 0) ? 'p2' : null;
        } else if (targetMode === 'dual') {
            assignedRole = (idx === 0) ? 'p1' : (idx === 1 ? 'p2' : null);
        } else {
            // 'auto': Nếu là Guest thì P2, nếu là Host/Solo thì tay 1 = P1, tay 2 = P2 (nếu có 2 tay)
            if (myRole === 'guest') {
                assignedRole = (idx === 0) ? 'p2' : null;
            } else {
                assignedRole = (idx === 0) ? 'p1' : (idx === 1 ? 'p2' : null);
            }
        }

        if (!assignedRole) return;

        const mapping = userGamepadConfig.buttons;
        if (!mapping) return;

        const currentStates = {};

        // Di chuyển: Hỗ trợ cả D-pad lẫn Cần gạt Analog Trái (Deadzone 0.45)
        currentStates.UP = isButtonPressed(gp, mapping.UP) || (gp.axes[1] !== undefined && gp.axes[1] < -0.45);
        currentStates.DOWN = isButtonPressed(gp, mapping.DOWN) || (gp.axes[1] !== undefined && gp.axes[1] > 0.45);
        currentStates.LEFT = isButtonPressed(gp, mapping.LEFT) || (gp.axes[0] !== undefined && gp.axes[0] < -0.45);
        currentStates.RIGHT = isButtonPressed(gp, mapping.RIGHT) || (gp.axes[0] !== undefined && gp.axes[0] > 0.45);

        // Các chiêu thức & Menu Start
        ['ATTACK', 'JUMP', 'DASH', 'SUB', 'ULTI', 'ASSIST', 'START'].forEach(act => {
            currentStates[act] = isButtonPressed(gp, mapping[act]);
        });

        // Edge detection & dispatch event
        const lastStates = lastGamepadActionStates[assignedRole] || {};
        for (const [action, isDown] of Object.entries(currentStates)) {
            const wasDown = !!lastStates[action];
            if (isDown !== wasDown) {
                dispatchActionFromGamepad(assignedRole, action, isDown);
                lastStates[action] = isDown;
            }
        }
        lastGamepadActionStates[assignedRole] = lastStates;
    });
}

function pollGamepadsLoop() {
    if (navigator.getGamepads) {
        const rawGamepads = navigator.getGamepads();
        const activeGamepads = [];
        for (let i = 0; i < rawGamepads.length; i++) {
            if (rawGamepads[i]) {
                activeGamepads.push(rawGamepads[i]);
            }
        }

        // Cập nhật nhãn Toolbar
        updateGamepadToolbarStatus(activeGamepads);

        const isModalOpen = keyModal && !keyModal.classList.contains('hidden');
        const isGamepadTab = isModalOpen && editingKeyGroup === 'gamepad';

        if (isGamepadTab) {
            updateGamepadModalUI(activeGamepads);
            if (activeRecordingGamepadButton) {
                checkGamepadRecordingInput(activeGamepads);
            }
        }

        // Xử lý nút điều khiển khi không đang bấm gán nút
        if (!activeRecordingGamepadButton) {
            processGamepadControls(activeGamepads);
        }
    }

    requestAnimationFrame(pollGamepadsLoop);
}

// Bắt sự kiện cắm / ngắt tay cầm
window.addEventListener('gamepadconnected', (e) => {
    showSyncNotification(`🎮 Đã kết nối tay cầm: ${e.gamepad.id || 'Gamepad'}!`);
    vibrateGamepad(120, 0.4, 0.4);
});

window.addEventListener('gamepaddisconnected', (e) => {
    showSyncNotification(`🔌 Đã ngắt kết nối tay cầm: ${e.gamepad.id || 'Gamepad'}`);
    ['p1', 'p2'].forEach(role => {
        const lastStates = lastGamepadActionStates[role] || {};
        for (const [action, wasDown] of Object.entries(lastStates)) {
            if (wasDown) {
                dispatchActionFromGamepad(role, action, false);
            }
        }
        lastGamepadActionStates[role] = {};
    });
});

// Render danh sách phím hướng dẫn bên dưới giao diện
function renderGuides() {
    renderGuideList(userKeyBindings.p1, FLASH_NATIVE_KEYS.p1, guideGridP1);
    renderGuideList(userKeyBindings.p2, FLASH_NATIVE_KEYS.p2, guideGridP2);
}

function renderGuideList(userGroup, nativeGroup, container) {
    container.innerHTML = '';

    const moveDiv = document.createElement('div');
    moveDiv.innerHTML = `
        <kbd>${userGroup.UP.display}</kbd>
        <kbd>${userGroup.LEFT.display}</kbd>
        <kbd>${userGroup.DOWN.display}</kbd>
        <kbd>${userGroup.RIGHT.display}</kbd>
        <span>Di chuyển</span>
    `;
    container.appendChild(moveDiv);

    const combatActions = ['ATTACK', 'JUMP', 'DASH', 'SUB', 'ULTI', 'ASSIST'];
    combatActions.forEach(act => {
        const div = document.createElement('div');
        const labelText = ACTION_LABELS[act] || nativeGroup[act].label;
        div.innerHTML = `<kbd>${userGroup[act].display}</kbd><span>${labelText}</span>`;
        container.appendChild(div);
    });

    const gpTip = document.createElement('div');
    gpTip.style.cssText = 'color: #ffaa00; font-size: 0.82rem; margin-top: 4px;';
    gpTip.innerHTML = `<span>🎮 <em>Tay cầm: D-Pad / Analog di chuyển • A: Đánh (J) • B: Nhảy (K) • RB: Lướt (L) • X: Phụ (U) • Y: Ulti (I) • LB: Trợ thủ (O) • Start: Menu</em></span>`;
    container.appendChild(gpTip);
}

// ==========================================
// 10. PHÍM ẢO NHANH (VIRTUAL CONTROLS BAR)
// ==========================================
function setupVirtualControls() {
    const vbtns = document.querySelectorAll('.vbtn[data-key]');
    vbtns.forEach(btn => {
        const keyAction = btn.getAttribute('data-key');

        const press = (e) => {
            e.preventDefault();
            btn.classList.add('vbtn-active');
            if (myRole === 'guest') {
                updateInputHud('p2', keyAction, true);
                setGuestKeyAction(keyAction, true);
            } else {
                dispatchFlashKeyEvent('keydown', FLASH_NATIVE_KEYS.p1[keyAction]);
            }
        };

        const release = (e) => {
            e.preventDefault();
            btn.classList.remove('vbtn-active');
            if (myRole === 'guest') {
                updateInputHud('p2', keyAction, false);
                setGuestKeyAction(keyAction, false);
            } else {
                dispatchFlashKeyEvent('keyup', FLASH_NATIVE_KEYS.p1[keyAction]);
            }
        };

        btn.addEventListener('mousedown', press);
        btn.addEventListener('mouseup', release);
        btn.addEventListener('mouseleave', release);
        btn.addEventListener('touchstart', press, { passive: false });
        btn.addEventListener('touchend', release, { passive: false });
    });
}

// ==========================================
// 10B. MODAL DONATE & SAO CHÉP THÔNG TIN
// ==========================================
function openDonateModal() {
    if (donateModal) {
        donateModal.classList.remove('hidden');
    }
}

function closeDonateModal() {
    if (donateModal) {
        donateModal.classList.add('hidden');
    }
}

if (btnHeaderDonate) btnHeaderDonate.addEventListener('click', openDonateModal);
if (btnFooterDonate) btnFooterDonate.addEventListener('click', openDonateModal);
if (btnOpenDonateModalBanner) btnOpenDonateModalBanner.addEventListener('click', openDonateModal);
if (qrPreviewTrigger) qrPreviewTrigger.addEventListener('click', openDonateModal);

if (btnCloseDonateModal) btnCloseDonateModal.addEventListener('click', closeDonateModal);
if (btnCloseDonateBottom) btnCloseDonateBottom.addEventListener('click', closeDonateModal);

if (donateModal) {
    donateModal.addEventListener('click', (e) => {
        if (e.target === donateModal) {
            closeDonateModal();
        }
    });
}

// Bấm phím Escape đóng modal
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (donateModal && !donateModal.classList.contains('hidden')) {
            closeDonateModal();
        }
    }
});

function copyToClipboard(text, targetEl, successText, originalText) {
    const doUpdate = () => {
        if (targetEl) {
            targetEl.innerText = successText;
            setTimeout(() => {
                targetEl.innerText = originalText;
            }, 2000);
        }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(doUpdate).catch(() => {
            fallbackCopy(text, doUpdate);
        });
    } else {
        fallbackCopy(text, doUpdate);
    }
}

function fallbackCopy(text, callback) {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        if (callback) callback();
    } catch (err) {
        console.warn('Copy fallback failed:', err);
    }
}

if (btnModalCopyStk) {
    btnModalCopyStk.addEventListener('click', () => {
        copyToClipboard('1072917758', btnModalCopyStk, '✓ Đã copy!', '📋 Copy STK');
    });
}

if (btnModalCopyMemo) {
    btnModalCopyMemo.addEventListener('click', () => {
        copyToClipboard('BVN Donate', btnModalCopyMemo, '✓ Đã copy!', '📋 Copy Lời nhắn');
    });
}

if (btnCopyStkBanner) {
    btnCopyStkBanner.addEventListener('click', () => {
        copyToClipboard('1072917758', bannerCopyStkBadge, '✓ Đã copy!', '📋 Copy');
    });
}

// ==========================================
// 10.5. BVN WEB SHELL BRIDGE & MODAL (EXTERNAL INTERFACE)
// Can thiệp mã nguồn game & Chọn tướng HTML5 kiểu Animugen
// ==========================================
const bvnBridge = {
    get api() {
        return (typeof rufflePlayer !== 'undefined' && rufflePlayer?.ruffle) ? rufflePlayer.ruffle(1) : null;
    },
    isReady() {
        return !!this.api && typeof this.api.callExternalInterface === 'function';
    },
    call(methodName, ...args) {
        if (!this.isReady()) {
            console.warn('[BVN Bridge] Flash Ruffle engine chưa sẵn sàng để nhận lệnh:', methodName);
            return null;
        }
        try {
            return this.api.callExternalInterface(methodName, ...args);
        } catch (e) {
            console.error('[BVN Bridge] Lỗi gọi ExternalInterface (' + methodName + '):', e);
            return null;
        }
    },
    startMatch(p1, p2, p1Assist, p2Assist, stage, modo = 3) {
        console.log(`[BVN Bridge] Yêu cầu vào trận đấu: P1=${p1} (+${p1Assist}) vs P2=${p2} (+${p2Assist}) | Map=${stage} | Mode=${modo}`);
        
        // 1. Nếu đang nạp Anime Battle (launch.swf): Gọi ExternalInterface animeRiftStartMatch chuẩn Animugen
        try {
            const req = {
                schemaVersion: 1,
                mode: modo === 2 ? 'cpu' : modo === 4 ? 'training' : 'local',
                p1: Array.isArray(p1) ? p1 : [p1],
                p2: Array.isArray(p2) ? p2 : [p2],
                p1Assist: p1Assist || null,
                p2Assist: p2Assist || null,
                map: stage || 'xianshi',
                bestOf: 3,
                hp: 1,
                time: 60,
                cpuLevel: 3
            };
            const riftRes = this.call('animeRiftStartMatch', JSON.stringify(req));
            if (riftRes && riftRes.ok === true) {
                console.log('[BVN Bridge] animeRiftStartMatch thành công:', riftRes);
                return riftRes;
            }
        } catch (e) {
            console.warn('[BVN Bridge] animeRiftStartMatch error:', e);
        }

        // 2. Thử các callback ExternalInterface chuẩn nếu bản SWF có hỗ trợ
        let res = this.call('startCustomMatch', p1, p2, p1Assist, p2Assist, stage, modo);
        if (res === null) res = this.call('startMatch', p1, p2, p1Assist, p2Assist, stage, modo);
        if (res !== null) {
            console.log('[BVN Bridge] startMatch ExternalInterface thành công ->', res);
            return res;
        }

        // 3. Với bản game.swf (BVN 2.6) chạy trên Flash/Ruffle:
        // Chạy Macro Virtual Driver tự động điều khiển vào thẳng màn hình chiến đấu!
        console.log(`[BVN Bridge] Khởi chạy Macro Virtual Driver tự động chọn tướng & trợ thủ vào trận...`);
        autoEnterBvn26Match(p1, p2, p1Assist, p2Assist);
        return { ok: true, driver: 'macro_bvn26' };
    },
    getBattleState() {
        const raw = this.call('getBattleState');
        if (!raw || typeof raw !== 'string') return null;
        const parts = raw.split('|');
        if (parts[0] === 'fight') {
            return {
                inFight: true,
                p1Hp: Number(parts[1]) || 0,
                p2Hp: Number(parts[2]) || 0,
                maxHp: Number(parts[3]) || 1000,
                p1Wins: Number(parts[4]) || 0,
                p2Wins: Number(parts[5]) || 0,
                rounds: Number(parts[6]) || 1,
                p1: parts[7] || '',
                p2: parts[8] || '',
                stage: parts[9] || '',
                gameTime: Number(parts[10]) || 60
            };
        } else if (parts[0] === 'menu') {
            return {
                inFight: false,
                currentFrame: Number(parts[1]) || 0
            };
        }
        return null;
    },
    endMatchToMenu() {
        return this.call('endMatchToMenu');
    },
    pauseBattle() {
        return this.call('pauseBattle');
    },
    resumeBattle() {
        return this.call('resumeBattle');
    },
    setFighterHp(playerNum, hp) {
        return this.call('setFighterHp', playerNum, hp);
    },
    skipIntro() {
        return this.call('skipIntroToMenu');
    },
    skipIntroToMenu() {
        return this.call('skipIntroToMenu');
    },
};
window.bvnBridge = bvnBridge;

// Macro Virtual Driver tự động điều khiển vào thẳng màn hình chiến đấu cho BVN 2.6
function autoEnterBvn26Match(p1, p2, p1Assist, p2Assist) {
    focusGame();
    const p1Down = FLASH_NATIVE_KEYS.p1.DOWN;
    const p1Confirm = FLASH_NATIVE_KEYS.p1.ATTACK;
    const p2Confirm = FLASH_NATIVE_KEYS.p2.ATTACK;

    // Bước 1: Điều hướng Menu chính xuống mục "Vs Human" (Đấu 2 Người) và bấm chọn
    dispatchFlashKeyEvent('keydown', p1Down);
    setTimeout(() => {
        dispatchFlashKeyEvent('keyup', p1Down);
        dispatchFlashKeyEvent('keydown', p1Confirm);
        setTimeout(() => {
            dispatchFlashKeyEvent('keyup', p1Confirm);

            // Bước 2: Tại màn hình Chọn Tướng, xác nhận Tướng chính P1 & P2
            setTimeout(() => {
                dispatchFlashKeyEvent('keydown', p1Confirm);
                dispatchFlashKeyEvent('keydown', p2Confirm);
                setTimeout(() => {
                    dispatchFlashKeyEvent('keyup', p1Confirm);
                    dispatchFlashKeyEvent('keyup', p2Confirm);

                    // Bước 3: Xác nhận Trợ thủ P1 & P2 ➔ Game vào thẳng trận đấu!
                    setTimeout(() => {
                        dispatchFlashKeyEvent('keydown', p1Confirm);
                        dispatchFlashKeyEvent('keydown', p2Confirm);
                        setTimeout(() => {
                            dispatchFlashKeyEvent('keyup', p1Confirm);
                            dispatchFlashKeyEvent('keyup', p2Confirm);
                            console.log('[Macro BVN 2.6] Đã tự động chọn tướng & trợ thủ vào trận thành công!');
                        }, 100);
                    }, 500);
                }, 100);
            }, 600);
        }, 100);
    }, 150);
}

// Web Shell UI Elements
const btnOpenWebShell = document.getElementById('btnOpenWebShell');
const webShellModal = document.getElementById('webShellModal');
const btnCloseWebShellModal = document.getElementById('btnCloseWebShellModal');
const btnCloseWebShellBottom = document.getElementById('btnCloseWebShellBottom');
const btnWsStartMatch = document.getElementById('btnWsStartMatch');
const btnWsFullHp = document.getElementById('btnWsFullHp');
const btnWsTogglePause = document.getElementById('btnWsTogglePause');
const btnWsEndMatch = document.getElementById('btnWsEndMatch');
const wsLiveStatus = document.getElementById('wsLiveStatus');

let isWsPaused = false;
let wsStatusTimer = null;

function openWebShellModal() {
    if (webShellModal) {
        webShellModal.classList.remove('hidden');
        updateWsLiveStatus();
        if (wsStatusTimer) clearInterval(wsStatusTimer);
        wsStatusTimer = setInterval(updateWsLiveStatus, 1000);
    }
}

function closeWebShellModal() {
    if (webShellModal) {
        webShellModal.classList.add('hidden');
        if (wsStatusTimer) {
            clearInterval(wsStatusTimer);
            wsStatusTimer = null;
        }
    }
}

function updateWsLiveStatus() {
    if (!wsLiveStatus) return;
    if (!bvnBridge.isReady()) {
        wsLiveStatus.innerText = 'Trạng thái: Đang nạp engine Ruffle...';
        wsLiveStatus.style.color = '#ffaa00';
        return;
    }
    const state = bvnBridge.getBattleState();
    if (!state) {
        wsLiveStatus.innerText = 'Trạng thái: Sẵn sàng ở Menu Flash';
        wsLiveStatus.style.color = '#00e676';
    } else if (state.inFight) {
        wsLiveStatus.innerText = `Đang thi đấu: P1 HP: ${state.p1Hp}/${state.maxHp} | P2 HP: ${state.p2Hp}/${state.maxHp} | Hiệp ${state.rounds}`;
        wsLiveStatus.style.color = '#00bfff';
    } else {
        wsLiveStatus.innerText = `Trạng thái: Menu chính (Frame ${state.currentFrame})`;
        wsLiveStatus.style.color = '#00e676';
    }
}

if (btnOpenWebShell) btnOpenWebShell.addEventListener('click', openWebShellModal);
if (btnCloseWebShellModal) btnCloseWebShellModal.addEventListener('click', closeWebShellModal);
if (btnCloseWebShellBottom) btnCloseWebShellBottom.addEventListener('click', closeWebShellModal);

if (webShellModal) {
    webShellModal.addEventListener('click', (e) => {
        if (e.target === webShellModal) closeWebShellModal();
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && webShellModal && !webShellModal.classList.contains('hidden')) {
        closeWebShellModal();
    }
});

// Nút Bắt Đầu Trận Đấu từ Web Shell
if (btnWsStartMatch) {
    btnWsStartMatch.addEventListener('click', () => {
        const p1 = document.getElementById('wsP1Fighter')?.value || '一护';
        const p2 = document.getElementById('wsP2Fighter')?.value || '鸣人';
        const p1Assist = document.getElementById('wsP1Assist')?.value || '夜一';
        const p2Assist = document.getElementById('wsP2Assist')?.value || '我爱罗';
        const stage = document.getElementById('wsStageSelect')?.value || '火影瀑布';
        const modoRadio = document.querySelector('input[name="wsModo"]:checked');
        const modo = modoRadio ? Number(modoRadio.value) : 3;

        console.log(`[Web Shell] Khởi động trận đấu: P1=${p1} (+${p1Assist}) vs P2=${p2} (+${p2Assist}) | Map=${stage} | Mode=${modo}`);
        
        // Gọi bridge Flash
        bvnBridge.startMatch(p1, p2, p1Assist, p2Assist, stage, modo);

        // Đồng bộ cho Khách nếu là Host
        if (myRole === 'host') {
            sendFastMessage({
                type: 'sync_start_match',
                p1, p2, p1Assist, p2Assist, stage, modo
            });
        }

        // Đóng modal và lấy tiêu điểm game
        closeWebShellModal();
        focusGame();
    });
}

// Bơm đầy máu cho cả 2 bên (Cheat)
if (btnWsFullHp) {
    btnWsFullHp.addEventListener('click', () => {
        bvnBridge.setFighterHp(1, 1000);
        bvnBridge.setFighterHp(2, 1000);
        if (myRole === 'host') {
            sendFastMessage({ type: 'sync_bridge_action', action: 'set_hp', player: 1, hp: 1000 });
            sendFastMessage({ type: 'sync_bridge_action', action: 'set_hp', player: 2, hp: 1000 });
        }
        updateWsLiveStatus();
    });
}

// Tạm dừng / Tiếp tục
if (btnWsTogglePause) {
    btnWsTogglePause.addEventListener('click', () => {
        if (!isWsPaused) {
            bvnBridge.pauseBattle();
            isWsPaused = true;
            btnWsTogglePause.innerText = '▶️ Tiếp Tục Trận Đấu';
            if (myRole === 'host') {
                sendFastMessage({ type: 'sync_bridge_action', action: 'pause' });
            }
        } else {
            bvnBridge.resumeBattle();
            isWsPaused = false;
            btnWsTogglePause.innerText = '⏸️ Tạm Dừng Trận Đấu';
            if (myRole === 'host') {
                sendFastMessage({ type: 'sync_bridge_action', action: 'resume' });
            }
        }
        updateWsLiveStatus();
    });
}

// Về Menu Chính
if (btnWsEndMatch) {
    btnWsEndMatch.addEventListener('click', () => {
        bvnBridge.endMatchToMenu();
        if (myRole === 'host') {
            sendFastMessage({ type: 'sync_bridge_action', action: 'end_match' });
        }
        updateWsLiveStatus();
    });
}

// ==========================================
// 10B. SẢNH CHỌN TƯỚNG BAN/PICK ESPORTS (DRAFT LOBBY)
// ==========================================
const BAN_PICK_ROSTER = {
    bleach: [
        { id: '一护', name: 'Ichigo Kurosaki', sub: 'Thần Chết', icon: '🗡️' },
        { id: '一护万解', name: 'Ichigo Bankai', sub: 'Vạn Giải', icon: '⚡' },
        { id: '一护虚化', name: 'Ichigo Hollow', sub: 'Mặt Nạ Hư', icon: '🎭' },
        { id: '白一护', name: 'White Ichigo', sub: 'Bạch Nguyệt', icon: '⚪' },
        { id: '牛头白一护', name: 'Vasto Lorde', sub: 'Hư Vương', icon: '👹' },
        { id: '露其雅', name: 'Rukia Kuchiki', sub: 'Tuyết Hoa', icon: '❄️' },
        { id: '露其雅始解', name: 'Rukia Shikai', sub: 'Băng Vũ', icon: '🌨️' },
        { id: '日番谷', name: 'Hitsugaya', sub: 'Đội Trưởng 10', icon: '🧊' },
        { id: '日番谷万解', name: 'Hitsugaya Bankai', sub: 'Đại Hồng Liên', icon: '🐉' },
        { id: '白哉', name: 'Byakuya', sub: 'Thiên Bản Anh', icon: '🌸' },
        { id: '恋次', name: 'Renji Abarai', sub: 'Xà Vĩ Hoàn', icon: '🐍' },
        { id: '银', name: 'Gin Ichimaru', sub: 'Thần Thương', icon: '🗡️' },
        { id: '蓝染', name: 'Aizen Sosuke', sub: 'Kính Hoa Thủy Nguyệt', icon: '👓' },
        { id: '剑八', name: 'Kenpachi', sub: 'Đội 11 Quỷ Kiếm', icon: '⚔️' },
        { id: '小乌', name: 'Ulquiorra', sub: 'Espada No.4', icon: '🦇' },
        { id: '碎蜂', name: 'Soi Fon', sub: 'Tước Phong', icon: '🐝' },
        { id: '葛力姆乔', name: 'Grimmjow', sub: 'Espada No.6', icon: '🐾' },
        { id: '蒂雅', name: 'Harribel', sub: 'Espada No.3', icon: '🦈' },
        { id: '史塔克', name: 'Coyote Starrk', sub: 'Espada No.1', icon: '🐺' },
        { id: '茶渡', name: 'Yasutora Chad', sub: 'Cự Thần Tí', icon: '🥊' },
        { id: '石田', name: 'Uryu Ishida', sub: 'Diệt Khước Sư', icon: '🏹' },
        { id: '一角', name: 'Ikkaku', sub: 'Nhất Giác', icon: '🎋' },
        { id: '涅茧利', name: 'Mayuri', sub: 'KHOA HỌC GIA', icon: '🧪' }
    ],
    naruto: [
        { id: '鸣人', name: 'Naruto Uzumaki', sub: 'Hokage 7', icon: '🍥' },
        { id: '仙鸣', name: 'Naruto Tiên Nhân', sub: 'Hiền Nhân Cóc', icon: '🐸' },
        { id: '鸣人九尾', name: 'Naruto 1 Vĩ', sub: 'Áo Vĩ Thú', icon: '🦊' },
        { id: '鸣人九尾实体', name: 'Naruto 4 Vĩ', sub: 'Hắc Vĩ Cuồng', icon: '💥' },
        { id: '黄金鸣人', name: 'Golden Naruto', sub: 'Chakra Cửu Vĩ', icon: '✨' },
        { id: '佐助', name: 'Sasuke Uchiha', sub: 'Chidori Lôi', icon: '⚡' },
        { id: '佐助咒怨', name: 'Sasuke Chú Ấn', sub: 'Nguyền Ấn', icon: '🦅' },
        { id: '须佐佐助', name: 'Sasuke Susanoo', sub: 'Vạn Hoa Đồng', icon: '👁️' },
        { id: '卡卡西', name: 'Kakashi Hatake', sub: 'Sharingan', icon: '📖' },
        { id: '小樱', name: 'Sakura Haruno', sub: 'Bách Hào Ấn', icon: '🌸' },
        { id: '李洛克', name: 'Rock Lee', sub: 'Bát Môn', icon: '🥋' },
        { id: '我爱罗', name: 'Gaara', sub: 'Kazekage Cát', icon: '🏺' },
        { id: '日向宁次', name: 'Neji Hyuga', sub: 'Bát Quái Chưởng', icon: '☯️' },
        { id: '自来也', name: 'Jiraiya', sub: 'Hao Kiệt Cóc', icon: '📜' },
        { id: '鼬', name: 'Itachi Uchiha', sub: 'Tsukuyomi', icon: '🐦' },
        { id: '佩恩', name: 'Pain Lục Đạo', sub: 'Thần La Thiên Chinh', icon: '🪐' },
        { id: '斑', name: 'Madara Uchiha', sub: 'Chiến Thần', icon: '🔥' },
        { id: '四代', name: 'Minato Namikaze', sub: 'Tia Chớp Vàng', icon: '⚡' },
        { id: '佐井', name: 'Sai', sub: 'Họa Thú', icon: '🖌️' },
        { id: '大蛇丸', name: 'Orochimaru', sub: 'Bạch Xà Tam Nin', icon: '🐍' },
        { id: '水月', name: 'Suigetsu', sub: 'Thủy Hóa Kiếm', icon: '💧' },
        { id: '迪达拉', name: 'Deidara', sub: 'Nổ Tung', icon: '💣' }
    ],
    guest: [
        { id: '剑心', name: 'Kenshin Himura', sub: 'Phi Thiên Ngự Kiếm', icon: '🗡️' },
        { id: '志志雄', name: 'Shishio Makoto', sub: 'Hỏa Kiếm Vô Hạn', icon: '🔥' }
    ],
    assist: [
        { id: '夜一', name: 'Yoruichi (Trợ thủ)', sub: 'Thuấn Thần Lôi Điện', icon: '⚡' },
        { id: '我爱罗', name: 'Gaara (Trợ thủ)', sub: 'Khiên Sa Bảo Vệ', icon: '🏺' },
        { id: '自来也', name: 'Jiraiya (Trợ thủ)', sub: 'Châm Địa Ngục', icon: '🐸' },
        { id: '井上', name: 'Orihime (Trợ thủ)', sub: 'Thuẫn Hồi Sinh', icon: '🛡️' },
        { id: '石田', name: 'Ishida (Trợ thủ)', sub: 'Mưa Tên Khí Công', icon: '🏹' },
        { id: '手鞠', name: 'Temari (Trợ thủ)', sub: 'Cuồng Phong Quạt', icon: '🌪️' },
        { id: '天天', name: 'Tenten (Trợ thủ)', sub: 'Bách Khí Liêm Đao', icon: '🗡️' },
        { id: '松本', name: 'Matsumoto (Trợ thủ)', sub: 'Tro Tàn Phủ Kín', icon: '🌫️' },
        { id: '纲手', name: 'Tsunade (Trợ thủ)', sub: 'Cấp Cứu Trị Liệu', icon: '💚' },
        { id: '土影', name: 'Ohnoki (Trợ thủ)', sub: 'Trần Độn Nguyên Tử', icon: '🪨' },
        { id: '雏田', name: 'Hinata (Trợ thủ)', sub: 'Bảo Hộ Nhu Quyền', icon: '💜' },
        { id: '八千流', name: 'Yachiru (Trợ thủ)', sub: 'Kẹo Ngọt Cổ Động', icon: '🍬' },
        { id: '涅音梦', name: 'Nemu (Trợ thủ)', sub: 'Dược Liệu Hồi Phục', icon: '💉' },
        { id: '魂', name: 'Kon (Trợ thủ)', sub: 'Thú Bông Cản Đòn', icon: '🦁' }
    ]
};

const banPickModal = document.getElementById('banPickModal');
const btnOpenBanPick = document.getElementById('btnOpenBanPick');
const btnCloseBanPickModal = document.getElementById('btnCloseBanPickModal');
const btnCloseBanPickBottom = document.getElementById('btnCloseBanPickBottom');
const btnLockP1 = document.getElementById('btnLockP1');
const btnLockP2 = document.getElementById('btnLockP2');
const btnLaunchMatch = document.getElementById('btnLaunchMatch');
const bpStageSelect = document.getElementById('bpStageSelect');
const bpSearchInput = document.getElementById('bpSearchInput');
const bpGridContainer = document.getElementById('bpGridContainer');
const bpCenterHint = document.getElementById('bpCenterHint');
const bpP1FighterSlot = document.getElementById('bpP1FighterSlot');
const bpP1AssistSlot = document.getElementById('bpP1AssistSlot');
const bpP2FighterSlot = document.getElementById('bpP2FighterSlot');
const bpP2AssistSlot = document.getElementById('bpP2AssistSlot');
const bpP1AssistAvatar = document.getElementById('bpP1AssistAvatar');
const bpP2AssistAvatar = document.getElementById('bpP2AssistAvatar');

let bpActiveSlot = 'fighter'; // 'fighter' hoặc 'assist'
let autoLaunchTimer = null;

let bpState = {
    p1: { fighter: '一护', assist: '夜一', locked: false },
    p2: { fighter: '鸣人', assist: '我爱罗', locked: false },
    stage: '火影瀑布',
    currentTab: 'bleach',
    searchQuery: ''
};

function findRosterItem(id) {
    for (const cat of Object.values(BAN_PICK_ROSTER)) {
        const found = cat.find(item => item.id === id);
        if (found) return found;
    }
    return { id, name: id, sub: '', icon: '👤' };
}

function switchBpTab(tabName) {
    bpState.currentTab = tabName;
    document.querySelectorAll('.bp-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tabName);
    });
    renderBanPickGrid();
}

function updateBpUi() {
    if (!banPickModal) return;

    // Cập nhật P1 Card
    const p1Fighter = findRosterItem(bpState.p1.fighter);
    const p1Assist = findRosterItem(bpState.p1.assist);
    const p1Avatar = document.getElementById('bpP1Avatar');
    const p1Name = document.getElementById('bpP1Name');
    const p1AssistLabel = document.getElementById('bpP1AssistLabel');
    const p1Status = document.getElementById('bpP1Status');

    if (p1Avatar) p1Avatar.innerText = p1Fighter.icon || '🗡️';
    if (p1Name) p1Name.innerText = p1Fighter.name;
    if (bpP1AssistAvatar) bpP1AssistAvatar.innerText = p1Assist.icon || '⚡';
    if (p1AssistLabel) p1AssistLabel.innerText = p1Assist.name;

    // Highlight slot đang chọn của P1
    if (bpP1FighterSlot) bpP1FighterSlot.classList.toggle('active', bpActiveSlot === 'fighter');
    if (bpP1AssistSlot) bpP1AssistSlot.classList.toggle('active', bpActiveSlot === 'assist');

    if (p1Status) {
        if (bpState.p1.locked) {
            p1Status.innerText = '✓ ĐÃ KHÓA TƯỚNG & TRỢ THỦ';
            p1Status.classList.add('locked');
        } else {
            p1Status.innerText = (bpActiveSlot === 'assist') ? 'Đang chọn Trợ thủ...' : 'Đang chọn Tướng chính...';
            p1Status.classList.remove('locked');
        }
    }
    if (btnLockP1) {
        if (bpState.p1.locked) {
            btnLockP1.innerText = '✓ Đã Khóa (P1)';
            btnLockP1.classList.add('locked');
            btnLockP1.disabled = true;
        } else {
            btnLockP1.innerText = '🔒 Khóa Tướng & Trợ Thủ (P1)';
            btnLockP1.classList.remove('locked');
            btnLockP1.disabled = (myRole === 'guest');
        }
    }

    // Cập nhật P2 Card
    const p2Fighter = findRosterItem(bpState.p2.fighter);
    const p2Assist = findRosterItem(bpState.p2.assist);
    const p2Avatar = document.getElementById('bpP2Avatar');
    const p2Name = document.getElementById('bpP2Name');
    const p2AssistLabel = document.getElementById('bpP2AssistLabel');
    const p2Status = document.getElementById('bpP2Status');

    if (p2Avatar) p2Avatar.innerText = p2Fighter.icon || '🦊';
    if (p2Name) p2Name.innerText = p2Fighter.name;
    if (bpP2AssistAvatar) bpP2AssistAvatar.innerText = p2Assist.icon || '🏺';
    if (p2AssistLabel) p2AssistLabel.innerText = p2Assist.name;

    // Highlight slot đang chọn của P2
    if (bpP2FighterSlot) bpP2FighterSlot.classList.toggle('active', bpActiveSlot === 'fighter');
    if (bpP2AssistSlot) bpP2AssistSlot.classList.toggle('active', bpActiveSlot === 'assist');

    if (p2Status) {
        if (bpState.p2.locked) {
            p2Status.innerText = '✓ ĐÃ KHÓA TƯỚNG & TRỢ THỦ';
            p2Status.classList.add('locked');
        } else {
            p2Status.innerText = (bpActiveSlot === 'assist') ? 'Đang chọn Trợ thủ...' : 'Đang chọn Tướng chính...';
            p2Status.classList.remove('locked');
        }
    }
    if (btnLockP2) {
        if (bpState.p2.locked) {
            btnLockP2.innerText = '✓ Đã Khóa (P2)';
            btnLockP2.classList.add('locked');
            btnLockP2.disabled = true;
        } else {
            btnLockP2.innerText = '🔒 Khóa Tướng & Trợ Thủ (P2)';
            btnLockP2.classList.remove('locked');
            btnLockP2.disabled = (myRole === 'host');
        }
    }

    // Cập nhật Map
    if (bpStageSelect && bpStageSelect.value !== bpState.stage) {
        bpStageSelect.value = bpState.stage;
    }

    // Cập nhật nút Xuất trận & Tự động vào game bằng lệnh khi 2 bên đã khóa xong
    const bothLocked = bpState.p1.locked && bpState.p2.locked;
    if (btnLaunchMatch) {
        if (bothLocked) {
            btnLaunchMatch.disabled = false;
            btnLaunchMatch.classList.add('ready');
            if (bpCenterHint) bpCenterHint.innerText = '🔥 2 bên đã khóa Tướng & Trợ thủ! Đang vào trận bằng lệnh...';

            // Đếm ngược 3 giây tự động vào trận nếu là Host
            if (myRole === 'host' && !autoLaunchTimer) {
                let countdown = 3;
                btnLaunchMatch.innerText = `⚔️ VÀO TRẬN SAU (${countdown}s)...`;
                autoLaunchTimer = setInterval(() => {
                    countdown--;
                    if (countdown > 0) {
                        btnLaunchMatch.innerText = `⚔️ VÀO TRẬN SAU (${countdown}s)...`;
                    } else {
                        clearInterval(autoLaunchTimer);
                        autoLaunchTimer = null;
                        launchMatchNow();
                    }
                }, 1000);
            } else if (myRole === 'guest') {
                btnLaunchMatch.innerText = '⏳ CHỜ HOST XUẤT TRẬN...';
            }
        } else {
            if (autoLaunchTimer) {
                clearInterval(autoLaunchTimer);
                autoLaunchTimer = null;
            }
            btnLaunchMatch.disabled = true;
            btnLaunchMatch.classList.remove('ready');
            btnLaunchMatch.innerText = '⚔️ XUẤT TRẬN (VÀO GAME)';
            if (bpCenterHint) bpCenterHint.innerText = 'Chọn Tướng + Trợ thủ rồi bấm Khóa để vào trận';
        }
    }

    renderBanPickGrid();
}

function renderBanPickGrid() {
    if (!bpGridContainer) return;
    bpGridContainer.innerHTML = '';

    const list = BAN_PICK_ROSTER[bpState.currentTab] || [];
    const query = (bpState.searchQuery || '').toLowerCase().trim();

    const filtered = list.filter(item => {
        if (!query) return true;
        return item.name.toLowerCase().includes(query) || item.sub.toLowerCase().includes(query) || item.id.toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
        bpGridContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #888; padding: 20px;">Không tìm thấy nhân vật phù hợp</div>`;
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = 'bp-item-card';

        const isAssist = (bpState.currentTab === 'assist');
        const isSelectedP1 = isAssist ? (bpState.p1.assist === item.id) : (bpState.p1.fighter === item.id);
        const isSelectedP2 = isAssist ? (bpState.p2.assist === item.id) : (bpState.p2.fighter === item.id);

        if (isSelectedP1) card.classList.add('selected-p1');
        if (isSelectedP2) card.classList.add('selected-p2');

        card.innerHTML = `
            <div class="bp-item-icon">${item.icon || '👤'}</div>
            <div class="bp-item-name" title="${item.name}">${item.name}</div>
            <div class="bp-item-sub">${item.sub}</div>
        `;

        card.addEventListener('click', () => {
            selectRosterItem(item.id, isAssist);
        });

        bpGridContainer.appendChild(card);
    });
}

function selectRosterItem(id, isAssistItem) {
    const isTargetAssist = isAssistItem || (bpActiveSlot === 'assist');

    if (myRole === 'guest') {
        if (bpState.p2.locked) return;
        if (isTargetAssist) {
            bpState.p2.assist = id;
            showSyncNotification(`🔵 P2 đã chọn Trợ thủ: ${findRosterItem(id).name}! Bấm Khóa để sẵn sàng.`);
        } else {
            bpState.p2.fighter = id;
            // Tự động chuyển tiếp sang chọn Trợ thủ cho người chơi!
            bpActiveSlot = 'assist';
            switchBpTab('assist');
            showSyncNotification(`🔵 P2 đã chọn: ${findRosterItem(id).name}! Tiếp theo hãy chọn Trợ thủ.`);
        }
        sendFastMessage({ type: 'bp_select', role: 'p2', fighter: bpState.p2.fighter, assist: bpState.p2.assist });
    } else {
        if (bpState.p1.locked) return;
        if (isTargetAssist) {
            bpState.p1.assist = id;
            showSyncNotification(`🔴 P1 đã chọn Trợ thủ: ${findRosterItem(id).name}! Bấm Khóa để sẵn sàng.`);
        } else {
            bpState.p1.fighter = id;
            // Tự động chuyển tiếp sang chọn Trợ thủ cho người chơi!
            bpActiveSlot = 'assist';
            switchBpTab('assist');
            showSyncNotification(`🔴 P1 đã chọn: ${findRosterItem(id).name}! Tiếp theo hãy chọn Trợ thủ.`);
        }
        if (myRole === 'host') {
            sendFastMessage({ type: 'bp_select', role: 'p1', fighter: bpState.p1.fighter, assist: bpState.p1.assist });
        }
    }
    updateBpUi();
}

function handleRemoteBanPickSelect(data) {
    if (data.role === 'p1') {
        if (data.fighter) bpState.p1.fighter = data.fighter;
        if (data.assist) bpState.p1.assist = data.assist;
    } else if (data.role === 'p2') {
        if (data.fighter) bpState.p2.fighter = data.fighter;
        if (data.assist) bpState.p2.assist = data.assist;
    }
    if (data.stage) bpState.stage = data.stage;
    updateBpUi();
}

function handleRemoteBanPickLock(data) {
    if (data.role === 'p1') bpState.p1.locked = true;
    if (data.role === 'p2') bpState.p2.locked = true;
    updateBpUi();
}

function openBanPickModal() {
    if (banPickModal) {
        banPickModal.classList.remove('hidden');
        updateBpUi();
    }
}

function closeBanPickModal() {
    if (banPickModal) banPickModal.classList.add('hidden');
}

// Bắt sự kiện click vào Slot Tướng / Trợ thủ trên thẻ người chơi
if (bpP1FighterSlot) {
    bpP1FighterSlot.addEventListener('click', () => {
        if (myRole === 'guest' || bpState.p1.locked) return;
        bpActiveSlot = 'fighter';
        if (bpState.currentTab === 'assist') switchBpTab('bleach');
        updateBpUi();
    });
}
if (bpP1AssistSlot) {
    bpP1AssistSlot.addEventListener('click', () => {
        if (myRole === 'guest' || bpState.p1.locked) return;
        bpActiveSlot = 'assist';
        switchBpTab('assist');
        updateBpUi();
    });
}
if (bpP2FighterSlot) {
    bpP2FighterSlot.addEventListener('click', () => {
        if (myRole === 'host' || bpState.p2.locked) return;
        bpActiveSlot = 'fighter';
        if (bpState.currentTab === 'assist') switchBpTab('naruto');
        updateBpUi();
    });
}
if (bpP2AssistSlot) {
    bpP2AssistSlot.addEventListener('click', () => {
        if (myRole === 'host' || bpState.p2.locked) return;
        bpActiveSlot = 'assist';
        switchBpTab('assist');
        updateBpUi();
    });
}

// Bắt sự kiện UI Ban/Pick
if (btnOpenBanPick) btnOpenBanPick.addEventListener('click', openBanPickModal);
if (btnCloseBanPickModal) btnCloseBanPickModal.addEventListener('click', closeBanPickModal);
if (btnCloseBanPickBottom) btnCloseBanPickBottom.addEventListener('click', closeBanPickModal);

if (banPickModal) {
    banPickModal.addEventListener('click', (e) => {
        if (e.target === banPickModal) closeBanPickModal();
    });
}

document.querySelectorAll('.bp-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
        const tab = tabBtn.dataset.tab || 'bleach';
        bpActiveSlot = (tab === 'assist') ? 'assist' : 'fighter';
        switchBpTab(tab);
        updateBpUi();
    });
});

if (bpSearchInput) {
    bpSearchInput.addEventListener('input', (e) => {
        bpState.searchQuery = e.target.value;
        renderBanPickGrid();
    });
}

if (bpStageSelect) {
    bpStageSelect.addEventListener('change', (e) => {
        bpState.stage = e.target.value;
        if (myRole === 'host') {
            sendFastMessage({ type: 'bp_select', role: 'p1', stage: bpState.stage });
        }
    });
}

if (btnLockP1) {
    btnLockP1.addEventListener('click', () => {
        if (myRole === 'guest') return;
        bpState.p1.locked = true;
        updateBpUi();
        if (myRole === 'host') {
            sendFastMessage({ type: 'bp_lock', role: 'p1' });
        }
    });
}

if (btnLockP2) {
    btnLockP2.addEventListener('click', () => {
        if (myRole === 'host') return;
        bpState.p2.locked = true;
        updateBpUi();
        sendFastMessage({ type: 'bp_lock', role: 'p2' });
    });
}

function launchMatchNow() {
    if (autoLaunchTimer) {
        clearInterval(autoLaunchTimer);
        autoLaunchTimer = null;
    }
    console.log(`[Ban/Pick] Xuất trận trực tiếp: P1=${bpState.p1.fighter} (+${bpState.p1.assist}) vs P2=${bpState.p2.fighter} (+${bpState.p2.assist}) | Stage=${bpState.stage}`);

    // Gọi bridge Flash để vào game thẳng bằng lệnh
    if (window.bvnBridge && typeof window.bvnBridge.startMatch === 'function') {
        window.bvnBridge.startMatch(bpState.p1.fighter, bpState.p2.fighter, bpState.p1.assist, bpState.p2.assist, bpState.stage, 3);
    }

    // Gửi lệnh đồng bộ cho Khách
    sendFastMessage({
        type: 'sync_start_match',
        p1: bpState.p1.fighter,
        p2: bpState.p2.fighter,
        p1Assist: bpState.p1.assist,
        p2Assist: bpState.p2.assist,
        stage: bpState.stage,
        modo: 3
    });

    closeBanPickModal();
    focusGame();
    showSyncNotification(`⚔️ ĐÃ VÀO TRẬN ĐẤU: ${findRosterItem(bpState.p1.fighter).name} vs ${findRosterItem(bpState.p2.fighter).name}!`);
}

if (btnLaunchMatch) {
    btnLaunchMatch.addEventListener('click', () => {
        if (myRole === 'guest') return; // Chỉ Host mới có quyền bấm xuất trận
        if (!bpState.p1.locked || !bpState.p2.locked) {
            alert('Cả 2 đấu thủ cần chọn đủ Tướng + Trợ thủ và bấm Khóa trước khi xuất trận!');
            return;
        }
        launchMatchNow();
    });
}

// ==========================================
// 11. KHỞI ĐỘNG
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    setNetcodeMode(currentNetcodeMode, false);
    wakeUpSignalingServer();
    renderGuides();
    syncHudKeyLabels();
    setupVirtualControls();
    initRuffleGame();
    pollGamepadsLoop(); // Bắt đầu vòng lặp đọc dữ liệu tay cầm 60FPS

    // Hỗ trợ tự kết nối khi mở qua link mời (?room=bvn-xxxx)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        inputRoomCode.value = roomParam;
        setTimeout(() => {
            joinRoomAsGuest(roomParam);
        }, 800);
    }
});
