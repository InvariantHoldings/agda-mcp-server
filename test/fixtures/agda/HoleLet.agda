module HoleLet where

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

letHole : Nat -> Nat
letHole n =
  let
    x : Nat
    x = ?
  in x
