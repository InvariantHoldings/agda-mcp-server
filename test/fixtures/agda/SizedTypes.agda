{-# OPTIONS --sized-types #-}

module SizedTypes where

open import Agda.Builtin.Size

data Conat : {i : Size} → Set where
  czero : {i : Size} → Conat {↑ i}
  csuc  : {i : Size} → Conat {i} → Conat {↑ i}
