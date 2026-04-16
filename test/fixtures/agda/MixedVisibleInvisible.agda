-- Stress test: both visible (interaction-point) holes and invisible
-- goals (abstract-block holes) in the same module.
-- The protocol should report visible goals for the top-level hole
-- and invisible goals for the abstract-block hole.
module MixedVisibleInvisible where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- This hole is a visible interaction point (InteractionId).
topLevel : Nat
topLevel = {!!}

abstract
  -- This hole is an invisible goal (NamedMeta) because it is inside
  -- an abstract block — no InteractionId is assigned.
  hidden : Nat
  hidden = {!!}
