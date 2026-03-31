module HoleWhereBlock where

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

outer : Nat -> Nat
outer n = helper n
  where
    helper : Nat -> Nat
    helper x = ?
