module WriteGiveQuestionMarks where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- Question mark holes
a : Nat
a = zero

b : Nat
b = suc zero
