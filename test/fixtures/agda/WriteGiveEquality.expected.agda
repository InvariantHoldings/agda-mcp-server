module WriteGiveEquality where

open import Agda.Builtin.Equality using (_≡_; refl)
open import Agda.Builtin.Nat using (Nat; zero; suc)

-- Auto-solvable
trivial : zero ≡ zero
trivial = refl

-- Give refl
alsoTrivial : suc zero ≡ suc zero
alsoTrivial = refl
