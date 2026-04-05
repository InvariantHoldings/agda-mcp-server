module FixtureDeps.Chain.Functions where

open import FixtureDeps.Chain.Types

not : Bool → Bool
not true  = false
not false = true

length : {A : Set} → List A → FixtureDeps.NatCore.Nat
length = go
  where
    open import FixtureDeps.NatCore
    go : {A : Set} → List A → Nat
    go []      = zero
    go (_ ∷ xs) = suc (go xs)
