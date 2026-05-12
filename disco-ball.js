/*
 * Disco ball drop for Freshservice portal pages.
 * Self-contained IIFE. Drops a hanging disco ball (animated GIF of a
 * spinning ball) with a springy ease, scatters coloured light spots
 * across the dimmed page, and retracts on dismiss.
 *
 * Must run in the top-level page (not inside an iframe).
 */
(function () {
  const CONFIG = {
    urlMatch: [/\/catalog\//, /\/support\/home/],
    gifUrl: 'https://raw.githubusercontent.com/Roxanne-Zest/Discoball/main/Discoball600x.gif',
    imageUrl: 'https://raw.githubusercontent.com/Roxanne-Zest/Discoball/main/Discoball.png',
    // Source crop in the still PNG (px in the original 1024x1024).
    imageBallCx: 520,
    imageBallCy: 585,
    imageBallR: 335,
    // Source crop in the GIF (px in the original 900x900). Tighten if you
    // see white halo around the ball; loosen if the ball edges get cut off.
    gifBallCx: 450,
    gifBallCy: 510,
    gifBallR: 320,
    ballRadius: 140,
    dropMs: 1150,
    retractMs: 700,
    swayDeg: 0.8,
    swayPeriodMs: 2800,
    spotIntervalMs: 90,
    zIndex: 2147483600,
    // Pixels whose darkest channel is within this many steps of 255 get faded
    // toward transparent (helps if the GIF still has white halo edges).
    // Set to 0 to disable.
    chromaKeyThreshold: 40,
  };

  const urlPath = window.location.pathname + window.location.hash;
  const patterns = Array.isArray(CONFIG.urlMatch) ? CONFIG.urlMatch : [CONFIG.urlMatch];
  if (!patterns.some((re) => re.test(urlPath))) return;
  if (window.top !== window.self) return;
  if (window.__discoBallLoaded) return;
  window.__discoBallLoaded = true;

  // PNG fallback shown while the larger GIF is buffering.
  const ballImage = new Image();
  ballImage.crossOrigin = 'anonymous';
  ballImage.src = CONFIG.imageUrl;

  // Animated GIF — browsers play it inside an Image, and drawImage samples
  // whatever frame is currently displayed at call time.
  const ballGif = new Image();
  ballGif.crossOrigin = 'anonymous';
  ballGif.src = CONFIG.gifUrl;

  function init() {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = '🪩';
    trigger.setAttribute('aria-label', 'Start disco');
    Object.assign(trigger.style, {
      position: 'fixed', right: '24px', bottom: '24px',
      width: '56px', height: '56px', borderRadius: '50%',
      border: 'none', background: 'linear-gradient(135deg,#ff6ec7,#4ee0ff)',
      color: 'white', fontSize: '28px', lineHeight: '56px',
      textAlign: 'center', cursor: 'pointer',
      boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
      zIndex: String(CONFIG.zIndex), padding: '0',
    });
    document.body.appendChild(trigger);

    let session = null;
    trigger.addEventListener('click', () => {
      if (session) return;
      session = startDisco(() => { session = null; });
    });
  }

  function startDisco(onClosed) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.92)',
      zIndex: String(CONFIG.zIndex + 1), overflow: 'hidden', cursor: 'pointer',
    });
    document.body.appendChild(overlay);

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      display: 'block', pointerEvents: 'none',
    });
    overlay.appendChild(canvas);

    const endBtn = document.createElement('button');
    endBtn.type = 'button';
    endBtn.textContent = 'End disco';
    Object.assign(endBtn.style, {
      position: 'absolute', top: '24px', right: '24px',
      padding: '10px 18px', borderRadius: '24px',
      border: '1px solid rgba(255,255,255,0.45)',
      background: 'rgba(0,0,0,0.55)', color: 'white',
      fontFamily: 'system-ui,-apple-system,Segoe UI,sans-serif',
      fontSize: '14px', letterSpacing: '0.04em', cursor: 'pointer', zIndex: '2',
    });
    overlay.appendChild(endBtn);

    const ctx = canvas.getContext('2d');

    // Offscreen buffer for sampling the GIF frame + optional chroma key.
    const keyCanvas = document.createElement('canvas');
    const keyCtx = keyCanvas.getContext('2d', { willReadFrequently: true });
    let chromaKeyDisabled = false;

    let W = 0, H = 0, DPR = 1;
    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = overlay.clientWidth || window.innerWidth;
      H = overlay.clientHeight || window.innerHeight;
      canvas.width = Math.max(1, Math.floor(W * DPR));
      canvas.height = Math.max(1, Math.floor(H * DPR));
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const lightSpots = [];
    const startedAt = performance.now();
    const R = CONFIG.ballRadius;
    const startY = -R * 1.8;
    let targetY = 0;
    function computeTarget() { targetY = Math.min(H * 0.42, H - R - 60); }
    computeTarget();
    window.addEventListener('resize', computeTarget);

    let phase = 'dropping';
    let phaseStart = startedAt;
    let lastSpotAt = 0;
    let rafId = 0;

    function ballY(now) {
      if (phase === 'dropping') {
        const t = (now - phaseStart) / CONFIG.dropMs;
        if (t >= 1) { phase = 'settled'; phaseStart = now; return targetY; }
        return startY + (targetY - startY) * springEase(t);
      }
      if (phase === 'settled') return targetY;
      if (phase === 'retracting') {
        const t = Math.min(1, (now - phaseStart) / CONFIG.retractMs);
        const e = t * t * (3 - 2 * t);
        if (t >= 1) phase = 'done';
        return targetY + (startY - targetY) * e;
      }
      return startY;
    }

    function drawBall(bx, by) {
      const gifReady = ballGif.complete && ballGif.naturalWidth > 0;
      const pngReady = ballImage.complete && ballImage.naturalWidth > 0;

      if (gifReady) {
        const gCx = CONFIG.gifBallCx, gCy = CONFIG.gifBallCy, gR = CONFIG.gifBallR;
        const sx = gCx - gR;
        const sy = gCy - gR;
        const side = gR * 2;
        const target = Math.max(64, Math.ceil(R * 2 * DPR));
        if (keyCanvas.width !== target) {
          keyCanvas.width = target;
          keyCanvas.height = target;
        }
        keyCtx.clearRect(0, 0, target, target);
        keyCtx.drawImage(ballGif, sx, sy, side, side, 0, 0, target, target);

        if (!chromaKeyDisabled && CONFIG.chromaKeyThreshold > 0) {
          try {
            const img = keyCtx.getImageData(0, 0, target, target);
            const data = img.data;
            const threshold = CONFIG.chromaKeyThreshold;
            const cutoff = 255 - threshold;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i + 3] === 0) continue; // already transparent
              const r = data[i], g = data[i + 1], b = data[i + 2];
              const m = r < g ? (r < b ? r : b) : (g < b ? g : b);
              if (m >= cutoff) {
                const a = (255 - m) * (255 / threshold);
                const clamped = a < 0 ? 0 : (a > 255 ? 255 : a);
                if (clamped < data[i + 3]) data[i + 3] = clamped;
              }
            }
            keyCtx.putImageData(img, 0, 0);
          } catch (e) {
            chromaKeyDisabled = true;
          }
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(keyCanvas, bx - R, by - R, R * 2, R * 2);
        ctx.restore();
      } else if (pngReady) {
        const sCx = CONFIG.imageBallCx, sCy = CONFIG.imageBallCy, sR = CONFIG.imageBallR;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(
          ballImage,
          sCx - sR, sCy - sR, sR * 2, sR * 2,
          bx - R, by - R, R * 2, R * 2
        );
        ctx.restore();
      } else {
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(bx, by, R, 0, Math.PI * 2);
        ctx.fill();
      }
      const rim = ctx.createRadialGradient(bx, by, R * 0.92, bx, by, R);
      rim.addColorStop(0, 'rgba(0,0,0,0)');
      rim.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(bx, by, R, 0, Math.PI * 2);
      ctx.fill();
    }

    function frame(now) {
      const by = ballY(now);
      const swayRad = (CONFIG.swayDeg * Math.PI / 180) *
        Math.sin((now - startedAt) / CONFIG.swayPeriodMs * Math.PI * 2);
      const bx = W / 2 + Math.sin(swayRad) * Math.max(0, by);
      const active = phase === 'dropping' || phase === 'settled';

      ctx.clearRect(0, 0, W, H);

      for (let i = lightSpots.length - 1; i >= 0; i--) {
        const s = lightSpots[i];
        s.life -= 0.012;
        if (s.life <= 0) { lightSpots.splice(i, 1); continue; }
        const r = s.radius * (1 + (1 - s.life) * 0.6);
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        grad.addColorStop(0, `hsla(${s.hue},100%,65%,${s.life * 0.55})`);
        grad.addColorStop(0.5, `hsla(${s.hue},100%,55%,${s.life * 0.18})`);
        grad.addColorStop(1, `hsla(${s.hue},100%,50%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
      }

      ctx.strokeStyle = 'rgba(220,220,220,0.75)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(bx, by - R);
      ctx.stroke();

      drawBall(bx, by);

      if (active && now - lastSpotAt > CONFIG.spotIntervalMs) {
        lastSpotAt = now;
        const count = 2 + (Math.random() * 2 | 0);
        for (let i = 0; i < count; i++) {
          const ang = Math.random() * Math.PI * 2;
          const ox = Math.cos(ang), oy = Math.sin(ang);
          const dist = R + 80 + Math.random() * Math.max(W, H) * 0.5;
          lightSpots.push({
            x: bx + ox * dist,
            y: by + oy * dist,
            hue: pickHue(),
            radius: 70 + Math.random() * 110,
            life: 1,
          });
        }
      }

      if (phase === 'done' && lightSpots.length === 0) { cleanup(); return; }
      rafId = requestAnimationFrame(frame);
    }

    function cleanup() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('resize', computeTarget);
      overlay.remove();
      if (onClosed) onClosed();
    }

    function close() {
      if (phase === 'retracting' || phase === 'done') return;
      phase = 'retracting';
      phaseStart = performance.now();
    }

    endBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    overlay.addEventListener('click', () => close());

    rafId = requestAnimationFrame(frame);
    return { close };
  }

  function springEase(t) {
    const c1 = 1.70158 * 1.1;
    const c3 = c1 + 1;
    const u = t - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
  }

  function pickHue() {
    const palette = [320, 180, 50, 290, 130];
    return palette[(Math.random() * palette.length) | 0] + (Math.random() * 20 - 10);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
