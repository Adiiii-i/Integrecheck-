/* ============================================
   ASSIGNMENT SIMILARITY CHECKER v4 — PRODUCTION
   Bugs fixed · Dark mode · Toasts · Confetti
   Demo data · Export · Keyboard shortcuts
   ============================================ */

'use strict';

// ── STATE ─────────────────────────────────────
const students = [];          // { id:string, name, text, fileName, fileType, status, pages:[] }
let analysisResults = null;
let flagThreshold = 40;
let soundEnabled = true;
let totalAnalyses = parseInt(localStorage.getItem('totalAnalyses') || '0');

// ── PDF.js SETUP ──────────────────────────────
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ── UTILS ─────────────────────────────────────
function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = String(text ?? '');
    return d.innerHTML;
}

function truncate(str, max) {
    return str.length <= max ? str : str.slice(0, max) + '…';
}

function fmtBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

// ── TOAST ─────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    // Trigger animation
    requestAnimationFrame(() => {
        t.style.animationDuration = `0.4s, 0.3s`;
        t.style.animationDelay = `0s, ${duration - 300}ms`;
        t.style.animationFillMode = 'forwards';
    });
    setTimeout(() => t.remove(), duration);
}

// ── SOUND ─────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function beep(freq = 440, type = 'sine', duration = 0.15, gain = 0.15) {
    if (!soundEnabled) return;
    try {
        if (!audioCtx) audioCtx = new AudioCtx();
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.connect(g); g.connect(audioCtx.destination);
        osc.frequency.value = freq; osc.type = type;
        g.gain.setValueAtTime(gain, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.start(); osc.stop(audioCtx.currentTime + duration);
    } catch (_) { }
}

function playAdd() { beep(880, 'sine', 0.1); }
function playRemove() { beep(220, 'triangle', 0.15); }
function playAnalyze() { [440, 550, 660].forEach((f, i) => setTimeout(() => beep(f, 'sine', 0.12), i * 80)); }
function playDone() { [660, 770, 880, 1100].forEach((f, i) => setTimeout(() => beep(f, 'sine', 0.1), i * 70)); }
function playFlag() { beep(330, 'sawtooth', 0.2); }

// ── THEME ─────────────────────────────────────
function toggleTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? '' : 'dark');
    document.getElementById('theme-toggle').textContent = dark ? '🌙' : '☀️';
    localStorage.setItem('theme', dark ? 'light' : 'dark');
    beep(dark ? 400 : 600, 'sine', 0.1, 0.1);
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    document.getElementById('sound-toggle').textContent = soundEnabled ? '🔊' : '🔇';
    localStorage.setItem('sound', soundEnabled ? '1' : '0');
}

// ── SHORTCUTS MODAL ───────────────────────────
function showShortcuts() {
    document.getElementById('shortcuts-modal').style.display = 'flex';
}
function closeShortcuts(e) {
    if (!e || e.target === document.getElementById('shortcuts-modal')) {
        document.getElementById('shortcuts-modal').style.display = 'none';
    }
}

// ── THRESHOLD ─────────────────────────────────
function updateThresholdLabel(val) {
    flagThreshold = parseInt(val);
    document.getElementById('threshold-label').textContent = val + '%';
}

// ── MODE SELECTOR (JS fallback for :has()) ────
document.getElementById('mode-selector').addEventListener('change', (e) => {
    document.querySelectorAll('.mode-option').forEach(opt => {
        opt.classList.toggle('selected', opt.querySelector('input') === e.target);
    });
});

// ── SCROLL ANIMATIONS ─────────────────────────
const scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            scrollObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.12 });

document.querySelectorAll('.animate-on-scroll').forEach((el, i) => {
    el.style.transitionDelay = `${i * 0.08}s`;
    scrollObserver.observe(el);
});

// fix sticky note rotations after scroll reveals them
const noteRotations = ['-2deg', '1.5deg', '-1deg', '2deg'];
document.querySelectorAll('.sticky-note').forEach((n, i) => {
    n.style.setProperty('--rotate', noteRotations[i] || '0deg');
});

// ── COUNTER DISPLAY ───────────────────────────
function updateAnalysisCounter() {
    totalAnalyses++;
    localStorage.setItem('totalAnalyses', totalAnalyses);
    document.getElementById('total-analyses').textContent = `${totalAnalyses} analys${totalAnalyses === 1 ? 'is' : 'es'} done`;
}

(function initCounter() {
    document.getElementById('total-analyses').textContent =
        `${totalAnalyses} analys${totalAnalyses === 1 ? 'is' : 'es'} done`;
})();

// ══════════════════════════════════════════════
// PERCEPTUAL HASHING ENGINE
// ══════════════════════════════════════════════

function getOffscreenCtx(w, h) {
    const canvas = document.getElementById('offscreen-canvas');
    canvas.width = w; canvas.height = h;
    return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
}

function canvasToGray(src, size) {
    const { ctx } = getOffscreenCtx(size, size);
    ctx.drawImage(src, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const gray = new Float32Array(size * size);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return gray;
}

function averageHash(src, size = 16) {
    const gray = canvasToGray(src, size);
    const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
    return Array.from(gray).map(v => v >= avg ? 1 : 0).join('');
}

function differenceHash(src, size = 16) {
    const w = size + 1;
    const { ctx } = getOffscreenCtx(w, size);
    ctx.drawImage(src, 0, 0, w, size);
    const data = ctx.getImageData(0, 0, w, size).data;
    let hash = '';
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const a = (y * w + x) * 4, b = (y * w + x + 1) * 4;
            const ga = 0.299 * data[a] + 0.587 * data[a + 1] + 0.114 * data[a + 2];
            const gb = 0.299 * data[b] + 0.587 * data[b + 1] + 0.114 * data[b + 2];
            hash += ga < gb ? '1' : '0';
        }
    }
    return hash;
}

function blockHash(src, blocks = 8) {
    const size = blocks * 4;
    const gray = canvasToGray(src, size);
    const bsz = size / blocks;
    const means = [];
    for (let by = 0; by < blocks; by++) {
        for (let bx = 0; bx < blocks; bx++) {
            let sum = 0, cnt = 0;
            for (let y = by * bsz; y < (by + 1) * bsz; y++)
                for (let x = bx * bsz; x < (bx + 1) * bsz; x++) { sum += gray[y * size + x]; cnt++; }
            means.push(sum / cnt);
        }
    }
    const avg = means.reduce((a, b) => a + b, 0) / means.length;
    return means.map(v => v >= avg ? 1 : 0).join('');
}

function hamming(h1, h2) {
    if (h1.length !== h2.length) return 1;
    let d = 0;
    for (let i = 0; i < h1.length; i++) if (h1[i] !== h2[i]) d++;
    return d / h1.length;
}

function visualPageSim(ha, hb) {
    const dist = hamming(ha.aHash, hb.aHash) * 0.25
        + hamming(ha.dHash, hb.dHash) * 0.45
        + hamming(ha.bHash, hb.bHash) * 0.30;
    return Math.round(Math.max(0, (1 - dist) * 100));
}

function computeHashes(canvas) {
    return { aHash: averageHash(canvas), dHash: differenceHash(canvas), bHash: blockHash(canvas) };
}

// ══════════════════════════════════════════════
// PDF & IMAGE PROCESSING
// ══════════════════════════════════════════════

async function processPDF(file, onProgress) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const n = pdf.numPages;
    let text = '';
    const pages = [];

    for (let i = 1; i <= n; i++) {
        if (onProgress) onProgress(`📄 Rendering page ${i}/${n}…`);
        const page = await pdf.getPage(i);

        // Text extraction
        try {
            const c = await page.getTextContent();
            text += c.items.map(it => it.str).join(' ') + '\n';
        } catch (_) { }

        // Render to canvas
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const hashes = computeHashes(canvas);
        const thumbCanvas = document.createElement('canvas');
        const tw = 150, th = Math.round(viewport.height / viewport.width * 150);
        thumbCanvas.width = tw; thumbCanvas.height = th;
        thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, tw, th);
        const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.6);

        // Free full canvas GPU memory
        canvas.width = canvas.height = 0;

        pages.push({ pageNum: i, thumbnail, hashes });
    }
    return { text: text.trim(), pages };
}

async function processImage(file, onProgress) {
    if (onProgress) onProgress('🖼️ Loading image…');
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();

    const hashes = computeHashes(canvas);
    const tw = 150, th = Math.round(bitmap.height / bitmap.width * 150);
    const tc = document.createElement('canvas');
    tc.width = tw; tc.height = th;
    tc.getContext('2d').drawImage(canvas, 0, 0, tw, th);
    const thumbnail = tc.toDataURL('image/jpeg', 0.6);

    // Free
    canvas.width = canvas.height = 0;

    let text = '';
    if (onProgress) onProgress('🔤 Running OCR…');
    try {
        const url = URL.createObjectURL(file);
        const res = await Tesseract.recognize(url, 'eng', {
            logger: m => {
                if (m.status === 'recognizing text' && onProgress)
                    onProgress(`🔤 OCR ${Math.round((m.progress || 0) * 100)}%`);
            }
        });
        URL.revokeObjectURL(url);
        text = res.data.text.trim();
    } catch (e) { console.warn('OCR failed', e); }

    return { text, pages: [{ pageNum: 1, thumbnail, hashes }] };
}

// ══════════════════════════════════════════════
// FILE UPLOAD
// ══════════════════════════════════════════════
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const MAX_STUDENTS = 50;

const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');

uploadZone.addEventListener('click', e => {
    if (!['INPUT', 'LABEL'].includes(e.target.tagName)) fileInput.click();
});
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
    e.preventDefault(); uploadZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => { handleFiles(e.target.files); fileInput.value = ''; });

async function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (students.length + files.length > MAX_STUDENTS) {
        toast(`Max ${MAX_STUDENTS} students allowed!`, 'error'); return;
    }
    for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
            toast(`Skipped "${file.name}" — unsupported format`, 'warning'); continue;
        }
        if (file.size > MAX_FILE_SIZE) {
            toast(`"${file.name}" too large (${fmtBytes(file.size)} > 20 MB)`, 'error'); continue;
        }
        // Duplicate check by name + size
        const dup = students.find(s => s.fileName === file.name && s.fileSize === file.size);
        if (dup) { toast(`"${file.name}" already added`, 'warning'); continue; }

        const id = uid();
        const name = file.name.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').trim();
        const student = {
            id, name, text: '', fileName: file.name, fileSize: file.size,
            fileType: ext, status: 'processing', pages: []
        };
        students.push(student);
        renderStudentsList();

        try {
            let result;
            if (ext === 'pdf') result = await processPDF(file, msg => setCardStatus(id, msg));
            else result = await processImage(file, msg => setCardStatus(id, msg));
            student.text = result.text;
            student.pages = result.pages;
            student.status = (result.pages.length > 0 || result.text.trim().length >= 5) ? 'ready' : 'error';
        } catch (err) {
            console.error(err); student.status = 'error';
            toast(`Error processing "${file.name}"`, 'error');
        }
        renderStudentsList(); updateUI();
    }
    if (students.some(s => s.status === 'ready')) {
        playAdd();
        toast(`${files.length} file(s) processed!`, 'success');
    }
}

function setCardStatus(id, msg) {
    const card = document.querySelector(`[data-student-id="${id}"]`);
    if (!card) return;
    const el = card.querySelector('.student-status');
    if (el) { el.textContent = msg; el.className = 'student-status status-processing'; }
}

// ══════════════════════════════════════════════
// MANUAL STUDENT
// ══════════════════════════════════════════════
function addManualStudent() {
    if (students.length >= MAX_STUDENTS) { toast(`Max ${MAX_STUDENTS} students!`, 'error'); return; }
    const input = document.getElementById('manual-name');
    const name = input.value.trim().replace(/[<>]/g, '') || `Student ${students.length + 1}`;
    const student = {
        id: uid(), name, text: '', fileName: 'manual', fileSize: 0,
        fileType: 'text', status: 'ready', pages: []
    };
    students.push(student);
    input.value = '';
    renderStudentsList(); updateUI(); playAdd();
    toast(`Added "${name}"`, 'success', 2000);
    setTimeout(() => {
        const card = document.querySelector(`[data-student-id="${student.id}"]`);
        if (card) {
            toggleEdit(student.id);
            const ta = card.querySelector('.student-edit-area');
            if (ta) ta.focus();
        }
    }, 120);
}

document.getElementById('manual-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') addManualStudent();
});

// ══════════════════════════════════════════════
// DEMO DATA
// ══════════════════════════════════════════════
function loadDemoData() {
    if (students.length > 0) clearAllStudents();
    const demo = [
        {
            name: 'Rahul Sharma',
            text: 'Machine learning is a branch of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. It focuses on developing computer programs that can access data and use it to learn for themselves. The process begins with observations of data, such as examples or direct experience, to look for patterns in data and make better decisions in the future. The primary aim is to allow the computers to learn automatically without human intervention.'
        },
        {
            name: 'Priya Singh',
            text: 'Machine learning is a part of artificial intelligence that allows systems to learn and improve from experience without being explicitly programmed. It focuses on building computer programs that can access data and use it to learn themselves. The process starts with observations of data such as examples or direct experience to look for patterns and make better decisions in future. The main goal is to allow computers to learn automatically without human intervention or assistance.'
        },
        {
            name: 'Amit Kumar',
            text: 'Cloud computing is the on-demand availability of computer system resources, especially data storage and computing power, without direct active management by the user. Large clouds often have functions distributed over multiple locations, each location being a data center. Cloud computing relies on sharing of resources to achieve coherence and economies of scale. Internet of Things connects physical devices with digital systems through cloud infrastructure.'
        }
    ];
    demo.forEach(d => {
        const student = {
            id: uid(), name: d.name, text: d.text, fileName: 'demo',
            fileSize: 0, fileType: 'text', status: 'ready', pages: []
        };
        students.push(student);
    });
    renderStudentsList(); updateUI(); playAdd();
    toast('Demo data loaded! Click Analyze to test.', 'info');
}

// ══════════════════════════════════════════════
// STUDENT LIST RENDERING
// ══════════════════════════════════════════════
function renderStudentsList() {
    const list = document.getElementById('students-list');
    list.innerHTML = '';

    students.forEach((student, index) => {
        const card = document.createElement('div');
        card.className = 'student-card';
        card.setAttribute('data-student-id', student.id);

        const statusCls = { ready: 'status-ready', processing: 'status-processing', error: 'status-error' }[student.status] || 'status-processing';
        const statusTxt = { ready: '✓ Ready', processing: '⏳ Processing…', error: '✕ Error' }[student.status] || '…';
        const wordCount = student.text.trim() ? student.text.trim().split(/\s+/).length : 0;
        const preview = student.text.slice(0, 130);

        let thumbsHTML = '';
        if (student.pages.length > 0) {
            thumbsHTML = '<div class="student-thumbnails">' +
                student.pages.map(p =>
                    `<div class="student-thumbnail">
            <img src="${p.thumbnail}" alt="P${p.pageNum}" loading="lazy">
            <span class="thumb-label">P${p.pageNum}</span>
           </div>`
                ).join('') + '</div>';
        }

        let infoHTML = '<div class="student-info-row">';
        if (student.pages.length > 0)
            infoHTML += `<span class="student-info-tag">📄 ${student.pages.length}pg</span>`;
        if (wordCount > 0)
            infoHTML += `<span class="student-info-tag">📝 ${wordCount}w</span>`;
        if (student.fileSize > 0)
            infoHTML += `<span class="student-info-tag">💾 ${fmtBytes(student.fileSize)}</span>`;
        if (student.pages.length > 0)
            infoHTML += `<span class="student-info-tag">🔑 Visual ready</span>`;
        infoHTML += '</div>';

        // Use data-id attributes on buttons to avoid inline eval
        card.innerHTML = `
      <div class="student-card-header">
        <div class="student-name-row">
          <span class="student-number">${index + 1}.</span>
          <span class="student-name" contenteditable="true" spellcheck="false"
                data-id="${escapeHtml(student.id)}"
                title="Click to rename">${escapeHtml(student.name)}</span>
          <span class="student-file-tag">${escapeHtml(student.fileName)}</span>
        </div>
        <span class="student-status ${statusCls}">${statusTxt}</span>
      </div>
      ${thumbsHTML}
      ${infoHTML}
      ${preview ? `<div class="student-text-preview">${escapeHtml(preview)}${preview.length >= 130 ? '…' : ''}</div>` : ''}
      <div class="student-actions">
        <button class="student-action-btn" data-action="edit" data-id="${student.id}">✏️ Edit Text</button>
        <button class="student-action-btn delete-btn" data-action="delete" data-id="${student.id}">🗑️ Remove</button>
      </div>
      <textarea class="student-edit-area" id="edit-${student.id}" style="display:none;"
                placeholder="Paste student's assignment text here…"
                data-id="${student.id}">${escapeHtml(student.text)}</textarea>
    `;

        list.appendChild(card);
    });

    // Event delegation — safe, no inline eval
    list.addEventListener('click', listClickHandler, { once: false });
    list.addEventListener('input', listInputHandler);
    list.addEventListener('blur', listBlurHandler, true);
}

function listClickHandler(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    if (btn.getAttribute('data-action') === 'edit') toggleEdit(id);
    if (btn.getAttribute('data-action') === 'delete') deleteStudent(id);
}

function listInputHandler(e) {
    const ta = e.target.closest('textarea.student-edit-area');
    if (!ta) return;
    const id = ta.getAttribute('data-id');
    onStudentTextEdit(id, ta.value);
}

function listBlurHandler(e) {
    const el = e.target.closest('.student-name[contenteditable]');
    if (!el) return;
    const id = el.getAttribute('data-id');
    const name = el.textContent.replace(/[<>]/g, '').trim() || 'Student';
    updateStudentName(id, name);
    el.textContent = name; // normalise displayed text
}

function updateStudentName(id, name) {
    const s = students.find(s => s.id === id);
    if (s) s.name = name;
}

function toggleEdit(id) {
    const el = document.getElementById(`edit-${id}`);
    if (!el) return;
    const open = el.style.display !== 'block';
    el.style.display = open ? 'block' : 'none';
    if (open) el.focus();
}

function onStudentTextEdit(id, text) {
    const s = students.find(s => s.id === id);
    if (!s) return;
    s.text = text;
    s.status = (text.trim().length >= 5 || s.pages.length > 0) ? 'ready' : 'error';
    updateUI();
}

function deleteStudent(id) {
    const i = students.findIndex(s => s.id === id);
    if (i > -1) {
        const name = students[i].name;
        students.splice(i, 1);
        renderStudentsList(); updateUI(); playRemove();
        toast(`Removed "${name}"`, 'info', 2000);
    }
}

function clearAllStudents() {
    students.length = 0;
    renderStudentsList(); updateUI();
    document.getElementById('results').style.display = 'none';
    document.getElementById('detail-section').style.display = 'none';
    toast('All students cleared', 'info', 2000);
}

function updateUI() {
    const ready = students.filter(s => s.status === 'ready');
    const counter = document.getElementById('student-counter');
    const step2 = document.getElementById('step-analyze');

    if (students.length > 0) {
        counter.style.display = 'flex';
        document.getElementById('student-count-text').textContent =
            `${students.length} student${students.length > 1 ? 's' : ''} (${ready.length} ready)`;
    } else {
        counter.style.display = 'none';
    }
    step2.style.display = ready.length >= 2 ? 'block' : 'none';
}

// ══════════════════════════════════════════════
// TEXT SIMILARITY ENGINE
// ══════════════════════════════════════════════
function normalize(s) { return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(); }

function getSentences(text) {
    return text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10);
}

function getNgrams(text, n) {
    const words = normalize(text).split(/\s+/).filter(Boolean);
    const grams = [];
    for (let i = 0; i <= words.length - n; i++) grams.push(words.slice(i, i + n).join(' '));
    return grams;
}

function jaccard(a, b) {
    const sa = new Set(normalize(a).split(' ')), sb = new Set(normalize(b).split(' '));
    let inter = 0;
    sa.forEach(w => { if (sb.has(w)) inter++; });
    return (sa.size + sb.size - inter) === 0 ? 0 : inter / (sa.size + sb.size - inter);
}

function findSimilarSentences(ta, tb, threshold = 0.4) {
    const sa = getSentences(ta), sb = getSentences(tb);
    const pairs = [], mA = new Set(), mB = new Set();
    for (let i = 0; i < sa.length; i++) {
        let best = -1, bestSc = 0;
        for (let j = 0; j < sb.length; j++) {
            const sc = jaccard(sa[i], sb[j]);
            if (sc > bestSc && sc >= threshold) { bestSc = sc; best = j; }
        }
        if (best !== -1) {
            pairs.push({ sentenceA: sa[i], sentenceB: sb[best], indexA: i, indexB: best, similarity: bestSc });
            mA.add(i); mB.add(best);
        }
    }
    return { pairs: pairs.sort((a, b) => b.similarity - a.similarity), sentencesA: sa, sentencesB: sb, matchedA: mA, matchedB: mB };
}

function findMatchingPhrases(ta, tb, n = 4) {
    const a = new Set(getNgrams(ta, n)), b = new Set(getNgrams(tb, n));
    return [...a].filter(g => b.has(g));
}

function computeTextSimilarity(ta, tb) {
    if (!ta.trim() || !tb.trim()) return 0;
    const j = jaccard(ta, tb);
    const ng3a = new Set(getNgrams(ta, 3)), ng3b = new Set(getNgrams(tb, 3));
    const t3 = ng3a.size + ng3b.size === 0 ? 0 :
        [...ng3a].filter(x => ng3b.has(x)).length / new Set([...ng3a, ...ng3b]).size;
    const ng5a = new Set(getNgrams(ta, 5)), ng5b = new Set(getNgrams(tb, 5));
    const t5 = ng5a.size + ng5b.size === 0 ? 0 :
        [...ng5a].filter(x => ng5b.has(x)).length / new Set([...ng5a, ...ng5b]).size;
    const sr = findSimilarSentences(ta, tb);
    const tot = Math.max(sr.sentencesA.length, sr.sentencesB.length);
    const ss = tot > 0 ? sr.pairs.length / tot : 0;
    return Math.min(Math.round((j * 0.15 + t3 * 0.25 + t5 * 0.35 + ss * 0.25) * 100), 100);
}

// ══════════════════════════════════════════════
// VISUAL SIMILARITY ENGINE
// ══════════════════════════════════════════════
function computeVisualSimilarity(pA, pB) {
    if (!pA.length || !pB.length) return { score: 0, pagePairs: [] };
    const pagePairs = [];
    for (const pa of pA)
        for (const pb of pB)
            pagePairs.push({
                pageA: pa.pageNum, pageB: pb.pageNum,
                thumbA: pa.thumbnail, thumbB: pb.thumbnail,
                similarity: visualPageSim(pa.hashes, pb.hashes)
            });
    pagePairs.sort((a, b) => b.similarity - a.similarity);

    const bestOf = (pages, key) => pages.map(p => {
        const matches = pagePairs.filter(pp => pp[key] === p.pageNum);
        return matches.length ? matches[0].similarity : 0;
    });
    const all = [...bestOf(pA, 'pageA'), ...bestOf(pB, 'pageB')];
    const score = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : 0;
    return { score, pagePairs };
}

// ══════════════════════════════════════════════
// HYBRID SIMILARITY
// ══════════════════════════════════════════════
function computeHybrid(sA, sB, mode) {
    const hasTA = sA.text.trim().length >= 10, hasTB = sB.text.trim().length >= 10;
    const hasPA = sA.pages.length > 0, hasPB = sB.pages.length > 0;
    let textScore = 0, visualScore = 0, visualDetail = { score: 0, pagePairs: [] };

    if (mode !== 'visual' && hasTA && hasTB)
        textScore = computeTextSimilarity(sA.text, sB.text);
    if (mode !== 'text' && hasPA && hasPB) {
        visualDetail = computeVisualSimilarity(sA.pages, sB.pages);
        visualScore = visualDetail.score;
    }

    let finalScore;
    if (mode === 'text') finalScore = textScore;
    else if (mode === 'visual') finalScore = visualScore;
    else if (hasPA && hasPB && hasTA && hasTB)
        finalScore = Math.round(textScore * 0.4 + visualScore * 0.6);
    else if (hasPA && hasPB) finalScore = visualScore;
    else finalScore = textScore;

    return { finalScore, textScore, visualScore, visualDetail };
}

// ══════════════════════════════════════════════
// ANALYSIS RUNNER
// ══════════════════════════════════════════════
function getMode() {
    return (document.querySelector('input[name="analysis-mode"]:checked') || {}).value || 'hybrid';
}

async function runAnalysis() {
    const ready = students.filter(s => s.status === 'ready');
    if (ready.length < 2) { toast('Need at least 2 ready students!', 'warning'); return; }

    const btn = document.getElementById('analyze-btn');
    btn.disabled = true; btn.classList.add('analyzing');
    btn.querySelector('.btn-text').textContent = 'Generating AI Reports…';

    const prog = document.getElementById('progress-container');
    const fill = document.getElementById('progress-fill');
    const pct = document.getElementById('progress-text');
    const title = document.getElementById('progress-title');
    const sub = document.getElementById('progress-sub');
    const log = document.getElementById('progress-log');
    
    prog.style.display = 'block';
    fill.style.width = '0%'; pct.textContent = '0%'; log.innerHTML = '';
    title.textContent = `Deep AI Analyzing ${ready.length} students…`;

    playAnalyze();

    const pairs = [];
    const totalPairs = (ready.length * (ready.length - 1)) / 2;
    let done = 0;

    for (let i = 0; i < ready.length; i++) {
        for (let j = i + 1; j < ready.length; j++) {
            const sA = ready[i];
            const sB = ready[j];
            
            sub.textContent = `Analyzing Pair ${done + 1}/${totalPairs}: ${sA.name} ↔ ${sB.name}`;
            
            try {
                // RUN DEEP AI CHECK FOR EVERY PAIR
                const aiResult = await triggerAIAnalytic(sA, sB);
                
                pairs.push({ 
                    studentA: sA, 
                    studentB: sB, 
                    finalScore: aiResult.score,
                    textScore: aiResult.score,
                    visualScore: 0,
                    aiVerdict: aiResult.verdict,
                    aiReasoning: aiResult.reasoning,
                    key: `${sA.id}|${sB.id}`
                });

                const row = document.createElement('div');
                row.className = aiResult.score >= 40 ? 'log-error' : 'log-done';
                row.textContent = `AI Scan: ${sA.name} ↔ ${sB.name}: ${aiResult.score}%`;
                log.appendChild(row);
                log.scrollTop = log.scrollHeight;
            } catch (e) {
                console.error("AI Pair fail", e);
            }

            done++;
            const p = Math.round(done / totalPairs * 100);
            fill.style.width = `${p}%`;
            pct.textContent = `${p}%`;
        }
    }

    pairs.sort((a, b) => b.finalScore - a.finalScore);
    analysisResults = { pairs, students: ready, mode: 'AI-Deep' };

    updateAnalysisCounter();
    playDone();

    const flagged = pairs.filter(p => p.finalScore >= flagThreshold);
    if (flagged.length > 0) { playFlag(); launchConfetti(); }

    await new Promise(r => setTimeout(r, 700));
    prog.style.display = 'none';

    btn.disabled = false; btn.classList.remove('analyzing');
    btn.querySelector('.btn-text').textContent = 'Re-run Global AI Scan';

    renderResultsAI();
    toast(flagged.length > 0 ? `⚠️ AI flagged ${flagged.length} incidents!` : '✅ AI cleared all assignments.', flagged.length > 0 ? 'warning' : 'success');
}

async function triggerAIAnalytic(sA, sB) {
    const prompt = `Compare these two student assignments. Detect paraphrasing. Return EXACTLY a JSON object with: 
    { "score": number (0-100), "verdict": "string", "reasoning": "string" }
    
    A: "${sA.text.substring(0, 2000)}"
    B: "${sB.text.substring(0, 2000)}"`;

    const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "google/gemma-2-27b-it",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 512,
            temperature: 0.1
        })
    });
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    const jsonMatch = content.match(/\{.*\}/s);
    return JSON.parse(jsonMatch ? jsonMatch[0] : '{"score":0, "verdict":"Error", "reasoning":"Failed to parse AI"}');
}

function renderResultsAI() {
    const { pairs } = analysisResults;
    document.getElementById('results').style.display = 'block';
    
    const grid = document.getElementById('syndicates-grid');
    grid.innerHTML = '';
    
    renderSyndicates(analysisResults.students, pairs);
    renderRanking(pairs);
}

// ══════════════════════════════════════════════
// CONFETTI
// ══════════════════════════════════════════════
function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const pieces = Array.from({ length: 80 }, () => ({
        x: Math.random() * canvas.width, y: Math.random() * -200,
        w: 8 + Math.random() * 8, h: 4 + Math.random() * 4,
        r: Math.random() * Math.PI * 2, vx: (Math.random() - 0.5) * 4,
        vy: 3 + Math.random() * 4, vr: (Math.random() - 0.5) * 0.2,
        color: `hsl(${Math.random() * 360},80%,60%)`
    }));
    let frame = 0;
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
            ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
            p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.05;
        });
        frame++;
        if (frame < 120) requestAnimationFrame(draw);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    draw();
}

// ══════════════════════════════════════════════
// RESULTS RENDERING
// ══════════════════════════════════════════════
function getHeatColor(s) {
    if (s >= 80) return '#dc2626';
    if (s >= 60) return '#ef4444';
    if (s >= 40) return '#f97316';
    if (s >= 25) return '#fbbf24';
    if (s >= 10) return '#fef08a';
    return '#f0fdf4';
}

function renderResults() {
    const { matrix, pairs, students: ready, mode } = analysisResults;
    const resultsEl = document.getElementById('results');
    resultsEl.style.display = 'block';

    const flagged = pairs.filter(p => p.finalScore >= flagThreshold);
    const maxScore = pairs.length ? pairs[0].finalScore : 0;

    document.getElementById('sum-students').textContent = ready.length;
    document.getElementById('sum-pairs').textContent = pairs.length;
    document.getElementById('sum-flagged').textContent = flagged.length;
    document.getElementById('sum-max').textContent = `${maxScore}%`;

    const stamp = document.getElementById('result-stamp');
    if (flagged.length > 0) {
        stamp.textContent = '⚠️ FLAGGED'; stamp.style.color = '#dc2626'; stamp.style.borderColor = '#dc2626';
    } else {
        stamp.textContent = '✓ ALL CLEAR'; stamp.style.color = '#16a34a'; stamp.style.borderColor = '#16a34a';
    }

    const modeNames = { hybrid: '🔀 Hybrid (Text + Visual)', visual: '👁️ Visual Only', text: '📝 Text Only' };
    document.getElementById('analysis-mode-tag').textContent = `Analysis mode: ${modeNames[mode]} · Flag threshold: ≥${flagThreshold}%`;

    renderHeatmap(ready, matrix);
    renderSyndicates(ready, pairs);
    renderRanking(pairs);

    // Re-observe new cards
    document.querySelectorAll('.summary-card').forEach(el => {
        el.classList.add('animate-on-scroll');
        scrollObserver.observe(el);
    });

    setTimeout(() => resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
}

function renderHeatmap(ready, matrix) {
    const grid = document.getElementById('heatmap-grid');
    grid.innerHTML = '';
    const n = ready.length;
    grid.style.gridTemplateColumns = `90px repeat(${n}, 52px)`;

    // Corner
    const corner = document.createElement('div');
    corner.className = 'heatmap-cell row-header';
    grid.appendChild(corner);

    // Column headers
    ready.forEach(s => {
        const h = document.createElement('div');
        h.className = 'heatmap-cell header-cell';
        h.textContent = truncate(s.name, 10); h.title = s.name;
        grid.appendChild(h);
    });

    // Rows
    for (let i = 0; i < n; i++) {
        const rh = document.createElement('div');
        rh.className = 'heatmap-cell row-header';
        rh.textContent = truncate(ready[i].name, 12); rh.title = ready[i].name;
        grid.appendChild(rh);

        for (let j = 0; j < n; j++) {
            const cell = document.createElement('div');
            cell.className = 'heatmap-cell';

            if (i === j) {
                cell.classList.add('diagonal'); cell.textContent = '—';
            } else {
                const key = i < j ? `${ready[i].id}|${ready[j].id}` : `${ready[j].id}|${ready[i].id}`;
                const result = matrix[key];
                const score = result ? result.finalScore : 0;
                cell.textContent = `${score}%`;
                cell.style.background = getHeatColor(score);
                cell.style.color = score > 55 ? '#fff' : '#1a1a2e';

                const tt = document.createElement('div');
                tt.className = 'heatmap-tooltip';
                tt.textContent = `${ready[i].name} ↔ ${ready[j].name}: ${score}%`;
                cell.appendChild(tt);

                cell.addEventListener('click', () => {
                    const a = i < j ? ready[i] : ready[j];
                    const b = i < j ? ready[j] : ready[i];
                    showDetail(a, b, result || { finalScore: 0, textScore: 0, visualScore: 0, visualDetail: { pagePairs: [] } });
                });
            }
            grid.appendChild(cell);
        }
    }
}

function renderRanking(pairs) {
    const list = document.getElementById('ranking-list');
    list.innerHTML = '';
    if (!pairs.length) {
        list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:1rem;font-family:var(--font-ui)">No pairs found.</p>';
        return;
    }
    pairs.slice(0, 30).forEach((pair, i) => {
        const color = pair.finalScore >= 60 ? '#dc2626' : pair.finalScore >= flagThreshold ? '#f97316' : pair.finalScore >= 20 ? '#eab308' : '#22c55e';
        const verdict = pair.finalScore >= 60 ? '🚨' : pair.finalScore >= flagThreshold ? '⚠️' : pair.finalScore >= 20 ? '🤔' : '✅';
        const item = document.createElement('div');
        item.className = 'ranking-item';
        item.innerHTML = `
      <span class="ranking-rank">#${i + 1}</span>
      <span class="ranking-names"><strong>${escapeHtml(pair.studentA.name)}</strong> ↔ <strong>${escapeHtml(pair.studentB.name)}</strong></span>
      <span class="ranking-mode-tags">
        <span class="ranking-mode-tag">T:${pair.textScore}%</span>
        <span class="ranking-mode-tag">V:${pair.visualScore}%</span>
      </span>
      <div class="ranking-score-bar"><div class="ranking-score-fill" style="width:${pair.finalScore}%;background:${color}"></div></div>
      <span class="ranking-score-text" style="color:${color}">${pair.finalScore}%</span>
      <span class="ranking-verdict">${verdict}</span>`;
        item.addEventListener('click', () => showDetail(pair.studentA, pair.studentB, pair));
        list.appendChild(item);
    });
}

// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// DETAIL VIEW
// ══════════════════════════════════════════════
let currentDetail = null; // Store for evidence report

function showDetail(sA, sB, result) {
    const section = document.getElementById('detail-section');
    section.style.display = 'block';
    const { finalScore, textScore, visualScore, visualDetail } = result;
    currentDetail = { sA, sB, result }; // Save context

    const color = finalScore >= 60 ? '#dc2626' : finalScore >= 40 ? '#f97316' : finalScore >= 20 ? '#eab308' : '#22c55e';
    const vtext = finalScore >= 80 ? 'HIGHLY SUSPICIOUS — Likely Copied!' :
        finalScore >= 60 ? 'Major Overlap — Investigate!' :
            finalScore >= 40 ? 'Some Similarities Found' :
                finalScore >= 20 ? 'Minor Overlap — Probably Fine' : 'All Original ✅';
    const emoji = finalScore >= 60 ? '🚨' : finalScore >= 40 ? '⚠️' : '✅';

    document.getElementById('detail-title').textContent = `🔍 ${sA.name} vs ${sB.name}`;
    document.getElementById('detail-score-row').innerHTML = `
    <div class="detail-score-badge" style="color:${color};border-color:${color}">${finalScore}%</div>
    <div class="detail-verdict-text" style="color:${color}">${emoji} ${vtext}</div>`;

    document.getElementById('score-breakdown').innerHTML = `
    <div class="breakdown-item">
      <div class="breakdown-icon">📝</div>
      <div class="breakdown-value" style="color:${textScore >= 40 ? '#dc2626' : '#22c55e'}">${textScore}%</div>
      <div class="breakdown-label">Text Similarity</div>
    </div>
    <div class="breakdown-item">
      <div class="breakdown-icon">👁️</div>
      <div class="breakdown-value" style="color:${visualScore >= 40 ? '#dc2626' : '#22c55e'}">${visualScore}%</div>
      <div class="breakdown-label">Visual Similarity</div>
    </div>
    <div class="breakdown-item">
      <div class="breakdown-icon">🔀</div>
      <div class="breakdown-value" style="color:${color}">${finalScore}%</div>
      <div class="breakdown-label">Combined Score</div>
    </div>`;

    // Visual comparison
    const visSection = document.getElementById('visual-comparison');
    if (visualDetail && visualDetail.pagePairs.length > 0) {
        visSection.style.display = 'block';
        const pgGrid = document.getElementById('page-comparison-grid');
        pgGrid.innerHTML = '';
        const show = visualDetail.pagePairs.filter(p => p.similarity > 25).slice(0, 10);
        const list = show.length ? show : visualDetail.pagePairs.slice(0, 5);
        list.forEach(pp => {
            const cls = pp.similarity >= 70 ? 'high-match' : pp.similarity >= 40 ? 'medium-match' : '';
            const pcol = pp.similarity >= 70 ? '#dc2626' : pp.similarity >= 40 ? '#f97316' : '#22c55e';
            const el = document.createElement('div');
            el.className = `page-pair ${cls}`;
            el.innerHTML = `
        <div class="page-thumb-container">
          <div class="page-thumb"><img src="${pp.thumbA}" alt="P${pp.pageA}" loading="lazy"></div>
          <div class="page-thumb-label">${escapeHtml(sA.name)} — P${pp.pageA}</div>
        </div>
        <div class="page-pair-arrow">↔</div>
        <div class="page-thumb-container">
          <div class="page-thumb"><img src="${pp.thumbB}" alt="P${pp.pageB}" loading="lazy"></div>
          <div class="page-thumb-label">${escapeHtml(sB.name)} — P${pp.pageB}</div>
        </div>
        <div class="page-pair-score">
          <div class="page-pair-score-value" style="color:${pcol}">${pp.similarity}%</div>
          <div class="page-pair-score-label">visual match</div>
        </div>`;
            pgGrid.appendChild(el);
        });
    } else { visSection.style.display = 'none'; }

    // Text comparison
    const textSec = document.getElementById('text-comparison');
    const matchSec = document.getElementById('detail-matches');
    const hasTA = sA.text.trim().length >= 10, hasTB = sB.text.trim().length >= 10;

    if (hasTA && hasTB) {
        textSec.style.display = 'block';
        document.getElementById('detail-label-a').textContent = `📄 ${sA.name}`;
        document.getElementById('detail-label-b').textContent = `📄 ${sB.name}`;
        const sd = findSimilarSentences(sA.text, sB.text);
        document.getElementById('detail-content-a').innerHTML = highlightSentences(sd.sentencesA, sd.matchedA);
        document.getElementById('detail-content-b').innerHTML = highlightSentences(sd.sentencesB, sd.matchedB);

        const phrases = findMatchingPhrases(sA.text, sB.text, 4);
        const mList = document.getElementById('detail-matches-list');
        mList.innerHTML = '';
        if (phrases.length > 0) {
            matchSec.style.display = 'block';
            phrases.slice(0, 15).forEach((p, i) => {
                const item = document.createElement('div');
                item.className = 'match-item';
                item.innerHTML = `<span class="match-number">#${i + 1}</span><span class="match-text">"${escapeHtml(p)}"</span>`;
                mList.appendChild(item);
            });
        } else { matchSec.style.display = 'none'; }
    } else { textSec.style.display = 'none'; matchSec.style.display = 'none'; }

    setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);

    // AI Analysis Reset
    const aiRes = document.getElementById('ai-analysis-result');
    aiRes.style.display = 'none';
    aiRes.innerHTML = '';
    const aiBtn = document.getElementById('run-ai-btn');
    aiBtn.onclick = () => runDeepAIAnalysis(sA, sB);
    
    // Render Stylometry
    renderStylometry(sA, sB, result);
}

function closeDetail() {
    document.getElementById('detail-section').style.display = 'none';
}

function highlightSentences(sentences, matched) {
    return sentences.map((s, i) =>
        matched.has(i)
            ? `<span class="match">${escapeHtml(s)}.</span> `
            : `<span class="original">${escapeHtml(s)}.</span> `
    ).join('');
}

// ══════════════════════════════════════════════
// EXPORT REPORT
// ══════════════════════════════════════════════
function exportReport() {
    if (!analysisResults) { toast('Run analysis first!', 'warning'); return; }
    const { pairs, students: ready, mode } = analysisResults;
    const flagged = pairs.filter(p => p.finalScore >= flagThreshold);

    let csv = 'Student A,Student B,Final Score,Text Score,Visual Score,Verdict\n';
    pairs.forEach(p => {
        const v = p.finalScore >= 60 ? 'SUSPICIOUS' : p.finalScore >= flagThreshold ? 'FLAGGED' : p.finalScore >= 20 ? 'LOW' : 'SAFE';
        csv += `"${p.studentA.name}","${p.studentB.name}",${p.finalScore}%,${p.textScore}%,${p.visualScore}%,${v}\n`;
    });

    const now = new Date().toISOString().split('T')[0];
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `similarity-report-${now}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    toast('Report exported as CSV!', 'success');
}

// ══════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeDetail();
        closeShortcuts();
        return;
    }
    if (e.metaKey || e.ctrlKey) {
        if (e.key === 'Enter') { e.preventDefault(); runAnalysis(); }
        if (e.key === 'd') { e.preventDefault(); toggleTheme(); }
        if (e.key === 'e') { e.preventDefault(); exportReport(); }
    }
});

// ══════════════════════════════════════════════
// INIT — restore preferences
// ══════════════════════════════════════════════
(function init() {
    // Theme
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.getElementById('theme-toggle').textContent = '☀️';
    }
    // Sound
    const sv = localStorage.getItem('sound');
    if (sv === '0') { soundEnabled = false; document.getElementById('sound-toggle').textContent = '🔇'; }

    console.log('%c🔍 Assignment Similarity Checker v4 ready!', 'font-size:15px;color:#2563eb;font-weight:bold');
    console.log('%c✅ Bugs fixed · Dark mode · Export · Confetti · Sound', 'font-size:12px;color:#16a34a');
})();

// ══════════════════════════════════════════════
// DEEP AI ANALYSIS (NVIDIA GEMMA-3)
// ══════════════════════════════════════════════
const NVIDIA_API_KEY = "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";

async function runDeepAIAnalysis(sA, sB) {
    const aiBtn = document.getElementById('run-ai-btn');
    const aiRes = document.getElementById('ai-analysis-result');
    
    try {
        aiBtn.disabled = true;
        aiBtn.innerHTML = "🌀 Gemma-3 Thinking...";
        aiRes.style.display = 'block';
        aiRes.innerHTML = '<div class="ai-loading">Reading assignments and analyzing semantic logic...</div>';

        const prompt = `
            Act as an Academic Integrity Expert. Compare these two student assignments. 
            Detect if Student B has copied from Student A using paraphrasing, synonym replacement, or structural mimicry.
            
            ASSIGNMENT A (${sA.name}):
            "${sA.text.substring(0, 3000)}"
            
            ASSIGNMENT B (${sB.name}):
            "${sB.text.substring(0, 3000)}"
            
            Format your response as:
            - VERDICT: [Copying Found / No Copying / Suspicious]
            - SIMILARITY SCORE: [X%]
            - REASONING: [1-2 sentences]
            - KEY MATCHES: [List 2-3 examples of paraphrasing or shared unique errors]
        `;

        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "google/gemma-2-27b-it",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 512,
                temperature: 0.2,
                top_p: 0.7
            })
        });

        const data = await response.json();
        if (data.choices && data.choices[0]) {
            const resultText = data.choices[0].message.content;
            aiRes.innerHTML = `
                <div class="ai-badge">🤖 AI Analysis Report</div>
                <div class="ai-content" style="white-space: pre-wrap; font-size: 0.9rem; line-height: 1.5; color: #333;">${escapeHtml(resultText)}</div>
            `;
        } else {
            throw new Error("Invalid API response");
        }
    } catch (err) {
        console.error(err);
        aiRes.innerHTML = '<div class="ai-error">❌ AI analysis failed. This could be due to API limits or network issues.</div>';
    } finally {
        aiBtn.disabled = false;
        aiBtn.innerHTML = "🤖 Re-run Deep AI Check";
    }
}

// ══════════════════════════════════════════════
// FEATURE: EVIDENCE REPORT PDF (HTML MODAL)
// ══════════════════════════════════════════════
function downloadEvidenceReport() {
    if (!currentDetail) return;
    const { sA, sB, result } = currentDetail;
    const { finalScore, textScore, visualScore } = result;

    const verdict = finalScore >= flagThreshold ? "FLAGGED FOR REVIEW: Highly Suspicious" : "SAFE: Minor or No Similarities";
    const dateStr = new Date().toLocaleString();

    // Create a print-friendly modal
    const overlay = document.createElement('div');
    overlay.className = 'evidence-overlay';
    
    const content = `
      <div class="evidence-modal">
        <button class="evidence-close" onclick="this.parentElement.parentElement.remove()">✕</button>
        <div class="evidence-header">
            <h2>Academic Integrity Report</h2>
            <p>Generated on: ${dateStr}</p>
        </div>
        
        <div class="evidence-section">
            <h3>Student Profiles</h3>
            <p><strong>Student A:</strong> ${escapeHtml(sA.name)}</p>
            <p><strong>Student B:</strong> ${escapeHtml(sB.name)}</p>
            <p><strong>Verdict:</strong> <strong>${verdict}</strong></p>
        </div>

        <div class="evidence-section">
            <h3>Similarity Matrix</h3>
            <div class="evidence-score-box">
                <div class="evidence-score-item">
                    <div class="value">${finalScore}%</div>
                    <div class="label">Combined Score</div>
                </div>
                <div class="evidence-score-item">
                    <div class="value">${textScore}%</div>
                    <div class="label">Text Overlap</div>
                </div>
                <div class="evidence-score-item">
                    <div class="value">${visualScore}%</div>
                    <div class="label">Visual Match</div>
                </div>
            </div>
        </div>

        <div class="evidence-section">
            <h3>Text Evidence (Student B Excerpt)</h3>
            <div class="evidence-text-box">${escapeHtml(sB.text.substring(0, 800))}...</div>
        </div>
        
        <p style="font-size: 0.8rem; color: #888; text-align: center; margin-top: 2rem;">Generated by Assignment Similarity Checker v4</p>
        
        <button class="evidence-print-btn" onclick="window.print()">🖨️ Print to PDF</button>
      </div>
    `;
    
    overlay.innerHTML = content;
    document.body.appendChild(overlay);
}

// ══════════════════════════════════════════════
// FEATURE: STYLOMETRY ANALYSIS
// ══════════════════════════════════════════════
function calculateStylometry(text) {
    if (!text.trim()) return { avgWordLength: 0, vocabRichness: 0, avgSentenceLen: 0 };
    const words = normalize(text).split(/\s+/).filter(Boolean);
    const sentences = getSentences(text);
    const uniqueWords = new Set(words);
    
    return {
        avgWordLength: words.length ? words.reduce((sum, w) => sum + w.length, 0) / words.length : 0,
        vocabRichness: words.length ? (uniqueWords.size / words.length) * 100 : 0,
        avgSentenceLen: sentences.length ? words.length / sentences.length : 0
    };
}

function renderStylometry(sA, sB, result) {
    const grid = document.getElementById('stylometry-grid');
    const verdict = document.getElementById('stylometry-verdict');
    
    if (sA.text.trim().length < 50 || sB.text.trim().length < 50) {
        grid.innerHTML = '<p class="stylometry-hint">Not enough text to perform stylometry analysis.</p>';
        verdict.style.display = 'none';
        return;
    }
    
    verdict.style.display = 'block';
    const stA = calculateStylometry(sA.text);
    const stB = calculateStylometry(sB.text);
    
    // Calculate differences (lower is more similar)
    const diffWL = Math.abs(stA.avgWordLength - stB.avgWordLength);
    const diffVR = Math.abs(stA.vocabRichness - stB.vocabRichness);
    const diffSL = Math.abs(stA.avgSentenceLen - stB.avgSentenceLen);
    
    // Determine style match (0-100%)
    // If differences are small, style match is HIGH (suspicious if they also share content)
    const styleMatchScore = Math.max(0, 100 - (diffWL * 20 + diffVR * 1.5 + diffSL * 3));
    
    grid.innerHTML = `
        <div class="stylo-card">
            <div class="stylo-card-title">Vocabulary Diversity</div>
            <div class="stylo-bars">
                <div class="stylo-bar-group">
                    <div class="stylo-bar" style="height: ${Math.min(100, stA.vocabRichness)}%; background: #3b82f6;"></div>
                    <div class="stylo-bar-label">${sA.name}</div>
                </div>
                <div class="stylo-bar-group">
                    <div class="stylo-bar" style="height: ${Math.min(100, stB.vocabRichness)}%; background: #8b5cf6;"></div>
                    <div class="stylo-bar-label">${sB.name}</div>
                </div>
            </div>
        </div>
        <div class="stylo-card">
            <div class="stylo-card-title">Avg. Sentence Length</div>
            <div class="stylo-bars">
                <div class="stylo-bar-group">
                    <div class="stylo-bar" style="height: ${Math.min(100, stA.avgSentenceLen * 3)}%; background: #10b981;"></div>
                    <div class="stylo-bar-label">${sA.name}</div>
                </div>
                <div class="stylo-bar-group">
                    <div class="stylo-bar" style="height: ${Math.min(100, stB.avgSentenceLen * 3)}%; background: #f59e0b;"></div>
                    <div class="stylo-bar-label">${sB.name}</div>
                </div>
            </div>
        </div>
    `;

    if (styleMatchScore > 85 && result.finalScore > 30) {
        verdict.className = 'stylometry-verdict suspicious';
        verdict.innerHTML = `<strong>⚠️ Suspiciously Similar Writing Style (${Math.round(styleMatchScore)}% Match).</strong> Both students use almost identical vocabulary richness and sentence structures. Combined with a high text overlap, this strongly suggests one student rewrote the other's work (paraphrasing without changing the core style).`;
    } else {
        verdict.className = 'stylometry-verdict safe';
        verdict.innerHTML = `<strong>✅ Distinct Writing Styles (${Math.round(styleMatchScore)}% Match).</strong> The statistical writing fingerprints of these two documents are sufficiently different.`;
    }
}

// ══════════════════════════════════════════════
// FEATURE: CHEATING SYNDICATES (Auto-Clustering)
// ══════════════════════════════════════════════
function renderSyndicates(students, pairs) {
    const section = document.getElementById('syndicates-section');
    const grid = document.getElementById('syndicates-grid');
    if (!section || !grid) return;

    section.style.display = 'block';
    
    // Connected Components Algorithm to find cheating rings
    const threshold = 30; // Minimum similarity to consider them connected
    
    // Create an adjacency list
    const adj = {};
    students.forEach(s => adj[s.id] = []);
    
    pairs.forEach(p => {
        if (p.finalScore >= threshold) {
            adj[p.studentA.id].push({ to: p.studentB.id, score: p.finalScore });
            adj[p.studentB.id].push({ to: p.studentA.id, score: p.finalScore });
        }
    });

    const visited = new Set();
    const syndicates = [];

    students.forEach(s => {
        if (!visited.has(s.id)) {
            const cluster = [];
            let maxScore = 0;
            const queue = [s.id];
            visited.add(s.id);
            
            while (queue.length > 0) {
                const current = queue.shift();
                cluster.push(current);
                
                adj[current].forEach(edge => {
                    if (edge.score > maxScore) maxScore = edge.score;
                    if (!visited.has(edge.to)) {
                        visited.add(edge.to);
                        queue.push(edge.to);
                    }
                });
            }
            
            // Only consider clusters of 2 or more as a "Syndicate"
            if (cluster.length > 1) {
                syndicates.push({ members: cluster, peakScore: maxScore });
            }
        }
    });

    // Sort syndicates by peak score
    syndicates.sort((a, b) => b.peakScore - a.peakScore);

    grid.innerHTML = '';
    
    if (syndicates.length === 0) {
        grid.innerHTML = '<div class="no-syndicates-msg">🎉 No organized cheating syndicates detected (no high-similarity groups).</div>';
        return;
    }

    syndicates.forEach((syn, index) => {
        // Find the worst pair in this syndicate
        let worstPair = null;
        let pScore = -1;
        pairs.forEach(p => {
            if (syn.members.includes(p.studentA.id) && syn.members.includes(p.studentB.id)) {
                if (p.finalScore > pScore) {
                    pScore = p.finalScore;
                    worstPair = p;
                }
            }
        });

        // Determine risk level
        const highRisk = syn.peakScore >= 60;
        const color = highRisk ? '#dc2626' : (syn.peakScore >= 40 ? '#f97316' : '#eab308');
        const badgeLabel = highRisk ? 'High Risk' : (syn.peakScore >= 40 ? 'Medium Risk' : 'Low Risk');
        
        const card = document.createElement('div');
        card.className = 'syndicate-card';
        card.style.borderTopColor = color;
        card.style.cursor = 'pointer';
        card.title = "Click to run Deep AI Analysis on the most suspicious pair in this ring";
        
        let html = `
            <div class="syndicate-header">
                <div class="syndicate-title">Ring #${index + 1}</div>
                <div class="syndicate-badge" style="background: ${color}20; color: ${color}">${badgeLabel}</div>
            </div>
            <div style="font-size: 0.85rem; color: #64748b; margin-bottom: 12px; font-weight: 500;">
                Peak Overlap: <strong style="color: ${color}">${syn.peakScore}%</strong>
                <span style="font-size: 0.75rem; margin-left: 5px;">(Click to Inspect)</span>
            </div>
            <div class="syndicate-members">
        `;
        
        syn.members.forEach(id => {
            const stu = students.find(s => s.id === id);
            if (stu) {
                html += `
                    <div class="syndicate-member">
                        <span class="member-icon">👤</span>
                        <span class="member-name">${escapeHtml(stu.name)}</span>
                    </div>
                `;
            }
        });
        
        html += `</div>`;
        card.innerHTML = html;
        
        // Attach click event to open Detail View & Deep AI Check
        if (worstPair) {
            card.onclick = () => showDetail(worstPair.studentA, worstPair.studentB, worstPair);
        }
        
        grid.appendChild(card);
    });
}

// ══════════════════════════════════════════════
// FEATURE: CLASS-WIDE AI REPORT
// ══════════════════════════════════════════════
async function generateClassWideAIReport() {
    const aiBtn = document.getElementById('run-class-ai-btn');
    const aiRes = document.getElementById('class-wide-ai-result');
    
    if (!analysisResults || analysisResults.pairs.length === 0) {
        toast('Run analysis first to generate a report.', 'warning');
        return;
    }

    try {
        aiBtn.disabled = true;
        aiBtn.innerHTML = "✨ Generating Executive Summary...";
        aiRes.style.display = 'block';
        aiRes.innerHTML = '<div class="ai-loading">Aggregating class data and analyzing cheating patterns...</div>';

        // Prepare the summary data for the prompt
        const flaggedPairs = analysisResults.pairs.filter(p => p.finalScore >= flagThreshold);
        let summaryContext = `Total Students Analyzed: ${analysisResults.students.length}\n`;
        summaryContext += `Total Suspicious Pairs Found: ${flaggedPairs.length}\n\n`;
        
        summaryContext += `Suspicious Details:\n`;
        flaggedPairs.slice(0, 50).forEach(p => { // Send top 50 flagged pairs
            summaryContext += `- ${p.studentA.name} and ${p.studentB.name}: ${p.finalScore}% similarity (Text: ${p.textScore}%, Visual: ${p.visualScore}%)\n`;
        });

        const prompt = `
            Act as an Academic Integrity Officer reviewing a class's assignment similarity report.
            Based on the following aggregated data from the similarity checker algorithm, provide an executive summary.
            Identify if there are clusters (cheating rings) or if the incidents seem isolated.
            Provide recommendations on how to handle these specific cases.

            CLASS DATA SUMMARY:
            ${summaryContext}

            Format your response clearly using markdown for readability. Include sections for:
            - Executive Overview
            - Pattern Analysis
            - Recommended Actions
        `;

        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "google/gemma-2-27b-it",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 1024, // Allow for a longer report
                temperature: 0.2,
                top_p: 0.7
            })
        });

        const data = await response.json();
        if (data.choices && data.choices[0]) {
            const resultText = data.choices[0].message.content;
            aiRes.innerHTML = `
                <div class="ai-badge">🤖 Class-Wide Executive Report</div>
                <div class="ai-content" style="white-space: pre-wrap; font-size: 0.95rem; line-height: 1.6; color: var(--text-primary); margin-top: 10px;">${escapeHtml(resultText)}</div>
            `;
        } else {
            throw new Error("Invalid API response");
        }
    } catch (err) {
        console.error(err);
        aiRes.innerHTML = '<div class="ai-error">❌ Report generation failed. This could be due to API limits or network issues.</div>';
    } finally {
        aiBtn.disabled = false;
        aiBtn.innerHTML = "✨ Re-generate Class Report";
    }
}

