-- Stress test: nested modules inside abstract blocks with holes.
--
-- HISTORICAL: older Agda releases reported the inner hole as an
-- invisible goal (NamedMeta) because the abstract block suppressed
-- interaction-layer tracking. On Agda 2.8.0 it comes back as a
-- visible goal — the matrix expectation `minVisibleGoalCount: 0`
-- accommodates either reporting; what we actually pin here is that
-- the file is `ok-with-holes`, never `ok-complete`. See
-- `InferredMeta.agda` for an invisible-only fixture that still
-- exercises the merged source-hole / protocol-counts path on 2.8.0.
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
