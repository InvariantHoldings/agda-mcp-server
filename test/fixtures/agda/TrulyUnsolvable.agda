module TrulyUnsolvable where

data ⊥ : Set where

-- Agda cannot solve this by proof search because the goal type is empty.
unsolvable : ⊥
unsolvable = {!!}
