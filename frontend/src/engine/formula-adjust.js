import { colLabel } from '../utils/cells.js'

// Convert column letters (e.g. "AB") to 0-based index.
function _colIndex(letters) {
  return letters.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1
}

// Shift a single cell reference token by (dr, dc), respecting $ anchors.
function _shiftRef(cDollar, colStr, rDollar, rowStr, dr, dc) {
  const col = _colIndex(colStr)
  const row = parseInt(rowStr, 10) - 1
  const newCol = cDollar ? col : col + dc
  const newRow = rDollar ? row : row + dr
  if (newCol < 0 || newRow < 0) return `${cDollar}${colStr}${rDollar}${rowStr}`
  return `${cDollar}${colLabel(newCol)}${rDollar}${newRow + 1}`
}

// Adjust all relative cell references in a formula by (dr, dc) rows/cols.
// Absolute refs (prefixed with $) are left unchanged.
// The (?!!) negative lookahead skips sequences like SHEET2! (sheet-name identifiers).
export function adjustFormula(formula, dr, dc) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) return formula
  if (dr === 0 && dc === 0) return formula
  return formula.replace(/(\$?)([A-Za-z]+)(\$?)(\d+)(?!!)/g, (_, cDollar, colStr, rDollar, rowStr) =>
    _shiftRef(cDollar, colStr.toUpperCase(), rDollar, rowStr, dr, dc)
  )
}
