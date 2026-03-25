module WithWhere where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

double : Nat → Nat
double n = add n n
  where
    add : Nat → Nat → Nat
    add zero    m = m
    add (suc k) m = suc (add k m)
