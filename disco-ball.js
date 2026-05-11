/*
 * Disco ball drop for Freshservice portal pages.
 * Paste into the portal's custom footer JS. Self-contained, no deps.
 * Must run in the top-level page (not inside an iframe) so the fixed canvas
 * covers the viewport instead of collapsing inside an iframe of zero height.
 */
(function () {
  const CONFIG = {
    // Activate only on URLs matching this pattern. Adjust as needed.
    urlMatch: /\/catalog\//,
    ballRadius: 120,
    ringCount: 24,
    tileSize: 13,
    rotationSpeed: 0.009,
    dropMs: 1150,
    retractMs: 700,
    zIndex: 2147483600,
  };

  if (!CONFIG.urlMatch.test(window.location.pathname + window.location.hash)) return;
  if (window.top !== window.self) return; // only run in the top frame
  if (window.__discoBallLoaded) return;
  window.__discoBallLoaded = true;

  function init() {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = '🪩';
    trigger.setAttribute('aria-label', 'Start disco');
    Object.assign(trigger.style, {
      position: 'fixed',
      right: '24px',
      bottom: '24px',
      width: '56px',
      height: '56px',
      borderRadius: '50%',
      border: 'none',
      background: 'linear-gradient(135deg,#ff6ec7,#4ee0ff)',
      color: 'white',
      fontSize: '28px',
      lineHeight: '56px',
      textAlign: 'center',
      cursor: 'pointer',
      boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
      zIndex: String(CONFIG.zIndex),
      padding: '0',
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
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.92)',
      zIndex: String(CONFIG.zIndex + 1),
      overflow: 'hidden',
      cursor: 'pointer',
    });
    document.body.appendChild(overlay);

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none',
    });
    overlay.appendChild(canvas);

    const endBtn = document.createElement('button');
    endBtn.type = 'button';
    endBtn.textContent = 'End disco';
    Object.assign(endBtn.style, {
      position: 'absolute',
      top: '24px',
      right: '24px',
      padding: '10px 18px',
      borderRadius: '24px',
      border: '1px solid rgba(255,255,255,0.45)',
      background: 'rgba(0,0,0,0.55)',
      color: 'white',
      fontFamily: 'system-ui,-apple-system,Segoe UI,sans-serif',
      fontSize: '14px',
      letterSpacing: '0.04em',
      cursor: 'pointer',
      zIndex: '2',
    });
    overlay.appendChild(endBtn);

    const ctx = canvas.getContext('2d');
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

    // Sphere tile layout: rows of latitude, tiles per ring scaled by sin(phi).
    const tiles = [];
    for (let i = 0; i < CONFIG.ringCount; i++) {
      const phi = (i + 0.5) / CONFIG.ringCount * Math.PI;
      const sphi = Math.sin(phi);
      const cphi = Math.cos(phi);
      const count = Math.max(4, Math.round(sphi * CONFIG.ringCount * 2.5));
      for (let j = 0; j < count; j++) {
        const theta = (j / count) * Math.PI * 2;
        tiles.push({
          phi, theta,
          x0: sphi * Math.cos(theta),
          y0: cphi,
          z0: sphi * Math.sin(theta),
          hueOffset: (phi + theta) * 57.3,
        });
      }
    }

    // Light direction (top-left-front) and half vector (view from +z).
    const lvec = norm3(-0.45, -0.55, 0.7);
    const hvec = norm3(lvec[0], lvec[1], lvec[2] + 1);

    const lightSpots = [];
    const startedAt = performance.now();
    const startY = -CONFIG.ballRadius * 1.8;
    let targetY = 0;
    function computeTarget() { targetY = Math.min(H * 0.42, H - CONFIG.ballRadius - 60); }
    computeTarget();
    window.addEventListener('resize', computeTarget);

    let phase = 'dropping';
    let phaseStart = startedAt;
    let rotation = 0;
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

    function frame(now) {
      const by = ballY(now);
      const bx = W / 2;
      rotation += CONFIG.rotationSpeed;
      const tSec = (now - startedAt) / 1000;
      const active = phase === 'dropping' || phase === 'settled';

      ctx.clearRect(0, 0, W, H);

      // Background light spots (behind the ball).
      for (let i = lightSpots.length - 1; i >= 0; i--) {
        const s = lightSpots[i];
        s.life -= 0.014;
        if (s.life <= 0) { lightSpots.splice(i, 1); continue; }
        const r = s.radius * (1 + (1 - s.life) * 0.7);
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        grad.addColorStop(0, `hsla(${s.hue},100%,65%,${s.life * 0.55})`);
        grad.addColorStop(0.5, `hsla(${s.hue},100%,55%,${s.life * 0.18})`);
        grad.addColorStop(1, `hsla(${s.hue},100%,50%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
      }

      // String + ceiling mount.
      ctx.strokeStyle = 'rgba(220,220,220,0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx, by - CONFIG.ballRadius);
      ctx.stroke();
      ctx.fillStyle = '#666';
      ctx.fillRect(bx - 9, by - CONFIG.ballRadius - 5, 18, 5);

      drawBall(bx, by, rotation, tSec, active);

      // Glassy sheen on top of the tiles.
      const sheen = ctx.createRadialGradient(
        bx - CONFIG.ballRadius * 0.4, by - CONFIG.ballRadius * 0.4, 0,
        bx, by, CONFIG.ballRadius
      );
      sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
      sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
      sheen.addColorStop(1, 'rgba(0,0,0,0.28)');
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.arc(bx, by, CONFIG.ballRadius, 0, Math.PI * 2);
      ctx.fill();

      if (phase === 'done' && lightSpots.length === 0) { cleanup(); return; }
      rafId = requestAnimationFrame(frame);
    }

    function drawBall(cx, cy, rot, tSec, canSpawn) {
      const R = CONFIG.ballRadius;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);

      const visible = [];
      for (let k = 0; k < tiles.length; k++) {
        const t = tiles[k];
        const nx = t.x0 * cosR + t.z0 * sinR;
        const ny = t.y0;
        const nz = -t.x0 * sinR + t.z0 * cosR;
        if (nz < 0.02) continue;
        visible.push({ nx, ny, nz, tile: t });
      }
      visible.sort((a, b) => a.nz - b.nz);

      for (let k = 0; k < visible.length; k++) {
        const v = visible[k];
        const nx = v.nx, ny = v.ny, nz = v.nz;
        const sx = cx + nx * R;
        const sy = cy + ny * R;
        const diffuse = Math.max(0, nx * lvec[0] + ny * lvec[1] + nz * lvec[2]);
        const spec = Math.pow(Math.max(0, nx * hvec[0] + ny * hvec[1] + nz * hvec[2]), 28);

        const base = 38 + diffuse * 190;
        let r = base, g = base, b = base + diffuse * 10;

        if (spec > 0.42) {
          const hue = (tSec * 70 + v.tile.hueOffset) % 360;
          const col = hslToRgb(hue, 100, 55 + spec * 30);
          const mix = Math.min(1, spec * 1.25);
          r = r * (1 - mix) + col[0] * mix;
          g = g * (1 - mix) + col[1] * mix;
          b = b * (1 - mix) + col[2] * mix;
        } else if (spec > 0.05) {
          const wmix = Math.min(1, spec * 1.6);
          r = r * (1 - wmix) + 255 * wmix;
          g = g * (1 - wmix) + 255 * wmix;
          b = b * (1 - wmix) + 255 * wmix;
        }

        const sz = CONFIG.tileSize * (0.55 + nz * 0.55);
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx - sz / 2, sy - sz / 2, sz, sz);

        if (canSpawn && spec > 0.78 && Math.random() < 0.05) {
          const hue = (tSec * 70 + v.tile.hueOffset + 30) % 360;
          // Direction roughly along the tile normal, projected outward into the room.
          const dx = nx + (Math.random() - 0.5) * 0.6;
          const dy = ny + (Math.random() - 0.5) * 0.6;
          const dist = 140 + Math.random() * 480;
          lightSpots.push({
            x: sx + dx * dist,
            y: sy + dy * dist,
            hue,
            radius: 70 + Math.random() * 90,
            life: 1,
          });
        }
      }
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
    // Ease-out-back: overshoots ~10% then settles to 1.
    const c1 = 1.70158 * 1.1;
    const c3 = c1 + 1;
    const u = t - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
  }

  function norm3(x, y, z) {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s /= 100; l /= 100;
    if (s === 0) { const v = l * 255; return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2 = (t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [hue2(h + 1 / 3) * 255, hue2(h) * 255, hue2(h - 1 / 3) * 255];
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
