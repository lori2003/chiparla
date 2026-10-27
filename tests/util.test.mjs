// Elenchi di nomi incollati (es. dai verbali)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNameList, splitNames } from '../js/util.js';

test('parseNameList: toglie numeri, punti elenco, ruoli e doppioni', () => {
  const text = '1. Mario Rossi – Presidente\r\n2) Bianchi Anna (Vicepresidente)\n• Luca De Santis\n- Paola Neri: segretaria\n\nMario Rossi, Giulia Verdi; Anna-Maria Ferri';
  assert.deepEqual(parseNameList(text), ['Mario Rossi', 'Bianchi Anna', 'Luca De Santis', 'Paola Neri', 'Giulia Verdi', 'Anna-Maria Ferri']);
});

test('splitNames: virgole, punti e virgola e righe', () => {
  assert.deepEqual(splitNames(' Marco,  Giulia ;Luca\nAnna  Maria '), ['Marco', 'Giulia', 'Luca', 'Anna Maria']);
});
