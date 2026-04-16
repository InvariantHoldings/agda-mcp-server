-- Stress test: nested modules inside abstract blocks with holes.
-- The protocol reports these as invisible goals (NamedMeta), and the
-- file should NOT be ok-complete.
module NestedAbstractHole where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

abstract
  module Inner where
    inner : Nat
    inner = {!!}

  outer : Nat
  outer = zero
