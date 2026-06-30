module NamedHole where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- "Named" / filled holes: Agda keeps each as an unsolved interaction
-- point but carries the candidate expression written inside the braces.
-- Both must surface as visible goals with distinct IDs.
one : Nat
one = {! suc zero !}

two : Nat
two = {! suc (suc zero) !}
