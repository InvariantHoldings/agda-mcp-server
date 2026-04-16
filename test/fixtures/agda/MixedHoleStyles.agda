module MixedHoleStyles where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- Explicit empty hole
hole1 : Nat
hole1 = {!!}

-- Question-mark hole
hole2 : Nat
hole2 = ?

-- Explicit hole with expression
hole3 : Nat → Nat
hole3 n = {! n !}
