module FixtureDeps.Chain.Functions where

open import FixtureDeps.Chain.Types
open import FixtureDeps.NatCore

not : Bool → Bool
not true  = false
not false = true

length : {A : Set} → List A → Nat
length = go
  where
    go : {A : Set} → List A → Nat
    go []      = zero
    go (_ ∷ xs) = suc (go xs)
