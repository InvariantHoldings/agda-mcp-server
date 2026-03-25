module TrulyUnsolvable where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

data Bool : Set where
  true  : Bool
  false : Bool

-- Agda cannot possibly solve this: no way to produce a Nat → Bool
-- from nothing, and the hole has no hints
unsolvable : Nat → Bool
unsolvable = {!!}
