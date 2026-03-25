module ParseError where

-- This is syntactically invalid Agda
data Broken : Set where
  oops = not valid syntax here !!!
