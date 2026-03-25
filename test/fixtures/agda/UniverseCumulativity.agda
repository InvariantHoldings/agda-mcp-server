{-# OPTIONS --cumulativity #-}

module UniverseCumulativity where

open import Agda.Primitive

-- With cumulativity, Set₀ is a subtype of Set₁
-- This should type-check with --cumulativity
promote : Set → Set₁
promote A = A
