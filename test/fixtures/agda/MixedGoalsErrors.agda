module MixedGoalsErrors where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

data Bool : Set where
  true  : Bool
  false : Bool

-- A hole (valid)
hole1 : Nat
hole1 = {!!}

-- A type error
wrong : Nat
wrong = true
