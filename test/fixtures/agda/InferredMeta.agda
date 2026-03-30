-- This remains an interaction meta under live Agda in our test setup.
module InferredMeta where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- The expected fixture behavior is "typechecks with holes", not "fully inferred".
inferred : (Nat → Nat) → Nat
inferred f = f _
