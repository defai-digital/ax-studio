import { Star } from "lucide-react";
import { useFavoriteModel } from '@/hooks/models/useFavoriteModel'
import { Button } from '@/components/ui/button'

interface FavoriteModelActionProps {
  model: Model
}

export function FavoriteModelAction({ model }: FavoriteModelActionProps) {
  const { isFavorite, toggleFavorite } = useFavoriteModel()
  const isModelFavorite = isFavorite(model.id)

  return (
    <Button
      aria-label="Toggle favorite" 
      variant="ghost"
      size="icon-xs"
      onClick={() => toggleFavorite(model)}
    >
      {isModelFavorite ? (
        <Star size={18} className="text-muted-foreground" fill="currentColor" />
      ) : (
        <Star size={18} className="text-muted-foreground" />
      )}
    </Button>
  )
}
