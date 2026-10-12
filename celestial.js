// ══════════════════════════════════════════════════════════════════════════
// ORBIT MESSENGER — LIVE CELESTIAL CANVAS ENGINE
// Living Space with Slit View & Shooting Stars (Dark Mode)
// Live East-to-West Sun Arc, Clouds, Moon & Flying Silhouettes (Day Mode)
// ══════════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    let canvas = null;
    let ctx = null;
    let animationFrameId = null;
    let isRunning = false;
    let width = 0;
    let height = 0;
    let dpr = 1;

    // Starfield state
    const stars = [];
    const NUM_STARS = 220;

    // Shooting stars (meteors)
    const shootingStars = [];
    let nextShootingStarTime = 0;

    // Clouds for day mode
    const clouds = [];
    const NUM_CLOUDS = 6;

    // Birds for day mode
    const birds = [];
    let nextBirdSpawnTime = 0;

    // Slit view aurora wave
    let auroraPhase = 0;

    function initCelestialEngine() {
        canvas = document.getElementById('orbit-celestial-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'orbit-celestial-canvas';
            canvas.className = 'orbit-celestial-canvas';
            document.body.prepend(canvas);
        }

        ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        handleResize();
        window.addEventListener('resize', handleResize, { passive: true });

        // Initialize stars
        initStars();

        // Initialize clouds
        initClouds();

        // Page visibility handling for 0% CPU when tab is hidden
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopAnimation();
            } else {
                startAnimation();
            }
        });

        startAnimation();
    }

    function handleResize() {
        if (!canvas) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        if (ctx) ctx.scale(dpr, dpr);
    }

    function initStars() {
        stars.length = 0;
        for (let i = 0; i < NUM_STARS; i++) {
            stars.push({
                x: Math.random() * (width || window.innerWidth),
                y: Math.random() * (height || window.innerHeight),
                radius: Math.random() * 1.5 + 0.5,
                baseAlpha: Math.random() * 0.7 + 0.25,
                twinkleSpeed: Math.random() * 0.03 + 0.01,
                twinklePhase: Math.random() * Math.PI * 2,
                colorType: Math.random() > 0.85 ? 'gold' : (Math.random() > 0.7 ? 'blue' : 'white')
            });
        }
    }

    function initClouds() {
        clouds.length = 0;
        for (let i = 0; i < NUM_CLOUDS; i++) {
            clouds.push({
                x: Math.random() * (width || window.innerWidth),
                y: Math.random() * (height ? height * 0.45 : 300) + 40,
                width: Math.random() * 180 + 120,
                height: Math.random() * 40 + 30,
                speed: Math.random() * 0.25 + 0.1,
                opacity: Math.random() * 0.35 + 0.2
            });
        }
    }

    function spawnShootingStar() {
        const startX = Math.random() * (width * 0.8) + width * 0.1;
        const startY = Math.random() * (height * 0.35) + 20;
        const angle = (Math.PI / 180) * (Math.random() * 20 + 25); // 25 to 45 degrees downward
        const speed = Math.random() * 10 + 14;
        const length = Math.random() * 90 + 70;

        shootingStars.push({
            x: startX,
            y: startY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            length: length,
            life: 1.0,
            decay: Math.random() * 0.02 + 0.015,
            width: Math.random() * 1.8 + 1.2
        });
    }

    function spawnBirdFlock() {
        const count = Math.floor(Math.random() * 3) + 2; // 2 to 4 birds
        const startY = Math.random() * (height * 0.38) + 60;
        const speed = Math.random() * 0.8 + 0.9;
        const baseWingSpeed = Math.random() * 0.12 + 0.08;

        for (let i = 0; i < count; i++) {
            birds.push({
                x: -50 - (i * 26),
                y: startY + (i * 12) + (Math.random() * 8 - 4),
                speed: speed,
                wingPhase: Math.random() * Math.PI,
                wingSpeed: baseWingSpeed,
                size: Math.random() * 3 + 5
            });
        }
    }

    // Main render loop
    function render(timestamp) {
        if (!isRunning || !ctx) return;

        ctx.clearRect(0, 0, width, height);

        const isLightMode = document.body.classList.contains('light-mode');
        const now = new Date();
        const currentHour = now.getHours() + now.getMinutes() / 60;

        if (isLightMode) {
            renderDayMode(currentHour);
        } else {
            renderNightMode(timestamp);
        }

        animationFrameId = requestAnimationFrame(render);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // NIGHT MODE: Living Space with Slit View & Shooting Stars
    // ──────────────────────────────────────────────────────────────────────────
    function renderNightMode(timestamp) {
        // 1. Ambient Slit View / Cosmic Aura Ribbon
        auroraPhase += 0.006;
        const slitGrad = ctx.createLinearGradient(0, 0, width, height * 0.85);
        const slitAlpha = 0.07 + Math.sin(auroraPhase) * 0.025;
        slitGrad.addColorStop(0, `rgba(147, 51, 234, ${slitAlpha * 1.3})`);    // Cosmic violet
        slitGrad.addColorStop(0.35, `rgba(59, 130, 246, ${slitAlpha})`);       // Deep nebula cyan
        slitGrad.addColorStop(0.7, `rgba(255, 46, 99, ${slitAlpha * 0.8})`);   // Orbit neon ruby
        slitGrad.addColorStop(1, 'rgba(6, 7, 11, 0)');

        ctx.fillStyle = slitGrad;
        ctx.fillRect(0, 0, width, height);

        // Angled Slit Beam (Soft diagonal light streak across the upper view)
        ctx.save();
        ctx.translate(width * 0.5, height * 0.25);
        ctx.rotate(-0.28);
        const beamGrad = ctx.createLinearGradient(-width * 0.8, 0, width * 0.8, 0);
        beamGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        beamGrad.addColorStop(0.5, `rgba(180, 200, 255, ${0.045 + Math.cos(auroraPhase * 0.7) * 0.015})`);
        beamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = beamGrad;
        ctx.fillRect(-width * 0.8, -80, width * 1.6, 160);
        ctx.restore();

        // 2. Twinkling Starfield
        for (let i = 0; i < stars.length; i++) {
            const s = stars[i];
            s.twinklePhase += s.twinkleSpeed;
            const currentAlpha = Math.max(0.1, s.baseAlpha + Math.sin(s.twinklePhase) * 0.35);

            ctx.beginPath();
            ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);

            if (s.colorType === 'gold') {
                ctx.fillStyle = `rgba(255, 220, 120, ${currentAlpha})`;
            } else if (s.colorType === 'blue') {
                ctx.fillStyle = `rgba(160, 210, 255, ${currentAlpha})`;
            } else {
                ctx.fillStyle = `rgba(255, 255, 255, ${currentAlpha})`;
            }
            ctx.fill();
        }

        // 3. Shooting Stars (Meteors)
        if (timestamp > nextShootingStarTime) {
            spawnShootingStar();
            nextShootingStarTime = timestamp + Math.random() * 3500 + 2500; // Next in 2.5s to 6s
        }

        for (let i = shootingStars.length - 1; i >= 0; i--) {
            const ss = shootingStars[i];
            ss.x += ss.vx;
            ss.y += ss.vy;
            ss.life -= ss.decay;

            if (ss.life <= 0 || ss.x > width + 100 || ss.y > height + 100) {
                shootingStars.splice(i, 1);
                continue;
            }

            const tailX = ss.x - (ss.vx / Math.hypot(ss.vx, ss.vy)) * ss.length;
            const tailY = ss.y - (ss.vy / Math.hypot(ss.vx, ss.vy)) * ss.length;

            const grad = ctx.createLinearGradient(tailX, tailY, ss.x, ss.y);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
            grad.addColorStop(0.7, `rgba(255, 215, 0, ${ss.life * 0.6})`);
            grad.addColorStop(1, `rgba(255, 255, 255, ${ss.life * 0.95})`);

            ctx.save();
            ctx.strokeStyle = grad;
            ctx.lineWidth = ss.width;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(ss.x, ss.y);
            ctx.stroke();

            // Glowing head
            ctx.beginPath();
            ctx.arc(ss.x, ss.y, ss.width * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${ss.life})`;
            ctx.shadowColor = '#FFD700';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.restore();
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // DAY MODE: Live East-to-West Sun Arc, Clouds, Moon & Birds
    // ──────────────────────────────────────────────────────────────────────────
    function renderDayMode(currentHour) {
        // Calculate solar progress: 6 AM (East / Left) to 18 PM (West / Right)
        const dayProgress = Math.max(0, Math.min(1, (currentHour - 6) / 12));
        const isSunsetOrSunrise = (currentHour >= 5.5 && currentHour <= 7.5) || (currentHour >= 16.5 && currentHour <= 19);

        // Sun Position
        const sunX = width * 0.1 + dayProgress * (width * 0.8);
        const sunY = (height * 0.55) - Math.sin(dayProgress * Math.PI) * (height * 0.42);

        // Golden Hour Ambient Sky Glow
        if (isSunsetOrSunrise) {
            const glowGrad = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, width * 0.65);
            glowGrad.addColorStop(0, 'rgba(255, 140, 50, 0.16)');
            glowGrad.addColorStop(0.4, 'rgba(255, 80, 90, 0.08)');
            glowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = glowGrad;
            ctx.fillRect(0, 0, width, height);
        }

        // 1. Sun Drawing (Corona & Radiance)
        const sunRadius = 24;
        const corona = ctx.createRadialGradient(sunX, sunY, sunRadius * 0.4, sunX, sunY, sunRadius * 2.8);
        corona.addColorStop(0, 'rgba(255, 245, 180, 0.85)');
        corona.addColorStop(0.3, isSunsetOrSunrise ? 'rgba(255, 150, 60, 0.4)' : 'rgba(255, 215, 0, 0.35)');
        corona.addColorStop(1, 'rgba(255, 200, 50, 0)');

        ctx.save();
        ctx.fillStyle = corona;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunRadius * 2.8, 0, Math.PI * 2);
        ctx.fill();

        // Sun Core
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
        ctx.fillStyle = isSunsetOrSunrise ? '#FFA040' : '#FFF4CC';
        ctx.shadowColor = 'rgba(255, 200, 50, 0.8)';
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.restore();

        // 2. Crescent Moon (Softly visible during daytime opposite side)
        const moonX = width * 0.85 - (dayProgress * (width * 0.3));
        const moonY = height * 0.18 + (Math.sin(dayProgress * Math.PI) * 40);
        renderCrescentMoon(moonX, moonY, 14, 0.4);

        // 3. Drifting Cumulus Clouds
        for (let i = 0; i < clouds.length; i++) {
            const c = clouds[i];
            c.x += c.speed;
            if (c.x - c.width > width) {
                c.x = -c.width;
                c.y = Math.random() * (height * 0.45) + 30;
            }
            renderCloud(c);
        }

        // 4. Rolling Green Hills & Small Village Silhouette
        renderHillsAndVillage();

        // 5. Flying Birds / Cross-horizon Flight
        const nowMs = Date.now();
        if (nowMs > nextBirdSpawnTime) {
            spawnBirdFlock();
            nextBirdSpawnTime = nowMs + Math.random() * 8000 + 7000; // Every 7s - 15s
        }

        for (let i = birds.length - 1; i >= 0; i--) {
            const b = birds[i];
            b.x += b.speed;
            b.wingPhase += b.wingSpeed;

            if (b.x > width + 60) {
                birds.splice(i, 1);
                continue;
            }

            renderBird(b);
        }
    }

    function renderHillsAndVillage() {
        ctx.save();

        // 1. Distant Hill Layer (Soft hazy blue-green)
        ctx.fillStyle = 'rgba(168, 204, 185, 0.42)';
        ctx.beginPath();
        ctx.moveTo(0, height);
        ctx.lineTo(0, height * 0.78);
        ctx.bezierCurveTo(width * 0.25, height * 0.72, width * 0.45, height * 0.82, width * 0.75, height * 0.74);
        ctx.bezierCurveTo(width * 0.88, height * 0.70, width * 0.95, height * 0.73, width, height * 0.72);
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();

        // 2. Midground Rolling Hill (Warm pastoral sage)
        ctx.fillStyle = 'rgba(142, 186, 160, 0.52)';
        ctx.beginPath();
        ctx.moveTo(0, height);
        ctx.lineTo(0, height * 0.84);
        ctx.bezierCurveTo(width * 0.2, height * 0.80, width * 0.4, height * 0.88, width * 0.65, height * 0.82);
        ctx.bezierCurveTo(width * 0.82, height * 0.78, width * 0.92, height * 0.83, width, height * 0.81);
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();

        // 3. Small Village Silhouette (Located on the midground hill slope)
        const villageBaseX = width * 0.58;
        const villageBaseY = height * 0.82;
        renderVillageSilhouette(villageBaseX, villageBaseY);

        // 4. Foreground Hill (Rich soft emerald green)
        ctx.fillStyle = 'rgba(118, 168, 138, 0.62)';
        ctx.beginPath();
        ctx.moveTo(0, height);
        ctx.lineTo(0, height * 0.90);
        ctx.bezierCurveTo(width * 0.3, height * 0.86, width * 0.55, height * 0.94, width * 0.85, height * 0.88);
        ctx.bezierCurveTo(width * 0.95, height * 0.86, width, height * 0.87, width, height * 0.88);
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    function renderVillageSilhouette(vx, vy) {
        ctx.save();
        ctx.fillStyle = 'rgba(65, 95, 78, 0.75)';

        // Church Tower & Steeple
        const churchW = 16;
        const churchH = 28;
        ctx.fillRect(vx, vy - churchH, churchW, churchH);

        // Steeple (Pyramid roof)
        ctx.beginPath();
        ctx.moveTo(vx - 2, vy - churchH);
        ctx.lineTo(vx + churchW / 2, vy - churchH - 18);
        ctx.lineTo(vx + churchW + 2, vy - churchH);
        ctx.closePath();
        ctx.fill();

        // Cross on Steeple
        ctx.strokeStyle = 'rgba(65, 95, 78, 0.75)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(vx + churchW / 2, vy - churchH - 24);
        ctx.lineTo(vx + churchW / 2, vy - churchH - 18);
        ctx.moveTo(vx + churchW / 2 - 3, vy - churchH - 21);
        ctx.lineTo(vx + churchW / 2 + 3, vy - churchH - 21);
        ctx.stroke();

        // Village Cottage 1
        const c1X = vx + churchW + 8;
        const c1W = 18;
        const c1H = 14;
        ctx.fillRect(c1X, vy - c1H, c1W, c1H);
        ctx.beginPath();
        ctx.moveTo(c1X - 2, vy - c1H);
        ctx.lineTo(c1X + c1W / 2, vy - c1H - 9);
        ctx.lineTo(c1X + c1W + 2, vy - c1H);
        ctx.closePath();
        ctx.fill();
        // Chimney
        ctx.fillRect(c1X + 3, vy - c1H - 13, 3, 6);

        // Village Cottage 2
        const c2X = c1X + c1W + 6;
        const c2W = 15;
        const c2H = 12;
        ctx.fillRect(c2X, vy - c2H + 2, c2W, c2H);
        ctx.beginPath();
        ctx.moveTo(c2X - 2, vy - c2H + 2);
        ctx.lineTo(c2X + c2W / 2, vy - c2H - 6);
        ctx.lineTo(c2X + c2W + 2, vy - c2H + 2);
        ctx.closePath();
        ctx.fill();

        // Cottage 3 (To the left of church)
        const c3X = vx - 22;
        const c3W = 16;
        const c3H = 13;
        ctx.fillRect(c3X, vy - c3H, c3W, c3H);
        ctx.beginPath();
        ctx.moveTo(c3X - 2, vy - c3H);
        ctx.lineTo(c3X + c3W / 2, vy - c3H - 8);
        ctx.lineTo(c3X + c3W + 2, vy - c3H);
        ctx.closePath();
        ctx.fill();

        // Trees dotted along the village & ridge
        renderTree(vx - 32, vy - 2, 9, 18);
        renderTree(vx - 8, vy - 2, 7, 14);
        renderTree(c2X + c2W + 8, vy + 1, 8, 16);
        renderTree(c2X + c2W + 22, vy + 4, 10, 20);

        ctx.restore();
    }

    function renderTree(tx, ty, r, trunkH) {
        ctx.fillRect(tx - 1.5, ty - trunkH, 3, trunkH);
        ctx.beginPath();
        ctx.arc(tx, ty - trunkH - r * 0.6, r, 0, Math.PI * 2);
        ctx.fill();
    }

    function renderCrescentMoon(cx, cy, r, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // Dark cutout to create crescent
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(cx + r * 0.55, cy - r * 0.2, r * 0.88, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function renderCloud(c) {
        ctx.save();
        ctx.fillStyle = `rgba(255, 255, 255, ${c.opacity})`;
        ctx.beginPath();
        const cx = c.x;
        const cy = c.y;
        const w = c.width;
        const h = c.height;

        ctx.arc(cx, cy, h * 0.5, 0, Math.PI * 2);
        ctx.arc(cx + w * 0.28, cy - h * 0.35, h * 0.65, 0, Math.PI * 2);
        ctx.arc(cx + w * 0.6, cy - h * 0.2, h * 0.55, 0, Math.PI * 2);
        ctx.arc(cx + w * 0.85, cy, h * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function renderBird(b) {
        ctx.save();
        ctx.strokeStyle = 'rgba(70, 80, 95, 0.45)';
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();

        const wingFlap = Math.sin(b.wingPhase) * (b.size * 0.65);
        // Left wing
        ctx.moveTo(b.x - b.size, b.y + wingFlap);
        ctx.quadraticCurveTo(b.x - b.size * 0.5, b.y - b.size * 0.3, b.x, b.y);
        // Right wing
        ctx.quadraticCurveTo(b.x + b.size * 0.5, b.y - b.size * 0.3, b.x + b.size, b.y + wingFlap);

        ctx.stroke();
        ctx.restore();
    }

    function startAnimation() {
        if (!isRunning) {
            isRunning = true;
            animationFrameId = requestAnimationFrame(render);
        }
    }

    function stopAnimation() {
        if (isRunning) {
            isRunning = false;
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        }
    }

    // Auto-init on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCelestialEngine);
    } else {
        initCelestialEngine();
    }

    window.OrbitCelestial = {
        init: initCelestialEngine,
        start: startAnimation,
        stop: stopAnimation,
        resize: handleResize
    };
})();
