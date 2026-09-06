import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// ---- DOM references ----
const videoEl = document.getElementById("webcam");
const canvasEl = document.getElementById("overlay");
const ctx = canvasEl.getContext("2d");

const gestureGuideEl = document.getElementById("gestureGuide");
const guideToggleEl = document.getElementById("guideToggle");
const chordDisplayEl = document.getElementById("chordDisplay");
const volumeBarEls = Array.from(document.querySelectorAll(".vol-bar"));
const qualityDisplayEl = document.getElementById("qualityDisplay");
const startOverlayEl = document.getElementById("startOverlay");

function trackClarityEvent(eventName) {
  if (typeof window.clarity === "function") {
    window.clarity("event", eventName);
  }
}

// NEW
const helpButton = document.getElementById("helpButton");
const helpModal = document.getElementById("helpModal");
const closeHelp = document.getElementById("closeHelp");

// ---- Finger landmark indices ----
const FINGERS = {
  index:  { pip: 6, tip: 8 },
  middle: { pip: 10, tip: 12 },
  ring:   { pip: 14, tip: 16 },
  pinky:  { pip: 18, tip: 20 },
};

function isFingerExtended(landmarks, name) {
  const { pip, tip } = FINGERS[name];
  return landmarks[tip].y < landmarks[pip].y;
}

function isThumbExtended(landmarks, handedness) {
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];

  if (handedness === "Right") {
    return thumbTip.x > thumbIp.x;
  } else {
    return thumbTip.x < thumbIp.x;
  }
}

function getChordQuality(landmarks) {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9]; // middle finger MCP joint
  return middleMcp.x > wrist.x ? "minor" : "major";
}

function classifyChord(landmarks, handedness) {
  const thumb = isThumbExtended(landmarks, handedness);
  const index = isFingerExtended(landmarks, "index");
  const middle = isFingerExtended(landmarks, "middle");
  const ring = isFingerExtended(landmarks, "ring");
  const pinky = isFingerExtended(landmarks, "pinky");

  const quality = getChordQuality(landmarks);

  if (index && pinky && !middle && !ring && !thumb) {
    return quality === "major" ? "VI" : "vi";
  }

  if (index && pinky && !middle && !ring && thumb) {
    return quality === "major" ? "VII" : "vii";
  }

  const count = [thumb, index, middle, ring, pinky].filter(Boolean).length;
  const ROMAN = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };
  const base = ROMAN[count];
  if (!base) return null;

  return quality === "major" ? base : base.toLowerCase();
}

function getHandHorizontalTilt(landmarks, handedness) {
  // Safe structure guardrails to prevent engine freezing
  if (!landmarks || typeof landmarks.length === "undefined" || landmarks.length < 18) {
    return 0;
  }

  try {
    const wrist = landmarks[0];     // Wrist Base
    const middleMcp = landmarks[9];  // Middle Knuckle (Left pillar)
    const ringMcp = landmarks[13];  // Ring Knuckle (Right pillar)

    if (!wrist || !middleMcp || !ringMcp) return 0;

    // Determine the left boundary and right boundary in coordinate space
    const minX = Math.min(middleMcp.x, ringMcp.x);
    const maxX = Math.max(middleMcp.x, ringMcp.x);

    let tiltFactor = 0;
    // Max travel distance past the boundaries before hitting 100%
    const MAX_TRAVEL = 0.12; 

    if (wrist.x < minX) {
      // Wrist has slipped out to the left of the hand structure
      tiltFactor = (wrist.x - minX) / MAX_TRAVEL;
    } else if (wrist.x > maxX) {
      // Wrist has slipped out to the right of the hand structure
      tiltFactor = (wrist.x - maxX) / MAX_TRAVEL;
    } else {
      // Wrist is safely between the knuckles -> Dead-zone active!
      tiltFactor = 0;
    }

    // Clamp value safely between -1.0 and 1.0
    tiltFactor = Math.max(-1, Math.min(1, tiltFactor));

    // Keep your working structural layout rule for right-hand inversion
    if (handedness === "Right") {
      tiltFactor = -tiltFactor;
    }

    return tiltFactor;

  } catch (error) {
    console.error("Buffered tilt calculation failed:", error);
    return 0;
  }
}

function drawEnergy(ctx, volume01, qualityIndex, tiltFactor, chordStr) {
  if (!ctx) return;

  // 1. QUALITY determines the number of lines (1: Major, 2: Minor, 3: Dominant, 4: Diminished)
  if (qualityIndex === 0) return;
  const lineCount = qualityIndex; // 1 to 4 lines stacked or layered

  try {
    // Center alignment point behind your absolute bottom HTML #chordDisplay text
    const centerY = ctx.canvas.height - 56;
    const canvasWidth = ctx.canvas.width;

    // 2. VOLUME determines the thickness of the lines
    const maxThickness = 1 + (volume01 * 8); // Scaled from hairline to 9px thick

    // 3. TILT determines the "shakiness" (magnitude and speed of jagged distortion)
    // Convert tiltFactor (-1 to 1) linearly to a chaos scale (0 to 1)
    const chaosScale = (tiltFactor + 1) / 2;
    const shakinessAmp = chaosScale * 25;   // Micro-vibrations past the base wave path
    const shakinessFreq = 0.05 + (chaosScale * 0.15); 

    // ---- 4. SCALE DEGREE determines the color hues ----
    let baseColorRGB = "150, 150, 150"; // Muted gray placeholder when no chord is playing
    let isChordActive = false;
    let isMajor = false;

    if (chordStr && chordStr !== "--") {
      isChordActive = true;
      const upperStr = chordStr.toUpperCase();
      isMajor = (chordStr === upperStr);

      const SCALE_COLORS = {
        "I":   "232, 161, 61",  // Tonic: Golden Sunset
        "II":  "210, 50, 120",  // 2nd: Purple-Red
        "III": "180, 40, 150",  // 3rd: Deep Violet/Magenta alternative
        "IV":  "240, 210, 40",  // 4th: Yellow
        "V":   "245, 120, 30",  // 5th: Orange
        "VI":  "230, 40, 40",    // 6th: Red
        "VII": "100, 200, 250"   // 7th: Cyan
      };
      baseColorRGB = SCALE_COLORS[upperStr] || "232, 161, 61";
    }


    // ---- 5. MAJOR / MINOR determines brightness ----
    // Major chords pop at 100% full opacity/glow. Minor chords damp down to a subtle 45% moody state.
    const brightnessAlpha = isChordActive ? (isMajor ? 1 : 0.70) : 0.3;

    ctx.save();
    
    // Time variable creates fluid left-to-right scrolling motion frame-by-frame
    const time = performance.now() * 0.004;

    // Parse base color strings safely for layout injection
    const colorChannels = baseColorRGB.split(",");
    const r = parseInt(colorChannels[0]);
    const g = parseInt(colorChannels[1]);
    const b = parseInt(colorChannels[2]);

    ctx.shadowBlur = 10 + (volume01 * 20);
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${0.5 * brightnessAlpha})`;

    // Draw individual lines stacked around the vertical text baseline
    for (let l = 0; l < lineCount; l++) {
      ctx.beginPath();

      // Separate each individual line layer vertically so they look like a wire ribbon
      const lineYOffset = centerY + (l - (lineCount - 1) / 2) * 12;

      for (let x = 0; x <= canvasWidth; x += 10) {
        // A standard flowing sine wave path
        const baseSine = Math.sin(x * 0.005 + time + l * 0.5) * 20;
        
        // Jitter math: Random noise scaled entirely by the right-hand tilt shakiness
        const jitter = (Math.random() - 0.5) * shakinessAmp * Math.sin(x * shakinessFreq + time);

        const y = lineYOffset + baseSine + jitter;

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${brightnessAlpha})`;
      ctx.lineWidth = Math.max(1, maxThickness - (l * 0.5)); // Subtle thickness variation per line layer
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    ctx.restore();

  } catch (error) {
    console.error("Wave animation failed:", error);
  }
}


// ---- Independent Gesture Stabilizers ----

// Musical state: needs confidence before changing
const CHORD_HOLD_TIME_MS = 100;

// Expression controls: should feel immediate
const VIBE_NULL_WINDOW_MS = 50;
// ============================
// CHORD STATE STABILIZER
// ============================

let stableChordState = null;
let candidateChordState = null;
let candidateChordSince = 0;
let lastChordSeenValidTime = 0;


function sameChordState(a, b) {

  if (a === null && b === null) return true;
  if (a === null || b === null) return false;

  return (
    a.chord === b.chord &&
    a.isMajorMode === b.isMajorMode &&
    a.qualityIndex === b.qualityIndex &&
    a.thumbDown === b.thumbDown
  );
}


function stabilizeChordState(rawState, now) {

  if (rawState !== null) {
    lastChordSeenValidTime = now;
  }


  let effectiveState = rawState;


  // prevent MediaPipe flicker
  if (
    rawState === null &&
    now - lastChordSeenValidTime < VIBE_NULL_WINDOW_MS
  ) {
    effectiveState = candidateChordState;
  }


  if (
    !sameChordState(
      effectiveState,
      candidateChordState
    )
  ) {

    candidateChordState = effectiveState;
    candidateChordSince = now;

  }


  if (
    now - candidateChordSince >= CHORD_HOLD_TIME_MS
  ) {

    stableChordState = candidateChordState;

  }


  return stableChordState;
}

// ---- Right hand: volume from height ----
function getVolumeFromHeight(landmarks) {
  const wrist = landmarks[0];
  const TOP = 0.05;
  const BOTTOM = 0.95;

  const clamped = Math.max(TOP, Math.min(BOTTOM, wrist.y));
  const t = (clamped - TOP) / (BOTTOM - TOP);
  return 1 - t;
}

function updateVolumeMeter(volume01) {
  const litCount = Math.round(volume01 * volumeBarEls.length);
  volumeBarEls.forEach((bar) => {
    const index = Number(bar.dataset.index);
    bar.classList.toggle("lit", index >= volumeBarEls.length - litCount);
  });
}

// ---- Right hand: quality (1-4 fingers = major, minor, dominant, diminished) ----
function getRightHandQualityIndex(landmarks) {
  const index = isFingerExtended(landmarks, "index");
  const middle = isFingerExtended(landmarks, "middle");
  const ring = isFingerExtended(landmarks, "ring");
  const pinky = isFingerExtended(landmarks, "pinky");

  return [index, middle, ring, pinky].filter(Boolean).length;
}


// ---- Camera setup ----
async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: false,
  });
  videoEl.srcObject = stream;
  return new Promise((resolve) => {
    videoEl.onloadedmetadata = () => {
      videoEl.play();
      resolve();
    };
  });
}



// ---- MediaPipe setup ----
async function setupHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

function gestureIconHtml(degree, isMinor = false) {
  if (degree >= 1 && degree <= 7) {
    const quality = isMinor ? "minor" : "major";
    return `<img src="/gestures/${degree}-${quality}.png" alt="degree ${degree}" draggable="false" />`;
  }
  return "";
}

const GESTURE_GUIDE = [
  { degree: 1 },
  { degree: 2 },
  { degree: 3 },
  { degree: 4 },
  { degree: 5 },
  { degree: 6 },
  { degree: 7 },
];

const MAJOR_SCALE = {
  A:  ["A","B","C#","D","E","F#","G#"],
  Bb: ["Bb","C","D","Eb","F","G","A"],
  B:  ["B","C#","D#","E","F#","G#","A#"],
  C:  ["C","D","E","F","G","A","B"],
  Db: ["Db","Eb","F","Gb","Ab","Bb","C"],
  D:  ["D","E","F#","G","A","B","C#"],
  Eb: ["Eb","F","G","Ab","Bb","C","D"],
  E:  ["E","F#","G#","A","B","C#","D#"],
  F:  ["F","G","A","Bb","C","D","E"],
  Gb: ["Gb","Ab","Bb","Cb","Db","Eb","F"],
  G:  ["G","A","B","C","D","E","F#"],
  Ab: ["Ab","Bb","C","Db","Eb","F","G"]
};

const NOTE_ALIASES = {
  "A#": "Bb",
  "Bb": "Bb",
  "C#": "Db",
  "Db": "Db",
  "D#": "Eb",
  "Eb": "Eb",
  "F#": "Gb",
  "Gb": "Gb",
  "G#": "Ab",
  "Ab": "Ab",
  Cb: "B",
  B: "B",
  E: "E",
  Fb: "E",
  "E#": "F",
  "B#": "C",
};

const CHORD_TOKEN_RE =
  /\b([A-G](?:#|b)?)((?:maj|min|dim|aug|sus|add|m|M)?\d*(?:sus\d+)?(?:add\d+)?(?:maj\d+)?(?:min\d+)?(?:\/[A-G](?:#|b)?)?)\b/g;

function normalizeNoteName(note) {
  if (!note) return "";
  const n = note[0].toUpperCase() + note.slice(1);
  return NOTE_ALIASES[n] || n;
}

function parseChordSymbol(symbol) {
  const raw = String(symbol || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^\[|\]$/g, "");
  const match = cleaned.match(
    /^([A-G](?:#|b)?)((?:maj|min|dim|aug|sus|add|m|M)?\d*(?:sus\d+)?(?:add\d+)?(?:maj\d+)?(?:min\d+)?)(?:\/([A-G](?:#|b)?))?$/
  );
  if (!match) return null;

  const root = normalizeNoteName(match[1]);
  const quality = match[2] || "";
  const qLower = quality.toLowerCase();
  const isMinor =
    /(^m(?!aj)|min|dim)/.test(qLower) ||
    qLower === "m" ||
    /^m\d/.test(qLower);

  return { symbol: cleaned, root, quality, isMinor };
}

function mapChordToDegree(symbol, keyName = currentKeyName) {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return null;

  const scale = MAJOR_SCALE[keyName];
  if (!scale) return null;

  let degree = -1;
  for (let i = 0; i < scale.length; i++) {
    if (normalizeNoteName(scale[i]) === normalizeNoteName(parsed.root)) {
      degree = i + 1;
      break;
    }
  }

  if (degree < 0) {
    return { ...parsed, degree: null, inKey: false };
  }

  // Prefer explicit quality; otherwise diatonic default
  let isMinor = parsed.isMinor;
  if (!parsed.quality || parsed.quality === "") {
    isMinor = DIATONIC_IS_MINOR[degree];
  } else if (!/(^m(?!aj)|min|dim|maj|sus|aug|add|M|\d)/.test(parsed.quality)) {
    isMinor = DIATONIC_IS_MINOR[degree];
  }

  // Explicit major qualities
  if (/^maj/i.test(parsed.quality) || parsed.quality === "M") {
    isMinor = false;
  }

  return {
    symbol: parsed.symbol,
    root: parsed.root,
    quality: parsed.quality,
    degree,
    isMinor,
    inKey: true,
  };
}

function extractChordsFromText(text) {
  const chords = [];
  const lines = String(text || "").split("\n");

  for (const line of lines) {
    // Bracket style [Am]
    const bracketRe = /\[([^\]]+)\]/g;
    let bm;
    let foundBracket = false;
    while ((bm = bracketRe.exec(line)) !== null) {
      const mapped = mapChordToDegree(bm[1]);
      if (mapped) {
        chords.push(mapped);
        foundBracket = true;
      }
    }
    if (foundBracket) continue;

    CHORD_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = CHORD_TOKEN_RE.exec(line)) !== null) {
      const mapped = mapChordToDegree(m[0]);
      if (mapped) chords.push(mapped);
    }
  }

  return chords;
}

function extractProgressionFromChords(mappedChords) {
  const steps = [];
  for (const c of mappedChords) {
    if (!c.inKey || !c.degree) continue;
    const prev = steps[steps.length - 1];
    if (prev && prev.degree === c.degree && prev.isMinor === c.isMinor) {
      continue; // collapse immediate repeats
    }
    steps.push({ degree: c.degree, isMinor: c.isMinor });
  }
  return steps;
}

function chordTokenHtml(symbol) {
  const mapped = mapChordToDegree(symbol);
  if (!mapped || !mapped.inKey || !mapped.degree) {
    return `<span class="sheet-chord sheet-chord-unknown">${escapeHtml(symbol)}</span>`;
  }
  return `<span class="sheet-chord" title="${escapeHtml(mapped.symbol)} → ${mapped.degree}${mapped.isMinor ? "m" : ""}">
    <span class="sheet-chord-icon">${gestureIconHtml(mapped.degree, mapped.isMinor)}</span>
    <span class="sheet-chord-name">${escapeHtml(mapped.symbol)}</span>
  </span>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderAnnotatedSheet(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  return lines
    .map((line) => {
      if (!line.trim()) return `<div class="sheet-line sheet-blank">&nbsp;</div>`;

      // Replace [Chord] first
      let html = escapeHtml(line);
      html = html.replace(/\[([^\]]+)\]/g, (_, chord) => chordTokenHtml(chord));

      // Replace bare chord tokens (on lines that look chord-heavy or always)
      // Work on original for matching, rebuild carefully
      const parts = [];
      let last = 0;
      const re = new RegExp(CHORD_TOKEN_RE.source, "g");
      const raw = line;
      let m;
      const matches = [];
      while ((m = re.exec(raw)) !== null) {
        // Skip if this looks like a word mid-lyric (lowercase around) — chords are Title case roots
        matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      }

      if (matches.length === 0) {
        return `<div class="sheet-line">${escapeHtml(line).replace(/\[([^\]]+)\]/g, (_, c) => chordTokenHtml(c))}</div>`;
      }

      // Heuristic: if line is mostly chords (few lowercase letters), annotate all
      const letters = (line.match(/[a-zA-Z]/g) || []).length;
      const lower = (line.match(/[a-z]/g) || []).length;
      const chordHeavy = letters === 0 || lower / letters < 0.35 || matches.length >= 2;

      if (!chordHeavy && !/\[[^\]]+\]/.test(line)) {
        return `<div class="sheet-line sheet-lyric">${escapeHtml(line)}</div>`;
      }

      let out = "";
      let idx = 0;
      for (const match of matches) {
        out += escapeHtml(raw.slice(idx, match.start));
        out += chordTokenHtml(match.text);
        idx = match.end;
      }
      out += escapeHtml(raw.slice(idx));
      // Also handle brackets that weren't escaped as tokens
      out = out.replace(/\[([^\]]+)\]/g, (_, chord) => {
        // already escaped brackets become literal — redo from raw if needed
        return chordTokenHtml(chord);
      });
      return `<div class="sheet-line">${out}</div>`;
    })
    .join("");
}

function updateGestureGuide() {
  if (!gestureGuideEl) return;

  const scale = MAJOR_SCALE[currentKeyName];

  gestureGuideEl.innerHTML = GESTURE_GUIDE
    .map(({ degree }) => `
      <div class="gesture-guide-row">
        <span class="gesture-guide-note">
          ${scale[degree - 1]}
        </span>

        <span class="gesture-guide-gesture">
          ${gestureIconHtml(degree, false)}
        </span>
      </div>
    `)
    .join("");
}

// Unmarked Nashville numbers in a major key → diatonic major/minor
const DIATONIC_IS_MINOR = {
  1: false,
  2: true,
  3: true,
  4: false,
  5: false,
  6: true,
  7: true,
};

const ROMAN_MAJOR = ["I", "II", "III", "IV", "V", "VI", "VII"];
const ROMAN_TOKEN_TO_DEGREE = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7,
};

const progressionAddButtonEl = document.getElementById("progressionAddButton");
const progressionInputRowEl = document.getElementById("progressionInputRow");
const progressionInputEl = document.getElementById("progressionInput");
const progressionApplyButtonEl = document.getElementById("progressionApplyButton");
const progressionClearButtonEl = document.getElementById("progressionClearButton");
const progressionGuideEl = document.getElementById("progressionGuide");

let currentProgression = [];
let progressionIndex = 0;
let lastHighlightedProgressionIndex = -1;
let progressionInputPinned = false;

function progressionStepToChord(step) {
  const roman = ROMAN_MAJOR[step.degree - 1];
  return step.isMinor ? roman.toLowerCase() : roman;
}

function degreeDistance(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 7 - d);
}

function snapToProgression(detectedChord, detectedIsMajor = true) {
  if (!currentProgression.length || !detectedChord) return null;

  const detectedDegree =
    NUMERAL_TO_DEGREE[detectedChord.toUpperCase()];
  if (!detectedDegree) return null;

  const detectedMinor = !detectedIsMajor;
  const len = currentProgression.length;
  const nextIndex = (progressionIndex + 1) % len;
  const prevIndex = (progressionIndex - 1 + len) % len;

  // Sticky only when current step fully matches (degree + major/minor).
  // Otherwise tilt can flip I ↔ i / 3 ↔ 3m without fighting sticky.
  const STICKY = 0.9;
  const NEXT_BIAS = 0.5;
  const PREV_BIAS = 0.45;
  const QUALITY_MISMATCH = 0.75;
  const NEIGHBOR_QUALITY_BONUS = 0.35;

  let bestIndex = progressionIndex;
  let bestScore = Infinity;

  currentProgression.forEach((step, i) => {
    let score = degreeDistance(detectedDegree, step.degree);
    if (step.isMinor !== detectedMinor) {
      score += QUALITY_MISMATCH;
    }

    const fullyMatches =
      step.degree === detectedDegree && step.isMinor === detectedMinor;

    if (i === progressionIndex && fullyMatches) {
      score -= STICKY;
    }

    if (i === nextIndex) score -= NEXT_BIAS;
    if (i === prevIndex) score -= PREV_BIAS;

    // Same finger degree, matching tilt — prefer adjacent guide steps (1m ↔ 1)
    if (
      fullyMatches &&
      (i === nextIndex || i === prevIndex)
    ) {
      score -= NEIGHBOR_QUALITY_BONUS;
    }

    // Prefer nearer steps when jumping to a quality match elsewhere
    const ringDist = Math.min(
      Math.abs(i - progressionIndex),
      len - Math.abs(i - progressionIndex)
    );
    score += ringDist * 0.12;

    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  });

  progressionIndex = bestIndex;
  const step = currentProgression[progressionIndex];

  return {
    chord: progressionStepToChord(step),
    isMajorMode: !step.isMinor,
  };
}

function highlightProgressionStep() {
  if (!progressionGuideEl || !currentProgression.length) return;
  if (progressionIndex === lastHighlightedProgressionIndex) return;

  const rows = progressionGuideEl.querySelectorAll(".progression-row");
  rows.forEach((row, i) => {
    row.classList.toggle("active", i === progressionIndex);
  });
  lastHighlightedProgressionIndex = progressionIndex;
}

function parseProgressionToken(raw) {
  const token = String(raw || "").trim();
  if (!token) return null;

  const romanMatch = token.match(/^(vii|vi|v|iv|iii|ii|i)(°|dim)?$/i);
  if (romanMatch) {
    const degree = ROMAN_TOKEN_TO_DEGREE[romanMatch[1].toLowerCase()];
    if (!degree) return null;

    // Respect written case: uppercase = major, lowercase = minor
    let isMinor = token === token.toLowerCase();
    if (romanMatch[2]) {
      isMinor = true;
    } else if (token === token.toUpperCase()) {
      isMinor = false;
    }
    return { degree, isMinor };
  }

  const numMatch = token.match(/^([1-7])(m|M|dim|°)?$/);
  if (!numMatch) return null;

  const degree = Number(numMatch[1]);
  const suffix = numMatch[2] || "";
  // Unmarked numbers are major; only explicit m/dim make minor
  let isMinor = false;
  if (suffix === "m" || suffix === "dim" || suffix === "°") {
    isMinor = true;
  } else if (suffix === "M") {
    isMinor = false;
  }

  return { degree, isMinor };
}

function parseProgression(str) {
  return String(str || "")
    .trim()
    .split(/[-–—,/\s]+/)
    .map(parseProgressionToken)
    .filter(Boolean);
}

function updateProgressionGuide() {
  if (!progressionGuideEl) return;

  if (!currentProgression.length) {
    progressionGuideEl.classList.add("hidden");
    progressionGuideEl.innerHTML = "";
    return;
  }

  const scale = MAJOR_SCALE[currentKeyName] || [];

  progressionGuideEl.innerHTML = currentProgression
    .map(({ degree, isMinor }, i) => {
      const note = scale[degree - 1] || "";
      const label = `${note}${isMinor ? "m" : ""}`;
      const roman = isMinor
        ? ROMAN_MAJOR[degree - 1].toLowerCase()
        : ROMAN_MAJOR[degree - 1];
      const gesture = gestureIconHtml(degree, isMinor);
      const tilt = isMinor
        ? `<span class="progression-tilt">tilt out</span>`
        : "";
      const activeClass = i === progressionIndex ? " active" : "";

      return `
        <div class="progression-row${activeClass}">
          <span class="progression-gesture">${gesture}</span>
          <span class="progression-label">${label} (${roman})</span>
          ${tilt}
        </div>
      `;
    })
    .join("");

  lastHighlightedProgressionIndex = progressionIndex;

  progressionGuideEl.classList.remove("hidden");
  progressionGuideEl.classList.toggle(
    "input-open",
    progressionInputPinned || !progressionInputRowEl.classList.contains("hidden")
  );
}

function syncProgressionInputValue() {
  if (!currentProgression.length) return;
  progressionInputEl.value = currentProgression
    .map(({ degree, isMinor }) => `${degree}${isMinor ? "m" : ""}`)
    .join("-");
}

function showProgressionInputRow({ focus = false, select = false } = {}) {
  progressionInputRowEl.classList.remove("hidden");
  progressionGuideEl.classList.add("input-open");
  if (focus) {
    progressionInputEl.focus();
    if (select) progressionInputEl.select();
  }
}

function openProgressionInput() {
  showProgressionInputRow({ focus: true, select: true });
  if (!progressionInputEl.value.trim() && currentProgression.length) {
    syncProgressionInputValue();
  }
}

function hideProgressionInputRow() {
  progressionInputRowEl.classList.add("hidden");
  progressionGuideEl.classList.remove("input-open");
  progressionInputPinned = false;
}

function applyProgressionFromInput() {
  const raw = progressionInputEl.value.trim();
  const parsed = parseProgression(raw);
  currentProgression = parsed;
  progressionIndex = 0;
  lastHighlightedProgressionIndex = -1;
  updateProgressionGuide();

  if (parsed.length) {
    progressionInputPinned = true;
    progressionInputEl.value = raw;
    showProgressionInputRow();
  } else {
    progressionInputEl.value = "";
    hideProgressionInputRow();
  }
}

function clearProgression() {
  currentProgression = [];
  progressionIndex = 0;
  lastHighlightedProgressionIndex = -1;
  progressionInputEl.value = "";
  progressionInputPinned = false;
  updateProgressionGuide();
  hideProgressionInputRow();
}

progressionAddButtonEl.addEventListener("click", () => {
  if (progressionInputRowEl.classList.contains("hidden")) {
    openProgressionInput();
  } else {
    progressionInputEl.focus();
  }
});

progressionApplyButtonEl.addEventListener("click", () => {
  applyProgressionFromInput();
});

progressionClearButtonEl.addEventListener("click", () => {
  clearProgression();
});

progressionInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    applyProgressionFromInput();
  } else if (e.key === "Escape") {
    e.preventDefault();
    if (!progressionInputPinned && !currentProgression.length) {
      hideProgressionInputRow();
    } else {
      progressionInputEl.blur();
    }
  }
  e.stopPropagation();
});

// ---- Song search panel (Ultimate Guitar + paste) ----
const songSearchButtonEl = document.getElementById("songSearchButton");
const songPanelEl = document.getElementById("songPanel");
const closeSongPanelEl = document.getElementById("closeSongPanel");
const songSearchInputEl = document.getElementById("songSearchInput");
const songSearchGoEl = document.getElementById("songSearchGo");
const songStatusEl = document.getElementById("songStatus");
const songResultsEl = document.getElementById("songResults");
const songSheetEl = document.getElementById("songSheet");
const songSheetMetaEl = document.getElementById("songSheetMeta");
const songSetKeyBtnEl = document.getElementById("songSetKeyBtn");
const songUseProgressionBtnEl = document.getElementById("songUseProgressionBtn");
const songPasteAreaEl = document.getElementById("songPasteArea");
const songPasteApplyEl = document.getElementById("songPasteApply");

let loadedSong = null; // { title, artist, key, url, content }

function setSongStatus(msg) {
  songStatusEl.textContent = msg || "";
}

function openSongPanel() {
  songPanelEl.classList.remove("hidden");
  songSearchInputEl.focus();
}

function closeSongPanel() {
  songPanelEl.classList.add("hidden");
}

function applySongContent(meta) {
  loadedSong = meta;
  const title = meta.title || "Song";
  const artist = meta.artist || "";
  const key = meta.key || "";
  songSheetMetaEl.textContent = [title, artist, key ? `Key: ${key}` : ""]
    .filter(Boolean)
    .join(" — ");

  songSheetEl.innerHTML = renderAnnotatedSheet(meta.content || "");

  if (key) {
    songSetKeyBtnEl.textContent = `Set key to ${key}`;
    songSetKeyBtnEl.classList.remove("hidden");
    songSetKeyBtnEl.dataset.key = key;
  } else {
    songSetKeyBtnEl.classList.add("hidden");
    delete songSetKeyBtnEl.dataset.key;
  }

  const mapped = extractChordsFromText(meta.content || "");
  const steps = extractProgressionFromChords(mapped);
  if (steps.length) {
    songUseProgressionBtnEl.classList.remove("hidden");
    songUseProgressionBtnEl.dataset.steps = JSON.stringify(steps);
    // Auto-fill practice progression
    applySongProgression(steps);
  } else {
    songUseProgressionBtnEl.classList.add("hidden");
    delete songUseProgressionBtnEl.dataset.steps;
  }
}

function applySongProgression(steps) {
  currentProgression = steps.slice();
  progressionIndex = 0;
  lastHighlightedProgressionIndex = -1;
  progressionInputPinned = true;
  syncProgressionInputValue();
  showProgressionInputRow();
  updateProgressionGuide();
  setSongStatus(`Progression loaded (${steps.length} chords) for key ${currentKeyName}`);
}

function refreshLoadedSongSheet() {
  if (!loadedSong?.content) return;
  songSheetEl.innerHTML = renderAnnotatedSheet(loadedSong.content);
  const mapped = extractChordsFromText(loadedSong.content);
  const steps = extractProgressionFromChords(mapped);
  if (steps.length) {
    songUseProgressionBtnEl.classList.remove("hidden");
    songUseProgressionBtnEl.dataset.steps = JSON.stringify(steps);
  }
}

async function readApiJson(res) {
  const text = await res.text();
  if (!text) {
    throw new Error(
      res.status === 502 || res.status === 504
        ? "Song API unavailable (empty response). If local, run npm run dev:api too."
        : `Song API returned empty response (${res.status})`
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Song API returned non-JSON (${res.status}): ${text.slice(0, 120)}`
    );
  }
}

async function searchSongs() {
  const q = songSearchInputEl.value.trim();
  if (!q) {
    setSongStatus("Enter a song name");
    return;
  }

  setSongStatus("Searching Ultimate Guitar…");
  songResultsEl.innerHTML = "";

  try {
    const res = await fetch(`/api/songs/search?q=${encodeURIComponent(q)}`);
    const data = await readApiJson(res);
    if (!res.ok) {
      throw new Error(data.message || data.error || "Search failed");
    }

    const results = data.results || [];
    if (!results.length) {
      setSongStatus("No chord charts found — try paste below");
      return;
    }

    setSongStatus(`${results.length} charts found`);
    songResultsEl.innerHTML = results
      .map(
        (r, i) => `
        <button type="button" class="song-result" data-index="${i}">
          <div>${escapeHtml(r.title)} — ${escapeHtml(r.artist)}</div>
          <div class="song-result-meta">
            ${r.key ? `Key ${escapeHtml(r.key)} · ` : ""}v${r.version ?? "?"}
            ${r.rating != null ? ` · ★ ${Number(r.rating).toFixed(1)}` : ""}
            ${r.difficulty ? ` · ${escapeHtml(r.difficulty)}` : ""}
          </div>
        </button>`
      )
      .join("");

    songResultsEl.querySelectorAll(".song-result").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        loadSongResult(results[idx], btn);
      });
    });
  } catch (err) {
    console.error(err);
    setSongStatus(`Search failed: ${err.message}. You can paste a chart below.`);
  }
}

async function loadSongResult(result, btnEl) {
  if (!result?.url) return;

  songResultsEl.querySelectorAll(".song-result").forEach((el) => {
    el.classList.toggle("active", el === btnEl);
  });

  setSongStatus(`Loading ${result.title}…`);
  try {
    const res = await fetch(`/api/songs/fetch?url=${encodeURIComponent(result.url)}`);
    const data = await readApiJson(res);
    if (!res.ok) {
      throw new Error(data.message || data.error || "Fetch failed");
    }

    applySongContent({
      title: data.title || result.title,
      artist: data.artist || result.artist,
      key: data.key || result.key || "",
      url: result.url,
      content: data.content || "",
    });
    setSongStatus("Chart loaded");
  } catch (err) {
    console.error(err);
    setSongStatus(`Fetch failed: ${err.message}. Paste the chart below.`);
  }
}

function setKeyFromSong(keyRaw) {
  const root = normalizeNoteName(String(keyRaw || "").replace(/m$/i, "").trim());
  // Find matching option by data-note
  const options = Array.from(keySelectEl.options);
  let match = options.find((o) => o.dataset.note === root);
  if (!match) {
    // Try reverse alias (Gb vs F#)
    const reverse = Object.entries(NOTE_ALIASES).find(([, v]) => v === root)?.[0];
    match = options.find((o) => o.dataset.note === reverse || o.dataset.note === keyRaw);
  }
  if (!match) {
    // Match label contains
    match = options.find((o) => o.textContent.includes(root) || o.textContent.includes(keyRaw));
  }
  if (!match) {
    setSongStatus(`Could not map key ${keyRaw} to selector`);
    return;
  }
  keySelectEl.value = match.value;
  keySelectEl.dispatchEvent(new Event("change"));
  setSongStatus(`Key set to ${match.dataset.note}`);
}

songSearchButtonEl.addEventListener("click", openSongPanel);
closeSongPanelEl.addEventListener("click", closeSongPanel);
songPanelEl.addEventListener("click", (e) => {
  if (e.target === songPanelEl) closeSongPanel();
});
songSearchGoEl.addEventListener("click", searchSongs);
songSearchInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    searchSongs();
  }
  e.stopPropagation();
});
songUseProgressionBtnEl.addEventListener("click", () => {
  try {
    const steps = JSON.parse(songUseProgressionBtnEl.dataset.steps || "[]");
    if (steps.length) applySongProgression(steps);
  } catch {}
});
songSetKeyBtnEl.addEventListener("click", () => {
  if (songSetKeyBtnEl.dataset.key) setKeyFromSong(songSetKeyBtnEl.dataset.key);
});
songPasteApplyEl.addEventListener("click", () => {
  const content = songPasteAreaEl.value.trim();
  if (!content) {
    setSongStatus("Paste a chord sheet first");
    return;
  }
  applySongContent({
    title: "Pasted chart",
    artist: "",
    key: loadedSong?.key || "",
    url: "",
    content,
  });
  setSongStatus("Pasted chart applied");
});

// ---- Chord -> note frequencies ----
// Semitone offset of each scale degree from the tonic, in a major scale.
// This stays fixed -- what changes is which frequency counts as "0".
const DEGREE_SEMITONES = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9 ,7: -1};

const keySelectEl = document.getElementById("keySelect");

let currentTonicFreq = Number(keySelectEl.value);

let currentKeyName =
  keySelectEl.selectedOptions[0].dataset.note;

  updateGestureGuide();

  keySelectEl.addEventListener("change", () => {

  currentTonicFreq = Number(keySelectEl.value);

  currentKeyName =
    keySelectEl.selectedOptions[0].dataset.note;

  updateGestureGuide();
  updateProgressionGuide();
  refreshLoadedSongSheet();

});

const toneSelectEl = document.getElementById("toneSelect");
let currentWaveform = toneSelectEl.value;

toneSelectEl.addEventListener("change", () => {
  currentWaveform = toneSelectEl.value;
  synth.currentKey = null; // forces sound refresh
});

const playStyleSelectEl = document.getElementById("playStyleSelect");
const bpmTapButtonEl = document.getElementById("bpmTapButton");
const voicingLockButtonEl = document.getElementById("voicingLockButton");
let currentPlayStyle = playStyleSelectEl.value;
let voicingLocked = false;

voicingLockButtonEl.addEventListener("click", () => {
  voicingLocked = !voicingLocked;
  voicingLockButtonEl.classList.toggle("locked", voicingLocked);
  voicingLockButtonEl.textContent = voicingLocked ? "LOCKED -8ve" : "Lock -8ve";
  voicingLockButtonEl.setAttribute(
    "aria-pressed",
    voicingLocked ? "true" : "false"
  );
  synth.currentKey = null;
});

const DEFAULT_ARP_BPM = 120;
const TAP_RESET_MS = 2000;
const TAP_HISTORY_MAX = 8;
let tapTimes = [];
let tappedBpm = null;

function updateBpmTapLabel() {
  const bpm = tappedBpm || DEFAULT_ARP_BPM;
  bpmTapButtonEl.textContent =
    currentPlayStyle === "arp" || tappedBpm ? `${bpm}` : "TAP";
}

function getArpIntervalMs() {
  const bpm = tappedBpm || DEFAULT_ARP_BPM;
  return 60000 / bpm;
}

playStyleSelectEl.addEventListener("change", () => {
  currentPlayStyle = playStyleSelectEl.value;
  updateBpmTapLabel();
  synth.currentKey = null; // forces sound refresh
  if (currentPlayStyle === "chord") {
    synth.stopArpeggio();
  }
});

function registerBpmTap() {
  const now = performance.now();

  if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > TAP_RESET_MS) {
    tapTimes = [];
  }

  tapTimes.push(now);
  if (tapTimes.length > TAP_HISTORY_MAX) {
    tapTimes.shift();
  }

  if (tapTimes.length >= 2) {
    let total = 0;
    for (let i = 1; i < tapTimes.length; i++) {
      total += tapTimes[i] - tapTimes[i - 1];
    }
    const avgMs = total / (tapTimes.length - 1);
    tappedBpm = Math.round(60000 / avgMs);
    tappedBpm = Math.max(40, Math.min(240, tappedBpm));
    updateBpmTapLabel();
    synth.currentKey = null; // restart arp at new tempo

    // If still on Chord, switch to arpeggio so tapping is immediately useful
    if (currentPlayStyle === "chord") {
      playStyleSelectEl.value = "arp";
      currentPlayStyle = "arp";
      updateBpmTapLabel();
    }
  }
}

bpmTapButtonEl.addEventListener("click", () => {
  registerBpmTap();
});

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.key !== " ") return;
  if (e.repeat) return;

  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (progressionInputRowEl && !progressionInputRowEl.classList.contains("hidden") && document.activeElement === progressionInputEl) return;
  if (songPanelEl && !songPanelEl.classList.contains("hidden")) return;

  // Prevent page scroll and Space-activated button click (would double-count)
  e.preventDefault();
  registerBpmTap();
});

function getDegreeFreq(degree) {
  const semitones = DEGREE_SEMITONES[degree];

  let tonic = currentTonicFreq;

  // Drop these keys one octave
  if (
    tonic === 369.99 || // Gb/F#
    tonic === 392.00 || // G
    tonic === 415.30    // Ab/G#
  ) {
    tonic /= 2;
  }

  return tonic * Math.pow(2, semitones / 12);
}

const NUMERAL_TO_DEGREE = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7
};



function getChordName(roman, isMajorMode) {

  if (!roman || roman === "--") {
    return "";
  }

  const degree =
    NUMERAL_TO_DEGREE[roman.toUpperCase()];

  if (!degree) {
    return "";
  }

  const root =
    MAJOR_SCALE[currentKeyName][degree - 1];


  return isMajorMode
    ? root
    : root + "m";

}


// Generate all fundamental raw intervals relative to the degree root
function getChordTones(numeralStr, isMajorMode) {
  if (!numeralStr || numeralStr === "--") return null;

  const degree = NUMERAL_TO_DEGREE[numeralStr.toUpperCase()];
  if (!degree) return null;

  const root = getDegreeFreq(degree); 

  // Define scale intervals using precise semitone adjustments
  const thirdSemitones = isMajorMode ? 4 : 3;
  const fifthSemitones = 7; // Fixed perfect 5th for modes 1, 2, 3

  // Extension semitones (11 for Major 7th, 10 for Dominant 7, 9 for Diminished 7)
  const maj7Semitones = 11;
  const dom7Semitones = 10;
  const dim7Semitones = 9;

  // Build the tone collection
  const third = root * Math.pow(2, thirdSemitones / 12);
  const fifth = root * Math.pow(2, fifthSemitones / 12);
  
  const octaveRoot = root * 2;
  const octaveThird = third * 2;

  // Special extension notes
  const maj7Tone = root * Math.pow(2, maj7Semitones / 12);
  const dom7Tone = root * Math.pow(2, dom7Semitones / 12);
  const dim7Tone = root * Math.pow(2, dim7Semitones / 12);

  // If left hand mode is minor, case 4 needs a diminished 5th (tritone) for the Diminished 7th chord
  const dim5Tone = root * Math.pow(2, 6 / 12);

  return { 
    root, third, fifth, octaveRoot, octaveThird, 
    maj7Tone, dom7Tone, dim7Tone, dim5Tone 
  };
}

// Map the 4 right-hand finger variations depending entirely on the left-hand tilt mode
function getSolidNotes(tones, rightHandCount, isMajorMode) {
  if (!tones) return [];
  
  const { 
    root, third, fifth, octaveRoot, octaveThird, 
    maj7Tone, dom7Tone, dim7Tone, dim5Tone 
  } = tones;

  if (isMajorMode) {
    switch (rightHandCount) {
      case 1: // Major chord (root, fifth, octave, octave third)
        return [root, fifth, octaveRoot, octaveThird];
      case 2: // 1st inversion (third, fifth, octave, octave third)
        return [third, fifth, octaveRoot, octaveThird];
      case 3: // Major 7th (root, third, fifth, maj7)
        return [root, third, fifth, maj7Tone];
      case 4: // Dominant 7th (root, third, fifth, dom7)
        return [root, third, fifth, dom7Tone];
      default: 
        return [root, fifth, octaveRoot, octaveThird];
    }
  } else {
    // Minor Mode Routing
    switch (rightHandCount) {
      case 1: // Minor chord (root, fifth, octave, octave minor third)
        return [root, fifth, octaveRoot, octaveThird];
      case 2: // 1st inversion (minor third, fifth, octave, octave minor third)
        return [third, fifth, octaveRoot, octaveThird];
      case 3: // Minor 7th (root, third, fifth, dom7)
        return [root, third, fifth, dom7Tone]; 
      case 4: // Diminished 7th (root, minor third, diminished fifth, dim7)
        return [root, third, dim5Tone, dim7Tone];
      default: 
        return [root, fifth, octaveRoot, octaveThird];
    }
  }
}

// ---- Synth engine: oscillators -> lowpass filter -> master volume ----
class SynthEngine {
  constructor() {
    this.ctx = null;
    this.filter = null;
    this.waveShaper = null;
    this.masterGain = null;
    this.oscillators = [];
    this.currentKey = null;

    // Arpeggio state
    this.arpTimerId = null;
    this.arpFreqs = [];
    this.arpIntervalMs = 250;
    this.arpIndex = 0;
    this.arpOsc = null;
    this.arpGain = null;
    this.arpActive = false;
  }

  ensureContext() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.waveShaper = this.ctx.createWaveShaper();
    this.waveShaper.curve = null;
    this.waveShaper.oversample = "4x"; // Reduces aliasing harshness

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1200;
    this.filter.Q.value = 0.7;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0;

    // Signal chain: oscillators -> waveshaper -> filter -> masterGain -> output
    this.waveShaper.connect(this.filter);
    this.filter.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  updateVolume(volume01) {
    if (!this.ctx) return;
    // Smooth gain transitions to prevent audio clicking
    this.masterGain.gain.setTargetAtTime(volume01, this.ctx.currentTime, 0.03);
  }
  setVolume(volume01) {
    if (!this.ctx) return;
    const clamped = Math.max(0, Math.min(1, volume01));
    this.masterGain.gain.linearRampToValueAtTime(clamped, this.ctx.currentTime + 0.05);
  }

  updateFilterSweep(tiltFactor) {
    if (!this.filter || !this.ctx) return;

    // Base parameters for a balanced centered (0%) hand
    let targetFrequency = 1200;
    let targetQ = 0.7;

    if (tiltFactor < 0) {
      // ---- INWARD TILT (Acoustic Warmth) ----
      const intensity = Math.abs(tiltFactor); 
      targetFrequency = 1200 - (intensity * 950);
      targetQ = 0.7 + (intensity * 1.5); // Add a subtle woody, hollow resonance
    } 
    else if (tiltFactor > 0) {
      // ---- OUTWARD TILT (EDM Filter Sweep) ----
      targetFrequency = 1200 + (tiltFactor * 3800);
      targetQ = 0.7 + (tiltFactor * 4.5); // Spikes resonance for synthetic "squelch"
    }

    // Smooth out audio node updates frame-by-frame to eliminate audio clicking
    const now = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(targetFrequency, now, 0.04);
    this.filter.Q.setTargetAtTime(targetQ, now, 0.04);
  }

  _clearSolidOscillators() {
    this.oscillators.forEach((osc) => { try { osc.stop(); } catch {} });
    this.oscillators = [];
  }

  playNotes(freqs) {
    if (!this.ctx || freqs.length === 0) return;

    this.stopArpeggio();

    if (!hasPlayedFirstSound) {
      hasPlayedFirstSound = true;
      trackClarityEvent("first_sound");
    }

    const key = freqs.map((f) => f.toFixed(1)).join(",");
    if (key === this.currentKey) return;

    this._clearSolidOscillators();
    this.oscillators = freqs.map((freq) => {
      const osc = this.ctx.createOscillator();
      osc.type = currentWaveform;
      osc.frequency.value = freq;
      osc.connect(this.waveShaper); // was: this.filter
      osc.start();
      return osc;
    });
    this.currentKey = key;
  }

  _ensureArpVoice() {
    if (this.arpOsc && this.arpGain) return;

    this.arpGain = this.ctx.createGain();
    this.arpGain.gain.value = 0;
    this.arpGain.connect(this.waveShaper);

    this.arpOsc = this.ctx.createOscillator();
    this.arpOsc.type = currentWaveform;
    this.arpOsc.frequency.value = 440;
    this.arpOsc.connect(this.arpGain);
    this.arpOsc.start();
  }

  _playArpStep() {
    if (!this.arpActive || !this.ctx || this.arpFreqs.length === 0) return;

    this._ensureArpVoice();

    const freq = this.arpFreqs[this.arpIndex % this.arpFreqs.length];
    this.arpIndex = (this.arpIndex + 1) % this.arpFreqs.length;

    const now = this.ctx.currentTime;
    const attack = 0.012;
    const release = Math.min(0.08, (this.arpIntervalMs / 1000) * 0.35);
    const noteEnd = now + this.arpIntervalMs / 1000;

    this.arpOsc.type = currentWaveform;
    this.arpOsc.frequency.setValueAtTime(freq, now);

    this.arpGain.gain.cancelScheduledValues(now);
    this.arpGain.gain.setValueAtTime(0, now);
    this.arpGain.gain.linearRampToValueAtTime(1, now + attack);
    this.arpGain.gain.setValueAtTime(1, Math.max(now + attack, noteEnd - release));
    this.arpGain.gain.linearRampToValueAtTime(0, noteEnd);

    this.arpTimerId = setTimeout(() => this._playArpStep(), this.arpIntervalMs);
  }

  startArpeggio(freqs, intervalMs) {
    if (!this.ctx || !freqs || freqs.length === 0) return;

    if (!hasPlayedFirstSound) {
      hasPlayedFirstSound = true;
      trackClarityEvent("first_sound");
    }

    const key = `arp:${intervalMs}:${freqs.map((f) => f.toFixed(1)).join(",")}`;
    if (key === this.currentKey && this.arpActive) return;

    this._clearSolidOscillators();
    this.stopArpeggio();

    this.arpFreqs = freqs.slice();
    this.arpIntervalMs = intervalMs;
    this.arpIndex = 0;
    this.arpActive = true;
    this.currentKey = key;

    this._playArpStep();
  }

  stopArpeggio() {
    if (this.arpTimerId != null) {
      clearTimeout(this.arpTimerId);
      this.arpTimerId = null;
    }

    this.arpActive = false;
    this.arpFreqs = [];
    this.arpIndex = 0;

    if (this.arpOsc) {
      try { this.arpOsc.stop(); } catch {}
      try { this.arpOsc.disconnect(); } catch {}
      this.arpOsc = null;
    }
    if (this.arpGain) {
      try { this.arpGain.disconnect(); } catch {}
      this.arpGain = null;
    }
  }

  stop() {
    this.setVolume(0);
    this.stopArpeggio();
    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    });
    this.oscillators = [];
    this.currentKey = null;
  }
}

const synth = new SynthEngine();

let hasPlayedFirstSound = false;
let lastTrackedChord = null;

startOverlayEl.addEventListener("click", () => {
  synth.ensureContext();
  startOverlayEl.style.display = "none";
  canvasEl.classList.remove("dimmed");
});

guideToggleEl.addEventListener("click", () => {
  const isHidden = gestureGuideEl.classList.toggle("hidden");

  if (!isHidden) {
    trackClarityEvent("guide_opened");
  }

  guideToggleEl.textContent = isHidden ? "Open Guide" : "Close Guide";
});

helpButton.addEventListener("click", () => {
  trackClarityEvent("help_opened");
  helpModal.classList.remove("hidden");
});

closeHelp.addEventListener("click", (e) => {
  e.stopPropagation();
  helpModal.classList.add("hidden");
});

// Optional: click outside the card to close
helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) {
    helpModal.classList.add("hidden");
  }
});

// Computes a "cover" crop rect in source-video pixel space: the largest
// centered rectangle matching the destination's aspect ratio, so the
// video fills the screen (height fit, width cropped) with zero stretch.
function computeCoverRect(srcW, srcH, dstW, dstH) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;

  if (srcRatio > dstRatio) {
    const sHeight = srcH;
    const sWidth = srcH * dstRatio;
    return { sx: (srcW - sWidth) / 2, sy: 0, sWidth, sHeight };
  } else {
    const sWidth = srcW;
    const sHeight = srcW / dstRatio;
    return { sx: 0, sy: (srcH - sHeight) / 2, sWidth, sHeight };
  }
}

function drawFrame(results, canvasWidth, canvasHeight) {
  const srcW = videoEl.videoWidth;
  const srcH = videoEl.videoHeight;
  if (!srcW || !srcH) return;

  const { sx, sy, sWidth, sHeight } = computeCoverRect(srcW, srcH, canvasWidth, canvasHeight);

  ctx.save();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.translate(canvasWidth, 0);
  ctx.scale(-1, 1);

  ctx.drawImage(videoEl, sx, sy, sWidth, sHeight, 0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = "#ffffff80";
  for (const landmarks of results.landmarks) {
    for (const point of landmarks) {
      const videoPx = point.x * srcW;
      const videoPy = point.y * srcH;
      const canvasX = ((videoPx - sx) / sWidth) * canvasWidth;
      const canvasY = ((videoPy - sy) / sHeight) * canvasHeight;

      ctx.beginPath();
      ctx.arc(canvasX, canvasY, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ---- Main loop ----
function resizeCanvas() {
  canvasEl.width = window.innerWidth;
  canvasEl.height = window.innerHeight;
}

async function main() {
  await setupCamera();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  const handLandmarker = await setupHandLandmarker();

  let lastVideoTime = -1;
  
  // Persistent structural cache to keep landmark data accessible across high-speed ticks
  let cachedLeftLandmarks = null;
  let cachedRightLandmarks = null;

  function loop() {
  const timestampNow = performance.now();

  // ============================
  // 1. UPDATE MEDIAPIPE FRAME
  // ============================

  if (videoEl.currentTime !== lastVideoTime) {
    lastVideoTime = videoEl.currentTime;

    const results = handLandmarker.detectForVideo(videoEl, timestampNow);

    drawFrame(
      results,
      canvasEl.width,
      canvasEl.height
    );

    cachedLeftLandmarks = null;
    cachedRightLandmarks = null;

    results.landmarks.forEach((landmarks, i) => {
      const handedness = results.handedness[i][0].categoryName;

      if (handedness === "Left") {
        cachedLeftLandmarks = landmarks;
      }

      if (handedness === "Right") {
        cachedRightLandmarks = landmarks;
      }
    });
  }


  // ============================
  // 2. RAW GESTURE STATES
  // ============================

  let currentChord = null;
  let isMajorMode = true;

  let qualityIndex = 0;
  let thumbDown = false;


  let rawChordState = null;


  // ============================
// BUILD MUSICAL CHORD STATE
// ============================

let rawChord = null;
let rawMode = true;
let rawQualityIndex = 0;
let rawThumbDown = false;


// LEFT HAND = ROOT CHORD

if (cachedLeftLandmarks) {

  const leftTilt =
    getHandHorizontalTilt(
      cachedLeftLandmarks,
      "Left"
    );


  rawChord =
    classifyChord(
      cachedLeftLandmarks,
      "Left"
    );


  rawMode =
    leftTilt >= 0;

  // With a progression guide, snap left-hand detection to the nearest
  // step and prefer advancing to the next chord when you move that way.
  if (rawChord && currentProgression.length) {
    const snapped = snapToProgression(rawChord, rawMode);
    if (snapped) {
      rawChord = snapped.chord;
      rawMode = snapped.isMajorMode;
    }
    highlightProgressionStep();
  }

}


// RIGHT HAND = VOICING

if (cachedRightLandmarks) {

  rawQualityIndex =
    getRightHandQualityIndex(
      cachedRightLandmarks
    );


  rawThumbDown =
    isThumbExtended(
      cachedRightLandmarks,
      "Right"
    );

}


// Combine into ONE musical object

if (rawChord) {

  rawChordState = {

    chord: rawChord,

    isMajorMode: rawMode,

    qualityIndex: rawQualityIndex,

    thumbDown: rawThumbDown

  };

}


  // ============================
  // 3. STABILIZE HANDS
  // ============================

  const stableChordState =
  stabilizeChordState(
    rawChordState,
    timestampNow
  );


  if (stableChordState) {

  currentChord =
    stableChordState.chord;


  isMajorMode =
    stableChordState.isMajorMode;


  qualityIndex =
    stableChordState.qualityIndex;


  thumbDown =
    stableChordState.thumbDown;

}

  // Locked voicing: root position + octave down (no right-hand pose required)
  if (voicingLocked) {
    qualityIndex = 1;
    thumbDown = true;
  }


  // ============================
  // 4. UI UPDATE
  // ============================

  if (currentChord) {
  const chordName =
    getChordName(
      currentChord,
      isMajorMode
    );

  chordDisplayEl.textContent =
    `${chordName}(${currentChord})`;
  } else {
    chordDisplayEl.textContent = "--";
  }


  const MAJOR_LABELS = {
    1: "Major",
    2: "Major 1st Inv",
    3: "Major 7th",
    4: "Dominant 7th"
  };


  const MINOR_LABELS = {
    1: "Minor",
    2: "Minor 1st Inv",
    3: "Minor 7th",
    4: "Diminished 7th"
  };


  const activeLabel =
    isMajorMode
      ? MAJOR_LABELS[qualityIndex]
      : MINOR_LABELS[qualityIndex];


  qualityDisplayEl.textContent =
    activeLabel
      ? `${activeLabel}${thumbDown ? " (-8ve)" : ""}${voicingLocked ? " 🔒" : ""}`
      : "--";



  // ============================
  // 5. AUDIO ENGINE
  // ============================

  const rightHandPresent = Boolean(cachedRightLandmarks);
  const leftHandPresent = Boolean(cachedLeftLandmarks);
  const canPlayVoicing =
    currentChord && (qualityIndex >= 1 || voicingLocked);

  let currentVolume = 0;
  let horizontalTilt = 0;

  if (voicingLocked) {
    // Left hand height drives volume while -8ve voicing is locked
    if (leftHandPresent) {
      currentVolume = getVolumeFromHeight(cachedLeftLandmarks);
    }
    if (rightHandPresent) {
      horizontalTilt = getHandHorizontalTilt(cachedRightLandmarks, "Right");
    }
  } else if (rightHandPresent) {
    currentVolume = getVolumeFromHeight(cachedRightLandmarks);
    horizontalTilt = getHandHorizontalTilt(cachedRightLandmarks, "Right");
  }

  updateVolumeMeter(currentVolume);

  const tiltPercentage = Math.round(horizontalTilt * 100);
  const targetEl = document.getElementById("distortionDisplay");
  if (targetEl) {
    targetEl.textContent =
      `Filter: ${tiltPercentage > 0 ? "+" : ""}${tiltPercentage}%`;
  }

  if (synth.ctx) {
    synth.updateFilterSweep(horizontalTilt);
  }

  if (canPlayVoicing && (rightHandPresent || voicingLocked)) {

      const chordTrackingKey =
        `${currentChord}-${isMajorMode ? "major" : "minor"}-${qualityIndex}-${thumbDown ? "low" : "normal"}`;

      if (chordTrackingKey !== lastTrackedChord) {
        lastTrackedChord = chordTrackingKey;
        trackClarityEvent("chord_changed");
      }

      const tones =
        getChordTones(
          currentChord,
          isMajorMode
        );


      let notes =
        getSolidNotes(
          tones,
          qualityIndex,
          isMajorMode
        );


      if (thumbDown) {
        notes =
          notes.map(
            freq => freq / 2
          );
      }


      const arpInterval = getArpIntervalMs();

      if (currentPlayStyle === "arp") {
        synth.startArpeggio(notes, arpInterval);
      } else {
        synth.playNotes(notes);
      }

      synth.setVolume(
        currentVolume
      );


  } else {

    synth.stopArpeggio();
    synth.setVolume(0);

  }



  // ============================
  // 6. VISUAL ENERGY
  // ============================

  const volume = currentVolume;


  const tilt = horizontalTilt;


  drawEnergy(
    ctx,
    volume,
    qualityIndex,
    tilt,
    currentChord
  );


  requestAnimationFrame(loop);
}
  
  loop();
}

main().catch((err) => console.error(err));

