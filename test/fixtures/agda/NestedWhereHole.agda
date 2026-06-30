module NestedWhereHole where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

_+_ : Nat → Nat → Nat
zero  + n = n
suc m + n = suc (m + n)

-- A hole buried two `where` levels deep. Its interaction point must
-- still surface with a usable goal ID.
outer : Nat → Nat
outer x = inner x
  where
    inner : Nat → Nat
    inner y = deepest y
      where
        deepest : Nat → Nat
        deepest z = {!!}
