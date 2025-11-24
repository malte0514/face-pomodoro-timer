import {
    FaceDetector,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js";

// --- DOM Elements ---
const video = document.getElementById("webcam");
const timeMain = document.getElementById("time-main");
const timeSub = document.getElementById("time-sub");
const dateDisplay = document.getElementById("date-display");
const timerDisplay = document.getElementById("timer-display");
const statusDot = document.getElementById("status-dot");
const breakBtn = document.getElementById("break-btn");
const marqueeContainer = document.getElementById("marquee-container");
const marqueeText = document.getElementById("marquee-text");

// Settings DOM
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const resetSettingsBtn = document.getElementById('reset-settings-btn');
const toneSelect = document.getElementById('tone-select');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const appVersion = document.getElementById('app-version');
const fullscreenBtn = document.getElementById('fullscreen-btn');

// New Settings DOM
const sensitivitySlider = document.getElementById('sensitivity-slider');
const sensitivityValue = document.getElementById('sensitivity-value');
const settingsStatusDot = document.getElementById('settings-status-dot');
const workDurationInput = document.getElementById('work-duration-input');
const breakDurationInput = document.getElementById('break-duration-input');
const fontSelect = document.getElementById('font-select');
const clockSizeSlider = document.getElementById('clock-size-slider');
const clockSpacingSlider = document.getElementById('clock-spacing-slider');
const secondsSizeSlider = document.getElementById('seconds-size-slider');
const secondsSpacingSlider = document.getElementById('seconds-spacing-slider');
const dateSizeSlider = document.getElementById('date-size-slider');
const dateSpacingSlider = document.getElementById('date-spacing-slider');
const timerSizeSlider = document.getElementById('timer-size-slider');
const timerSpacingSlider = document.getElementById('timer-spacing-slider');
const newTaskInput = document.getElementById('new-task-input');
const addTaskBtn = document.getElementById('add-task-btn');
const taskList = document.getElementById('task-list');

let faceDetector;
let lastVideoTime = -1;
let wakeLock = null;

const APP_VERSION = 'ver.202511241450';

// --- State Management ---
const STATE = {
    WORK: 'WORK',
    ALARM: 'ALARM',
    BREAK: 'BREAK'
};
let currentState = STATE.WORK;

// Timer State
let workDuration = 25;
let breakDuration = 5;
let timerMinutes = 25;
let timerSeconds = 0;
let isUserPresent = false;
let awayTime = 0; // Seconds user has been away
const AWAY_RESET_THRESHOLD = 180; // 3 minutes

// Settings State
let currentTone = 'sine';
let currentVolume = 0.3;
let sensitivity = 0.5;
let breakTasks = ["Deep Breath", "Stretch", "Drink Water"];

let typography = {
    fontFamily: "'Share Tech Mono', monospace",
    clockSize: 30,
    clockSpacing: 0,
    secondsSize: 8,
    secondsSpacing: 0,
    dateSize: 5,
    dateSpacing: 0,
    timerSize: 5,
    timerSpacing: 0
};

// --- Audio System (Web Audio API) ---
let audioCtx;
let alarmOscillator = null;
let alarmGain = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playAlarmLoop() {
    initAudio();
    stopAlarm(); // Ensure clean slate

    alarmOscillator = audioCtx.createOscillator();
    alarmGain = audioCtx.createGain();

    alarmOscillator.type = currentTone;
    alarmOscillator.frequency.value = 1000; // High pitch

    alarmOscillator.start();
    alarmOscillator.connect(alarmGain);
    alarmGain.connect(audioCtx.destination);

    // Schedule beeps for a long time
    const now = audioCtx.currentTime;
    const beepLen = 0.1;
    const gapLen = 0.1;

    // Schedule 10 minutes of beeping
    for (let i = 0; i < 3000; i++) {
        const start = now + i * (beepLen + gapLen);
        alarmGain.gain.setValueAtTime(currentVolume, start);
        alarmGain.gain.setValueAtTime(0, start + beepLen);
    }
    // Initial silence
    alarmGain.gain.setValueAtTime(0, now);
}

function stopAlarm() {
    if (alarmOscillator) {
        try {
            alarmOscillator.stop();
            alarmOscillator.disconnect();
        } catch (e) { }
        alarmOscillator = null;
    }
    if (alarmGain) {
        alarmGain.disconnect();
        alarmGain = null;
    }
}

function playBreakEndSound() {
    initAudio();
    stopAlarm();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = currentTone;
    osc.frequency.value = 1000;

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    // Pi-Pi! (Two beeps)
    gain.gain.setValueAtTime(0, now);

    // Beep 1
    gain.gain.setValueAtTime(currentVolume, now + 0.1);
    gain.gain.setValueAtTime(0, now + 0.3);

    // Beep 2
    gain.gain.setValueAtTime(currentVolume, now + 0.4);
    gain.gain.setValueAtTime(0, now + 0.6);

    osc.start();
    osc.stop(now + 1.0);
}

function playPreviewSound() {
    initAudio();
    stopAlarm(); // Stop any running alarm

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = currentTone;
    osc.frequency.value = 880; // A5

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(currentVolume, now + 0.05);
    gain.gain.setValueAtTime(0, now + 0.55); // 0.5s duration

    osc.start();
    osc.stop(now + 0.6);
}

// --- Wake Lock API ---
async function requestWakeLock() {
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake Lock is active');
        wakeLock.addEventListener('release', () => {
            console.log('Wake Lock was released');
        });
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
}

document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// --- Initialization ---
async function initialize() {
    loadSettings();
    updateTypography();
    renderTaskList();

    // Initialize timer with loaded duration
    resetWorkTimer();
    updateTimerDisplay();

    await initializeFaceDetector();
    startCamera();
    startClock();
    startTimerLoop();
    requestWakeLock();

    // Break button listener
    breakBtn.addEventListener('click', () => {
        if (currentState === STATE.ALARM) {
            startBreak();
        }
    });

    initSettingsEvents();
}

// --- Settings Logic ---
function loadSettings() {
    const savedTone = localStorage.getItem('pomodoro_tone');
    const savedVolume = localStorage.getItem('pomodoro_volume');
    const savedSensitivity = localStorage.getItem('pomodoro_sensitivity');
    const savedTypography = localStorage.getItem('pomodoro_typography');
    const savedTasks = localStorage.getItem('pomodoro_tasks');
    const savedWorkDuration = localStorage.getItem('pomodoro_work_duration');
    const savedBreakDuration = localStorage.getItem('pomodoro_break_duration');

    if (savedTone) currentTone = savedTone;
    if (savedVolume) currentVolume = parseFloat(savedVolume);
    if (savedSensitivity) sensitivity = parseFloat(savedSensitivity);
    if (savedTypography) typography = JSON.parse(savedTypography);
    if (savedTasks) breakTasks = JSON.parse(savedTasks);
    if (savedWorkDuration) workDuration = parseInt(savedWorkDuration);
    if (savedBreakDuration) breakDuration = parseInt(savedBreakDuration);

    // Update UI to match loaded settings
    toneSelect.value = currentTone;
    volumeSlider.value = currentVolume * 100;
    volumeValue.textContent = Math.round(currentVolume * 100);
    sensitivitySlider.value = sensitivity;
    sensitivityValue.textContent = sensitivity;
    workDurationInput.value = workDuration;
    breakDurationInput.value = breakDuration;

    fontSelect.value = typography.fontFamily;
    clockSizeSlider.value = typography.clockSize;
    clockSpacingSlider.value = typography.clockSpacing;
    secondsSizeSlider.value = typography.secondsSize;
    secondsSpacingSlider.value = typography.secondsSpacing;
    dateSizeSlider.value = typography.dateSize;
    dateSpacingSlider.value = typography.dateSpacing;
    timerSizeSlider.value = typography.timerSize;
    timerSpacingSlider.value = typography.timerSpacing;

    appVersion.textContent = APP_VERSION;
}

function saveSettings() {
    localStorage.setItem('pomodoro_tone', currentTone);
    localStorage.setItem('pomodoro_volume', currentVolume);
    localStorage.setItem('pomodoro_sensitivity', sensitivity);
    localStorage.setItem('pomodoro_typography', JSON.stringify(typography));
    localStorage.setItem('pomodoro_tasks', JSON.stringify(breakTasks));
    localStorage.setItem('pomodoro_work_duration', workDuration);
    localStorage.setItem('pomodoro_break_duration', breakDuration);
}

function updateTypography() {
    const root = document.documentElement;

    // Font Family
    document.body.style.fontFamily = typography.fontFamily;
    root.style.setProperty('--font-mono', typography.fontFamily);

    // Sizes & Spacing
    root.style.setProperty('--clock-size', `${typography.clockSize}vw`);
    root.style.setProperty('--clock-spacing', `${typography.clockSpacing}px`);

    root.style.setProperty('--seconds-size', `${typography.secondsSize}vw`);
    root.style.setProperty('--seconds-spacing', `${typography.secondsSpacing}px`);

    root.style.setProperty('--date-size', `${typography.dateSize}vw`);
    root.style.setProperty('--date-spacing', `${typography.dateSpacing}px`);

    root.style.setProperty('--timer-size', `${typography.timerSize}vw`);
    root.style.setProperty('--timer-spacing', `${typography.timerSpacing}px`);
}

function renderTaskList() {
    taskList.innerHTML = '';
    breakTasks.forEach((task, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${task}</span>
            <button class="delete-task-btn" data-index="${index}">×</button>
        `;
        taskList.appendChild(li);
    });

    // Add delete listeners
    document.querySelectorAll('.delete-task-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.getAttribute('data-index'));
            breakTasks.splice(index, 1);
            saveSettings();
            renderTaskList();
        });
    });
}

function initSettingsEvents() {
    // Modal Toggle
    settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) settingsModal.classList.add('hidden');
    });

    // Reset Settings
    resetSettingsBtn.addEventListener('click', () => {
        if (confirm('Reset all settings to defaults?')) {
            localStorage.clear();
            location.reload();
        }
    });

    // Fullscreen
    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    });

    document.addEventListener('fullscreenchange', () => {
        const icon = fullscreenBtn.querySelector('svg');
        if (document.fullscreenElement) {
            // Minimize icon
            icon.innerHTML = '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>';
        } else {
            // Maximize icon
            icon.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>';
        }
    });

    // Audio
    toneSelect.addEventListener('change', (e) => {
        currentTone = e.target.value;
        saveSettings();
        playPreviewSound();
    });
    volumeSlider.addEventListener('input', (e) => {
        volumeValue.textContent = e.target.value;
        currentVolume = e.target.value / 100;
    });
    volumeSlider.addEventListener('change', (e) => {
        currentVolume = e.target.value / 100;
        saveSettings();
        playPreviewSound();
    });

    // Face Recognition
    sensitivitySlider.addEventListener('input', (e) => {
        sensitivityValue.textContent = e.target.value;
    });
    sensitivitySlider.addEventListener('change', async (e) => {
        sensitivity = parseFloat(e.target.value);
        saveSettings();
        // Re-initialize detector
        faceDetector = null; // Clear existing
        await initializeFaceDetector();
    });

    // Timer Durations
    // Timer Durations
    workDurationInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value);
        if (val < 1) val = 1;
        if (val > 120) val = 120;

        workDuration = val;
        e.target.value = val;
        saveSettings();

        // Always reset if in WORK mode
        if (currentState === STATE.WORK) {
            resetWorkTimer();
            updateTimerDisplay();
        }
    });

    breakDurationInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value);
        if (val < 1) val = 1;
        if (val > 120) val = 120;
        breakDuration = val;
        e.target.value = val;
        saveSettings();

        // Always reset if in BREAK mode
        if (currentState === STATE.BREAK) {
            timerMinutes = breakDuration;
            timerSeconds = 0;
            updateTimerDisplay();
        }
    });

    // Typography
    fontSelect.addEventListener('change', (e) => {
        typography.fontFamily = e.target.value;
        updateTypography();
        saveSettings();
    });

    const bindSlider = (slider, key, unit) => {
        slider.addEventListener('input', (e) => {
            typography[key] = parseInt(e.target.value);
            updateTypography();
        });
        slider.addEventListener('change', () => saveSettings());
    };

    bindSlider(clockSizeSlider, 'clockSize');
    bindSlider(clockSpacingSlider, 'clockSpacing');
    bindSlider(secondsSizeSlider, 'secondsSize');
    bindSlider(secondsSpacingSlider, 'secondsSpacing');
    bindSlider(dateSizeSlider, 'dateSize');
    bindSlider(dateSpacingSlider, 'dateSpacing');
    bindSlider(timerSizeSlider, 'timerSize');
    bindSlider(timerSpacingSlider, 'timerSpacing');

    // Break Tasks
    addTaskBtn.addEventListener('click', () => {
        const task = newTaskInput.value.trim();
        if (task) {
            breakTasks.push(task);
            newTaskInput.value = '';
            saveSettings();
            renderTaskList();
        }
    });
}

// --- Face Detection ---
async function initializeFaceDetector() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        minDetectionConfidence: sensitivity
    });
}

async function startCamera() {
    try {
        const constraints = {
            video: {
                facingMode: "user",
                width: 640,
                height: 480
            }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
    } catch (err) {
        console.error("Error accessing webcam:", err);
        alert("Camera access denied or not found. Please allow camera access.");
    }
}

async function predictWebcam() {
    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const startTimeMs = performance.now();

        if (faceDetector) {
            const detections = faceDetector.detectForVideo(video, startTimeMs).detections;
            handleDetections(detections);
        }
    }
    requestAnimationFrame(predictWebcam);
}

function handleDetections(detections) {
    if (detections.length > 0) {
        isUserPresent = true;
        awayTime = 0;
        statusDot.classList.add('active');
        if (settingsStatusDot) settingsStatusDot.classList.add('active');
        if (currentState === STATE.WORK) {
            timerDisplay.classList.remove('dimmed');
        }
    } else {
        isUserPresent = false;
        statusDot.classList.remove('active');
        if (settingsStatusDot) settingsStatusDot.classList.remove('active');
        if (currentState === STATE.WORK) {
            timerDisplay.classList.add('dimmed');
        }
    }
}

// --- Clock & Date ---
function startClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    timeMain.textContent = `${hours}:${minutes}`;
    const seconds = String(now.getSeconds()).padStart(2, '0');
    timeSub.textContent = seconds;
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    dateDisplay.textContent = `${year}/${month}/${day}`;
}

// --- Pomodoro Logic ---
function startTimerLoop() {
    setInterval(() => {
        if (currentState === STATE.WORK) {
            handleWorkState();
        } else if (currentState === STATE.BREAK) {
            handleBreakState();
        }
        updateTimerDisplay();
    }, 1000);
}

function handleWorkState() {
    if (isUserPresent) {
        decrementTimer();
        if (timerMinutes === 0 && timerSeconds === 0) {
            triggerAlarm();
        }
    } else {
        awayTime++;
        if (awayTime >= AWAY_RESET_THRESHOLD) {
            resetWorkTimer();
            awayTime = 0;
        }
    }
}

function handleBreakState() {
    decrementTimer();
    if (timerMinutes === 0 && timerSeconds === 0) {
        endBreak();
    }
}

function decrementTimer() {
    if (timerSeconds > 0) {
        timerSeconds--;
    } else if (timerMinutes > 0) {
        timerMinutes--;
        timerSeconds = 59;
    }
}

function resetWorkTimer() {
    timerMinutes = workDuration;
    timerSeconds = 0;
}

function updateTimerDisplay() {
    const mins = String(timerMinutes).padStart(2, '0');
    const secs = String(timerSeconds).padStart(2, '0');
    timerDisplay.textContent = `${mins}:${secs}`;
}

function triggerAlarm() {
    currentState = STATE.ALARM;
    playAlarmLoop();
    breakBtn.classList.remove('hidden');
    timerDisplay.classList.remove('dimmed');
}

function startBreak() {
    stopAlarm();
    currentState = STATE.BREAK;
    breakBtn.classList.add('hidden');

    // Set break time from settings
    timerMinutes = breakDuration;
    timerSeconds = 0;

    timerDisplay.classList.add('break-mode');
    timerDisplay.classList.remove('dimmed');

    // Show Marquee with random task
    if (breakTasks.length > 0) {
        const randomTask = breakTasks[Math.floor(Math.random() * breakTasks.length)];
        marqueeText.textContent = randomTask;
    } else {
        marqueeText.textContent = "RELAX";
    }
    marqueeContainer.classList.remove('hidden');
}

function endBreak() {
    playBreakEndSound();

    currentState = STATE.WORK;
    resetWorkTimer();

    timerDisplay.classList.remove('break-mode');
    marqueeContainer.classList.add('hidden');
}

initialize();
