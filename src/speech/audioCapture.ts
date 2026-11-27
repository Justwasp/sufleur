/**
 * Microphone capture utility providing:
 * - Real-time RMS audio level [0..1] for the broadcast VU meter
 * - 16kHz mono PCM Int16 / AudioBuffer streaming for Vosk WASM and Deepgram WebSocket
 */
export interface MicrophoneSession {
  stream: MediaStream;
  audioContext: AudioContext;
  stop: () => Promise<void>;
}

export interface AudioCaptureCallbacks {
  onLevel?: (level: number) => void;
  onPcm16?: (pcm16: Int16Array) => void;
  onAudioBuffer?: (buffer: AudioBuffer) => void;
}

function downsampleTo16kHz(
  input: Float32Array,
  inputSampleRate: number,
  targetRate = 16000,
): Float32Array {
  if (inputSampleRate === targetRate) return input;
  const ratio = inputSampleRate / targetRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.min(
      input.length,
      Math.round((offsetResult + 1) * ratio),
    );
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += input[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function floatToInt16(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export async function startMicrophoneCapture(
  callbacks: AudioCaptureCallbacks,
  desiredSampleRate = 16000,
): Promise<MicrophoneSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is not supported in this browser or context (HTTPS/localhost required).');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioContext = new AudioCtx({ sampleRate: desiredSampleRate });
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  const source = audioContext.createMediaStreamSource(stream);
  // ScriptProcessorNode remains the most compatible cross-browser synchronous PCM tap for Vosk/WebSockets
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  // Route through zero-gain node so audio never echoes to speakers
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    const input = event.inputBuffer.getChannelData(0);

    if (callbacks.onLevel) {
      let sumSq = 0;
      for (let i = 0; i < input.length; i++) {
        sumSq += input[i] * input[i];
      }
      const rms = Math.sqrt(sumSq / input.length);
      callbacks.onLevel(Math.min(1, rms * 4.5));
    }

    if (callbacks.onAudioBuffer) {
      callbacks.onAudioBuffer(event.inputBuffer);
    }

    if (callbacks.onPcm16) {
      const resampled = downsampleTo16kHz(input, audioContext.sampleRate, 16000);
      callbacks.onPcm16(floatToInt16(resampled));
    }
  };

  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  return {
    stream,
    audioContext,
    stop: async () => {
      processor.onaudioprocess = null;
      try {
        source.disconnect();
        processor.disconnect();
        silentGain.disconnect();
      } catch {
        // ignore already disconnected nodes
      }
      for (const track of stream.getTracks()) {
        track.stop();
      }
      if (audioContext.state !== 'closed') {
        await audioContext.close().catch(() => undefined);
      }
    },
  };
}
