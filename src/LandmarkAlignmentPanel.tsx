import { useState } from 'react';
import * as THREE from 'three';
import { alignByLandmarkFrame, type LandmarkPair } from './modelAlignment';

type Props = {
  disabled?: boolean;
  onApply: (matrix: THREE.Matrix4, report: { rmsError: number; maxError: number }) => void;
};

const blank = () => Array.from({ length: 3 }, () => ({ sx: '', sy: '', sz: '', tx: '', ty: '', tz: '' }));
export default function LandmarkAlignmentPanel({ disabled = false, onApply }: Props) {
  const [rows, setRows] = useState(blank);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ rmsError: number; maxError: number } | null>(null);

  const update = (index: number, key: keyof (typeof rows)[number], value: string) => {
    setRows(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
    setError('');
    setResult(null);
  };

  const apply = () => {
    const numbers = rows.map(row => Object.values(row).map(value => value.trim() === '' ? NaN : Number(value.replace(',', '.'))));
    if (numbers.some(row => row.some(value => !Number.isFinite(value)))) {
      setError('Заполните все координаты трёх пар ориентиров.');
      return;
    }
    const pairs: LandmarkPair[] = numbers.map(row => ({
      source: new THREE.Vector3(row[0], row[1], row[2]),
      target: new THREE.Vector3(row[3], row[4], row[5]),
    }));
    const fit = alignByLandmarkFrame(pairs);
    if (!fit) {
      setError('Ориентиры совпадают или почти лежат на одной прямой. Выберите три пространственно разнесённые точки.');
      return;
    }
    const report = { rmsError: fit.rmsError, maxError: fit.maxError };
    setResult(report);
    setError('');
    onApply(fit.matrix, report);
  };

  return <section className="landmark-align-panel">
    <div className="landmark-align-heading"><b>Привязка по 3 ориентирам</b><span>Rigid · без масштаба</span></div>
    <p>Для каждой точки укажите координаты на перемещаемой STL (X/Y/Z) и соответствующей точки эталона. Координаты — в мм и в одной системе единиц.</p>
    <div className="landmark-align-table">
      <div className="landmark-align-row landmark-align-labels"><span>Точка</span><span>STL X/Y/Z</span><span>Эталон X/Y/Z</span></div>
      {rows.map((row, index) => <div className="landmark-align-row" key={index}>
        <b>{index + 1}</b>
        <div>{(['sx', 'sy', 'sz'] as const).map(key => <input key={key} aria-label={`Точка ${index + 1}, STL ${key[1].toUpperCase()}`} inputMode="decimal" placeholder={key[1].toUpperCase()} value={row[key]} disabled={disabled} onChange={event => update(index, key, event.target.value)} />)}</div>
        <div>{(['tx', 'ty', 'tz'] as const).map(key => <input key={key} aria-label={`Точка ${index + 1}, эталон ${key[1].toUpperCase()}`} inputMode="decimal" placeholder={key[1].toUpperCase()} value={row[key]} disabled={disabled} onChange={event => update(index, key, event.target.value)} />)}</div>
      </div>)}
    </div>
    <button type="button" className="wide-secondary" disabled={disabled} onClick={apply}>Рассчитать жёсткое совмещение</button>
    {error && <p className="landmark-align-error" role="alert">{error}</p>}
    {result && <div className="landmark-align-result"><b>Расчёт выполнен</b><span>RMS: {result.rmsError.toFixed(3)} мм</span><span>Макс.: {result.maxError.toFixed(3)} мм</span><small>Три точки определяют преобразование точно по построенному базису; ошибка здесь не является клинической оценкой посадки.</small></div>}
  </section>;
}
