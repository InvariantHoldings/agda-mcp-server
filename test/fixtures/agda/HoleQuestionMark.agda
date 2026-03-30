module HoleQuestionMark where

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

question : Nat
question = ?
