import { COLORS, COL_HEADER_H, ROW_HEADER_W } from '../constants.js'
import { cellId } from '../../utils/cells.js'

export function createSelectionPainter(ctx, { cw, rh, colX, rowY }) {

  function drawSelFill({ r0, c0, r1, c1 }) {
    const x = colX(c0), y = rowY(r0)
    const w = colX(c1) + cw(c1) - x
    const h = rowY(r1) + rh(r1) - y
    ctx.fillStyle = COLORS.selFill
    ctx.fillRect(x, y, w, h)
  }

  function drawSelectionBorder(sel, range, fc, fr, mainX, mainY, cssW, cssH, getMergeInfo) {
    const activeMerge = getMergeInfo ? getMergeInfo(cellId(sel.r, sel.c)) : null
    const spanC = activeMerge ? activeMerge.colSpan : 1
    const spanR = activeMerge ? activeMerge.rowSpan : 1
    let mergedW = 0, mergedH = 0
    for (let i = 0; i < spanC; i++) mergedW += cw(sel.c + i)
    for (let i = 0; i < spanR; i++) mergedH += rh(sel.r + i)

    const clipX = sel.c < fc ? ROW_HEADER_W : mainX
    const clipY = sel.r < fr ? COL_HEADER_H : mainY
    ctx.save()
    ctx.beginPath()
    ctx.rect(clipX, clipY, Math.max(0, cssW - clipX), Math.max(0, cssH - clipY))
    ctx.clip()
    ctx.strokeStyle = COLORS.selBorder
    ctx.lineWidth = 2
    ctx.strokeRect(colX(sel.c) + 1, rowY(sel.r) + 1, mergedW - 2, mergedH - 2)
    ctx.lineWidth = 1
    _drawFillHandle(range)
    ctx.restore()
  }

  function _drawFillHandle({ r1, c1 }) {
    const hx = colX(c1) + cw(c1)
    const hy = rowY(r1) + rh(r1)
    ctx.save()
    // White ring so the dot stands out against the cell border
    ctx.fillStyle = COLORS.white
    ctx.beginPath()
    ctx.arc(hx, hy, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = COLORS.selHandle
    ctx.beginPath()
    ctx.arc(hx, hy, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  function drawMarchingAnts({ r0, c0, r1, c1 }, phase) {
    const x = colX(c0) + 1, y = rowY(r0) + 1
    const w = colX(c1) + cw(c1) - x - 1
    const h = rowY(r1) + rh(r1) - y - 1
    ctx.save()
    ctx.lineWidth = 1
    ctx.strokeStyle = COLORS.selBorder
    ctx.setLineDash([4, 4])
    ctx.lineDashOffset = -phase
    ctx.strokeRect(x, y, w, h)
    ctx.restore()
  }

  function drawPickerRect({ r0, c0, r1, c1 }) {
    const x = colX(c0), y = rowY(r0)
    const w = colX(c1) + cw(c1) - x
    const h = rowY(r1) + rh(r1) - y
    ctx.save()
    ctx.fillStyle = COLORS.pickerFill
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = COLORS.pickerBorder
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5)
    ctx.restore()
  }

  return { drawSelFill, drawSelectionBorder, drawMarchingAnts, drawPickerRect }
}
