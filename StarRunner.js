(() => {
    const groundY = 188;
    const gravity = 0.58;
    const baseWidth = 640;
    const baseHeight = 220;

    let state = null;
    let rafId = 0;
    let keysBound = false;

    function el(id) {
        return document.getElementById(id);
    }

    function canvas() {
        return el("runner-game");
    }

    function ctx() {
        return canvas()?.getContext("2d") || null;
    }

    function setStatus(text) {
        const status = el("runner-status");
        if (status) status.textContent = text;
    }

    function setScore(value) {
        const score = el("runner-score");
        if (score) score.textContent = String(Math.floor(value));
    }

    function resetState() {
        cancelAnimationFrame(rafId);
        const now = performance.now();
        state = {
            phase: "countdown",
            countdownFrom: now,
            lastTime: now,
            startTime: 0,
            score: 100,
            speed: 4.8,
            nextSpawn: 170,
            player: { x: 64, y: groundY - 46, w: 24, h: 46, vy: 0, grounded: true, holdMs: 0, holding: false },
            enemies: [],
            passed: 0,
            gameOverAt: 0
        };
        setScore(state.score);
        setStatus("3");
    }

    function start() {
        if (!canvas()) return;
        bindControls();
        resetState();
        rafId = requestAnimationFrame(frame);
    }

    function jump() {
        if (!state || state.phase === "gameover") return;
        if (state.phase === "countdown") return;
        const p = state.player;
        if (p.grounded) {
            p.vy = -7.9;
            p.grounded = false;
            p.holding = true;
            p.holdMs = 0;
        }
    }

    function holdStart() {
        jump();
        if (state?.player) state.player.holding = true;
    }

    function holdEnd() {
        if (state?.player) state.player.holding = false;
    }

    function spawnEnemy() {
        const lastEnemy = state.enemies[state.enemies.length - 1];
        const minimumGap = 220 + state.speed * 18;
        if (lastEnemy && lastEnemy.x > baseWidth - minimumGap) {
            state.nextSpawn = 34;
            return;
        }
        const groundTypes = ["croc", "horse", "ostrich", "elephant"];
        const air = Math.random() < 0.28;
        const type = air ? "condor" : groundTypes[Math.floor(Math.random() * groundTypes.length)];
        const sizes = {
            croc: { w: 58, h: 18, y: groundY - 18 },
            horse: { w: 42, h: 34, y: groundY - 34 },
            ostrich: { w: 28, h: 58, y: groundY - 58 },
            elephant: { w: 72, h: 52, y: groundY - 52 },
            condor: { w: 48, h: 24, y: 72 + Math.random() * 36 }
        };
        const size = sizes[type];
        state.enemies.push({ ...size, type, x: baseWidth + 24, scored: false });
        state.nextSpawn = 180 + Math.random() * 155 - Math.min(34, state.speed * 2);
    }

    function frame(time) {
        if (!state) return;
        const c = canvas();
        const context = ctx();
        if (!c || !context) return;
        const dtMs = Math.min(40, time - state.lastTime);
        const dt = dtMs / 16.67;
        state.lastTime = time;

        if (state.phase === "countdown") {
            draw(context, c, time);
            const elapsed = time - state.countdownFrom;
            if (elapsed >= 3500) {
                state.phase = "running";
                state.startTime = time;
                state.lastTime = time;
                setStatus("START!");
            } else {
                const remaining = Math.max(1, 3 - Math.floor(elapsed / 1000));
                setStatus(String(remaining));
            }
            rafId = requestAnimationFrame(frame);
            return;
        }

        if (state.phase !== "running") {
            draw(context, c, time);
            return;
        }

        const playSeconds = (time - state.startTime) / 1000;
        state.speed = 4.8 + Math.min(8.8, playSeconds * 0.13);
        state.score += dt * Math.max(0.35, state.speed * 0.28);

        const p = state.player;
        if (p.holding && !p.grounded && p.holdMs < 240) {
            p.vy -= 0.38 * dt;
            p.holdMs += dtMs;
        }
        p.vy += gravity * dt;
        p.y += p.vy * dt;
        if (p.y >= groundY - p.h) {
            p.y = groundY - p.h;
            p.vy = 0;
            p.grounded = true;
            p.holding = false;
        }

        state.nextSpawn -= state.speed * dt;
        if (state.nextSpawn <= 0) spawnEnemy();

        state.enemies.forEach(enemy => {
            enemy.x -= state.speed * dt;
            if (!enemy.scored && enemy.x + enemy.w < p.x) {
                enemy.scored = true;
                state.passed += 1;
                state.score += Math.round(170 + state.speed * 36);
            }
        });
        state.enemies = state.enemies.filter(enemy => enemy.x > -120);

        const hit = state.enemies.some(enemy => intersects(p, enemy, 5));
        if (hit) {
            state.phase = "gameover";
            state.gameOverAt = time;
            setStatus(`GAME OVER / Score ${Math.floor(state.score)} / ${playSeconds.toFixed(1)}s`);
        }

        setScore(state.score);
        draw(context, c, time);
        if (state.phase === "running") rafId = requestAnimationFrame(frame);
    }

    function intersects(a, b, pad = 0) {
        return a.x + pad < b.x + b.w - pad
            && a.x + a.w - pad > b.x + pad
            && a.y + pad < b.y + b.h - pad
            && a.y + a.h - pad > b.y + pad;
    }

    function draw(context, c, time) {
        context.clearRect(0, 0, c.width, c.height);
        context.fillStyle = "#e0f2fe";
        context.fillRect(0, 0, c.width, c.height);
        drawBackground(context, time);
        context.fillStyle = "#bae6fd";
        context.fillRect(0, groundY, c.width, 5);
        if (state) {
            state.enemies.forEach(enemy => drawEnemy(context, enemy));
            drawRunner(context, state.player, time);
            drawOverlay(context, time);
        }
    }

    function drawBackground(context, time) {
        context.fillStyle = "#fef3c7";
        context.beginPath();
        context.arc(560, 38, 18, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#7dd3fc";
        for (let x = -((time / 30) % 110); x < baseWidth; x += 110) {
            context.fillRect(x, groundY + 12, 54, 3);
        }
    }

    function drawRunner(context, p, time) {
        const step = Math.sin(time / 90) * 5;
        context.strokeStyle = "#075985";
        context.lineWidth = 4;
        context.lineCap = "round";
        context.fillStyle = "#fde68a";
        context.beginPath();
        context.arc(p.x + 13, p.y + 10, 8, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.moveTo(p.x + 13, p.y + 20);
        context.lineTo(p.x + 13, p.y + 34);
        context.moveTo(p.x + 13, p.y + 24);
        context.lineTo(p.x + 3, p.y + 30 + step / 2);
        context.moveTo(p.x + 13, p.y + 24);
        context.lineTo(p.x + 25, p.y + 28 - step / 2);
        context.moveTo(p.x + 13, p.y + 34);
        context.lineTo(p.x + 4, p.y + 45 - step);
        context.moveTo(p.x + 13, p.y + 34);
        context.lineTo(p.x + 24, p.y + 45 + step);
        context.stroke();
    }

    function drawEnemy(context, enemy) {
        context.save();
        context.translate(enemy.x, enemy.y);
        if (enemy.type === "croc") drawCroc(context, enemy);
        if (enemy.type === "horse") drawHorse(context, enemy);
        if (enemy.type === "ostrich") drawOstrich(context, enemy);
        if (enemy.type === "elephant") drawElephant(context, enemy);
        if (enemy.type === "condor") drawCondor(context, enemy);
        context.restore();
    }

    function drawCroc(context, e) {
        context.fillStyle = "#15803d";
        context.fillRect(0, 8, e.w - 10, 10);
        context.fillRect(e.w - 16, 4, 16, 12);
        context.fillStyle = "#bbf7d0";
        context.fillRect(8, 14, 28, 3);
    }

    function drawHorse(context, e) {
        context.fillStyle = "#92400e";
        context.fillRect(8, 12, 28, 14);
        context.fillRect(30, 5, 10, 14);
        context.fillRect(10, 24, 5, 10);
        context.fillRect(28, 24, 5, 10);
    }

    function drawOstrich(context, e) {
        context.fillStyle = "#334155";
        context.fillRect(10, 26, 14, 16);
        context.fillRect(17, 0, 5, 30);
        context.fillStyle = "#fbbf24";
        context.fillRect(14, 42, 4, 16);
        context.fillRect(23, 42, 4, 16);
    }

    function drawElephant(context, e) {
        context.fillStyle = "#64748b";
        context.fillRect(8, 14, 48, 26);
        context.fillRect(48, 8, 18, 22);
        context.fillRect(56, 26, 8, 18);
        context.fillRect(14, 38, 8, 14);
        context.fillRect(44, 38, 8, 14);
    }

    function drawCondor(context, e) {
        context.fillStyle = "#78350f";
        context.beginPath();
        context.moveTo(2, 14);
        context.lineTo(18, 4);
        context.lineTo(30, 14);
        context.lineTo(46, 6);
        context.lineTo(32, 22);
        context.lineTo(16, 22);
        context.closePath();
        context.fill();
    }

    function drawOverlay(context, time) {
        if (state.phase === "countdown") {
            const elapsed = time - state.countdownFrom;
            const label = elapsed >= 3000 ? "START!" : String(Math.max(1, 3 - Math.floor(elapsed / 1000)));
            drawCenterText(context, label, "#075985");
        }
        if (state.phase === "gameover") {
            const playSeconds = ((state.gameOverAt || performance.now()) - state.startTime) / 1000;
            context.fillStyle = "rgba(15, 23, 42, 0.72)";
            context.fillRect(0, 0, baseWidth, baseHeight);
            drawCenterText(context, `GAME OVER\nScore ${Math.floor(state.score)}\nTime ${playSeconds.toFixed(1)}s`, "#fff");
        }
    }

    function drawCenterText(context, text, color) {
        const lines = String(text).split("\n");
        context.fillStyle = color;
        context.textAlign = "center";
        context.font = "bold 26px sans-serif";
        lines.forEach((line, index) => context.fillText(line, baseWidth / 2, 82 + index * 32));
        context.textAlign = "left";
    }

    function bindControls() {
        if (keysBound) return;
        keysBound = true;
        document.addEventListener("keydown", event => {
            if (event.code === "Space" && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") {
                event.preventDefault();
                holdStart();
            }
        });
        document.addEventListener("keyup", event => {
            if (event.code === "Space") holdEnd();
        });
        const c = canvas();
        if (c) {
            c.addEventListener("pointerdown", holdStart);
            c.addEventListener("pointerup", holdEnd);
            c.addEventListener("pointerleave", holdEnd);
        }
    }

    function debug(mode) {
        const log = el("ops-game-debug-log");
        if (log) log.textContent = `StarRunner.js active / ${mode || "default"} / ${new Date().toLocaleTimeString()}`;
    }

    window.StarRunner = {
        start,
        jump,
        holdStart,
        holdEnd,
        debug,
        sourceHint: "// StarRunner.js は C:/Users/ktmr2/Downloads/test/StarRunner.js に分離されています。"
    };
    window.startRunnerGame = start;
    window.runnerJump = jump;
    window.runnerHoldStart = holdStart;
    window.runnerHoldEnd = holdEnd;
    window.opsRunnerDebug = debug;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindControls);
    } else {
        bindControls();
    }
})();
