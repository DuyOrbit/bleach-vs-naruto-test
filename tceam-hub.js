// ==========================================
// TCEAM / ANIME BATTLE PRE-GAME HUB & LOCKSTEP ENGINE (Animugen-compatible)
// ==========================================
(function () {
    const ANIMUGEN_MEDIA_ORIGIN = 'https://animugen.vercel.app';
    const FRAME_MS = 1000 / 60;
    const MIN_DELAY = 2;
    const MAX_DELAY = 12;
    const RESEND_WINDOW = 40;
    const MAX_FRAME = 1 << 20;
    const KEEP_SEGMENTS = 3;

    function validInt(v, max) {
        return Number.isSafeInteger(v) && v >= 0 && v <= max;
    }

    function inputDelayFrames(rttMs) {
        if (!Number.isFinite(rttMs) || rttMs < 0) return 4;
        return Math.max(MIN_DELAY, Math.min(MAX_DELAY, Math.ceil((rttMs / 2 + 24) / FRAME_MS)));
    }

    class TceamLockstep {
        constructor({ slot, epoch = 1, send, readLocalMask, onDesync = () => {} }) {
            this.slot = slot === 'p2' ? 'p2' : 'p1';
            this.epoch = epoch;
            this.send = send;
            this.readLocalMask = readLocalMask;
            this.onDesync = onDesync;
            this.delay = 4;
            this.local = new Map();
            this.remote = new Map();
            this.pushed = new Map();
            this.peerAck = new Map();
            this.ownHashes = new Map();
            this.peerHashes = new Map();
            this.segment = 0;
            this.lock = false;
            this.started = false;
            this.desyncs = 0;
            this.checked = 0;
            this.stalls = 0;
            this.stalled = 0;
            this.floor = MIN_DELAY;
            this.floorUntil = 0;
            this.lowerAt = 0;
            this.windowAt = 0;
            this.windowStalls = 0;
        }

        setRtt(rttMs, now = Date.now()) {
            const floor = now < this.floorUntil ? this.floor : MIN_DELAY;
            const target = Math.max(inputDelayFrames(rttMs), floor);
            if (target > this.delay) this.delay = target;
            else if (target < this.delay && now - this.lowerAt >= 2000) {
                this.delay--;
                this.lowerAt = now;
            }
        }

        trackStalls(status, now) {
            const added = Math.max(0, (status.stalls || 0) - this.stalls);
            if (status.lock && status.frame > 30) this.windowStalls += added;
            if (now - this.windowAt < 1000) return;
            if (this.windowStalls > 6) {
                this.floor = Math.min(MAX_DELAY, this.delay + 1);
                this.floorUntil = now + 10000;
                this.delay = Math.max(this.delay, this.floor);
                this.lowerAt = now;
            }
            this.windowAt = now;
            this.windowStalls = 0;
        }

        contiguous(segment) {
            const masks = this.remote.get(segment);
            if (!masks) return -1;
            let frame = 0;
            while (masks[frame] !== undefined) frame++;
            return frame - 1;
        }

        prune() {
            for (const map of [this.local, this.remote, this.pushed, this.peerAck]) {
                for (const seg of map.keys()) if (seg < this.segment - KEEP_SEGMENTS + 1) map.delete(seg);
            }
            for (const map of [this.ownHashes, this.peerHashes]) {
                for (const key of map.keys()) if (Number(key.split(':')[0]) < this.segment - KEEP_SEGMENTS + 1) map.delete(key);
            }
        }

        update(status, now = Date.now()) {
            if (!status || !status.enabled) return [];
            if (status.frames > 0) this.started = true;
            this.trackStalls(status, now);
            this.stalls = status.stalls || 0;
            this.stalled = status.stalled || 0;
            for (const [seg, fr, hash] of (status.hashes || [])) this.recordHash(this.ownHashes, seg, fr, hash, true);
            if (status.segment > this.segment) {
                this.segment = status.segment;
                this.prune();
            }
            this.lock = Boolean(status.lock);
            const segment = this.segment;
            if (this.lock && segment) {
                const masks = this.local.get(segment) || [];
                this.local.set(segment, masks);
                const target = Math.min(MAX_FRAME, status.frame + this.delay);
                const mask = this.started ? (this.readLocalMask() & 1023) : 0;
                while (masks.length <= target) masks.push(mask);
            }
            this.flush();
            return this.ready(segment);
        }

        ready(segment) {
            const local = this.local.get(segment);
            const remote = this.remote.get(segment);
            if (!local || !remote) return [];
            const frames = [];
            let frame = this.pushed.get(segment) || 0;
            while (local[frame] !== undefined && remote[frame] !== undefined) {
                frames.push(this.slot === 'p1' ? [segment, frame, local[frame], remote[frame]] : [segment, frame, remote[frame], local[frame]]);
                frame++;
            }
            this.pushed.set(segment, frame);
            return frames;
        }

        flush() {
            const segments = [...this.local.keys()].filter(s => s >= this.segment - 1).sort((a, b) => a - b);
            if (!segments.includes(this.segment) && this.segment) segments.push(this.segment);
            for (const segment of segments) {
                const masks = this.local.get(segment) || [];
                const acked = this.peerAck.get(segment) ?? -1;
                const end = masks.length;
                if (segment < this.segment && acked >= end - 1) continue;
                const start = Math.max(acked + 1, end - RESEND_WINDOW);
                const text = 'f|' + this.epoch + '|' + segment + '|' + start + '|' + masks.slice(start, end).join(',') + '|' + this.contiguous(segment);
                this.send(text);
            }
        }

        receive(text) {
            if (typeof text !== 'string' || text.length > 512) return false;
            const parts = text.split('|');
            const epoch = Number(parts[1]);
            if (!validInt(epoch, 1e9) || epoch !== this.epoch) return false;
            if (parts[0] === 'f' && parts.length === 6) {
                const segment = Number(parts[2]), start = Number(parts[3]), ack = Number(parts[5]);
                const masks = parts[4] ? parts[4].split(',').map(Number) : [];
                if (!validInt(segment, 1e6) || !validInt(start, MAX_FRAME) || !Number.isSafeInteger(ack) || ack < -1 || ack > MAX_FRAME || masks.length > RESEND_WINDOW || !masks.every(m => validInt(m, 1023))) return false;
                const remote = this.remote.get(segment) || [];
                this.remote.set(segment, remote);
                masks.forEach((m, offset) => { if (remote[start + offset] === undefined) remote[start + offset] = m; });
                if (ack > (this.peerAck.get(segment) ?? -1)) this.peerAck.set(segment, ack);
                return true;
            }
            if (parts[0] === 'h' && parts.length === 5) {
                const segment = Number(parts[2]), frame = Number(parts[3]), hash = Number(parts[4]);
                if (!validInt(segment, 1e6) || !validInt(frame, MAX_FRAME) || !Number.isSafeInteger(hash)) return false;
                this.recordHash(this.peerHashes, segment, frame, hash, false);
                return true;
            }
            return false;
        }

        recordHash(own, segment, frame, hash, local) {
            const key = segment + ':' + frame;
            const other = (local ? this.peerHashes : this.ownHashes).get(key);
            if (local) this.send('h|' + this.epoch + '|' + segment + '|' + frame + '|' + hash);
            if (other === undefined) {
                own.set(key, hash);
                return;
            }
            (local ? this.peerHashes : this.ownHashes).delete(key);
            this.checked++;
            if (other !== hash) {
                this.desyncs++;
                this.onDesync({ segment, frame });
            }
        }

        stats() {
            return { delay: this.delay, segment: this.segment, lock: this.lock, started: this.started, stalls: this.stalls, stalled: this.stalled, desyncs: this.desyncs, checked: this.checked };
        }
    }

    // ==========================================
    // TCEAM PRE-GAME HUB STATE & UI
    // ==========================================
    let catalog = null;
    let hubState = {
        mode: 'cpu',         // 'cpu' | 'local' | 'training' | 'arcade' | 'online'
        teamSize: 1,         // 1 | 2 | 3
        p1: ['一护'],
        p2: ['鸣人'],
        p1Assist: null,
        p2Assist: null,
        map: 'xianshi',
        cpuLevel: 3,
        hp: 1,
        time: 60,
        bestOf: 3,
        activeSlot: 'p1',    // 'p1' | 'p2' | 'p1Assist' | 'p2Assist'
        seriesFilter: 'all',
        search: '',
        inMatch: false,
        qmStatus: 'idle',    // 'idle' | 'searching' | 'matched'
        qmPlayerId: 'p-' + Math.random().toString(36).slice(2, 10),
        qmTimer: null
    };

    const MODE_CARDS = [
        { id: 'cpu', icon: '🤖', title: 'VS Máy (CPU)', desc: 'Đấu với AI 6 cấp độ' },
        { id: 'local', icon: '👥', title: 'VS Người (2P)', desc: 'Đấu 2 người trên cùng máy' },
        { id: 'training', icon: '🎯', title: 'Tập Luyện', desc: 'Luyện combo không giới hạn' },
        { id: 'arcade', icon: '🏆', title: 'Chiến Dịch', desc: 'Vượt ải Arcade nguyên bản' },
        { id: 'online', icon: '🌐', title: 'Online 1v1', desc: 'Lockstep 0MB Video • Ghép trận' }
    ];

    function portraitUrl(p) {
        if (!p) return '';
        return p.startsWith('http') ? p : (ANIMUGEN_MEDIA_ORIGIN + p);
    }

    async function loadCatalog() {
        if (catalog) return catalog;
        try {
            const res = await fetch('assets/tceam-catalog.json');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            catalog = await res.json();
            // Ensure defaults exist in catalog
            const fighters = (catalog.entries || []).filter(e => e.kind === 'fighter' && e.available && e.selectable !== false);
            if (fighters.length >= 2) {
                if (!fighters.some(f => f.id === hubState.p1[0])) hubState.p1 = [fighters[0].id];
                if (!fighters.some(f => f.id === hubState.p2[0])) hubState.p2 = [fighters[1].id];
            }
            if (catalog.maps && catalog.maps.length && !catalog.maps.some(m => m.id === hubState.map)) {
                hubState.map = catalog.maps[0].id;
            }
        } catch (err) {
            console.error('[TCEAM Hub] Không thể tải assets/tceam-catalog.json:', err);
            catalog = { entries: [], series: [], maps: [] };
        }
        return catalog;
    }

    function findEntry(id) {
        if (!catalog || !id) return null;
        return (catalog.entries || []).find(e => e.id === id) || null;
    }

    function buildMatchRequest() {
        const nativeMode = hubState.mode === 'online' ? 'local' : hubState.mode;
        const req = {
            schemaVersion: 1,
            mode: nativeMode,
            p1: hubState.p1.slice(0, hubState.teamSize),
            p2: nativeMode === 'arcade' ? [] : hubState.p2.slice(0, hubState.teamSize),
            p1Assist: hubState.p1Assist || null,
            p2Assist: nativeMode === 'arcade' ? null : (hubState.p2Assist || null),
            map: hubState.map || 'xianshi',
            hp: Number(hubState.hp) || 1,
            time: Number(hubState.time) || 60,
            bestOf: Number(hubState.bestOf) || 3
        };
        if (nativeMode === 'cpu') req.cpuLevel = Number(hubState.cpuLevel) || 3;
        return req;
    }

    function renderHub() {
        const root = document.getElementById('tceamHub');
        if (!root) return;

        const isOnline = hubState.mode === 'online';
        if (isOnline && hubState.teamSize !== 1) hubState.teamSize = 1;

        const fighters = (catalog?.entries || []).filter(e => e.kind === 'fighter' && e.available && e.selectable !== false);
        const assists = (catalog?.entries || []).filter(e => e.kind === 'assist' && e.available && e.selectable !== false);
        const isAssistSlot = hubState.activeSlot === 'p1Assist' || hubState.activeSlot === 'p2Assist';
        const q = hubState.search.trim().toLowerCase();

        const pool = (isAssistSlot ? assists : fighters).filter(item => {
            if (hubState.seriesFilter !== 'all' && item.seriesId !== hubState.seriesFilter) return false;
            if (!q) return true;
            return (item.name || '').toLowerCase().includes(q)
                || (item.familyName || '').toLowerCase().includes(q)
                || (item.id || '').toLowerCase().includes(q);
        });

        const renderTeamSlots = (role) => {
            const list = hubState[role];
            const label = role === 'p1' ? '🔴 P1 (Bạn)' : (hubState.mode === 'cpu' ? '🤖 P2 (CPU)' : '🔵 P2');
            const disabled = hubState.mode === 'arcade' && role === 'p2';
            if (disabled) {
                return `<div class="th-team-box disabled"><div class="th-team-title">${label}</div><div class="th-muted">Tự động theo ải Arcade</div></div>`;
            }
            let html = `<div class="th-team-box ${hubState.activeSlot === role ? 'active' : ''}" data-slot="${role}">
                <div class="th-team-title">${label}</div><div class="th-slots-row">`;
            for (let i = 0; i < hubState.teamSize; i++) {
                const f = findEntry(list[i] || list[0]);
                const pUrl = f ? portraitUrl(f.portrait) : '';
                html += `<div class="th-slot-chip" title="${f ? f.name : ''}">
                    ${pUrl ? `<img src="${pUrl}" alt="">` : '👤'}
                    <span>${f ? (f.familyName || f.name).split(' - ')[0] : 'Chọn'}</span>
                </div>`;
            }
            const assistKey = role === 'p1' ? 'p1Assist' : 'p2Assist';
            const aEntry = findEntry(hubState[assistKey]);
            html += `<div class="th-slot-chip assist ${hubState.activeSlot === assistKey ? 'active' : ''}" data-slot="${assistKey}">
                ${aEntry && aEntry.portrait ? `<img src="${portraitUrl(aEntry.portrait)}" alt="">` : '⚡'}
                <span>${aEntry ? aEntry.name : 'Trợ thủ: Không'}</span>
            </div>`;
            html += `</div></div>`;
            return html;
        };

        const mapsHtml = (catalog?.maps || []).map(m =>
            `<option value="${m.id}" ${m.id === hubState.map ? 'selected' : ''}>${m.name} (${m.id})</option>`
        ).join('');

        const seriesList = (catalog?.series || []).map(s =>
            `<button class="th-filter-btn ${hubState.seriesFilter === s.id ? 'active' : ''}" data-series="${s.id}">${s.label}</button>`
        ).join('');

        const cardsHtml = pool.slice(0, 120).map(item => {
            const selected = isAssistSlot
                ? (hubState[hubState.activeSlot] === item.id)
                : hubState[hubState.activeSlot]?.includes(item.id);
            const pUrl = portraitUrl(item.portrait);
            return `<button class="th-char-card ${selected ? 'selected' : ''}" data-id="${item.id}" title="${item.name}">
                <div class="th-char-img">${pUrl ? `<img loading="lazy" src="${pUrl}" alt="${item.name}">` : '👤'}</div>
                <div class="th-char-name">${item.name}</div>
            </button>`;
        }).join('');

        root.innerHTML = `
            <div class="th-shell">
                <div class="th-topbar">
                    <div class="th-brand">🔥 ANIME BATTLE (TCEAM) <span>• Chọn chế độ & tướng trước, bấm Đánh mới nạp game</span></div>
                    <div class="th-team-size">
                        <span>Đội hình:</span>
                        ${[1, 2, 3].map(n => `<button class="th-size-btn ${hubState.teamSize === n ? 'active' : ''}" data-size="${n}" ${isOnline && n > 1 ? 'disabled' : ''}>${n}v${n}</button>`).join('')}
                    </div>
                </div>

                <div class="th-modes-row">
                    ${MODE_CARDS.map(m => `
                        <button class="th-mode-card ${hubState.mode === m.id ? 'active' : ''}" data-mode="${m.id}">
                            <span class="th-mode-icon">${m.icon}</span>
                            <span class="th-mode-info"><strong>${m.title}</strong><small>${m.desc}</small></span>
                        </button>
                    `).join('')}
                </div>

                ${isOnline ? `
                <div class="th-online-bar">
                    <div class="th-online-left">
                        <button id="thBtnQuickMatch" class="btn btn-primary btn-sm">
                            ${hubState.qmStatus === 'searching' ? '⏳ Đang tìm đối thủ... (Bấm để hủy)' : '⚡ Tìm Trận Ngẫu Nhiên (Quick Match)'}
                        </button>
                        <span id="thQmStatusText" class="th-muted">${hubState.qmStatus === 'matched' ? '✅ Đã ghép trận! Đang vào phòng...' : 'Hoặc dùng bảng Tạo/Vào phòng bên dưới'}</span>
                    </div>
                </div>` : ''}

                <div class="th-teams-grid">
                    ${renderTeamSlots('p1')}
                    <div class="th-center-rules">
                        <label>🗺️ Bản đồ:
                            <select id="thMapSelect">${mapsHtml}</select>
                        </label>
                        <div class="th-rules-mini">
                            <label>HP: <select id="thHpSelect">${[0.5,1,2,3,5].map(v => `<option value="${v}" ${hubState.hp===v?'selected':''}>${v}x</option>`).join('')}</select></label>
                            <label>Giờ: <select id="thTimeSelect">${[30,60,90,-1].map(v => `<option value="${v}" ${hubState.time===v?'selected':''}>${v===-1?'∞':v+'s'}</option>`).join('')}</select></label>
                            <label>Bo: <select id="thBoSelect">${[1,3,5].map(v => `<option value="${v}" ${hubState.bestOf===v?'selected':''}>Bo${v}</option>`).join('')}</select></label>
                            ${hubState.mode === 'cpu' ? `<label>AI: <select id="thCpuSelect">${[1,2,3,4,5,6].map(v => `<option value="${v}" ${hubState.cpuLevel===v?'selected':''}>Lv${v}</option>`).join('')}</select></label>` : ''}
                        </div>
                        <button id="thBtnStartMatch" class="btn btn-primary th-launch-btn">⚔️ VÀO TRẬN NGAY (NẠP GAME)</button>
                    </div>
                    ${renderTeamSlots('p2')}
                </div>

                <div class="th-roster-bar">
                    <div class="th-filters">
                        <button class="th-filter-btn ${hubState.seriesFilter === 'all' ? 'active' : ''}" data-series="all">Tất cả (${pool.length})</button>
                        ${seriesList}
                        ${isAssistSlot ? `<button id="thBtnClearAssist" class="th-filter-btn">❌ Bỏ Trợ thủ</button>` : ''}
                    </div>
                    <input id="thSearchInput" type="text" placeholder="🔍 Tìm trong 493+ form tướng..." value="${hubState.search.replace(/"/g, '&quot;')}">
                </div>

                <div class="th-char-grid">${cardsHtml || '<div class="th-muted">Không tìm thấy nhân vật phù hợp</div>'}</div>
            </div>
        `;

        // Bind events
        root.querySelectorAll('.th-mode-card').forEach(btn => {
            btn.onclick = () => {
                hubState.mode = btn.dataset.mode;
                if (hubState.mode === 'online') hubState.teamSize = 1;
                renderHub();
            };
        });
        root.querySelectorAll('.th-size-btn').forEach(btn => {
            btn.onclick = () => {
                hubState.teamSize = Number(btn.dataset.size) || 1;
                while (hubState.p1.length < hubState.teamSize) hubState.p1.push(hubState.p1[0]);
                while (hubState.p2.length < hubState.teamSize) hubState.p2.push(hubState.p2[0]);
                renderHub();
            };
        });
        root.querySelectorAll('[data-slot]').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                hubState.activeSlot = el.dataset.slot;
                renderHub();
            };
        });
        root.querySelectorAll('.th-filter-btn[data-series]').forEach(btn => {
            btn.onclick = () => { hubState.seriesFilter = btn.dataset.series; renderHub(); };
        });
        const clearAssistBtn = root.querySelector('#thBtnClearAssist');
        if (clearAssistBtn) {
            clearAssistBtn.onclick = () => {
                if (hubState.activeSlot === 'p1Assist' || hubState.activeSlot === 'p2Assist') {
                    hubState[hubState.activeSlot] = null;
                    renderHub();
                }
            };
        }
        const searchEl = root.querySelector('#thSearchInput');
        if (searchEl) {
            searchEl.oninput = () => {
                hubState.search = searchEl.value;
                renderHub();
                const ref = root.querySelector('#thSearchInput');
                if (ref) { ref.focus(); ref.setSelectionRange(ref.value.length, ref.value.length); }
            };
        }
        root.querySelectorAll('.th-char-card').forEach(btn => {
            btn.onclick = () => {
                const id = btn.dataset.id;
                if (hubState.activeSlot === 'p1Assist' || hubState.activeSlot === 'p2Assist') {
                    hubState[hubState.activeSlot] = id;
                } else {
                    const arr = hubState[hubState.activeSlot];
                    if (hubState.teamSize === 1) {
                        hubState[hubState.activeSlot] = [id];
                    } else {
                        const idx = arr.indexOf(id);
                        if (idx !== -1 && arr.length > 1) arr.splice(idx, 1);
                        else if (arr.length < hubState.teamSize) arr.push(id);
                        else { arr.shift(); arr.push(id); }
                    }
                    if (typeof window.sendTceamLobbySelection === 'function') {
                        window.sendTceamLobbySelection(hubState);
                    }
                }
                renderHub();
            };
        });
        const mapSel = root.querySelector('#thMapSelect');
        if (mapSel) mapSel.onchange = () => { hubState.map = mapSel.value; };
        const hpSel = root.querySelector('#thHpSelect');
        if (hpSel) hpSel.onchange = () => { hubState.hp = Number(hpSel.value); };
        const timeSel = root.querySelector('#thTimeSelect');
        if (timeSel) timeSel.onchange = () => { hubState.time = Number(timeSel.value); };
        const boSel = root.querySelector('#thBoSelect');
        if (boSel) boSel.onchange = () => { hubState.bestOf = Number(boSel.value); };
        const cpuSel = root.querySelector('#thCpuSelect');
        if (cpuSel) cpuSel.onchange = () => { hubState.cpuLevel = Number(cpuSel.value); };

        const qmBtn = root.querySelector('#thBtnQuickMatch');
        if (qmBtn) qmBtn.onclick = toggleQuickMatch;

        const startBtn = root.querySelector('#thBtnStartMatch');
        if (startBtn) {
            startBtn.onclick = () => {
                const req = buildMatchRequest();
                if (typeof window.launchTceamMatch === 'function') {
                    window.launchTceamMatch(req, hubState.mode === 'online');
                }
            };
        }
    }

    async function toggleQuickMatch() {
        if (hubState.qmStatus === 'searching') {
            if (hubState.qmTimer) { clearInterval(hubState.qmTimer); hubState.qmTimer = null; }
            hubState.qmStatus = 'idle';
            fetch('/api/matchmaking/leave', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId: hubState.qmPlayerId })
            }).catch(() => {});
            renderHub();
            return;
        }

        hubState.qmStatus = 'searching';
        renderHub();
        try {
            const res = await fetch('/api/matchmaking/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerId: hubState.qmPlayerId, name: 'Player-' + hubState.qmPlayerId.slice(2, 6) })
            });
            const data = await res.json();
            if (data.state === 'matched') {
                onQuickMatchFound(data);
                return;
            }
        } catch (e) {}

        hubState.qmTimer = setInterval(async () => {
            try {
                const r = await fetch(`/api/matchmaking/status?playerId=${encodeURIComponent(hubState.qmPlayerId)}`);
                const d = await r.json();
                if (d.state === 'matched') {
                    clearInterval(hubState.qmTimer);
                    hubState.qmTimer = null;
                    onQuickMatchFound(d);
                }
            } catch (_) {}
        }, 1800);
    }

    function onQuickMatchFound(data) {
        hubState.qmStatus = 'matched';
        renderHub();
        if (typeof window.handleQuickMatchFound === 'function') {
            window.handleQuickMatchFound(data);
        }
    }

    window.TceamLockstep = TceamLockstep;
    window.TceamHub = {
        async show() {
            await loadCatalog();
            const el = document.getElementById('tceamHub');
            if (el) el.classList.remove('hidden');
            hubState.inMatch = false;
            renderHub();
        },
        hide() {
            const el = document.getElementById('tceamHub');
            if (el) el.classList.add('hidden');
            hubState.inMatch = true;
        },
        getState() { return hubState; },
        buildMatchRequest,
        applyRemoteSelection(sel) {
            if (!sel) return;
            if (Array.isArray(sel.p1)) hubState.p1 = sel.p1;
            if (Array.isArray(sel.p2)) hubState.p2 = sel.p2;
            if (sel.map) hubState.map = sel.map;
            if (!hubState.inMatch) renderHub();
        }
    };
})();
