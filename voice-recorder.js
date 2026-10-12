// ORBIT CHAT ACTIONS - VOICE RECORDER & AUDIO STUDIO (js/actions/voice-recorder.js)
// Audio recording studio, real-time waveform visualizer, hold-to-record gestures, voice playback speed.
// VOICE NOTES STUDIO & AUDIO WAVEFORM
// ══════════════════════════════════════════════════════════════════════════
let voiceAudioContext = null;
let voiceAnalyser = null;
let voiceCanvasAnimation = null;
let voiceHoldStartX = 0;
let voiceHoldStartY = 0;
let isVoiceHolding = false;
let isVoiceLocked = false;
let voiceHoldStartTime = 0;
let voiceRecordingRoom = null;
let voiceRecordingUser = null;

async function startVoiceRecording() {
    if (!currentRoom || !currentUser) {
        showToast('Open a chat to record voice note', 'error');
        return;
    }
    voiceRecordingRoom = currentRoom;
    voiceRecordingUser = currentUser.id;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (currentRoom !== voiceRecordingRoom || currentUser?.id !== voiceRecordingUser) {
            stream.getTracks().forEach(track => track.stop());
            showToast('Chat changed before recording started. Reopen the original chat and try again.', 'error');
            return;
        }
        voiceAudioChunks = [];
        voiceMediaRecorder = new MediaRecorder(stream);

        voiceMediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) voiceAudioChunks.push(e.data);
        };

        voiceRecordingStartTime = Date.now();

        // UI updates: show panel, hide standard row
        const panel = document.getElementById('voice-rec-panel') || document.getElementById('voice-recording-studio');
        const inputRow = document.getElementById('chat-standard-input-row');
        const timer = document.getElementById('voice-rec-timer') || document.getElementById('voice-recording-timer');
        if (panel) panel.classList.remove('hide');
        if (inputRow) inputRow.classList.add('hide');

        if (timer) timer.innerText = '00:00';

        voiceTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - voiceRecordingStartTime) / 1000);
            const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const s = String(elapsed % 60).padStart(2, '0');
            if (timer) timer.innerText = `${m}:${s}`;
        }, 500);

        // Web Audio Analyser for live waveform
        try {
            voiceAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = voiceAudioContext.createMediaStreamSource(stream);
            voiceAnalyser = voiceAudioContext.createAnalyser();
            voiceAnalyser.fftSize = 64;
            source.connect(voiceAnalyser);
            startVoiceCanvasWaveform();
        } catch(audioCtxErr) {
            console.warn('AudioContext visualization note:', audioCtxErr);
        }

        voiceMediaRecorder.start();
    } catch(err) {
        console.error('Microphone access error:', err);
        showToast('Could not access microphone. Check browser permissions.', 'error');
    }
}

function startVoiceCanvasWaveform() {
    const canvas = document.getElementById('voice-rec-canvas');
    if (!canvas || !voiceAnalyser) return;
    const ctx = canvas.getContext('2d');
    const bufferLength = voiceAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function drawWave() {
        voiceCanvasAnimation = requestAnimationFrame(drawWave);
        voiceAnalyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / bufferLength) * 1.8;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height * 0.9;
            ctx.fillStyle = '#FFD700';
            ctx.fillRect(x, (canvas.height - barHeight) / 2, barWidth - 1, Math.max(barHeight, 2));
            x += barWidth;
        }
    }
    drawWave();
}

function stopVoiceCanvasWaveform() {
    if (voiceCanvasAnimation) {
        cancelAnimationFrame(voiceCanvasAnimation);
        voiceCanvasAnimation = null;
    }
    if (voiceAudioContext && voiceAudioContext.state !== 'closed') {
        try { voiceAudioContext.close(); } catch(e) {}
        voiceAudioContext = null;
    }
}

function cancelVoiceRecording() {
    if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
        voiceMediaRecorder.onstop = null;
        voiceMediaRecorder.stop();
        try { voiceMediaRecorder.stream.getTracks().forEach(t => t.stop()); } catch(e) {}
    }
    clearInterval(voiceTimerInterval);
    stopVoiceCanvasWaveform();

    const panel = document.getElementById('voice-rec-panel') || document.getElementById('voice-recording-studio');
    const inputRow = document.getElementById('chat-standard-input-row');
    if (panel) panel.classList.add('hide');
    if (inputRow) inputRow.classList.remove('hide');
}

async function stopAndSendVoiceRecording() {
    if (!voiceMediaRecorder || voiceMediaRecorder.state === 'inactive') return;

    clearInterval(voiceTimerInterval);
    stopVoiceCanvasWaveform();

    const panel = document.getElementById('voice-rec-panel') || document.getElementById('voice-recording-studio');
    const inputRow = document.getElementById('chat-standard-input-row');
    if (panel) panel.classList.add('hide');
    if (inputRow) inputRow.classList.remove('hide');

    voiceMediaRecorder.onstop = async () => {
        try { voiceMediaRecorder.stream.getTracks().forEach(t => t.stop()); } catch(e) {}
        const audioBlob = new Blob(voiceAudioChunks, { type: 'audio/webm' });
        if (audioBlob.size < 500) {
            showToast('Voice note too short');
            return;
        }

        try {
            if (typeof queueMediaMessage !== 'function') throw new Error('Background media queue is unavailable.');
            await queueMediaMessage(
                [{ file: audioBlob, name: 'Voice Note.webm', type: 'audio' }],
                '🎤 Voice Note',
                'voice',
                { roomId: voiceRecordingRoom, userId: voiceRecordingUser }
            );
        } catch(e) {
            console.error('Voice send error:', e);
            showToast(`Could not queue voice note: ${e.message || 'Please try again.'}`, 'error');
        }
    };

    voiceMediaRecorder.stop();
}

function initVoiceButtonHoldListener() {
    const btn = document.getElementById('voice-rec-btn');
    if (!btn || btn._voiceHoldAttached) return;
    btn._voiceHoldAttached = true;

    btn.addEventListener('pointerdown', async (e) => {
        e.preventDefault();
        voiceHoldStartX = e.clientX;
        voiceHoldStartY = e.clientY;
        isVoiceHolding = true;
        isVoiceLocked = false;
        voiceHoldStartTime = Date.now();
        try { btn.setPointerCapture(e.pointerId); } catch(err) {}

        await startVoiceRecording();
    });

    btn.addEventListener('pointermove', (e) => {
        if (!isVoiceHolding || isVoiceLocked) return;
        const dx = e.clientX - voiceHoldStartX;
        const dy = e.clientY - voiceHoldStartY;

        if (dx < -80) {
            isVoiceHolding = false;
            cancelVoiceRecording();
            showToast('Cancelled voice recording', 'info');
            return;
        }

        if (dy < -60) {
            isVoiceLocked = true;
            showToast('Recording locked. Tap send when finished.', 'info');
        }
    });

    btn.addEventListener('pointerup', async (e) => {
        if (!isVoiceHolding) return;
        isVoiceHolding = false;
        try { btn.releasePointerCapture(e.pointerId); } catch(err) {}

        if (isVoiceLocked) return;

        const duration = Date.now() - voiceHoldStartTime;
        if (duration < 500) {
            // Quick tap: keep panel open so user can speak comfortably
            return;
        }

        await stopAndSendVoiceRecording();
    });

    btn.addEventListener('pointercancel', () => {
        if (isVoiceHolding && !isVoiceLocked) {
            isVoiceHolding = false;
            cancelVoiceRecording();
        }
    });
}
document.addEventListener('DOMContentLoaded', initVoiceButtonHoldListener);

function toggleVoiceAudioPlay(uid) {
    const audio = document.getElementById(`${uid}-audio`);
    const btnIcon = document.getElementById(`${uid}-icon`);
    const progress = document.getElementById(`${uid}-progress`);
    if (!audio) return;

    if (audio.paused) {
        // Pause any other playing voice notes first
        document.querySelectorAll('audio').forEach(a => {
            if (a !== audio && !a.paused) a.pause();
        });
        audio.play();
        if (btnIcon) { btnIcon.className = 'fa-solid fa-pause'; }

        audio.ontimeupdate = () => {
            if (progress && audio.duration) {
                const pct = (audio.currentTime / audio.duration) * 100;
                progress.style.width = `${pct}%`;
            }
        };

        audio.onended = () => {
            if (btnIcon) { btnIcon.className = 'fa-solid fa-play'; }
            if (progress) progress.style.width = '0%';
        };
    } else {
        audio.pause();
        if (btnIcon) { btnIcon.className = 'fa-solid fa-play'; }
    }
}

function setVoicePlaySpeed(uid) {
    const audio = document.getElementById(`${uid}-audio`);
    const pill = document.getElementById(`${uid}-speed`);
    if (!audio || !pill) return;

    currentVoiceSpeedIndex = (currentVoiceSpeedIndex + 1) % voicePlaybackSpeeds.length;
    const speed = voicePlaybackSpeeds[currentVoiceSpeedIndex];
    audio.playbackRate = speed;
    pill.innerText = `${speed}x`;
}



function toggleVoiceRecord() {
    const studio = document.getElementById('voice-recording-studio');
    if (studio && !studio.classList.contains('hide')) {
        stopAndSendVoiceRecording();
    } else {
        startVoiceRecording();
    }
}

function pauseResumeVoiceRecording() {
    if (!voiceMediaRecorder) return;
    const btnIcon = document.querySelector('#voice-btn-pause i');
    if (voiceMediaRecorder.state === 'recording') {
        voiceMediaRecorder.pause();
        if (btnIcon) btnIcon.className = 'fa-solid fa-play';
        showToast('Recording paused');
    } else if (voiceMediaRecorder.state === 'paused') {
        voiceMediaRecorder.resume();
        if (btnIcon) btnIcon.className = 'fa-solid fa-pause';
        showToast('Recording resumed');
    }
}

