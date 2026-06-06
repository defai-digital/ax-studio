import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useFavoriteModel } from './useFavoriteModel'

const makeModel = (id: string, name?: string): Model => ({
  id,
  name: name ?? id,
})

describe('useFavoriteModel', () => {
  beforeEach(() => {
    act(() => {
      useFavoriteModel.setState({ favoriteModels: [] })
    })
  })

  describe('initial state', () => {
    it('should initialize with an empty favoriteModels array', () => {
      expect(useFavoriteModel.getState().favoriteModels).toEqual([])
    })
  })

  describe('addFavorite', () => {
    it('should add a model to favorites', () => {
      const model = makeModel('gpt-4')
      act(() => {
        useFavoriteModel.getState().addFavorite(model)
      })
      expect(useFavoriteModel.getState().favoriteModels).toEqual([model])
    })

    it('should not add a duplicate model', () => {
      const model = makeModel('gpt-4')
      act(() => {
        useFavoriteModel.getState().addFavorite(model)
      })
      act(() => {
        useFavoriteModel.getState().addFavorite(model)
      })
      expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
    })

    it('should add multiple different models', () => {
      const model1 = makeModel('gpt-4')
      const model2 = makeModel('claude-3')
      act(() => {
        useFavoriteModel.getState().addFavorite(model1)
        useFavoriteModel.getState().addFavorite(model2)
      })
      expect(useFavoriteModel.getState().favoriteModels).toHaveLength(2)
      expect(useFavoriteModel.getState().favoriteModels[0].id).toBe('gpt-4')
      expect(useFavoriteModel.getState().favoriteModels[1].id).toBe('claude-3')
    })

    it('should not add duplicate even with different name but same id', () => {
      act(() => {
        useFavoriteModel.getState().addFavorite(makeModel('gpt-4', 'GPT 4'))
      })
      act(() => {
        useFavoriteModel.getState().addFavorite(makeModel('gpt-4', 'GPT-4 Updated'))
      })
      expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
      expect(useFavoriteModel.getState().favoriteModels[0].name).toBe('GPT 4')
    })
  })

  describe('removeFavorite', () => {
    it('should remove a model by id', () => {
      const model = makeModel('gpt-4')
      act(() => {
        useFavoriteModel.getState().addFavorite(model)
      })
      act(() => {
        useFavoriteModel.getState().removeFavorite('gpt-4')
      })
      expect(useFavoriteModel.getState().favoriteModels).toEqual([])
    })

    it('should not throw when removing a non-existent model', () => {
      act(() => {
        useFavoriteModel.getState().removeFavorite('non-existent')
      })
      expect(useFavoriteModel.getState().favoriteModels).toEqual([])
    })

    it('should only remove the matching model', () => {
      act(() => {
        useFavoriteModel.getState().addFavorite(makeModel('gpt-4'))
        useFavoriteModel.getState().addFavorite(makeModel('claude-3'))
      })
      act(() => {
        useFavoriteModel.getState().removeFavorite('gpt-4')
      })
      expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
      expect(useFavoriteModel.getState().favoriteModels[0].id).toBe('claude-3')
    })
  })

  describe('isFavorite', () => {
    it('should return false for a model not in favorites', () => {
      expect(useFavoriteModel.getState().isFavorite('gpt-4')).toBe(false)
    })

    it('should return true for a model in favorites', () => {
      act(() => {
        useFavoriteModel.getState().addFavorite(makeModel('gpt-4'))
      })
      expect(useFavoriteModel.getState().isFavorite('gpt-4')).toBe(true)
    })

    it('should return false after model is removed', () => {
      act(() => {
        useFavoriteModel.getState().addFavorite(makeModel('gpt-4'))
      })
      act(() => {
        useFavoriteModel.getState().removeFavorite('gpt-4')
      })
      expect(useFavoriteModel.getState().isFavorite('gpt-4')).toBe(false)
    })
  })

  describe('toggleFavorite', () => {
    it('should add model when not in favorites', () => {
      const model = makeModel('gpt-4')
      act(() => {
        useFavoriteModel.getState().toggleFavorite(model)
      })
      expect(useFavoriteModel.getState().isFavorite('gpt-4')).toBe(true)
    })

    it('should remove model when already in favorites', () => {
      const model = makeModel('gpt-4')
      act(() => {
        useFavoriteModel.getState().addFavorite(model)
      })
      act(() => {
        useFavoriteModel.getState().toggleFavorite(model)
      })
      expect(useFavoriteModel.getState().isFavorite('gpt-4')).toBe(false)
    })

    it('should re-add model after toggling twice', () => {
      const model = makeModel('gpt-4')
      act(() => {
        useFavoriteModel.getState().toggleFavorite(model)
      })
      act(() => {
        useFavoriteModel.getState().toggleFavorite(model)
      })
      act(() => {
        useFavoriteModel.getState().toggleFavorite(model)
      })
      expect(useFavoriteModel.getState().isFavorite('gpt-4')).toBe(true)
      expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
    })

    it('should not affect other favorites when toggling one model', () => {
      act(() => {
        useFavoriteModel.getState().addFavorite(makeModel('gpt-4'))
        useFavoriteModel.getState().addFavorite(makeModel('claude-3'))
      })
      act(() => {
        useFavoriteModel.getState().toggleFavorite(makeModel('gpt-4'))
      })
      expect(useFavoriteModel.getState().isFavorite('gpt-4')).toBe(false)
      expect(useFavoriteModel.getState().isFavorite('claude-3')).toBe(true)
    })
  })
})
