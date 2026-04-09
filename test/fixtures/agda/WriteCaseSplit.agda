module WriteCaseSplit where

data Bool : Set where
  true  : Bool
  false : Bool

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- Ready for case split
not : Bool → Bool
not b = {!!}

isZero : Nat → Bool
isZero n = {!!}
