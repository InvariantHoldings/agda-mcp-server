{-# OPTIONS --rewriting #-}

module WithRewrite where

open import Agda.Builtin.Equality
open import Agda.Builtin.Equality.Rewrite

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

_+_ : Nat → Nat → Nat
zero  + m = m
suc n + m = suc (n + m)

+-zero : (n : Nat) → n + zero ≡ n
+-zero zero    = refl
+-zero (suc n) = cong suc (+-zero n)
  where
    cong : {A B : Set} {x y : A} (f : A → B) → x ≡ y → f x ≡ f y
    cong f refl = refl

{-# REWRITE +-zero #-}
