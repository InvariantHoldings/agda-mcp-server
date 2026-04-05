-- Deep import chain: ChainImport → Chain.Functions → Chain.Types + NatCore
module ChainImport where

open import FixtureDeps.Chain.Types
open import FixtureDeps.Chain.Functions
open import FixtureDeps.NatCore

bools : List Bool
bools = true ∷ false ∷ true ∷ []

count : Nat
count = length bools
