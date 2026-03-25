module WithPostulates where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

postulate
  magic : {A : Set} → A
  axiom : Nat → Nat
