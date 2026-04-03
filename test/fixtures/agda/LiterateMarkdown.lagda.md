# Literate Markdown

A simple literate Agda module using the `.lagda.md` format.

```agda
module LiterateMarkdown where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

add : Nat → Nat → Nat
add zero    m = m
add (suc n) m = suc (add n m)

-- Unsolved hole
test : Nat
test = {!!}
```
