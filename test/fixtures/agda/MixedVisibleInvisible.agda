-- Stress test: holes in two different positions (top-level vs.
-- inside an abstract block) in the same module.
--
-- HISTORICAL: older Agda releases reported the abstract-block hole
-- as an invisible goal (NamedMeta) and the top-level hole as a
-- visible interaction point (InteractionId), giving us a classic
-- "mixed" reporting shape. On Agda 2.8.0 both come back as visible
-- goals — the abstract keyword no longer suppresses interaction-
-- layer tracking. The classification (`ok-with-holes`) is correct
-- under both reportings, and the matrix expectation
-- `minVisibleGoalCount: 1, minHoleCount: 1` accommodates either.
-- See `InferredMeta.agda` for an invisible-only fixture that still
-- exercises the merged source-hole / protocol-counts path on 2.8.0.
module MixedVisibleInvisible where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- Top-level hole — always reported as a visible interaction point.
topLevel : Nat
topLevel = {!!}

abstract
  -- Hole inside an abstract block — historically NamedMeta-only
  -- (invisible), now a regular InteractionId on Agda 2.8.0.
  hidden : Nat
  hidden = {!!}
