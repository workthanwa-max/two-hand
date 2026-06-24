import { useEffect, useRef, useCallback } from 'react'

interface BGMOptions {
  src: string
  volume?: number
}

export default function useBGM({ src, volume = 0.5 }: BGMOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    // Create the audio element only once
    if (!audioRef.current) {
      const audio = new Audio(src)
      audio.loop = true // User requested: เล่นซ้ำอัตโนมัติ
      audio.volume = volume
      audioRef.current = audio
    }

    const audio = audioRef.current

    // Update properties if they change
    audio.src = src
    audio.volume = volume

    return () => {
      // Cleanup on unmount
      audio.pause()
      audio.src = ''
    }
  }, [src, volume])

  const playBGM = useCallback(() => {
    if (audioRef.current) {
      // Browsers might block autoplay before user interaction. 
      // We handle the promise to avoid unhandled rejection errors in the console.
      audioRef.current.play().catch((e) => {
        console.warn('BGM Auto-play was prevented by the browser. It will play after user interaction.', e)
        
        // Add a one-time event listener to start playing on the first user click
        const playOnInteraction = () => {
          audioRef.current?.play().catch(() => {})
          window.removeEventListener('click', playOnInteraction)
          window.removeEventListener('touchstart', playOnInteraction)
        }
        
        window.addEventListener('click', playOnInteraction)
        window.addEventListener('touchstart', playOnInteraction)
      })
    }
  }, [])

  const pauseBGM = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
    }
  }, [])

  return { playBGM, pauseBGM }
}
