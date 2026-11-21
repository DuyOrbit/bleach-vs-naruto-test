// ==========================================
// NVB ARENA — 4-SCREEN ESPORTS UI & BAN/PICK DRAFT SYSTEM
// ==========================================
(function () {
    const ANIMUGEN_MEDIA = 'https://animugen.vercel.app';

    const state = {
        screen: 1, // 1: Chọn phiên bản | 2: Chọn chế độ | 3: Phòng đấu | 4: Cấm & chọn
        edition: 'bvn26', // 'bvn26' | '500'
        mode: '1v1', // '1v1' | '3v3' | 'training'
        roomCode: 'NVB • 8X2K',
        playerName: 'Kuro',
        playerTag: '#0281',
        opponentName: 'Shinigami',
        lang: 'VI',
        settings: {
            format: 'BO3 · Thắng 2 / 3',
            banPick: true,
            turnTime: 30,
            allowMirror: false
        },
        chat: [
            { sender: 'Hệ thống', color: '#99A5B8', text: 'Shinigami đã tham gia phòng.' },
            { sender: 'Kuro', color: '#FFB547', text: 'Đấu BO3 nhé, cấm chọn cho căng!' },
            { sender: 'Shinigami', color: '#65C8FF', text: 'Ok, sẵn sàng rồi 🔥' }
        ],
        draft: {
            phase: 'ban', // 'ban' | 'pick' | 'assist' | 'ready'
            tab: 'fighter', // 'fighter' | 'assist'
            search: '',
            universe: 'all',
            onlyAvailable: false,
            timer: 30,
            timerId: null,
            p1Bans: [],
            p2Bans: [],
            p1Picks: ['鸣人'],
            p2Picks: ['一护'],
            p1Assist: null,
            p2Assist: null,
            selectedCandidate: '鸣人',
            p1Locked: false,
            p2Locked: true
        },
        tceamCatalog: null
    };

    function getFighters() {
        if (state.edition === '500' && state.tceamCatalog) {
            return (state.tceamCatalog.entries || [])
                .filter(e => e.kind === 'fighter' && e.available && e.selectable !== false)
                .slice(0, 120)
                .map(e => ({
                    id: e.id,
                    name: e.name,
                    universe: e.seriesId || 'other',
                    role: e.powerTier || 'Đấu sĩ',
                    avatar: e.portrait ? (e.portrait.startsWith('http') ? e.portrait : ANIMUGEN_MEDIA + e.portrait) : 'assets/avatars/naruto.png'
                }));
        }
        const r = window.BVN_MASTER_ROSTER;
        if (!r) return [];
        return [
            ...r.naruto.map(c => ({ id: c.id, name: c.name, universe: 'naruto', role: c.sub, avatar: c.avatar || 'assets/avatars/naruto.png' })),
            ...r.bleach.map(c => ({ id: c.id, name: c.name, universe: 'bleach', role: c.sub, avatar: c.avatar || 'assets/avatars/ichigo.png' })),
            ...r.guest.map(c => ({ id: c.id, name: c.name, universe: 'guest', role: c.sub, avatar: c.avatar || 'assets/avatars/byakuya.png' }))
        ];
    }

    function getAssists() {
        if (state.edition === '500' && state.tceamCatalog) {
            const list = (state.tceamCatalog.entries || []).filter(e => e.kind === 'assist' && e.available);
            if (list.length) {
                return list.map(e => ({
                    id: e.id,
                    name: e.name,
                    universe: e.seriesId || 'other',
                    role: 'Hỗ trợ',
                    avatar: e.portrait ? (e.portrait.startsWith('http') ? e.portrait : ANIMUGEN_MEDIA + e.portrait) : 'assets/avatars/assist_yoruichi.png'
                }));
            }
        }
        const r = window.BVN_MASTER_ROSTER;
        if (!r) return [];
        return r.assist.map(a => ({ id: a.id, name: a.name, universe: 'assist', role: a.sub, avatar: a.avatar || 'assets/avatars/assist_yoruichi.png' }));
    }

    function findChar(id) {
        return getFighters().find(c => c.id === id) || getAssists().find(a => a.id === id) || null;
    }

    async function ensureTceamCatalog() {
        if (state.tceamCatalog) return;
        try {
            const res = await fetch('assets/tceam-catalog.json');
            if (res.ok) state.tceamCatalog = await res.json();
        } catch (_) {}
    }

    function stopTimer() {
        if (state.draft.timerId) {
            clearInterval(state.draft.timerId);
            state.draft.timerId = null;
        }
    }

    function startDraftTimer() {
        stopTimer();
        state.draft.timer = Number(state.settings.turnTime) || 30;
        state.draft.timerId = setInterval(() => {
            if (state.screen !== 4 || state.draft.phase === 'ready') {
                stopTimer();
                return;
            }
            state.draft.timer--;
            const el = document.getElementById('nvbTimerValue');
            if (el) el.innerText = '00:' + String(Math.max(0, state.draft.timer)).padStart(2, '0');
            if (state.draft.timer <= 0) {
                handleConfirmAction();
            }
        }, 1000);
    }

    function resetDraft() {
        const fighters = getFighters();
        const firstP1 = fighters.find(f => f.id === '鸣人')?.id || fighters[0]?.id || '鸣人';
        const firstP2 = fighters.find(f => f.id === '一护')?.id || fighters[1]?.id || '一护';
        state.draft.phase = state.settings.banPick ? 'ban' : 'pick';
        state.draft.tab = 'fighter';
        state.draft.p1Bans = [];
        state.draft.p2Bans = [];
        state.draft.p1Picks = [firstP1];
        state.draft.p2Picks = [firstP2];
        state.draft.p1Assist = null;
        state.draft.p2Assist = null;
        state.draft.selectedCandidate = firstP1;
        state.draft.p1Locked = false;
        state.draft.p2Locked = true;
        startDraftTimer();
    }

    function autoOpponentBans() {
        const fighters = getFighters();
        const taken = new Set([...state.draft.p1Bans, ...state.draft.p2Bans, ...state.draft.p1Picks, ...state.draft.p2Picks]);
        while (state.draft.p2Bans.length < 3) {
            const pool = fighters.filter(f => !taken.has(f.id));
            if (!pool.length) break;
            const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 15))];
            state.draft.p2Bans.push(pick.id);
            taken.add(pick.id);
        }
    }

    function handleConfirmAction() {
        const d = state.draft;
        const neededPicks = state.mode === '3v3' ? 3 : 1;

        if (d.phase === 'ban') {
            const fighters = getFighters();
            const taken = new Set([...d.p1Bans, ...d.p2Bans]);
            while (d.p1Bans.length < 3) {
                const avail = fighters.find(f => !taken.has(f.id));
                if (!avail) break;
                d.p1Bans.push(avail.id);
                taken.add(avail.id);
            }
            autoOpponentBans();
            // Ensure P1/P2 default picks aren't banned
            const bannedSet = new Set([...d.p1Bans, ...d.p2Bans]);
            const availPicks = fighters.filter(f => !bannedSet.has(f.id));
            if (bannedSet.has(d.p1Picks[0]) && availPicks[0]) d.p1Picks = [availPicks[0].id];
            if (bannedSet.has(d.p2Picks[0]) && availPicks[1]) d.p2Picks = [availPicks[1].id];
            d.selectedCandidate = d.p1Picks[0];
            d.phase = 'pick';
            d.tab = 'fighter';
            startDraftTimer();
            render();
            return;
        }

        if (d.phase === 'pick') {
            const fighters = getFighters();
            const bannedSet = new Set([...d.p1Bans, ...d.p2Bans]);
            while (d.p1Picks.length < neededPicks) {
                const next = fighters.find(f => !bannedSet.has(f.id) && !d.p1Picks.includes(f.id));
                if (!next) break;
                d.p1Picks.push(next.id);
            }
            while (d.p2Picks.length < neededPicks) {
                const next = fighters.find(f => !bannedSet.has(f.id) && !d.p2Picks.includes(f.id) && (state.settings.allowMirror || !d.p1Picks.includes(f.id)));
                if (!next) break;
                d.p2Picks.push(next.id);
            }
            d.phase = 'assist';
            d.tab = 'assist';
            const assists = getAssists();
            d.selectedCandidate = d.p1Assist || assists[0]?.id || null;
            startDraftTimer();
            render();
            return;
        }

        if (d.phase === 'assist') {
            const assists = getAssists();
            if (!d.p1Assist && assists[0]) d.p1Assist = assists[0].id;
            if (!d.p2Assist && assists[1]) d.p2Assist = assists[1].id;
            d.phase = 'ready';
            stopTimer();
            render();
            return;
        }

        if (d.phase === 'ready') {
            launchIntoGame();
        }
    }

    function launchIntoGame() {
        const app = document.getElementById('nvbArenaApp');
        const legacy = document.querySelector('.app-container');
        if (app) app.classList.add('nvb-hidden');
        if (legacy) legacy.classList.remove('nvb-hidden');

        const d = state.draft;
        if (state.edition === '500' && typeof window.launchTceamMatch === 'function') {
            window.launchTceamMatch({
                schemaVersion: 1,
                mode: state.mode === 'training' ? 'training' : 'local',
                p1: d.p1Picks,
                p2: d.p2Picks,
                p1Assist: d.p1Assist,
                p2Assist: d.p2Assist,
                map: 'xianshi',
                hp: 1,
                time: 60,
                bestOf: 3
            }, false);
        } else if (typeof window.launchBvn26Match === 'function') {
            window.launchBvn26Match({
                mode: state.mode === 'training' ? 'training' : 'local',
                p1: d.p1Picks[0],
                p2: d.p2Picks[0],
                p1Assist: d.p1Assist || '夜一',
                p2Assist: d.p2Assist || '我爱罗',
                stage: '火影瀑布'
            }, false);
        }
    }

    function renderNav() {
        const rightBtn = state.screen === 1
            ? `<button class="nvb-user-btn" id="nvbNavPlayNow">Chơi ngay</button>`
            : `<button class="nvb-user-btn" id="nvbNavUser">${state.playerName} · ${state.playerTag}</button>`;
        return `
        <nav class="nvb-nav">
            <div class="nvb-nav-inner">
                <div class="nvb-nav-left">
                    <div class="nvb-brand" id="nvbBrandHome">
                        <div class="nvb-logo-box">N</div>
                        <div class="nvb-brand-text">
                            <strong>NVB</strong>
                            <span>ARENA</span>
                        </div>
                    </div>
                    <div class="nvb-links">
                        <button class="nvb-link active" data-nav="arena">ĐẤU TRƯỜNG</button>
                        <button class="nvb-link" data-nav="guide">HƯỚNG DẪN</button>
                        <button class="nvb-link" data-nav="community">CỘNG ĐỒNG</button>
                    </div>
                </div>
                <div class="nvb-nav-right">
                    <div class="nvb-online-pill"><span class="nvb-dot-mint"></span> 1.284 đang online</div>
                    <button class="nvb-lang-btn" id="nvbLangBtn">${state.lang}</button>
                    ${rightBtn}
                </div>
            </div>
        </nav>`;
    }

    function renderFooter() {
        return `
        <footer class="nvb-footer">
            <div class="nvb-footer-inner">
                <div><strong style="letter-spacing:0.06em">NVB ARENA / FAN-MADE PROJECT</strong></div>
                <div>Dự án cộng đồng • Không liên kết với nhà phát hành gốc</div>
                <div style="color:var(--nvb-mint)"><span class="nvb-dot-mint"></span> Asia · Việt Nam &nbsp; ● &nbsp; 24 ms</div>
            </div>
        </footer>`;
    }

    function renderScreen1() {
        return `
        <section class="nvb-hero">
            <div class="nvb-hero-art" style="background-image: url('assets/hero-clash.jpg')"></div>
            <div class="nvb-hero-overlay"></div>
            <div class="nvb-hero-content">
                <span class="nvb-pill-gold">NARUTO × BLEACH</span>
                <h1>HAI THẾ GIỚI.<br>MỘT ĐẤU TRƯỜNG.</h1>
                <p>Chọn phiên bản. Lập phòng cùng bạn bè. Khẳng định đẳng cấp đối kháng.</p>
                <div class="nvb-hero-meta">MIỄN PHÍ &nbsp;/&nbsp; CHƠI TRÊN TRÌNH DUYỆT &nbsp;/&nbsp; KHÔNG CẦN TẢI</div>
            </div>
        </section>

        <div class="nvb-section-head">
            <div>
                <h2>CHỌN PHIÊN BẢN CỦA BẠN</h2>
                <p>Hai trải nghiệm. Cùng một tinh thần đối kháng.</p>
            </div>
            <div class="nvb-step-tag">01 / 04</div>
        </div>

        <div class="nvb-editions-grid">
            <div class="nvb-edition-card featured">
                <img class="nvb-edition-art" src="assets/avatars/naruto.png" alt="Bản 2.6">
                <div class="nvb-edition-grad"></div>
                <div class="nvb-edition-body">
                    <span class="nvb-pill-gold">CLASSIC</span>
                    <h3>BẢN 2.6</h3>
                    <p class="nvb-edition-sub">Nguyên bản. Chuẩn kỹ năng.</p>
                    <div class="nvb-edition-note">Bộ tướng kinh điển · Cân bằng truyền thống</div>
                </div>
                <button class="nvb-btn-gold" id="nvbPick26"><span>Chơi bản 2.6</span><span>→</span></button>
            </div>

            <div class="nvb-edition-card">
                <img class="nvb-edition-art" src="assets/avatars/ichigo_bankai.png" alt="500 Tướng">
                <div class="nvb-edition-grad"></div>
                <div class="nvb-edition-body">
                    <span class="nvb-pill-cyan">MỞ RỘNG</span>
                    <h3>500 TƯỚNG</h3>
                    <p class="nvb-edition-sub">Đa vũ trụ. Vô hạn đội hình.</p>
                    <div class="nvb-edition-note">Kho tướng mở rộng · Combo đa dạng</div>
                </div>
                <button class="nvb-btn-dark" id="nvbPick500"><span>Chơi bản 500 tướng</span><span>→</span></button>
            </div>
        </div>

        <div class="nvb-status-strip">
            <div class="nvb-status-strip-left">
                <span style="color:var(--nvb-mint)">● &nbsp;Máy chủ ổn định</span>
                <span>⌨ &nbsp;Hỗ trợ bàn phím & Tay cầm</span>
            </div>
            <div>Phím mặc định: WASD / J K L · Có thể tùy chỉnh trong phòng</div>
        </div>`;
    }

    function renderScreen2() {
        const edLabel = state.edition === '500' ? '500 TƯỚNG / MỞ RỘNG' : 'BẢN 2.6 / CLASSIC';
        const modes = [
            { id: '1v1', num: '01', badge: '1 VS 1', title: 'ĐẤU ĐƠN', tagline: 'Một đối thủ. Một cơ hội tỏa sáng.', desc: '1 tướng chính + 1 hỗ trợ / người\nCấm 3 tướng mỗi bên · Thể thức BO3', img: 'assets/avatars/naruto.png' },
            { id: '3v3', num: '02', badge: '3 VS 3', title: 'ĐẤU ĐỘI', tagline: 'Xây đội hình. Làm chủ mọi kèo đấu.', desc: '3 tướng chính + 1 hỗ trợ / người\nCấm 3 tướng mỗi bên · Giao lưu chiến thuật', img: 'assets/avatars/sasuke_susanoo.png' },
            { id: 'training', num: '03', badge: 'SOLO / VS CPU', title: 'LUYỆN TẬP', tagline: 'Thử combo mới. Sẵn sàng bứt phá.', desc: 'Tự do chọn tướng và hỗ trợ\nTùy chỉnh độ khó CPU hoặc tập tự do', img: 'assets/avatars/kakashi.png' }
        ];
        return `
        <div class="nvb-subhead">
            <button class="nvb-back-link" id="nvbBackTo1">← Đổi phiên bản</button>
            <div class="nvb-crumb-gold">${edLabel}</div>
        </div>

        <div class="nvb-page-title-row">
            <div>
                <h1>BẠN MUỐN ĐẤU THẾ NÀO?</h1>
                <p>Chọn chế độ, tạo phòng và gửi mã cho đối thủ</p>
            </div>
            <div class="nvb-step-tag">02 / 04</div>
        </div>

        <div class="nvb-modes-grid">
            ${modes.map(m => {
                const active = state.mode === m.id;
                return `
                <div class="nvb-mode-card ${active ? 'active' : ''}" data-mode="${m.id}">
                    <img class="nvb-mode-art" src="${m.img}" alt="${m.title}">
                    <div class="nvb-mode-grad"></div>
                    <div class="nvb-mode-top">
                        <span class="nvb-mode-num">${m.num}</span>
                        <span class="nvb-mode-badge">${m.badge}</span>
                    </div>
                    <div class="nvb-mode-body">
                        <h3>${m.title}</h3>
                        <p class="nvb-mode-tagline">${m.tagline}</p>
                        <p class="nvb-mode-details">${m.desc.replace('\n', '<br>')}</p>
                        <div class="nvb-mode-status">${active ? '● &nbsp;Đang chọn' : 'Chọn chế độ →'}</div>
                    </div>
                </div>`;
            }).join('')}
        </div>

        <div class="nvb-quick-rules">
            <div>
                <small>LUẬT PHÒNG MẶC ĐỊNH</small>
                <strong>${state.settings.banPick ? 'Cấm & chọn' : 'Chọn tự do'} &nbsp;•&nbsp; ${state.settings.format.split(' · ')[0]} &nbsp;•&nbsp; ${state.settings.turnTime} giây / lượt &nbsp;•&nbsp; ${state.settings.allowMirror ? 'Cho phép trùng tướng' : 'Không trùng tướng'}</strong>
            </div>
            <div style="font-size:12px;color:var(--nvb-muted)">Có thể thay đổi trong phòng</div>
        </div>

        <div class="nvb-mode-actions">
            <div class="nvb-join-inline">
                <span style="font-size:14px;color:var(--nvb-muted)">Đã có mã phòng?</span>
                <input class="nvb-input-dark" id="nvbJoinCodeInput" placeholder="Nhập mã phòng" style="width:185px">
                <button class="nvb-btn-dark" id="nvbJoinRoomBtn" style="min-width:130px">Vào phòng</button>
            </div>
            <button class="nvb-btn-gold" id="nvbCreateRoomBtn" style="min-width:240px"><span>Tạo phòng đấu</span><span>→</span></button>
        </div>`;
    }

    function renderScreen3() {
        const modeLabel = state.mode === '3v3' ? 'ĐẤU ĐỘI 3V3' : state.mode === 'training' ? 'LUYỆN TẬP' : 'ĐẤU ĐƠN 1V1';
        const edLabel = state.edition === '500' ? '500 TƯỚNG' : 'BẢN 2.6';
        return `
        <div class="nvb-subhead">
            <button class="nvb-back-link" id="nvbBackTo2">← Chọn chế độ</button>
            <div class="nvb-crumb-gold">${edLabel} &nbsp;/&nbsp; ${modeLabel}</div>
        </div>

        <div class="nvb-page-title-row">
            <div>
                <h1>PHÒNG ĐẤU CỦA ${state.playerName.toUpperCase()}</h1>
                <p>Mời đối thủ vào phòng. Cả hai sẵn sàng là có thể vào Cấm & Chọn.</p>
            </div>
            <div class="nvb-step-tag">03 / 04</div>
        </div>

        <div class="nvb-room-code-bar">
            <div class="nvb-room-code-left">
                <div class="nvb-room-code-val">
                    <small>MÃ PHÒNG</small>
                    <strong>${state.roomCode}</strong>
                </div>
                <button class="nvb-btn-dark" id="nvbCopyCodeBtn" style="min-width:154px">Sao chép mã</button>
                <span style="font-size:12px;color:var(--nvb-muted)">Phòng riêng tư • Chỉ người có mã mới tham gia</span>
            </div>
            <button class="nvb-btn-gold" id="nvbCopyInviteBtn" style="min-width:240px"><span>Sao chép liên kết mời</span><span>↗</span></button>
        </div>

        <div class="nvb-room-grid">
            <div>
                <div class="nvb-panel">
                    <div class="nvb-panel-head">
                        <span>NGƯỜI CHƠI</span>
                        <span style="color:var(--nvb-mint)">2 / 2</span>
                    </div>
                    <div class="nvb-players-row">
                        <div class="nvb-player-card">
                            <div class="nvb-player-top">
                                <img class="nvb-player-avatar" src="assets/avatars/naruto.png" alt="${state.playerName}">
                                <div class="nvb-player-meta">
                                    <small>BẠN • CHỦ PHÒNG</small>
                                    <strong>${state.playerName}</strong>
                                    <span style="font-size:10px;color:var(--nvb-mint)">● &nbsp;24 ms</span>
                                </div>
                            </div>
                            <div class="nvb-player-ready">✓ &nbsp;Đã sẵn sàng</div>
                        </div>

                        <div class="nvb-player-card p2">
                            <div class="nvb-player-top">
                                <img class="nvb-player-avatar" src="assets/avatars/ichigo.png" alt="${state.opponentName}">
                                <div class="nvb-player-meta">
                                    <small>ĐỐI THỦ</small>
                                    <strong>${state.opponentName}</strong>
                                    <span style="font-size:10px;color:var(--nvb-mint)">● &nbsp;31 ms</span>
                                </div>
                            </div>
                            <div class="nvb-player-ready">✓ &nbsp;Đã sẵn sàng</div>
                        </div>
                    </div>
                </div>

                <div class="nvb-panel nvb-chat-box">
                    <div class="nvb-panel-head"><span>TRÒ CHUYỆN</span></div>
                    <div class="nvb-chat-log" id="nvbChatLog">
                        ${state.chat.map(m => `<div class="nvb-chat-line"><span class="nvb-chat-sender" style="color:${m.color}">${m.sender}</span><span>${m.text}</span></div>`).join('')}
                    </div>
                    <div class="nvb-chat-input-row">
                        <input id="nvbChatInput" placeholder="Nhắn gì đó với đối thủ…">
                        <button class="nvb-chat-send" id="nvbChatSendBtn">Gửi ↗</button>
                    </div>
                </div>
            </div>

            <div class="nvb-panel">
                <div style="font-size:13px;font-weight:700;margin-bottom:4px">THIẾT LẬP TRẬN ĐẤU</div>
                <div style="font-size:11px;color:var(--nvb-muted)">Chỉ chủ phòng được thay đổi</div>
                <div class="nvb-settings-list">
                    <div class="nvb-setting-row">
                        <label>Thể thức</label>
                        <select id="nvbSetFormat">
                            <option value="BO1 · Thắng 1" ${state.settings.format.startsWith('BO1') ? 'selected' : ''}>BO1 · Thắng 1</option>
                            <option value="BO3 · Thắng 2 / 3" ${state.settings.format.startsWith('BO3') ? 'selected' : ''}>BO3 · Thắng 2 / 3</option>
                            <option value="BO5 · Thắng 3 / 5" ${state.settings.format.startsWith('BO5') ? 'selected' : ''}>BO5 · Thắng 3 / 5</option>
                        </select>
                    </div>
                    <div class="nvb-setting-row">
                        <label>Cấm & chọn</label>
                        <select id="nvbSetBanPick">
                            <option value="on" ${state.settings.banPick ? 'selected' : ''}>Bật · 3 lượt cấm mỗi bên</option>
                            <option value="off" ${!state.settings.banPick ? 'selected' : ''}>Tắt · Chọn tướng trực tiếp</option>
                        </select>
                    </div>
                    <div class="nvb-setting-row">
                        <label>Thời gian mỗi lượt</label>
                        <select id="nvbSetTime">
                            <option value="15" ${state.settings.turnTime === 15 ? 'selected' : ''}>15 giây</option>
                            <option value="30" ${state.settings.turnTime === 30 ? 'selected' : ''}>30 giây</option>
                            <option value="60" ${state.settings.turnTime === 60 ? 'selected' : ''}>60 giây</option>
                        </select>
                    </div>
                    <div class="nvb-setting-row">
                        <label>Chọn trùng tướng</label>
                        <select id="nvbSetMirror">
                            <option value="no" ${!state.settings.allowMirror ? 'selected' : ''}>Không cho phép</option>
                            <option value="yes" ${state.settings.allowMirror ? 'selected' : ''}>Cho phép</option>
                        </select>
                    </div>
                </div>
                <div style="border-top:1px solid var(--nvb-border);padding-top:18px;margin-top:18px">
                    <div style="font-size:12px;font-weight:500;color:var(--nvb-mint);margin-bottom:14px">✓ &nbsp;Cả hai người chơi đã sẵn sàng</div>
                    <button class="nvb-btn-gold" id="nvbStartDraftBtn" style="width:100%"><span>${state.settings.banPick ? 'Bắt đầu cấm & chọn' : 'Bắt đầu chọn tướng'}</span><span>→</span></button>
                    <div style="font-size:10px;color:var(--nvb-muted);text-align:center;margin-top:12px">Vào cấm & chọn sau khi chủ phòng bắt đầu.</div>
                </div>
            </div>
        </div>`;
    }

    function renderScreen4() {
        const d = state.draft;
        const fighters = getFighters();
        const assists = getAssists();
        const isAssistTab = d.tab === 'assist';
        const q = d.search.trim().toLowerCase();
        const bannedSet = new Set([...d.p1Bans, ...d.p2Bans]);

        const list = (isAssistTab ? assists : fighters).filter(c => {
            if (d.universe !== 'all' && c.universe !== d.universe) return false;
            if (d.onlyAvailable && (bannedSet.has(c.id) || d.p1Picks.includes(c.id) || d.p2Picks.includes(c.id))) return false;
            if (!q) return true;
            return c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
        });

        const phaseText = d.phase === 'ban'
            ? `Bạn đang cấm tướng (${d.p1Bans.length}/3)`
            : d.phase === 'pick'
                ? 'Bạn đang chọn tướng chính'
                : d.phase === 'assist'
                    ? 'Bạn đang chọn tướng hỗ trợ'
                    : 'Đội hình đã sẵn sàng — bấm Xuất trận!';

        const confirmLabel = d.phase === 'ban'
            ? 'XÁC NHẬN CẤM →'
            : d.phase === 'pick'
                ? 'KHÓA TƯỚNG →'
                : d.phase === 'assist'
                    ? 'KHÓA HỖ TRỢ →'
                    : 'XUẤT TRẬN →';

        const p1Main = findChar(d.p1Picks[0]) || fighters[0];
        const p2Main = findChar(d.p2Picks[0]) || fighters[1];
        const p1A = d.p1Assist ? findChar(d.p1Assist) : null;
        const p2A = d.p2Assist ? findChar(d.p2Assist) : null;
        const selObj = findChar(d.selectedCandidate) || p1Main;

        const renderBans = (bans) => [0, 1, 2].map(i => {
            const c = bans[i] ? findChar(bans[i]) : null;
            return `<div class="nvb-ban-slot">${c ? `<img src="${c.avatar}" alt="${c.name}"><div class="nvb-ban-tag">╱ CẤM</div>` : '+'}</div>`;
        }).join('');

        return `
        <div class="nvb-match-bar">
            <div style="display:flex;gap:36px">
                <span>PHÒNG ${state.roomCode.replace('NVB • ', '')}</span>
                <span style="color:var(--nvb-muted)">${state.edition === '500' ? '500 TƯỚNG' : 'BẢN 2.6'} &nbsp;/&nbsp; ${state.mode.toUpperCase()} &nbsp;/&nbsp; ${state.settings.format.split(' · ')[0]}</span>
            </div>
            <div style="display:flex;gap:48px">
                <span>VÁN 01 / 03</span>
                <span style="color:var(--nvb-muted)">${state.playerName.toUpperCase()} &nbsp; 0 : 0 &nbsp; ${state.opponentName.toUpperCase()}</span>
            </div>
        </div>

        <div class="nvb-draft-head">
            <div>
                <h1>CẤM & CHỌN</h1>
                <div class="nvb-draft-sub">${phaseText}</div>
            </div>
            <div class="nvb-timer-box">
                <small>LƯỢT CỦA BẠN</small>
                <strong id="nvbTimerValue">00:${String(Math.max(0, d.timer)).padStart(2, '0')}</strong>
            </div>
            <div style="text-align:right">
                <div style="font-size:12px;font-weight:600;color:var(--nvb-cyan)">Đối thủ đã khóa ${p2Main ? p2Main.name : 'Ichigo'}</div>
                <div style="font-size:11px;color:var(--nvb-muted);margin-top:4px">Chọn tướng → Khóa lựa chọn</div>
            </div>
        </div>

        <div class="nvb-steps-bar">
            <div class="nvb-step-pill ${d.phase === 'ban' ? 'active' : 'done'}">01 &nbsp; CẤM TƯỚNG ${d.phase !== 'ban' ? '✓' : ''}</div>
            <div class="nvb-step-pill ${d.phase === 'pick' ? 'active' : (d.phase === 'assist' || d.phase === 'ready' ? 'done' : '')}">02 &nbsp; TƯỚNG CHÍNH ${(d.phase === 'assist' || d.phase === 'ready') ? '✓' : ''}</div>
            <div class="nvb-step-pill ${d.phase === 'assist' ? 'active' : (d.phase === 'ready' ? 'done' : '')}">03 &nbsp; TƯỚNG HỖ TRỢ ${d.phase === 'ready' ? '✓' : ''}</div>
            <div class="nvb-step-pill ${d.phase === 'ready' ? 'active' : ''}">04 &nbsp; VÀO TRẬN</div>
        </div>

        <div class="nvb-draft-board">
            <div class="nvb-team-col">
                <div>
                    <div class="nvb-team-label">ĐỘI A / BẠN</div>
                    <h3 class="nvb-team-name">${state.playerName.toUpperCase()}</h3>
                </div>
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-muted);margin-bottom:8px">ĐÃ CẤM &nbsp; ${d.p1Bans.length} / 3</div>
                    <div class="nvb-ban-row">${renderBans(d.p1Bans)}</div>
                </div>
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-gold);margin-bottom:8px">TƯỚNG CHÍNH (${d.p1Picks.length})</div>
                    <div class="nvb-pick-card" id="nvbSlotP1Main">
                        <img src="${p1Main?.avatar || 'assets/avatars/naruto.png'}" alt="">
                        <div class="nvb-pick-info">
                            <strong>${(p1Main?.name || 'NARUTO').toUpperCase()}</strong>
                            <span>${d.phase === 'pick' ? 'Đang chọn…' : '✓ Đã chọn'}</span>
                            <small style="font-size:10px;color:var(--nvb-muted)">${p1Main?.role || ''}</small>
                        </div>
                    </div>
                </div>
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-muted);margin-bottom:8px">TƯỚNG HỖ TRỢ</div>
                    <div class="nvb-assist-slot" id="nvbSlotP1Assist">
                        ${p1A ? `<img src="${p1A.avatar}" alt=""><div><strong style="font-size:12px">${p1A.name}</strong><div style="font-size:10px;color:var(--nvb-mint)">✓ Đã chọn</div></div>`
                            : `<span style="font-size:26px;color:var(--nvb-muted)">+</span><div><div style="font-size:12px;font-weight:500;color:var(--nvb-muted)">Chưa lựa chọn</div><div style="font-size:9px;color:var(--nvb-muted)">Chọn ở giai đoạn 03</div></div>`}
                    </div>
                </div>
            </div>

            <div class="nvb-roster-panel">
                <div class="nvb-roster-tabs">
                    <div class="nvb-tab-group">
                        <button class="nvb-tab-btn ${d.tab === 'fighter' ? 'active' : ''}" data-tab="fighter">TƯỚNG CHÍNH</button>
                        <button class="nvb-tab-btn ${d.tab === 'assist' ? 'active' : ''}" data-tab="assist">TƯỚNG HỖ TRỢ</button>
                    </div>
                    <span style="font-size:10px;color:var(--nvb-muted)">${list.length} tướng hiển thị</span>
                </div>

                <div class="nvb-roster-filters">
                    <input id="nvbDraftSearch" placeholder="Tìm tên tướng…" value="${d.search.replace(/"/g, '&quot;')}">
                    <select id="nvbDraftUniverse">
                        <option value="all" ${d.universe === 'all' ? 'selected' : ''}>Tất cả vũ trụ</option>
                        <option value="naruto" ${d.universe === 'naruto' ? 'selected' : ''}>Naruto</option>
                        <option value="bleach" ${d.universe === 'bleach' ? 'selected' : ''}>Bleach</option>
                        ${state.edition === '500' ? `<option value="dragon-ball" ${d.universe === 'dragon-ball' ? 'selected' : ''}>Dragon Ball</option><option value="one-piece" ${d.universe === 'one-piece' ? 'selected' : ''}>One Piece</option>` : ''}
                    </select>
                    <label class="nvb-avail-check">
                        <input type="checkbox" id="nvbOnlyAvail" ${d.onlyAvailable ? 'checked' : ''}>
                        <span>Có thể chọn</span>
                    </label>
                </div>

                <div class="nvb-roster-grid">
                    ${list.map(c => {
                        const isBanned = bannedSet.has(c.id);
                        const isP1 = isAssistTab ? d.p1Assist === c.id : d.p1Picks.includes(c.id);
                        const isP2 = isAssistTab ? d.p2Assist === c.id : d.p2Picks.includes(c.id);
                        let badge = '';
                        let cls = '';
                        if (isBanned) { cls = 'banned'; badge = `<div class="nvb-tile-status ban">╱ ĐÃ CẤM</div>`; }
                        else if (isP1) { cls = 'picked-p1'; badge = `<div class="nvb-tile-status p1">ĐANG CHỌN</div>`; }
                        else if (isP2) { cls = 'picked-p2'; badge = `<div class="nvb-tile-status p2">ĐỐI THỦ</div>`; }
                        return `
                        <button class="nvb-char-tile ${cls}" data-id="${c.id}" ${isBanned ? 'disabled' : ''}>
                            <img loading="lazy" src="${c.avatar}" alt="${c.name}">
                            ${badge}
                            <div class="nvb-char-tile-name">${c.name}</div>
                        </button>`;
                    }).join('')}
                </div>

                <div style="font-size:10px;color:var(--nvb-muted)">Cấm áp dụng cho cả hai đội. Không thể chọn tướng đã bị cấm.</div>
            </div>

            <div class="nvb-team-col p2">
                <div>
                    <div class="nvb-team-label">ĐỘI B / ĐỐI THỦ</div>
                    <h3 class="nvb-team-name">${state.opponentName.toUpperCase()}</h3>
                </div>
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-muted);margin-bottom:8px">ĐÃ CẤM &nbsp; ${d.p2Bans.length} / 3</div>
                    <div class="nvb-ban-row">${renderBans(d.p2Bans)}</div>
                </div>
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-cyan);margin-bottom:8px">TƯỚNG CHÍNH (${d.p2Picks.length})</div>
                    <div class="nvb-pick-card">
                        <img src="${p2Main?.avatar || 'assets/avatars/ichigo.png'}" alt="">
                        <div class="nvb-pick-info">
                            <strong>${(p2Main?.name || 'ICHIGO').toUpperCase()}</strong>
                            <span>✓ Đã khóa</span>
                            <small style="font-size:10px;color:var(--nvb-muted)">${p2Main?.role || ''}</small>
                        </div>
                    </div>
                </div>
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-muted);margin-bottom:8px">TƯỚNG HỖ TRỢ</div>
                    <div class="nvb-assist-slot">
                        ${p2A ? `<img src="${p2A.avatar}" alt=""><div><strong style="font-size:12px">${p2A.name}</strong><div style="font-size:10px;color:var(--nvb-cyan)">✓ Đã khóa</div></div>`
                            : `<span style="font-size:26px;color:var(--nvb-muted)">+</span><div><div style="font-size:12px;font-weight:500;color:var(--nvb-muted)">Chưa lựa chọn</div><div style="font-size:9px;color:var(--nvb-muted)">Chọn ở giai đoạn 03</div></div>`}
                    </div>
                </div>
            </div>
        </div>

        <div class="nvb-confirm-bar">
            <div>
                <div style="font-size:13px;font-weight:700">ĐANG CHỌN: ${(selObj?.name || 'NARUTO UZUMAKI').toUpperCase()}</div>
                <div style="font-size:11px;color:var(--nvb-muted);margin-top:4px">Hết giờ sẽ tự khóa lựa chọn hiện tại. Bấm nút bên phải để chuyển bước tiếp theo.</div>
            </div>
            <div style="display:flex;align-items:center;gap:24px">
                <span style="font-size:11px;font-weight:500;color:var(--nvb-cyan)">${d.phase === 'ready' ? 'Sẵn sàng vào đấu trường!' : 'Lượt tiếp: Đối thủ & Hỗ trợ'}</span>
                <button class="nvb-btn-gold" id="nvbConfirmDraftBtn" style="min-width:244px;justify-content:center">${confirmLabel}</button>
            </div>
        </div>`;
    }

    function render() {
        const root = document.getElementById('nvbArenaApp');
        if (!root) return;
        let body = '';
        if (state.screen === 1) body = renderScreen1();
        else if (state.screen === 2) body = renderScreen2();
        else if (state.screen === 3) body = renderScreen3();
        else body = renderScreen4();

        root.innerHTML = `${renderNav()}<main class="nvb-main">${body}</main>${renderFooter()}`;
        bindEvents();
    }

    function bindEvents() {
        const goHome = document.getElementById('nvbBrandHome');
        if (goHome) goHome.onclick = () => { stopTimer(); state.screen = 1; render(); };

        const playNow = document.getElementById('nvbNavPlayNow');
        if (playNow) playNow.onclick = () => { state.screen = 2; render(); };

        const pick26 = document.getElementById('nvbPick26');
        if (pick26) pick26.onclick = () => { state.edition = 'bvn26'; state.screen = 2; render(); };

        const pick500 = document.getElementById('nvbPick500');
        if (pick500) pick500.onclick = async () => {
            state.edition = '500';
            await ensureTceamCatalog();
            state.screen = 2;
            render();
        };

        const b1 = document.getElementById('nvbBackTo1');
        if (b1) b1.onclick = () => { state.screen = 1; render(); };

        const b2 = document.getElementById('nvbBackTo2');
        if (b2) b2.onclick = () => { state.screen = 2; render(); };

        document.querySelectorAll('.nvb-mode-card').forEach(card => {
            card.onclick = () => { state.mode = card.dataset.mode; render(); };
        });

        const createBtn = document.getElementById('nvbCreateRoomBtn');
        if (createBtn) createBtn.onclick = () => {
            state.roomCode = 'NVB • ' + Math.random().toString(36).substring(2, 6).toUpperCase();
            state.screen = 3;
            render();
        };

        const joinBtn = document.getElementById('nvbJoinRoomBtn');
        if (joinBtn) joinBtn.onclick = () => {
            const code = (document.getElementById('nvbJoinCodeInput')?.value || '').trim();
            if (code) state.roomCode = code.toUpperCase();
            state.screen = 3;
            render();
        };

        const copyCode = document.getElementById('nvbCopyCodeBtn');
        if (copyCode) copyCode.onclick = () => {
            navigator.clipboard?.writeText(state.roomCode);
            copyCode.innerText = '✓ Đã sao chép';
        };

        const copyInv = document.getElementById('nvbCopyInviteBtn');
        if (copyInv) copyInv.onclick = () => {
            navigator.clipboard?.writeText(location.origin + '/?room=' + encodeURIComponent(state.roomCode));
            copyInv.innerHTML = '<span>✓ Đã copy liên kết</span><span>↗</span>';
        };

        const chatSend = document.getElementById('nvbChatSendBtn');
        const chatInp = document.getElementById('nvbChatInput');
        const sendMsg = () => {
            const txt = (chatInp?.value || '').trim();
            if (!txt) return;
            state.chat.push({ sender: state.playerName, color: '#FFB547', text: txt });
            render();
        };
        if (chatSend) chatSend.onclick = sendMsg;
        if (chatInp) chatInp.onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };

        const setFormat = document.getElementById('nvbSetFormat');
        if (setFormat) setFormat.onchange = () => { state.settings.format = setFormat.value; };
        const setBp = document.getElementById('nvbSetBanPick');
        if (setBp) setBp.onchange = () => { state.settings.banPick = setBp.value === 'on'; render(); };
        const setTime = document.getElementById('nvbSetTime');
        if (setTime) setTime.onchange = () => { state.settings.turnTime = Number(setTime.value); };
        const setMirror = document.getElementById('nvbSetMirror');
        if (setMirror) setMirror.onchange = () => { state.settings.allowMirror = setMirror.value === 'yes'; };

        const startDraft = document.getElementById('nvbStartDraftBtn');
        if (startDraft) startDraft.onclick = async () => {
            if (state.edition === '500') await ensureTceamCatalog();
            resetDraft();
            state.screen = 4;
            render();
        };

        // Screen 4 events
        document.querySelectorAll('.nvb-tab-btn').forEach(btn => {
            btn.onclick = () => { state.draft.tab = btn.dataset.tab; render(); };
        });

        const searchEl = document.getElementById('nvbDraftSearch');
        if (searchEl) searchEl.oninput = () => {
            state.draft.search = searchEl.value;
            render();
            const el = document.getElementById('nvbDraftSearch');
            if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        };

        const univEl = document.getElementById('nvbDraftUniverse');
        if (univEl) univEl.onchange = () => { state.draft.universe = univEl.value; render(); };

        const availEl = document.getElementById('nvbOnlyAvail');
        if (availEl) availEl.onchange = () => { state.draft.onlyAvailable = availEl.checked; render(); };

        document.querySelectorAll('.nvb-char-tile').forEach(tile => {
            tile.onclick = () => {
                const id = tile.dataset.id;
                const d = state.draft;
                d.selectedCandidate = id;
                if (d.phase === 'ban') {
                    const idx = d.p1Bans.indexOf(id);
                    if (idx !== -1) d.p1Bans.splice(idx, 1);
                    else if (d.p1Bans.length < 3) d.p1Bans.push(id);
                } else if (d.tab === 'assist' || d.phase === 'assist') {
                    d.p1Assist = id;
                } else {
                    const needed = state.mode === '3v3' ? 3 : 1;
                    if (needed === 1) {
                        d.p1Picks = [id];
                    } else {
                        const idx = d.p1Picks.indexOf(id);
                        if (idx !== -1 && d.p1Picks.length > 1) d.p1Picks.splice(idx, 1);
                        else if (d.p1Picks.length < 3) d.p1Picks.push(id);
                        else { d.p1Picks.shift(); d.p1Picks.push(id); }
                    }
                }
                render();
            };
        });

        const confirmBtn = document.getElementById('nvbConfirmDraftBtn');
        if (confirmBtn) confirmBtn.onclick = handleConfirmAction;

        const slotAssist = document.getElementById('nvbSlotP1Assist');
        if (slotAssist) slotAssist.onclick = () => { state.draft.tab = 'assist'; render(); };
        const slotMain = document.getElementById('nvbSlotP1Main');
        if (slotMain) slotMain.onclick = () => { state.draft.tab = 'fighter'; render(); };

        document.querySelectorAll('.nvb-link[data-nav]').forEach(btn => {
            btn.onclick = () => {
                if (btn.dataset.nav === 'guide') {
                    const modal = document.getElementById('keyModal');
                    if (modal) modal.classList.remove('hidden');
                }
            };
        });
    }

    window.NvbArena = {
        show(screenNum) {
            const app = document.getElementById('nvbArenaApp');
            const legacy = document.querySelector('.app-container');
            if (legacy) legacy.classList.add('nvb-hidden');
            if (app) app.classList.remove('nvb-hidden');
            if (screenNum) state.screen = screenNum;
            render();
        }
    };

    window.addEventListener('DOMContentLoaded', () => {
        window.NvbArena.show(1);
    });
})();
