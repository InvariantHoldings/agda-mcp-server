module WriteCaseSplit where

data Bool : Set where
  true  : Bool
  false : Bool

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- Ready for case split
not : Bool → Bool
not true = false
not false = true

isZero : Nat → Bool
isZero zero = true
isZero (suc n) = false
