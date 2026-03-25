module MultipleHoles where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- Two unsolved holes
hole1 : Nat
hole1 = {!!}

hole2 : Nat → Nat
hole2 n = {!!}
