module WriteGiveSimple where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- Simple give test: fill with zero
myZero : Nat
myZero = {!!}

-- Multi-hole: add defined by recursion
add : Nat → Nat → Nat
add zero    m = {!!}
add (suc n) m = {!!}
