module HoleRecordField where

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

record Box : Set where
  field
    value : Nat

boxed : Box
boxed = record { value = ? }
