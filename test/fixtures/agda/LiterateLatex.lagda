\documentclass{article}

\begin{document}

A simple literate Agda module using the classic \texttt{.lagda} format.

\begin{code}
module LiterateLatex where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

add : Nat → Nat → Nat
add zero    m = m
add (suc n) m = suc (add n m)

-- Unsolved hole
test : Nat
test = {!!}
\end{code}

\end{document}
