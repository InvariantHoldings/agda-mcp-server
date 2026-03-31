module ImportedContextHole where

open import FixtureDeps.NatCore
open import FixtureDeps.NatExtra

goalFromImport : Nat
goalFromImport = add {!!} two
