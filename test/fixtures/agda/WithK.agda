{-# OPTIONS --with-K #-}

module WithK where

open import Agda.Builtin.Equality

-- K axiom: only available with --with-K
K : {A : Set} {x : A} (P : x ≡ x → Set) → P refl → (p : x ≡ x) → P p
K P pr refl = pr
