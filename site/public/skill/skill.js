// /skill — copy buttons + a small static starfield (reuses app.js pieces, kept tiny)
const canvas = document.getElementById("starfield");
const ctx = canvas.getContext("2d");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let stars = [];

function seed() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  stars = Array.from({ length: Math.min(320, Math.floor((innerWidth * innerHeight) / 8000)) }, () => ({
    x: Math.random() * innerWidth,
    y: Math.random() * innerHeight,
    r: 0.35 + Math.random() * 1.1,
    phase: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 1.2,
    warm: Math.random() < 0.06,
  }));
}

function draw(t) {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const s of stars) {
    ctx.globalAlpha = reduced ? 0.7 : 0.25 + 0.75 * Math.abs(Math.sin(t / 1000 * s.speed + s.phase));
    ctx.fillStyle = s.warm ? "#ffd9a0" : "#e6ecff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, 6.2832);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

seed();
if (reduced) draw(0);
else requestAnimationFrame(function loop(t) { if (!document.hidden) draw(t); requestAnimationFrame(loop); });
addEventListener("resize", () => { seed(); if (reduced) draw(0); });

for (const btn of document.querySelectorAll(".copybtn")) {
  btn.addEventListener("click", async () => {
    const text = document.getElementById(btn.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "copied ✦";
    } catch {
      btn.textContent = "select & copy";
    }
    setTimeout(() => { btn.textContent = "copy"; }, 2000);
  });
}
