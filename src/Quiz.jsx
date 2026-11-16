import React, { useEffect, useRef, useState } from 'react';
import { QUESTIONS, questionPath } from './quiz.js';

export function Quiz({ onComplete }) {
  const [answers, setAnswers] = useState({});
  const [step, setStep] = useState(0);
  const [multi, setMulti] = useState([]);
  const [sound, setSound] = useState(true);
  const [feedback, setFeedback] = useState('');
  const audio = useRef(null);
  const heading = useRef(null);
  const path = questionPath(answers);
  const key = path[step];
  const question = QUESTIONS[key];
  const total = !answers.transport || (answers.transport === 'Sim' && !answers.vehicle) ? 8 : !answers.gender && answers.vehicle !== 'Moto' ? (answers.transport === 'Sim' ? 8 : 7) : path.length;
  useEffect(() => { heading.current?.focus(); setMulti(answers[key] || []); }, [step, key]);
  useEffect(() => () => { audio.current?.close().catch(() => {}); }, []);
  function beep() {
    if (!sound) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      const context = audio.current || (audio.current = new Audio());
      context.resume().catch(() => {});
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(990, context.currentTime + .09);
      gain.gain.setValueAtTime(.055, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .14);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .15);
    } catch { /* Sound is optional when the browser cannot play it. */ }
  }
  function next(value) {
    beep();
    // Going back and changing a filter discards dependent answers.
    const clean = Object.fromEntries(path.slice(0, step).filter(id => answers[id] !== undefined).map(id => [id, answers[id]]));
    const updated = { ...clean, [key]: value };
    setAnswers(updated); setFeedback('Boa escolha! Estamos conhecendo melhor o seu estilo.');
    const nextPath = questionPath(updated);
    if (step + 1 === nextPath.length && nextPath.every(id => updated[id] !== undefined)) onComplete(updated);
    else setStep(step + 1);
  }
  function toggle(value) {
    beep();
    setMulti(current => value === 'Ainda nenhum' ? (current.includes(value) ? [] : [value]) : current.includes(value) ? current.filter(item => item !== value) : [...current.filter(item => item !== 'Ainda nenhum'), value]);
  }
  return <main className="quiz-page"><header className="journey-top"><span className="journey-wordmark">lopesdapromoção<span>.</span></span><button className="sound-toggle" aria-pressed={sound} onClick={() => setSound(!sound)}>Som {sound ? 'ligado ♪' : 'desligado'}</button></header><div className="quiz-card"><div className="quiz-progress-label"><span>SEU GRUPO, DO SEU JEITO</span><span>{step + 1} / {total}</span></div><progress aria-label="Progresso do quiz" value={step + 1} max={total} /><p className="quiz-feedback" role="status">{feedback || 'Um minutinho para encontrar seu próximo grupo favorito.'}</p><div key={key} className="quiz-question"><span className="quiz-number">{String(step + 1).padStart(2, '0')}</span><h1 ref={heading} tabIndex={-1}>{question.title}</h1><p>{question.note || 'Conte para a gente. Cada resposta ajuda na sua seleção.'}</p><div className="quiz-options">{question.options.map((option, index) => <button key={option} className={question.multi && multi.includes(option) ? 'chosen' : ''} {...(question.multi ? { 'aria-pressed': multi.includes(option) } : {})} onClick={() => question.multi ? toggle(option) : next(option)}><span className="option-number">{question.multi ? (multi.includes(option) ? '✓' : '+') : String.fromCharCode(65 + index)}</span><span>{option}</span><span aria-hidden="true">→</span></button>)}</div>{question.multi && <button className="btn btn-orange quiz-next" disabled={!multi.length} onClick={() => next(multi)}>Continuar →</button>}</div><div className="quiz-bottom">{step > 0 && <button onClick={() => { setStep(step - 1); setFeedback('Você pode ajustar sua escolha.'); }}>← Voltar</button>}<span>Suas respostas ficam apenas nesta página.</span></div></div><p className="journey-footnote">Responda no seu ritmo. O resultado vem logo depois.</p></main>;
}
