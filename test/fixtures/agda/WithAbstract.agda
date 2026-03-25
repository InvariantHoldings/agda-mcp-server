module WithAbstract where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

abstract
  secret : Nat
  secret = {!!}
