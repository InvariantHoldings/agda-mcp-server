-- Stress test: multiple holes inside abstract blocks.
-- These are reported as invisible goals (NamedMeta), NOT visible
-- interaction points (InteractionId), because abstract blocks hide
-- the concrete definition from the interaction layer.
module AbstractHoleMultiple where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

abstract
  secret₁ : Nat
  secret₁ = {!!}

  secret₂ : Nat
  secret₂ = {!!}

  secret₃ : Nat → Nat
  secret₃ n = {! n !}
