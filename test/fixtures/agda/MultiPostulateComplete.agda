-- Stress test: multiple postulates and no holes.
-- Postulates are complete definitions. This module must be
-- ok-complete with zero visible and zero invisible goals.
module MultiPostulateComplete where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

data Bool : Set where
  true  : Bool
  false : Bool

postulate
  magic : {A : Set} → A
  axiom₁ : Nat → Nat
  axiom₂ : Bool → Nat
  axiom₃ : Nat → Bool → Nat

-- A concrete definition using a postulate — still complete.
result : Nat
result = axiom₁ (suc zero)
