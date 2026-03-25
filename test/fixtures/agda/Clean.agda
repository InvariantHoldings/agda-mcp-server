module Clean where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

add : Nat → Nat → Nat
add zero    m = m
add (suc n) m = suc (add n m)
