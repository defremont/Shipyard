const SOUND_KEY = 'shipyard:ai-sound-enabled'

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  // A context created before the first click starts suspended, and one in a
  // window left in the background can be put back to sleep.
  if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => {})
  return audioCtx
}

export function isSoundEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) !== 'false'
}

export function setSoundEnabled(enabled: boolean) {
  localStorage.setItem(SOUND_KEY, String(enabled))
}

/** Play a short run of sine notes. Web Audio API — no audio files needed. */
function playNotes(frequencies: number[], { duration = 0.12, gap = 0.08, volume = 0.15 } = {}) {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.value = freq

      const start = now + i * (duration + gap)
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(volume, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + duration)
    })
  } catch {
    // Silently fail — sound is non-critical
  }
}

/** A subtle two-tone ascending chime (C5 → E5): an AI operation completed. */
export function playAiCompleteSound() {
  if (!isSoundEnabled()) return
  playNotes([523.25, 659.25])
}

/**
 * The two sounds an agent session makes. They have to be told apart without
 * looking: "finished" resolves upwards and is done; "question" is the same
 * note twice, like a knock, because someone is waiting.
 */
export function playSessionSound(kind: 'question' | 'finished') {
  if (kind === 'question') playNotes([880, 880], { duration: 0.1, gap: 0.09, volume: 0.18 })
  else playNotes([523.25, 659.25, 783.99], { duration: 0.11, gap: 0.05 })
}
