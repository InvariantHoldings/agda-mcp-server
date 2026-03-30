module NavigationQueries where

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

module Local where
  data Flag : Set where
    on off : Flag

  flip : Flag -> Flag
  flip on = off
  flip off = on

open Local public

add : Nat -> Nat -> Nat
add zero m = m
add (suc n) m = suc (add n m)

goalValue : Nat -> Nat -> Nat
goalValue n m = {!!}
