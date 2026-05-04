-- Stress test: multiple holes inside abstract blocks.
--
-- HISTORICAL: in older Agda releases the interaction layer hid these
-- behind the abstract block and reported them as invisible goals
-- (NamedMeta) rather than visible interaction points (InteractionId).
-- On Agda 2.8.0 they come back as three visible goals — the abstract
-- keyword no longer suppresses interaction-layer tracking.
--
-- The file's classification (`ok-with-holes`, never `ok-complete`)
-- is correct under both reportings because the load pipeline merges
-- the source-hole scan with the protocol counts. For an invisible-
-- only fixture that still exercises the merged path on 2.8.0 see
-- `InferredMeta.agda` (asserted by the
-- "InferredMeta.agda: typechecks but still exposes an interaction meta"
-- integration test in agda-load.test.ts).
module AbstractHoleMultiple where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

abstract
  secret₁ : Nat
  secret₁ = {!!}

  secret₂ : Nat
  secret₂ = {!!}

  secret₃ : Nat → Nat
  secret₃ n = {! n !}
