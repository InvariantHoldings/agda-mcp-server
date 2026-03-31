module QualifiedImportedHole where

import FixtureDeps.NatExtra as Extra
open import FixtureDeps.NatCore using (Nat; add)

goalFromQualifiedImport : Nat
goalFromQualifiedImport = add Extra.one {!!}
