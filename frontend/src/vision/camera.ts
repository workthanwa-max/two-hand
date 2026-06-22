export async function requestCameraStream() {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  })
}

export function attachStreamToVideo(
  videoElement: HTMLVideoElement,
  stream: MediaStream,
) {
  videoElement.srcObject = stream
  return new Promise<void>((resolve, reject) => {
    const handleReady = () => {
      videoElement.play().then(resolve).catch(reject)
    }

    if (videoElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
      handleReady()
      return
    }

    videoElement.addEventListener('loadedmetadata', handleReady, { once: true })
    videoElement.addEventListener('error', () => reject(videoElement.error), {
      once: true,
    })
  })
}

export function stopCameraStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}
