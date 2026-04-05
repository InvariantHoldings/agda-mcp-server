module MutualHole where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

data Even : Nat → Set
data Odd  : Nat → Set

data Even where
  even-zero : Even zero
  even-suc  : {n : Nat} → Odd n → Even (suc n)

data Odd where
  odd-suc : {n : Nat} → Even n → Odd (suc n)

-- Hole: prove that 2 is even
two-is-even : Even (suc (suc zero))
two-is-even = {!!}
