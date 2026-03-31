module SearchAboutSupport where

data Maybe (A : Set) : Set where
  nothing : Maybe A
  just : A -> Maybe A

mapMaybe : {A B : Set} -> (A -> B) -> Maybe A -> Maybe B
mapMaybe f nothing = nothing
mapMaybe f (just x) = just (f x)

constMaybe : {A : Set} -> A -> Maybe A
constMaybe x = just x
