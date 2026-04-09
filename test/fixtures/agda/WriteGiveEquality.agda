module WriteGiveEquality where

open import Agda.Builtin.Equality using (_≡_; refl)
open import Agda.Builtin.Nat using (Nat; zero; suc)

-- Auto-solvable
trivial : zero ≡ zero
trivial = {!!}

-- Give refl
alsoTrivial : suc zero ≡ suc zero
alsoTrivial = {!!}
