module FixtureSupport where

data Nat : Set where
  zero : Nat
  suc  : Nat -> Nat

inc : Nat -> Nat
inc n = suc n
