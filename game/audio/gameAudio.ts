type AudioContextConstructor = new () => AudioContext;

export type GameAudioLoop = {
  start: () => Promise<boolean>;
  setVolume: (volume: number) => void;
  stop: () => void;
};

export type GameAudioScope = {
  play: (src: string, volume?: number) => Promise<boolean>;
  stop: () => void;
};

type ActivePlayback = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  cleanup: () => void;
};

let audioContext: AudioContext | null = null;
let resumePromise: Promise<boolean> | null = null;
const audioData = new Map<string, Promise<ArrayBuffer>>();
const decodedAudio = new Map<string, Promise<AudioBuffer>>();

function publishAudioState(state: string) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.audioState = state;
  }
}

function publishPlayback(src: string) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.audioLastPlayed = src;
  }
}

function reportAudioError(action: string, error: unknown) {
  const name = error instanceof DOMException ? error.name : "Error";
  if (
    (name === "NotAllowedError" || name === "AbortError")
    && process.env.NODE_ENV === "production"
  ) return;
  console.warn(`[SpaceY audio] ${action} failed`, error);
}

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (audioContext?.state === "closed") {
    audioContext = null;
    decodedAudio.clear();
  }
  if (audioContext) return audioContext;

  const AudioContextClass = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  if (!AudioContextClass) {
    publishAudioState("unavailable");
    return null;
  }

  try {
    const context = new AudioContextClass();
    audioContext = context;
    context.addEventListener("statechange", () => {
      publishAudioState(context.state);
    });
    publishAudioState(context.state);
    return context;
  } catch (error) {
    publishAudioState("unavailable");
    reportAudioError("initialization", error);
    return null;
  }
}

function primeAudioContext(context: AudioContext) {
  const source = context.createBufferSource();
  source.buffer = context.createBuffer(1, 1, context.sampleRate);
  source.connect(context.destination);
  source.addEventListener("ended", () => source.disconnect(), { once: true });
  source.start();
}

function loadAudioData(src: string) {
  const cached = audioData.get(src);
  if (cached) return cached;

  const request = fetch(src, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${src}`);
      return response.arrayBuffer();
    })
    .catch((error) => {
      audioData.delete(src);
      throw error;
    });
  audioData.set(src, request);
  return request;
}

function decodeAudio(context: AudioContext, src: string) {
  const cached = decodedAudio.get(src);
  if (cached) return cached;

  const request = loadAudioData(src)
    .then((data) => context.decodeAudioData(data.slice(0)))
    .catch((error) => {
      decodedAudio.delete(src);
      throw error;
    });
  decodedAudio.set(src, request);
  return request;
}

export function isGameAudioRunning() {
  return audioContext?.state === "running";
}

function waitForGameAudio() {
  if (audioContext?.state === "running") return Promise.resolve(true);
  return resumePromise ?? Promise.resolve(false);
}

export function unlockGameAudio(options: { userGesture?: boolean } = {}) {
  const context = getAudioContext();
  if (!context) return Promise.resolve(false);
  if (context.state === "running") {
    publishAudioState("running");
    return Promise.resolve(true);
  }
  if (resumePromise && !options.userGesture) return resumePromise;

  const attempt = (async () => {
    try {
      primeAudioContext(context);
      await context.resume();
      const running = context.state === "running";
      publishAudioState(context.state);
      return running;
    } catch (error) {
      reportAudioError("unlock", error);
      publishAudioState(context.state);
      return false;
    }
  })();
  resumePromise = attempt;
  void attempt.finally(() => {
    if (resumePromise === attempt) resumePromise = null;
  });
  return attempt;
}

export function installGameAudioUnlock() {
  if (typeof document === "undefined") return () => {};
  publishAudioState(audioContext?.state ?? "locked");

  const unlock = () => {
    void unlockGameAudio({ userGesture: true });
  };
  document.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  document.addEventListener("touchend", unlock, { capture: true, passive: true });
  document.addEventListener("keydown", unlock, { capture: true });

  return () => {
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("touchend", unlock, true);
    document.removeEventListener("keydown", unlock, true);
  };
}

export function preloadGameAudio(sources: readonly string[]) {
  sources.forEach((src) => {
    void loadAudioData(src).catch((error) => reportAudioError(`preload ${src}`, error));
  });
}

async function startGameSound(
  src: string,
  volume: number,
  activePlaybacks?: Set<ActivePlayback>,
  isStopped?: () => boolean
) {
  const context = audioContext;
  if (!context) return false;

  try {
    const [unlocked, buffer] = await Promise.all([
      waitForGameAudio(),
      decodeAudio(context, src)
    ]);
    if (!unlocked || context.state !== "running" || isStopped?.()) return false;

    const source = context.createBufferSource();
    const gain = context.createGain();
    const playback: ActivePlayback = { source, gain, cleanup: () => {} };
    source.buffer = buffer;
    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(gain);
    gain.connect(context.destination);
    let cleaned = false;
    playback.cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      activePlaybacks?.delete(playback);
      source.disconnect();
      gain.disconnect();
    };
    source.addEventListener("ended", playback.cleanup, { once: true });
    activePlaybacks?.add(playback);
    source.start();
    publishPlayback(src);
    return true;
  } catch (error) {
    reportAudioError(`play ${src}`, error);
    return false;
  }
}

export function playGameSound(src: string, volume = 1) {
  return startGameSound(src, volume);
}

export function createGameAudioScope(): GameAudioScope {
  const activePlaybacks = new Set<ActivePlayback>();
  let stopped = false;

  return {
    play: (src, volume = 1) => startGameSound(
      src,
      volume,
      activePlaybacks,
      () => stopped
    ),
    stop: () => {
      stopped = true;
      activePlaybacks.forEach(({ source, cleanup }) => {
        try {
          source.stop();
        } catch {
          // The one-shot may already have finished while the route was unmounting.
        }
        cleanup();
      });
      activePlaybacks.clear();
    }
  };
}

export function createGameAudioLoop(src: string, initialVolume = 0): GameAudioLoop {
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  let startPromise: Promise<boolean> | null = null;
  let volume = Math.max(0, Math.min(1, initialVolume));
  let stopped = false;

  preloadGameAudio([src]);

  const start = () => {
    if (source) return Promise.resolve(true);
    if (stopped) return Promise.resolve(false);
    if (startPromise) return startPromise;

    startPromise = (async () => {
      const context = getAudioContext();
      if (!context) return false;
      try {
        const [unlocked, buffer] = await Promise.all([
          waitForGameAudio(),
          decodeAudio(context, src)
        ]);
        if (!unlocked || stopped || context.state !== "running") return false;
        if (source) return true;

        const nextSource = context.createBufferSource();
        const nextGain = context.createGain();
        nextSource.buffer = buffer;
        nextSource.loop = true;
        nextGain.gain.value = volume;
        nextSource.connect(nextGain);
        nextGain.connect(context.destination);
        nextSource.start();
        source = nextSource;
        gain = nextGain;
        publishPlayback(src);
        return true;
      } catch (error) {
        reportAudioError(`loop ${src}`, error);
        return false;
      }
    })().finally(() => {
      startPromise = null;
    });
    return startPromise;
  };

  return {
    start,
    setVolume: (nextVolume) => {
      volume = Math.max(0, Math.min(1, nextVolume));
      const context = audioContext;
      if (!gain || !context) return;
      gain.gain.setTargetAtTime(volume, context.currentTime, 0.02);
    },
    stop: () => {
      stopped = true;
      if (source) {
        try {
          source.stop();
        } catch {
          // The source may already have stopped while the route was unmounting.
        }
        source.disconnect();
      }
      gain?.disconnect();
      source = null;
      gain = null;
    }
  };
}
