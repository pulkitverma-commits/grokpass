'use client';

import { useEffect, useState } from 'react';

// Types a word out, holds it, erases it, and repeats. Every `colorMs` the word
// alternates between the brand accent and a #FF5757 → #79DEFE gradient.
export default function TypeWord({
  word,
  typeMs = 110,
  eraseMs = 55,
  holdMs = 2600,
  gapMs = 450,
  colorMs = 3000,
}: {
  word: string;
  typeMs?: number;
  eraseMs?: number;
  holdMs?: number;
  gapMs?: number;
  colorMs?: number;
}) {
  const [count, setCount] = useState(0);
  const [erasing, setErasing] = useState(false);
  const [gradient, setGradient] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Typing / erasing loop.
  useEffect(() => {
    if (reduced) { setCount(word.length); return; }
    let t: ReturnType<typeof setTimeout>;
    if (!erasing && count >= word.length) t = setTimeout(() => setErasing(true), holdMs);
    else if (erasing && count <= 0) t = setTimeout(() => setErasing(false), gapMs);
    else t = setTimeout(() => setCount(c => c + (erasing ? -1 : 1)), erasing ? eraseMs : typeMs);
    return () => clearTimeout(t);
  }, [count, erasing, reduced, word, typeMs, eraseMs, holdMs, gapMs]);

  // Colour swap every few seconds.
  useEffect(() => {
    const id = setInterval(() => setGradient(g => !g), colorMs);
    return () => clearInterval(id);
  }, [colorMs]);

  return (
    <span className={`type-word${gradient ? ' is-grad' : ''}`}>
      <span className="sr-only">{word}</span>
      <span aria-hidden="true" className="type-text">{word.slice(0, count)}</span>
      <span aria-hidden="true" className="type-caret" />
    </span>
  );
}
