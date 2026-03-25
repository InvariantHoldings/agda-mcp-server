module UniverseError where

open import Agda.Primitive

-- Invalid: Set₁ does not live in Set₀
-- This is Girard's paradox territory
bad : Set
bad = Set
