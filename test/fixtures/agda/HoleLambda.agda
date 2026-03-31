module HoleLambda where

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

applyLater : Nat -> Nat -> Nat
applyLater n = \m -> {!!}
