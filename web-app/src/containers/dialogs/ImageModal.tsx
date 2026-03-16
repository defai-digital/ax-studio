import { X } from 'lucide-react'

interface ImageModalProps {
  image: { url: string; alt: string } | null
  onClose: () => void
}

const ImageModal = ({ image, onClose }: ImageModalProps) => {
  if (!image) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        <X className="size-5" />
      </button>
      <img
        src={image.url}
        alt={image.alt || 'Preview'}
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
    </div>
  )
}

export default ImageModal
