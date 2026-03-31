module ExpressionQueries where

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

add : Nat -> Nat -> Nat
add zero m = m
add (suc n) m = suc (add n m)

double : Nat -> Nat
double n = add n n

topValue : Nat
topValue = add (suc zero) (suc zero)

goalValue : Nat -> Nat -> Nat
goalValue n m = {!!}
