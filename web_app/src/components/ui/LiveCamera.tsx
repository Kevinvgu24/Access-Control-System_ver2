import { useState, useEffect, useRef } from 'react'

interface LiveCameraProps {
  labId: string
  nodeId: string
}

export function LiveCamera({ labId, nodeId }: LiveCameraProps) {
  const [error, setError] = useState<string | null>(null)
  const [hasLoadedAtLeastOnce, setHasLoadedAtLeastOnce] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    // Start IR stream request
    const startStream = async () => {
      try {
        const res = await fetch(`/api/labs/${labId}/nodes/${nodeId}/ir-stream/start`, {
          method: 'POST',
        })
        if (!res.ok) throw new Error('Failed to start stream')
      } catch {
        setError('Unable to activate stream on node')
      }
    }

    void startStream()

    // Stop IR stream request on unmount
    return () => {
      void fetch(`/api/labs/${labId}/nodes/${nodeId}/ir-stream/stop`, {
        method: 'POST',
      }).catch(() => {})
    }
  }, [labId, nodeId])

  const captureFrame = () => {
    const imgElement = imgRef.current
    if (!imgElement) return

    try {
      const canvas = document.createElement('canvas')
      // Use natural resolution of the source frame, fallback to display size
      canvas.width = imgElement.naturalWidth || imgElement.width || 640
      canvas.height = imgElement.naturalHeight || imgElement.height || 480
      
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.95)
        
        // Trigger file download
        const link = document.createElement('a')
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        link.download = `ir_capture_${timestamp}.jpg`
        link.href = dataUrl
        link.click()
      }
    } catch (err) {
      console.error("Failed to capture frame from stream:", err)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-video rounded-lg overflow-hidden bg-slate-950 border border-line flex items-center justify-center">
        {error ? (
          <div className="text-center p-4">
            <span className="text-red font-mono text-xs uppercase tracking-wider block mb-1">Stream Error</span>
            <span className="text-slate-400 text-xs">{error}</span>
          </div>
        ) : (
          <>
            <img
              ref={imgRef}
              src={`/api/labs/${labId}/nodes/${nodeId}/ir-stream`}
              alt="IR Live Feed"
              className={`w-full h-full object-cover grayscale transition-opacity duration-300 ${
                hasLoadedAtLeastOnce ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={() => setHasLoadedAtLeastOnce(true)}
              onError={() => {
                // Fail silently before the first frame is uploaded
              }}
            />
            {!hasLoadedAtLeastOnce && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/90">
                <span className="blink w-2.5 h-2.5 rounded-full bg-green" />
                <span className="font-mono text-[10px] text-slate-400 uppercase tracking-widest">
                  Awaiting Edge Feed…
                </span>
              </div>
            )}
          </>
        )}

        {/* Live HUD Overlay */}
        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full flex items-center gap-2 border border-white/10">
          <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
          <span className="font-mono text-[10px] text-white font-bold tracking-widest uppercase">LIVE IR</span>
        </div>

        <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded font-mono text-[9px] text-slate-300 border border-white/5">
          NODE: {nodeId}
        </div>
      </div>
      
      <div className="flex justify-between items-center px-1">
        <span className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green animate-ping" />
          15-20 FPS Auto Stream
        </span>
        <div className="flex items-center gap-4">
          <button
            onClick={captureFrame}
            disabled={!hasLoadedAtLeastOnce}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white font-mono text-[11px] px-3.5 py-1.5 rounded-md border border-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm font-semibold active:scale-[0.98]"
            title="Capture current stream frame"
          >
            📸 Capture Photo
          </button>
          <span className="text-xs text-green font-semibold">
            Active
          </span>
        </div>
      </div>
    </div>
  )
}
