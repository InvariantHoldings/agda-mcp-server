module EqualityProofHole where

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

data _==_ {A : Set} (x : A) : A -> Set where
  refl : x == x

zeroEqZero : zero == zero
zeroEqZero = ?
