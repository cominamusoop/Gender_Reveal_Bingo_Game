"use strict";

/* ==========================================
   STATE
========================================== */
const LINES = [
  // rows
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [8, 9, 10, 11],
  [12, 13, 14, 15],
  // columns
  [0, 4, 8, 12],
  [1, 5, 9, 13],
  [2, 6, 10, 14],
  [3, 7, 11, 15],
  // diagonals
  [0, 5, 10, 15],
  [3, 6, 9, 12],
];

let gameData = { babyName: "", gender: "" }; // gender: 'boy' | 'girl'
let bingoGrid = []; // 16 x { number, value }
let flippedIndices = new Set();
let isGameFinished = false;
let revealTimer = null;

const $ = (id) => document.getElementById(id);

/* ==========================================
   SOUND (Web Audio API, 첫 클릭 시 생성)
========================================== */
let audioCtx = null;

function getAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function beep(freq, start, dur, type = "sine", vol = 0.18, slideTo) {
  const ctx = getAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function playSound(type) {
  if (type === "click") {
    beep(400, 0, 0.1, "sine", 0.15, 800);
  } else if (type === "line") {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      beep(f, i * 0.1, 0.25, "triangle", 0.2),
    );
  } else if (type === "win") {
    [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
      beep(f, i * 0.12, 0.45, "sine", 0.2),
    );
  }
}

/* ==========================================
   UTIL
========================================== */
function showToast(message) {
  $("toast-msg").textContent = message;
  const toast = $("toast");
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {}
    document.body.removeChild(ta);
    return ok;
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// 한글 안전 인코딩 (기존 링크 형식과 동일: btoa(encodeURIComponent(json)))
function encodeData(obj) {
  return btoa(encodeURIComponent(JSON.stringify(obj)));
}
function decodeData(str) {
  const cleaned = decodeURIComponent(str).replace(/ /g, "+");
  return JSON.parse(decodeURIComponent(atob(cleaned)));
}

/* ==========================================
   INIT
========================================== */
window.addEventListener("DOMContentLoaded", () => {
  $("organizer-form").addEventListener("submit", generateShareLink);
  $("copy-btn").addEventListener("click", copyShareUrl);
  $("start-btn").addEventListener("click", gameStart);
  $("share-btn").addEventListener("click", shareResultText);
  $("restart-btn").addEventListener("click", restartGame);
  $("share-url").addEventListener("focus", (e) => e.target.select());

  initFromHash();
});

window.addEventListener("hashchange", () => {
  if (!initFromHash()) location.reload();
});

function initFromHash() {
  const hash = location.hash;
  if (hash.startsWith("#data=")) {
    try {
      const parsed = decodeData(hash.slice(6));
      const gender = parsed.gender;
      const name = String(parsed.babyName || "")
        .trim()
        .slice(0, 10);
      if (name && (gender === "boy" || gender === "girl")) {
        gameData = { babyName: name, gender };
        startGuestGameMode();
        return true;
      }
    } catch (e) {
      console.error("URL 데이터 해독 실패:", e);
    }
    showToast("잘못된 초대 링크입니다. 주최자 화면으로 이동합니다.");
  }
  return false;
}

/* ==========================================
   ORGANIZER
========================================== */
function generateShareLink(event) {
  event.preventDefault();
  const babyName = $("baby-name").value.trim();
  const gender = document.querySelector('input[name="gender"]:checked')?.value;

  if (!babyName || !gender) {
    showToast("태명과 성별을 입력해주세요!");
    return;
  }

  const base = location.href.split("#")[0];
  $("share-url").value = `${base}#data=${encodeData({ babyName, gender })}`;
  $("generated-link-box").classList.remove("hidden");
  showToast("공유 링크가 생성되었습니다!");
}

async function copyShareUrl() {
  const ok = await copyText($("share-url").value);
  showToast(
    ok
      ? "링크가 클립보드에 복사되었습니다!"
      : "복사에 실패했습니다. 직접 복사해주세요.",
  );
}

function gameStart() {
  const url = $("share-url").value;
  if (!url) return;
  history.replaceState(null, "", url.slice(url.indexOf("#")));
  initFromHash();
}

/* ==========================================
   BINGO LOGIC
========================================== */
// 완성된(4칸 모두 같은 값) 줄의 값을 반환, 아니면 null
function lineValue(values, line) {
  const v = values[line[0]];
  return line.every((i) => values[i] === v) ? v : null;
}

// 8 BOY / 8 GIRL 이며, 주최자 성별 줄은 정확히 1개, 반대 성별 줄은 0개
function isValidGrid(values, target) {
  let mine = 0;
  let other = 0;
  for (const line of LINES) {
    const v = lineValue(values, line);
    if (v === target) mine++;
    else if (v) other++;
  }
  return (
    mine === 1 && other === 0 && values.filter((v) => v === target).length === 8
  );
}

function generateValid4x4Grid() {
  const target = gameData.gender;
  const opposite = target === "boy" ? "girl" : "boy";
  const values = [...Array(8).fill(target), ...Array(8).fill(opposite)];

  do {
    shuffleArray(values);
  } while (!isValidGrid(values, target)); // 성공 확률 약 20%

  const numbers = Array.from({ length: 16 }, (_, i) => i + 1);
  shuffleArray(numbers);
  bingoGrid = values.map((value, i) => ({ number: numbers[i], value }));
}

function startGuestGameMode() {
  clearTimeout(revealTimer);
  $("organizer-section").classList.add("hidden");
  $("result-section").classList.add("hidden");
  $("fx-layer").innerHTML = "";
  $("game-section").classList.remove("hidden");
  $("display-baby-name").textContent = gameData.babyName;

  flippedIndices.clear();
  isGameFinished = false;

  generateValid4x4Grid();
  renderBingoBoard();
}

function renderBingoBoard() {
  const board = $("bingo-board");
  board.innerHTML = "";

  bingoGrid.forEach((card, index) => {
    const el = document.createElement("button");
    el.type = "button";
    el.id = `card-${index}`;
    el.className = "bingo-card";
    el.setAttribute("aria-label", `${card.number}번 카드`);
    el.addEventListener("click", () => handleCardClick(index));

    const inner = document.createElement("div");
    inner.className = "card-inner";

    const front = document.createElement("div");
    front.className = "card-front font-title";
    front.textContent = card.number;

    const back = document.createElement("div");
    back.className = `card-back ${card.value} font-title`;
    back.textContent = card.value.toUpperCase();

    inner.append(front, back);
    el.appendChild(inner);
    board.appendChild(el);
  });
}

function handleCardClick(index) {
  if (isGameFinished || flippedIndices.has(index)) return;

  flippedIndices.add(index);
  playSound("click");

  const el = $(`card-${index}`);
  el.classList.add("flipped");
  el.disabled = true;

  checkBingoLines();
}

function checkBingoLines() {
  const values = bingoGrid.map((c) => c.value);
  const line = LINES.find(
    (l) =>
      l.every((i) => flippedIndices.has(i)) &&
      lineValue(values, l) === gameData.gender,
  );
  if (!line) return;

  isGameFinished = true;
  playSound("line");
  document.querySelectorAll(".bingo-card").forEach((c) => (c.disabled = true));
  line.forEach((i) => $(`card-${i}`).classList.add("line-completed"));
  // 완성된 줄만 남기고 나머지 카드는 숨김
  document
    .querySelectorAll(".bingo-card")
    .forEach((c, i) => c.classList.toggle("dimmed", !line.includes(i)));

  revealTimer = setTimeout(showResultScreen, 1000);
}

/* ==========================================
   RESULT SCREEN
========================================== */
function showResultScreen() {
  const isBoy = gameData.gender === "boy";
  const kind = isBoy ? "boy" : "girl";

  const badge = $("gender-badge");
  badge.className = `result-badge ${kind} font-title`;
  badge.textContent = isBoy ? "IT'S A BOY!" : "IT'S A GIRL!";
  $("gender-emoji").textContent = isBoy ? "👦🏻💙" : "👧🏻💖";
  const title = $("gender-title-text");
  title.className = `result-title ${kind} font-title`;
  title.textContent = `${gameData.babyName}${isBoy ? "는 멋진 아들!" : "는 예쁜 딸!"}`;

  $("game-section").classList.add("hidden");
  $("result-section").classList.remove("hidden");

  playSound("win");
  spawnCelebration(isBoy);
}

// confetti 대체: 성별 테마 이모지가 떠오르는 CSS 애니메이션
function spawnCelebration(isBoy) {
  const layer = $("fx-layer");
  layer.innerHTML = "";
  const set = isBoy
    ? ["💙", "🎈", "⭐", "✨", "🐻"]
    : ["💗", "🎀", "🌸", "✨", "🐰"];
  for (let n = 0; n < 28; n++) {
    const el = document.createElement("span");
    el.className = "fx-item";
    el.textContent = set[n % set.length];
    el.style.left = `${Math.random() * 92}%`;
    el.style.fontSize = `${18 + Math.random() * 22}px`;
    el.style.animationDuration = `${3 + Math.random() * 3}s`;
    el.style.animationDelay = `${Math.random() * 2.5}s`;
    el.style.setProperty("--sway", `${(Math.random() - 0.5) * 80}px`);
    layer.appendChild(el);
  }
}

async function shareResultText() {
  const kr = gameData.gender === "boy" ? "아들 👦" : "딸 👧";
  const text = `🎉 [젠더리빌 빙고 이벤트] 🎉\n${gameData.babyName}의 성별은 바로... ${kr} 입니다! 💕`;
  showToast(
    (await copyText(text)) ? "결과 문구가 복사되었습니다!" : "복사 실패",
  );
}

function restartGame() {
  startGuestGameMode();
}
