module MutualRecursion where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- Mutual recursion: even / odd
mutual
  even : Nat → Nat
  even zero    = zero
  even (suc n) = suc (odd n)

  odd : Nat → Nat
  odd zero    = zero
  odd (suc n) = suc (even n)
