// ==========================================
// NVB ARENA — 4-SCREEN ESPORTS UI & BAN/PICK DRAFT SYSTEM
// ==========================================
(function () {
    const ANIMUGEN_MEDIA = 'https://animugen.vercel.app';

    const state = {
        navTab: 'arena', // 'arena' | 'guide' | 'community'
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
            phase: 'ban', // 'ban' | 'pick' | 'assist_ban' | 'assist_pick' | 'ready' | 'free'
            tab: 'fighter', // 'fighter' | 'assist'
            search: '',
            universe: 'all',
            onlyAvailable: false,
            timer: 30,
            timerId: null,
            p1Bans: [],
            p2Bans: [],
            p1AssistBans: [],
            p2AssistBans: [],
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

    function hasAssist() {
        return state.edition !== '500';
    }

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
        const isFree = state.mode === 'training';
        state.draft.phase = isFree ? 'free' : (state.settings.banPick ? 'ban' : 'pick');
        state.draft.tab = 'fighter';
        state.draft.p1Bans = [];
        state.draft.p2Bans = [];
        state.draft.p1AssistBans = [];
        state.draft.p2AssistBans = [];
        state.draft.p1Picks = [firstP1];
        state.draft.p2Picks = [firstP2];
        state.draft.p1Assist = null;
        state.draft.p2Assist = null;
        state.draft.selectedCandidate = firstP1;
        state.draft.p1Locked = false;
        state.draft.p2Locked = true;
        if (!isFree) startDraftTimer();
        else stopTimer();
    }

    function pickRandomFromPool(pool, excludeSet) {
        const avail = pool.filter(x => !excludeSet.has(x.id));
        if (!avail.length) return null;
        return avail[Math.floor(Math.random() * Math.min(avail.length, 15))].id;
    }

    function autoOpponentStepBan(isAssist) {
        const d = state.draft;
        const limit = isAssist ? 2 : 3;
        const p2List = isAssist ? d.p2AssistBans : d.p2Bans;
        const p1List = isAssist ? d.p1AssistBans : d.p1Bans;
        if (p2List.length >= limit) return;
        const pool = isAssist ? getAssists() : getFighters();
        const taken = new Set([...p1List, ...p2List]);
        const picked = pickRandomFromPool(pool, taken);
        if (picked) p2List.push(picked);
    }

    function handleConfirmAction() {
        const d = state.draft;
        const neededPicks = state.mode === '3v3' ? 3 : 1;

        if (d.phase === 'free') {
            launchIntoGame();
            return;
        }

        if (d.phase === 'ban') {
            const fighters = getFighters();
            const taken = new Set([...d.p1Bans, ...d.p2Bans]);
            while (d.p1Bans.length < 3) {
                const avail = fighters.find(f => !taken.has(f.id));
                if (!avail) break;
                d.p1Bans.push(avail.id);
                taken.add(avail.id);
                if (d.p2Bans.length < 3) {
                    const p2Pick = pickRandomFromPool(fighters, taken);
                    if (p2Pick) { d.p2Bans.push(p2Pick); taken.add(p2Pick); }
                }
            }
            while (d.p2Bans.length < 3) {
                const p2Pick = pickRandomFromPool(fighters, taken);
                if (!p2Pick) break;
                d.p2Bans.push(p2Pick);
                taken.add(p2Pick);
            }
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
            if (hasAssist()) {
                d.phase = 'assist_ban';
                d.tab = 'assist';
                const assists = getAssists();
                d.selectedCandidate = assists[0]?.id || null;
                startDraftTimer();
            } else {
                d.phase = 'ready';
                stopTimer();
            }
            render();
            return;
        }

        if (d.phase === 'assist_ban') {
            const assists = getAssists();
            const taken = new Set([...d.p1AssistBans, ...d.p2AssistBans]);
            while (d.p1AssistBans.length < 2) {
                const avail = assists.find(a => !taken.has(a.id));
                if (!avail) break;
                d.p1AssistBans.push(avail.id);
                taken.add(avail.id);
                if (d.p2AssistBans.length < 2) {
                    const p2A = pickRandomFromPool(assists, taken);
                    if (p2A) { d.p2AssistBans.push(p2A); taken.add(p2A); }
                }
            }
            while (d.p2AssistBans.length < 2) {
                const p2A = pickRandomFromPool(assists, taken);
                if (!p2A) break;
                d.p2AssistBans.push(p2A);
                taken.add(p2A);
            }
            const bannedA = new Set([...d.p1AssistBans, ...d.p2AssistBans]);
            const availA = assists.filter(a => !bannedA.has(a.id));
            d.p1Assist = availA[0]?.id || null;
            d.p2Assist = availA[1]?.id || availA[0]?.id || null;
            d.selectedCandidate = d.p1Assist;
            d.phase = 'assist_pick';
            d.tab = 'assist';
            startDraftTimer();
            render();
            return;
        }

        if (d.phase === 'assist_pick') {
            const assists = getAssists();
            const bannedA = new Set([...d.p1AssistBans, ...d.p2AssistBans]);
            const availA = assists.filter(a => !bannedA.has(a.id));
            if (!d.p1Assist && availA[0]) d.p1Assist = availA[0].id;
            if (!d.p2Assist && availA[1]) d.p2Assist = availA[1].id;
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
                        <button class="nvb-link ${state.navTab === 'arena' ? 'active' : ''}" data-nav="arena">ĐẤU TRƯỜNG</button>
                        <button class="nvb-link ${state.navTab === 'guide' ? 'active' : ''}" data-nav="guide">HƯỚNG DẪN</button>
                        <button class="nvb-link ${state.navTab === 'community' ? 'active' : ''}" data-nav="community">CỘNG ĐỒNG</button>
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
        const assistNote = hasAssist() ? ' + 1 hỗ trợ' : ' (Không hỗ trợ)';
        const assistBanNote = hasAssist() ? 'Cấm 3 tướng + 2 hỗ trợ · Chọn mù' : 'Cấm 3 tướng · Chọn mù';
        const modes = [
            { id: '1v1', num: '01', badge: '1 VS 1', title: 'ĐẤU ĐƠN', tagline: 'Chơi với bạn · Tự động tạo phòng.', desc: `1 tướng chính${assistNote} / người\n${assistBanNote}`, img: 'assets/avatars/naruto.png' },
            { id: '3v3', num: '02', badge: '3 VS 3', title: 'ĐẤU ĐỘI', tagline: 'Chơi với bạn · Xây đội hình 3v3.', desc: `3 tướng chính${assistNote} / người\n${assistBanNote}`, img: 'assets/avatars/sasuke_susanoo.png' },
            { id: 'training', num: '03', badge: 'SOLO / LUYỆN TẬP', title: 'LUYỆN TẬP', tagline: 'Chơi đơn · Vào thẳng trận không cần cấm chọn.', desc: `Tự do chọn tướng${hasAssist() ? ' và hỗ trợ' : ''}\nKhông cấm chọn · Vào ngay đấu trường`, img: 'assets/avatars/kakashi.png' }
        ];
        const isSolo = state.mode === 'training';
        return `
        <div class="nvb-subhead">
            <button class="nvb-back-link" id="nvbBackTo1">← Đổi phiên bản</button>
            <div class="nvb-crumb-gold">${edLabel}</div>
        </div>

        <div class="nvb-page-title-row">
            <div>
                <h1>BẠN MUỐN ĐẤU THẾ NÀO?</h1>
                <p>${isSolo ? 'Chế độ Luyện tập / Chơi đơn vào thẳng chọn tướng, không cần tạo phòng.' : 'Chọn Đấu Đơn hoặc Đấu Đội để tự động tạo phòng Cấm & Chọn với bạn bè.'}</p>
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
                <small>LUẬT CHẾ ĐỘ ĐANG CHỌN</small>
                <strong>${isSolo ? 'Chọn tướng tự do · Không cấm chọn · Vào thẳng trận' : `${assistBanNote} • ${state.settings.format.split(' · ')[0]} • ${state.settings.turnTime}s / lượt`}</strong>
            </div>
            <div style="font-size:12px;color:var(--nvb-muted)">${isSolo ? 'Chế độ chơi đơn' : 'Tự động tạo phòng khi tiếp tục'}</div>
        </div>

        <div class="nvb-mode-actions">
            <div class="nvb-join-inline">
                <span style="font-size:14px;color:var(--nvb-muted)">Đã có mã phòng?</span>
                <input class="nvb-input-dark" id="nvbJoinCodeInput" placeholder="Nhập mã phòng" style="width:185px">
                <button class="nvb-btn-dark" id="nvbJoinRoomBtn" style="min-width:130px">Vào phòng</button>
            </div>
            <button class="nvb-btn-gold" id="nvbCreateRoomBtn" style="min-width:240px"><span>${isSolo ? 'Vào chọn tướng' : 'Tạo phòng đấu'}</span><span>→</span></button>
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
        const showAssist = hasAssist();
        const isFree = d.phase === 'free';
        const isAssistTab = showAssist && (d.tab === 'assist');
        const q = d.search.trim().toLowerCase();
        const bannedMainSet = new Set([...d.p1Bans, ...d.p2Bans]);
        const bannedAssistSet = new Set([...d.p1AssistBans, ...d.p2AssistBans]);
        const activeBanSet = isAssistTab ? bannedAssistSet : bannedMainSet;

        const isBlindMain = d.phase === 'pick' || d.phase === 'ban';
        const isBlindAssist = d.phase === 'assist_pick' || d.phase === 'assist_ban';
        const revealP2Main = isFree || d.phase === 'assist_ban' || d.phase === 'assist_pick' || d.phase === 'ready';
        const revealP2Assist = isFree || d.phase === 'ready';

        const list = (isAssistTab ? assists : fighters).filter(c => {
            if (d.universe !== 'all' && c.universe !== d.universe) return false;
            if (d.onlyAvailable && (activeBanSet.has(c.id) || d.p1Picks.includes(c.id) || (revealP2Main && d.p2Picks.includes(c.id)))) return false;
            if (!q) return true;
            return c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
        });

        const phaseText = isFree
            ? 'Chế độ Luyện tập / Chơi đơn — Chọn tướng tự do rồi bấm Xuất trận'
            : d.phase === 'ban'
                ? `Lần lượt cấm 3 tướng chính (${d.p1Bans.length}/3)`
                : d.phase === 'pick'
                    ? 'Chọn mù tướng chính (Đối thủ không thấy lựa chọn của bạn)'
                    : d.phase === 'assist_ban'
                        ? `Lần lượt cấm 2 nhân vật phụ (${d.p1AssistBans.length}/2)`
                        : d.phase === 'assist_pick'
                            ? 'Chọn mù 1 nhân vật phụ (Đối thủ không thấy lựa chọn)'
                            : 'Hai bên đã khóa xong — Sẵn sàng Xuất trận!';

        const confirmLabel = isFree
            ? 'XUẤT TRẬN →'
            : d.phase === 'ban'
                ? 'KHÓA CẤM TƯỚNG →'
                : d.phase === 'pick'
                    ? 'KHÓA CHỌN MÙ →'
                    : d.phase === 'assist_ban'
                        ? 'KHÓA CẤM HỖ TRỢ →'
                        : d.phase === 'assist_pick'
                            ? 'KHÓA HỖ TRỢ →'
                            : 'XUẤT TRẬN →';

        const p1Main = findChar(d.p1Picks[0]) || fighters[0];
        const p2Main = findChar(d.p2Picks[0]) || fighters[1];
        const p1A = d.p1Assist ? findChar(d.p1Assist) : null;
        const p2A = d.p2Assist ? findChar(d.p2Assist) : null;
        const selObj = findChar(d.selectedCandidate) || p1Main;

        const renderBans = (bans, count = 3) => Array.from({ length: count }, (_, i) => {
            const c = bans[i] ? findChar(bans[i]) : null;
            return `<div class="nvb-ban-slot">${c ? `<img src="${c.avatar}" alt="${c.name}"><div class="nvb-ban-tag">╱ CẤM</div>` : '+'}</div>`;
        }).join('');

        const stepsHtml = isFree ? '' : (showAssist ? `
        <div class="nvb-steps-bar" style="grid-template-columns:repeat(5,1fr)">
            <div class="nvb-step-pill ${d.phase === 'ban' ? 'active' : 'done'}">01 CẤM TƯỚNG (3) ${d.phase !== 'ban' ? '✓' : ''}</div>
            <div class="nvb-step-pill ${d.phase === 'pick' ? 'active' : (['assist_ban','assist_pick','ready'].includes(d.phase) ? 'done' : '')}">02 CHỌN MÙ TƯỚNG ${['assist_ban','assist_pick','ready'].includes(d.phase) ? '✓' : ''}</div>
            <div class="nvb-step-pill ${d.phase === 'assist_ban' ? 'active' : (['assist_pick','ready'].includes(d.phase) ? 'done' : '')}">03 CẤM HỖ TRỢ (2) ${['assist_pick','ready'].includes(d.phase) ? '✓' : ''}</div>
            <div class="nvb-step-pill ${d.phase === 'assist_pick' ? 'active' : (d.phase === 'ready' ? 'done' : '')}">04 CHỌN MÙ HỖ TRỢ ${d.phase === 'ready' ? '✓' : ''}</div>
            <div class="nvb-step-pill ${d.phase === 'ready' ? 'active' : ''}">05 VÀO TRẬN</div>
        </div>` : `
        <div class="nvb-steps-bar" style="grid-template-columns:repeat(3,1fr)">
            <div class="nvb-step-pill ${d.phase === 'ban' ? 'active' : 'done'}">01 CẤM TƯỚNG (3) ${d.phase !== 'ban' ? '✓' : ''}</div>
            <div class="nvb-step-pill ${d.phase === 'pick' ? 'active' : (d.phase === 'ready' ? 'done' : '')}">02 CHỌN MÙ TƯỚNG ${d.phase === 'ready' ? '✓' : ''}</div>
            <div class="nvb-step-pill ${d.phase === 'ready' ? 'active' : ''}">03 VÀO TRẬN</div>
        </div>`);

        return `
        <div class="nvb-match-bar">
            <div style="display:flex;gap:36px">
                <span>${isFree ? 'CHẾ ĐỘ LUYỆN TẬP / CHƠI ĐƠN' : 'PHÒNG ' + state.roomCode.replace('NVB • ', '')}</span>
                <span style="color:var(--nvb-muted)">${state.edition === '500' ? '500 TƯỚNG (KHÔNG HỖ TRỢ)' : 'BẢN 2.6'} &nbsp;/&nbsp; ${state.mode.toUpperCase()}</span>
            </div>
            <div style="display:flex;gap:48px">
                <span>${isFree ? 'KHÔNG CẤM CHỌN' : 'VÁN 01 / 03'}</span>
                <span style="color:var(--nvb-muted)">${state.playerName.toUpperCase()} &nbsp; vs &nbsp; ${isFree ? 'CPU / FREE' : state.opponentName.toUpperCase()}</span>
            </div>
        </div>

        <div class="nvb-draft-head">
            <div>
                <h1>${isFree ? 'CHỌN TƯỚNG LUYỆN TẬP' : 'CẤM & CHỌN MÙ'}</h1>
                <div class="nvb-draft-sub">${phaseText}</div>
            </div>
            ${isFree ? '' : `
            <div class="nvb-timer-box">
                <small>LƯỢT CỦA BẠN</small>
                <strong id="nvbTimerValue">00:${String(Math.max(0, d.timer)).padStart(2, '0')}</strong>
            </div>`}
            <div style="text-align:right">
                <div style="font-size:12px;font-weight:600;color:var(--nvb-cyan)">${revealP2Main ? `Đối thủ: ${p2Main ? p2Main.name : 'Ichigo'}` : 'Đối thủ đang chọn mù (Ẩn)'}</div>
                <div style="font-size:11px;color:var(--nvb-muted);margin-top:4px">${isFree ? 'Chọn tướng rồi bấm Xuất trận' : 'Chọn mù sẽ chỉ hiện sau khi khóa'}</div>
            </div>
        </div>

        ${stepsHtml}

        <div class="nvb-draft-board">
            <div class="nvb-team-col">
                <div>
                    <div class="nvb-team-label">ĐỘI A / BẠN</div>
                    <h3 class="nvb-team-name">${state.playerName.toUpperCase()}</h3>
                </div>
                ${isFree ? '' : `
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-muted);margin-bottom:8px">CẤM TƯỚNG &nbsp; ${d.p1Bans.length} / 3</div>
                    <div class="nvb-ban-row">${renderBans(d.p1Bans, 3)}</div>
                </div>`}
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-gold);margin-bottom:8px">TƯỚNG CHÍNH (${d.p1Picks.length})</div>
                    <div class="nvb-pick-card" id="nvbSlotP1Main">
                        <img src="${p1Main?.avatar || 'assets/avatars/naruto.png'}" alt="">
                        <div class="nvb-pick-info">
                            <strong>${(p1Main?.name || 'NARUTO').toUpperCase()}</strong>
                            <span>${d.phase === 'pick' || isFree ? 'Đang chọn…' : '✓ Đã khóa'}</span>
                            <small style="font-size:10px;color:var(--nvb-muted)">${p1Main?.role || ''}</small>
                        </div>
                    </div>
                </div>
                ${showAssist ? `
                ${isFree ? '' : `
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-muted);margin-bottom:8px">CẤM HỖ TRỢ &nbsp; ${d.p1AssistBans.length} / 2</div>
                    <div class="nvb-ban-row" style="grid-template-columns:repeat(2,1fr)">${renderBans(d.p1AssistBans, 2)}</div>
                </div>`}
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-muted);margin-bottom:8px">TƯỚNG HỖ TRỢ</div>
                    <div class="nvb-assist-slot" id="nvbSlotP1Assist">
                        ${p1A ? `<img src="${p1A.avatar}" alt=""><div><strong style="font-size:12px">${p1A.name}</strong><div style="font-size:10px;color:var(--nvb-mint)">✓ Đã chọn</div></div>`
                            : `<span style="font-size:26px;color:var(--nvb-muted)">+</span><div><div style="font-size:12px;font-weight:500;color:var(--nvb-muted)">Chưa lựa chọn</div><div style="font-size:9px;color:var(--nvb-muted)">Chọn nhân vật phụ</div></div>`}
                    </div>
                </div>` : ''}
            </div>

            <div class="nvb-roster-panel">
                <div class="nvb-roster-tabs">
                    <div class="nvb-tab-group">
                        <button class="nvb-tab-btn ${!isAssistTab ? 'active' : ''}" data-tab="fighter">TƯỚNG CHÍNH</button>
                        ${showAssist ? `<button class="nvb-tab-btn ${isAssistTab ? 'active' : ''}" data-tab="assist">TƯỚNG HỖ TRỢ</button>` : ''}
                    </div>
                    <span style="font-size:10px;color:var(--nvb-muted)">${list.length} nhân vật hiển thị</span>
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
                        const isBanned = activeBanSet.has(c.id);
                        const isP1 = isAssistTab ? d.p1Assist === c.id : d.p1Picks.includes(c.id);
                        const isP2 = isAssistTab ? (revealP2Assist && d.p2Assist === c.id) : (revealP2Main && d.p2Picks.includes(c.id));
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

                <div style="font-size:10px;color:var(--nvb-muted)">${isFree ? 'Nhấn chọn tướng muốn tập và bấm Xuất trận.' : 'Cấm áp dụng cho cả hai đội. Chọn mù ẩn lựa chọn của đối thủ cho đến khi khóa.'}</div>
            </div>

            <div class="nvb-team-col p2">
                <div>
                    <div class="nvb-team-label">${isFree ? 'ĐỘI B / CPU' : 'ĐỘI B / ĐỐI THỦ'}</div>
                    <h3 class="nvb-team-name">${isFree ? 'BOT / CPU' : state.opponentName.toUpperCase()}</h3>
                </div>
                ${isFree ? '' : `
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-muted);margin-bottom:8px">CẤM TƯỚNG &nbsp; ${d.p2Bans.length} / 3</div>
                    <div class="nvb-ban-row">${renderBans(d.p2Bans, 3)}</div>
                </div>`}
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-cyan);margin-bottom:8px">TƯỚNG CHÍNH (${d.p2Picks.length})</div>
                    <div class="nvb-pick-card">
                        ${revealP2Main ? `
                        <img src="${p2Main?.avatar || 'assets/avatars/ichigo.png'}" alt="">
                        <div class="nvb-pick-info">
                            <strong>${(p2Main?.name || 'ICHIGO').toUpperCase()}</strong>
                            <span>✓ Đã khóa</span>
                            <small style="font-size:10px;color:var(--nvb-muted)">${p2Main?.role || ''}</small>
                        </div>` : `
                        <div style="width:96px;height:100%;background:#131A26;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:var(--nvb-cyan)">?</div>
                        <div class="nvb-pick-info">
                            <strong>CHỌN MÙ (ẨN)</strong>
                            <span>${d.phase === 'pick' ? '⏳ Đã khóa ẩn' : 'Đang chờ…'}</span>
                            <small style="font-size:10px;color:var(--nvb-muted)">Mở sau khi 2 bên khóa</small>
                        </div>`}
                    </div>
                </div>
                ${showAssist ? `
                ${isFree ? '' : `
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-muted);margin-bottom:8px">CẤM HỖ TRỢ &nbsp; ${d.p2AssistBans.length} / 2</div>
                    <div class="nvb-ban-row" style="grid-template-columns:repeat(2,1fr)">${renderBans(d.p2AssistBans, 2)}</div>
                </div>`}
                <div>
                    <div style="font-size:10px;font-weight:700;color:var(--nvb-muted);margin-bottom:8px">TƯỚNG HỖ TRỢ</div>
                    <div class="nvb-assist-slot">
                        ${revealP2Assist && p2A ? `<img src="${p2A.avatar}" alt=""><div><strong style="font-size:12px">${p2A.name}</strong><div style="font-size:10px;color:var(--nvb-cyan)">✓ Đã khóa</div></div>`
                            : `<span style="font-size:22px;color:var(--nvb-cyan);font-weight:900">?</span><div><div style="font-size:12px;font-weight:500;color:var(--nvb-muted)">${isBlindAssist ? 'Đang chọn mù (Ẩn)' : 'Chưa mở'}</div><div style="font-size:9px;color:var(--nvb-muted)">Mở sau khi khóa</div></div>`}
                    </div>
                </div>` : ''}
            </div>
        </div>

        <div class="nvb-confirm-bar">
            <div>
                <div style="font-size:13px;font-weight:700">ĐANG CHỌN: ${(selObj?.name || 'NARUTO UZUMAKI').toUpperCase()}</div>
                <div style="font-size:11px;color:var(--nvb-muted);margin-top:4px">${isFree ? 'Không cần cấm chọn trong chế độ Luyện tập.' : 'Hai bên chọn mù độc lập — danh tính chỉ lộ khi bước vào trận.'}</div>
            </div>
            <div style="display:flex;align-items:center;gap:24px">
                <span style="font-size:11px;font-weight:500;color:var(--nvb-cyan)">${d.phase === 'ready' || isFree ? 'Sẵn sàng vào đấu trường!' : 'Đang trong phiên Cấm & Chọn'}</span>
                <button class="nvb-btn-gold" id="nvbConfirmDraftBtn" style="min-width:244px;justify-content:center">${confirmLabel}</button>
            </div>
        </div>`;
    }

    function renderGuideView() {
        return `
        <div class="nvb-page-title-row">
            <div>
                <h1>HƯỚNG DẪN & PHÍM ĐIỀU KHIỂN</h1>
                <p>Thiết lập phím mặc định, tay cầm Gamepad và quy trình Cấm & Chọn 4 bước.</p>
            </div>
            <button class="nvb-btn-gold" id="nvbOpenKeySettingsBtn" style="min-width:220px"><span>⚙️ Tùy chỉnh phím & Tay cầm</span><span>→</span></button>
        </div>

        <div class="nvb-info-grid">
            <div class="nvb-panel">
                <div class="nvb-panel-head"><span style="color:var(--nvb-gold)">🔴 NGƯỜI CHƠI 1 (P1 / HOST)</span><span>BÀN PHÍM MẶC ĐỊNH</span></div>
                <div class="nvb-keycap-row">
                    <div class="nvb-keycap"><strong>W A S D</strong><span>Di chuyển</span></div>
                    <div class="nvb-keycap"><strong>J</strong><span>Đánh thường</span></div>
                    <div class="nvb-keycap"><strong>K</strong><span>Nhảy</span></div>
                    <div class="nvb-keycap"><strong>L</strong><span>Lướt nhanh</span></div>
                    <div class="nvb-keycap"><strong>U</strong><span>Kỹ năng</span></div>
                    <div class="nvb-keycap"><strong>I</strong><span>Tuyệt chiêu</span></div>
                    <div class="nvb-keycap"><strong>O</strong><span>Gọi hỗ trợ</span></div>
                </div>
            </div>

            <div class="nvb-panel">
                <div class="nvb-panel-head"><span style="color:var(--nvb-cyan)">🔵 NGƯỜI CHƠI 2 (P2 / KHÁCH)</span><span>BÀN PHÍM MẶC ĐỊNH</span></div>
                <div class="nvb-keycap-row">
                    <div class="nvb-keycap p2"><strong>↑ ↓ ← →</strong><span>Di chuyển</span></div>
                    <div class="nvb-keycap p2"><strong>1 / J</strong><span>Đánh thường</span></div>
                    <div class="nvb-keycap p2"><strong>2 / K</strong><span>Nhảy</span></div>
                    <div class="nvb-keycap p2"><strong>3 / L</strong><span>Lướt nhanh</span></div>
                    <div class="nvb-keycap p2"><strong>4 / U</strong><span>Kỹ năng</span></div>
                    <div class="nvb-keycap p2"><strong>5 / I</strong><span>Tuyệt chiêu</span></div>
                    <div class="nvb-keycap p2"><strong>6 / O</strong><span>Gọi hỗ trợ</span></div>
                </div>
            </div>

            <div class="nvb-panel">
                <div class="nvb-panel-head"><span>QUY TRÌNH CẤM & CHỌN (BAN/PICK)</span><span>04 BƯỚC</span></div>
                <ul class="nvb-rule-list">
                    <li><strong>Bước 01 · Cấm tướng:</strong> Mỗi bên cấm tối đa 3 tướng mạnh; tướng bị cấm sẽ bị khóa cho cả 2 đội.</li>
                    <li><strong>Bước 02 · Tướng chính:</strong> Chọn 1 tướng (Đấu đơn 1v1) hoặc 3 tướng (Đấu đội 3v3).</li>
                    <li><strong>Bước 03 · Tướng hỗ trợ:</strong> Chọn 1 trợ thủ (Assist) đồng hành trong trận.</li>
                    <li><strong>Bước 04 · Vào trận:</strong> Bấm Xuất trận để nạp game và nhảy thẳng vào đấu trường.</li>
                </ul>
            </div>

            <div class="nvb-panel">
                <div class="nvb-panel-head"><span>CHƠI ONLINE P2P & TAY CẦM</span><span style="color:var(--nvb-mint)">WEBRTC DIRECT</span></div>
                <ul class="nvb-rule-list">
                    <li><strong>Kết nối trực tiếp P2P:</strong> Dùng WebRTC DataChannel truyền phím bấm độ trễ thấp, không vòng qua server Mỹ.</li>
                    <li><strong>Phiên bản 500 Tướng (TCEAM):</strong> Hỗ trợ chế độ Lockstep 0 MB Video siêu nét.</li>
                    <li><strong>Tay cầm (Gamepad):</strong> Cắm tay cầm USB/Bluetooth rồi bấm nút <em>Tùy chỉnh phím & Tay cầm</em> ở trên để gán nút.</li>
                </ul>
            </div>
        </div>`;
    }

    function renderCommunityView() {
        return `
        <div class="nvb-page-title-row">
            <div>
                <h1>CỘNG ĐỒNG & GHÉP TRẬN</h1>
                <p>Tìm đối thủ ngẫu nhiên, theo dõi độ trễ khu vực và ủng hộ duy trì máy chủ.</p>
            </div>
            <button class="nvb-btn-gold" id="nvbBackArenaFromComm" style="min-width:200px"><span>← Về Đấu Trường</span><span></span></button>
        </div>

        <div class="nvb-info-grid">
            <div class="nvb-panel">
                <div class="nvb-panel-head"><span>⚡ GHÉP TRẬN NGẪU NHIÊN (QUICK MATCH)</span><span style="color:var(--nvb-mint)">● SẴN SÀNG</span></div>
                <p style="font-size:13px;color:var(--nvb-muted);line-height:1.5;margin:0 0 18px">
                    Không cần tạo mã phòng thủ công — hệ thống tự động ghép bạn với một người chơi khác đang tìm trận và đưa cả hai vào cùng phòng đấu.
                </p>
                <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                    <button class="nvb-btn-gold" id="nvbCommQuickMatch" style="min-width:220px"><span>Tìm đối thủ ngay</span><span>⚡</span></button>
                    <span id="nvbCommQmStatus" style="font-size:12px;color:var(--nvb-muted)">Trạng thái: Đang chờ</span>
                </div>
            </div>

            <div class="nvb-panel">
                <div class="nvb-panel-head"><span>☕ ỦNG HỘ DUY TRÌ MÁY CHỦ (DONATE)</span><span style="color:var(--nvb-gold)">CỘNG ĐỒNG</span></div>
                <p style="font-size:13px;color:var(--nvb-muted);line-height:1.5;margin:0 0 16px">
                    NVB Arena hoàn toàn miễn phí và không quảng cáo. Mọi đóng góp đều dùng để duy trì hạ tầng signaling & TURN Relay tốc độ cao tại Việt Nam / Singapore.
                </p>
                <div style="display:flex;align-items:center;justify-content:space-between;background:#0B1018;border:1px solid #273040;border-radius:6px;padding:12px 16px">
                    <div>
                        <small style="display:block;font-size:10px;color:var(--nvb-muted)">MB BANK / CHUYỂN KHOẢN</small>
                        <strong style="font-size:16px;letter-spacing:0.06em">1072917758</strong>
                    </div>
                    <button class="nvb-btn-dark" id="nvbCommCopyStk" style="min-width:120px;height:38px">Copy STK</button>
                </div>
            </div>
        </div>`;
    }

    function render() {
        const root = document.getElementById('nvbArenaApp');
        if (!root) return;
        let body = '';
        if (state.navTab === 'guide') body = renderGuideView();
        else if (state.navTab === 'community') body = renderCommunityView();
        else if (state.screen === 1) body = renderScreen1();
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
        if (createBtn) createBtn.onclick = async () => {
            if (state.mode === 'training') {
                if (state.edition === '500') await ensureTceamCatalog();
                resetDraft();
                state.screen = 4;
                render();
            } else {
                state.roomCode = 'NVB • ' + Math.random().toString(36).substring(2, 6).toUpperCase();
                state.screen = 3;
                render();
            }
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
                    if (idx !== -1) {
                        d.p1Bans.splice(idx, 1);
                    } else if (d.p1Bans.length < 3) {
                        d.p1Bans.push(id);
                        autoOpponentStepBan(false);
                        if (d.p1Bans.length === 3 && d.p2Bans.length === 3) {
                            handleConfirmAction();
                            return;
                        }
                    }
                } else if (d.phase === 'assist_ban') {
                    const idx = d.p1AssistBans.indexOf(id);
                    if (idx !== -1) {
                        d.p1AssistBans.splice(idx, 1);
                    } else if (d.p1AssistBans.length < 2) {
                        d.p1AssistBans.push(id);
                        autoOpponentStepBan(true);
                        if (d.p1AssistBans.length === 2 && d.p2AssistBans.length === 2) {
                            handleConfirmAction();
                            return;
                        }
                    }
                } else if (d.tab === 'assist' || d.phase === 'assist_pick') {
                    if (hasAssist()) d.p1Assist = id;
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
                state.navTab = btn.dataset.nav;
                render();
            };
        });

        const keyBtn = document.getElementById('nvbOpenKeySettingsBtn');
        if (keyBtn) {
            keyBtn.onclick = () => {
                const legacy = document.querySelector('.app-container');
                const modal = document.getElementById('keyModal');
                if (legacy) legacy.classList.remove('nvb-hidden');
                if (modal) modal.classList.remove('hidden');
            };
        }

        const backComm = document.getElementById('nvbBackArenaFromComm');
        if (backComm) backComm.onclick = () => { state.navTab = 'arena'; render(); };

        const copyStk = document.getElementById('nvbCommCopyStk');
        if (copyStk) copyStk.onclick = () => {
            navigator.clipboard?.writeText('1072917758');
            copyStk.innerText = '✓ Đã copy';
        };

        const qmBtn = document.getElementById('nvbCommQuickMatch');
        if (qmBtn) {
            qmBtn.onclick = async () => {
                const stEl = document.getElementById('nvbCommQmStatus');
                if (stEl) stEl.innerText = 'Đang tìm đối thủ...';
                const pid = 'nvb-' + Math.random().toString(36).slice(2, 8);
                try {
                    const res = await fetch('/api/matchmaking/join', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ playerId: pid, name: state.playerName })
                    });
                    const data = await res.json();
                    if (data.state === 'matched') {
                        state.roomCode = data.roomId.toUpperCase();
                        state.navTab = 'arena';
                        state.screen = 3;
                        render();
                    } else if (stEl) {
                        stEl.innerText = `Đang trong hàng đợi (${data.searching || 1} người đang tìm)...`;
                    }
                } catch (_) {
                    if (stEl) stEl.innerText = 'Không thể kết nối máy chủ ghép trận.';
                }
            };
        }
    }

    window.NvbArena = {
        show(screenNum) {
            const app = document.getElementById('nvbArenaApp');
            const legacy = document.querySelector('.app-container');
            if (legacy) legacy.classList.add('nvb-hidden');
            if (app) app.classList.remove('nvb-hidden');
            state.navTab = 'arena';
            if (screenNum) state.screen = screenNum;
            render();
        }
    };

    window.addEventListener('DOMContentLoaded', () => {
        const backBtn = document.getElementById('btnBackToNvbArena');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                if (typeof stopTceamNetplay === 'function') stopTceamNetplay();
                window.NvbArena.show(4);
            });
        }
        window.NvbArena.show(1);
    });
})();
