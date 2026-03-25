module TypeError where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

data Bool : Set where
  true  : Bool
  false : Bool

-- Type error: Bool where Nat expected
wrong : Nat
wrong = true
