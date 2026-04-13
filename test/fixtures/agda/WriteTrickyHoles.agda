module WriteTrickyHoles where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

-- Hole with content
filled : Nat
filled = {! zero !}

-- Hole after a comment containing !}
-- bad !} fake close
afterComment : Nat
afterComment = {!!}

-- Nested holes
nested : Nat
nested = {! {! zero !} !}

-- Hole with a block comment containing !} inside (scanner edge case)
withBlockComment : Nat
withBlockComment = {! {- !} -} zero !}
