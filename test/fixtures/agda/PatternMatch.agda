module PatternMatch where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

data Bool : Set where
  true  : Bool
  false : Bool

-- Ready for case-split on the Bool argument
isZero : Nat → Bool
isZero n = {!!}
