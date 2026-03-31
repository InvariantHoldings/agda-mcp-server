module SearchAboutNestedModules where

module Reexports where
  open import SearchAboutSupport public

  id : {A : Set} -> A -> A
  id x = x

  maybeId : {A : Set} -> Maybe A -> Maybe A
  maybeId = mapMaybe id

open Reexports public

module Local where
  data Flag : Set where
    on off : Flag

  flip : Flag -> Flag
  flip on = off
  flip off = on

  mapFlagMaybe : Maybe Flag -> Maybe Flag
  mapFlagMaybe = mapMaybe flip

open Local public
