module WithClauseHole where

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

predOrSelf : Nat -> Nat
predOrSelf n with n
... | zero = ?
... | suc k = k
