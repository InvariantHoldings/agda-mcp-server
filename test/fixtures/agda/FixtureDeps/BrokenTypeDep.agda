module FixtureDeps.BrokenTypeDep where

data Nat : Set where
  zero : Nat

bad : Nat
bad = Set
